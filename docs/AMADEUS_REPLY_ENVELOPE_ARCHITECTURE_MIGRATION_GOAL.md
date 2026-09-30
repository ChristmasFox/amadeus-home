> Historical-only audit evidence. Superseded by `docs/CURRENT_TASK.md`; retired contract names below are not live instructions or runtime dependencies.

# Amadeus ReplyEnvelope 架构一次性切换 Goal

更新时间：2026-09-29

## 1. Goal

彻底重构 Kurisu 的回复输出链路，解决以下问题：

- 明确要求语音回复时偶发只有文字；
- reply voice/default/normal 等内部控制信息泄露到 WhatsApp；
- heartbeat、cron、内部 handoff 偶发把 NO_REPLY 发给私聊；
- TTS、文本、静默和频道投递由多层补丁分别决定；
- 通过清理文本、恢复 marker、二次猜测等方式修补症状。

本 Goal 采用一次性切换到新架构：

- 不保留旧 [[amadeus:reply-modality=...]] 协议；
- 不保留旧 marker 兼容解析；
- 不保留旧文本清理兼容层；
- 不保留“缺少 TTS marker 时从双语文本恢复语音”的逻辑；
- 不保留多处对同一 payload 的重复修正；
- 不通过增加 timeout 掩盖 provider 慢或失败；
- 不新增第二个 Agent、第二个 planner 或第二个 sender。

完成后，回复 modality、可见文本、语音文本、情绪、静默和投递结果必须由一个结构化协议贯穿整个生命周期。

## 2. 当前事实与已确认根因

当前仓库基线为 main@28d40a2。重点源码：

- plugins/amadeus/src/reply-modality.ts
- plugins/amadeus/src/voice-reply-prompt.ts
- scripts/openclaw-voice-policy.mjs
- scripts/openclaw-voice-lease.mjs
- scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs
- infra/docker/casaos/9router/tts-bridge.mjs

### 2.1 TTS 总 deadline 不成立

当前 bridge 串行尝试：

1. Qwen 3.1，最多 80 秒；
2. Qwen 3.0，再最多 80 秒；
3. M204 本地 TTS，再最多 115 秒；
4. 如果云端返回音频 URL，下载和转换还可能继续占用时间。

OpenClaw TTS timeout 为 120 秒。因此一次云端异常就可能在本地 fallback 完成前触发 OpenClaw 超时，最后只发送文本。

新架构必须使用单一请求 deadline，所有 provider、音频下载和转换共享剩余时间。

### 2.2 模型文本承载控制协议

当前模型把 modality 控制信息写进普通文本，再由多个 patch 解析和清理。这导致：

- 模型遗漏控制行时不会触发语音；
- 不同 hook 的执行顺序影响 TTS gate；
- 某条投递路径绕过清理时控制行泄露；
- NO_REPLY 前带 marker 时可能绕过核心精确静默判断；
- 同一个 payload 被 TTS patch、plugin hook、WhatsApp patch 多次改写。

新架构禁止把运行控制信息编码进用户可见文本。

### 2.3 状态清理早于最终投递

当前 agent_end 会清理 modality registry，但最终 TTS 和频道投递可能发生在 Agent 结束之后。决策状态和 delivery 生命周期不一致，导致：

- 语音恢复时找不到当前 turn 的 modality；
- 并发 turn 可能读取错误状态；
- agent_end、TTS finalization、WhatsApp settlement 各自拥有一部分生命周期。

新架构必须让一个 immutable ReplyEnvelope 从 Agent 输出一直传递到 delivery settled，settled 之后才销毁。

### 2.4 NO_REPLY 是字符串而不是状态

NO_REPLY 当前仍然通过普通文本传播，依赖多个地方识别。新架构必须把静默表示为：

~~~ts
silent: true
~~~

静默 envelope 不得进入 TTS、文本发送、WhatsApp typing 结束后的普通 reply sender，也不得写入频道 transcript 作为 outbound message。

## 3. 新架构契约

新增平台无关的结构化协议，建议放在：

~~~text
plugins/amadeus/src/reply-envelope.ts
plugins/amadeus/src/reply-planner.ts
plugins/amadeus/src/reply-delivery.ts
~~~

类型至少包含：

~~~ts
type ReplyModality = 'text' | 'voice';

type ReplyOrigin =
  | 'external_user'
  | 'inbound_voice'
  | 'heartbeat'
  | 'cron'
  | 'internal_handoff'
  | 'system';

type ReplyEnvelope = {
  version: 1;
  runId: string;
  sessionKey: string;
  channel: string;
  origin: ReplyOrigin;
  modality: ReplyModality;
  silent: boolean;
  visibleText: string;
  speechText?: string;
  emotion?: 'default' | 'irritated' | 'embarrassed' | 'angry' | 'sarcastic' | 'soft' | 'sad';
  source: 'agent_structured_output' | 'inbound_voice_policy' | 'system_silent';
};
~~~

硬约束：

1. silent=true 时不得有 visibleText、speechText、音频或发送动作。
2. modality=text 时不得触发 TTS。
3. modality=voice 时必须有有效 speechText；无效时进入明确的 text fallback 状态并记录原因。
4. speechText 必须是日语，不能从中文文本猜测。
5. 语音回复的 visibleText 由 planner 直接生成最终的中文/日语可见合同。
6. 频道 adapter 不得重新决定 modality，不得解析模型文本，不得清理控制 marker。
7. TTS provider 不得决定是否发送文字；它只接收 speechText 并返回音频结果。

## 4. Modality 决策方式

### 4.1 入站 WhatsApp 语音

入站音频是 runtime 的确定事实：

~~~text
origin = inbound_voice
modality = voice
~~~

不得依赖模型是否输出某个标签，也不得要求模型再次决定是否语音。

ASR 失败时：

- 不得把空 transcript 送入普通 Agent；
- 不得生成 ReplyEnvelope(modality=voice)；
- 通过明确的 text error envelope 或 channel error boundary 结束；
- 只允许一次用户可见错误消息。

### 4.2 外部 typed WhatsApp

typed turn 的 modality 必须由一个结构化 planner 产生，不得使用：

- 用户文本关键词正则；
- [[...]] marker；
- 双语文本形状推断；
- WhatsApp delivery 层的二次猜测。

planner 输出必须是严格结构化数据，例如：

~~~json
{
  "modality": "voice",
  "answer_plan": "answer_with_voice",
  "emotion": "soft"
}
~~~

planner 失败、格式非法或意图不明确时，默认：

~~~text
modality=text
~~~

planner 的结果必须绑定当前 runId，不能写入 session 级共享状态。

### 4.3 内部 turn

heartbeat、cron、内部 handoff、系统任务必须在 dispatch boundary 明确标记 origin。

- origin !== external_user 时，不注入 typed voice planner；
- 系统静默任务直接生成 silent=true；
- 内部任务不得经过 WhatsApp 普通用户 reply path；
- 不得依赖 NO_REPLY 字符串进行二次判断。

## 5. Agent 输出与 ReplyEnvelope 生成

实现一个唯一的 resolveReplyEnvelope：

~~~text
dispatch context
  -> origin/run/session
  -> modality planner or inbound voice policy
  -> Agent answer
  -> ReplyEnvelope
  -> TTS/text/silent delivery
~~~

要求：

- Agent 最终文本只能成为 visibleText 或 planner 指定的 speechText；
- 不允许 Agent 输出隐藏控制行；
- 不允许在 delivery 层从文本中提取日语；
- 不允许在 delivery 层把双语文本升级成 voice；
- 不允许一个 turn 生成两个 envelope；
- envelope 必须带唯一 runId 和 deliveryId。

如果当前 OpenClaw 2026.9.4 没有足够的原生 structured output hook，则在 Agent final boundary 建立一次严格 JSON schema 解析；解析失败直接 text fallback，不能退回 marker 协议。

## 6. 唯一 Delivery Pipeline

### 6.1 Text

~~~text
ReplyEnvelope(text)
  -> channel adapter.sendText(visibleText)
  -> record delivery result
~~~

### 6.2 Voice

~~~text
ReplyEnvelope(voice)
  -> TTS request(speechText, emotion, deadline)
  -> validate audio
  -> channel adapter.sendVoice(audio)
  -> optional sendText(visibleText) according to one explicit channel policy
  -> record one delivery result
~~~

WhatsApp 语音回复必须明确采用一种顺序，并全仓库统一：

- 语音 + 可见双语文本作为一次 envelope 的两个 delivery parts；
- 不能再由 ttsSupplement、mediaOnlyCoalescer、audioAsVoice 等多个历史字段分别决定。

### 6.3 Silent

~~~text
ReplyEnvelope(silent)
  -> no TTS
  -> no sendText
  -> no sendVoice
  -> no outbound message record
~~~

### 6.4 Exactly-once

以 deliveryId 做幂等键：

- 同一 deliveryId 只能产生一次 voice send；
- provider retry 不得重复频道发送；
- WhatsApp 重复 ingress 不得重复启动同一 Agent turn；
- typing/composing 只属于当前 envelope，settled 后停止。

## 7. TTS deadline 与 fallback

修改 infra/docker/casaos/9router/tts-bridge.mjs：

1. 请求入口生成唯一 deadline；
2. deadline 通过内部调用链传递；
3. 云端首选、云端备用、本地 provider 共享同一个剩余时间；
4. 每个 provider 必须在剩余时间不足时立即跳过；
5. 音频 URL 下载、ffmpeg 转换也必须受同一个 deadline 控制；
6. 禁止 80s + 80s + 115s 的串行预算；
7. provider fallback 结果必须返回结构化状态：
   - success
   - provider_timeout
   - provider_unavailable
   - audio_invalid
   - deadline_exceeded
   - busy
8. bridge 不返回内部控制文本，不返回 NO_REPLY，不修改 ReplyEnvelope。

推荐初始预算：

~~~text
OpenClaw 总预算：110s
├── cloud primary：25s
├── cloud secondary：25s
├── local fallback：55s
└── reserve：5s
~~~

实际值必须通过测试验证，但总和必须严格小于上层 timeout，并保留发送和转换余量。

## 8. 必须删除的旧实现

这是一次性迁移，完成后旧实现必须删除，不允许保留 dormant fallback。

### 删除控制 marker

- REPLY_MODALITY_MARKER_PREFIX
- REPLY_MODALITY_MARKER_SUFFIX
- parseReplyModalityMarker()
- parseAmadeusReplyModalityMarker()
- REPLY_MODALITY_RUNS_GLOBAL
- __amadeusReplyModalityRuns20260928
- 所有 [[amadeus:reply-modality=...]] 文本协议

### 删除文本清理和推断

- stripAmadeusTtsControlMarkers()
- ensureAmadeusJapaneseVoiceText()
- isAmadeusBilingualVoiceContract()
- resolveAmadeusJapaneseSpeechText()
- resolveAmadeusReplyModalityForTts()
- amadeusImplicitTypedWhatsAppVoice
- 从 visible text 恢复 speech text 的逻辑
- WhatsApp delivery 层的 marker scrub
- plugin reply_payload_sending 中的 marker 清理和 NO_REPLY 特判

### 删除重复 patch 职责

从 scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs 删除：

- TTS input selection；
- modality marker gate；
- Japanese visible text postprocessor；
- final delivery scrub；
- payload marker recovery；
- ttsSupplement / audioAsVoice 的历史兼容分支；
- 任何依赖字符串 anchor 的多阶段 payload 重写。

保留的 patch 只能负责 OpenClaw 没有原生 hook 的最窄 transport/lifecycle 接入；如果新 adapter 能完全替代某个 patch，则连 patch 一起删除。

### 删除旧 registry 生命周期

- setReplyModalityForTurn()
- getReplyModalityForTurn()
- clearReplyModalityForTurn()
- agent_end 中对 modality registry 的清理；
- session 级 modality fallback。

状态只能存放在当前 run 的 ReplyEnvelope 或 delivery context 中。

## 9. 测试要求

新增并通过以下测试。

### Unit

- text envelope 不触发 TTS；
- voice envelope 只使用 speechText；
- silent envelope 不触发任何发送；
- inbound voice 永远生成 voice modality；
- typed voice planner 输出结构化 voice；
- planner 失败默认 text；
- 非法 JSON 不进入 marker fallback；
- 两个并发 run 的 envelope 不串扰；
- agent_end 发生后 envelope 仍能完成 delivery；
- delivery settled 后 envelope 被销毁。

### TTS bridge

- primary 成功；
- primary 超时后在 deadline 内进入 secondary；
- secondary 超时后在 deadline 内进入 local；
- URL 下载超时；
- ffmpeg 转换超时；
- 总耗时永远不超过上层 deadline；
- provider failure 不会导致重复 send；
- 失败分类可观测但不泄露文本、token 或 voice id。

### WhatsApp

- 普通 typed DM：一条文字，无 TTS；
- 明确 typed voice：一次 TTS、一次 voice delivery、可见文本符合合同；
- inbound voice：一次 ASR、一次 TTS、一次 voice delivery；
- heartbeat/cron：零 outbound message；
- 内部任务返回 silent envelope：零 outbound message；
- 同一 inbound message 重试：不重复发送；
- 并发 typed/voice turns：互不串模态；
- TTS 失败：一次明确 text fallback，不发送空音频；
- 禁止出现 marker、reply voice/normal、NO_REPLY。

### Architecture checks

新增静态检查，禁止以下内容重新出现：

~~~text
[[amadeus:
reply-modality
NO_REPLY as outbound text
stripAmadeusTtsControlMarkers
ensureAmadeusJapaneseVoiceText
amadeusImplicitTypedWhatsAppVoice
session modality registry
~~~

## 10. 观测与故障定位

每个 run 记录结构化、脱敏的阶段信息：

~~~text
run_id
delivery_id
origin
modality
source
tts_requested
tts_provider
tts_attempt
deadline_ms
queue_wait_ms
provider_ms
audio_validation_ms
channel_send_ms
final_status
fallback_reason
~~~

禁止记录：

- 用户原文；
- transcript；
- 音频；
- 手机号；
- API key；
- voice enrollment 内容；
- 完整 provider URL 中的敏感参数。

必须能通过一条 run_id 判断：

1. 是否应当说话；
2. 是否请求 TTS；
3. TTS 尝试了哪些 provider；
4. 是否因为 deadline 放弃；
5. 是否发送了文字；
6. 是否发送了语音；
7. 是否发生重复发送。

## 11. 执行顺序

### Phase A — 新协议实现

- 新增 ReplyEnvelope 类型和 validator；
- 新增 origin/run/delivery context；
- 新增 planner 和唯一 envelope resolver；
- 新增 text/voice/silent 三条 delivery；
- 先写 focused tests。

### Phase B — 替换 OpenClaw 接入

- 将 WhatsApp inbound voice 接入 envelope；
- 将 typed WhatsApp 接入结构化 planner；
- 将 heartbeat/cron/internal handoff 接入 silent/origin；
- 删除旧 marker prompt 和 registry；
- 删除旧清理 hook。

### Phase C — 重写 TTS deadline

- 重写 bridge provider budget；
- 增加 deadline propagation；
- 增加 provider outcome telemetry；
- 验证云端、备用云端、本地 fallback；
- 不扩大 OpenClaw 120 秒 timeout。

### Phase D — 删除旧代码

- 删除本 Goal 第 8 节列出的全部符号和分支；
- 删除对应历史 tests，替换为新协议 tests；
- 更新 README、架构文档、CURRENT_TASK；
- 全仓库搜索确保无旧 marker、旧清理函数和 session registry。

### Phase E — 验证与真实验收

执行：

~~~sh
pnpm workflow:plan
pnpm check:secrets
pnpm exec tsc --noEmit
pnpm test
git diff --check
~~~

然后进行受控 runtime 验证：

1. 重启唯一 OpenClaw runtime；
2. 检查 TTS bridge health；
3. 发送普通文字；
4. 发送明确语音请求；
5. 发送 WhatsApp inbound voice；
6. 触发 heartbeat；
7. 检查 provider 超时 fallback；
8. 检查重复 ingress；
9. 检查运行日志中不存在旧协议内容。

只有以下条件全部满足才算完成：

- 普通文字没有音频；
- 明确语音请求稳定收到音频；
- inbound voice 稳定收到音频；
- TTS provider 异常时在上层 deadline 内得到明确 text fallback；
- heartbeat/cron 不产生私聊消息；
- 没有 marker、reply voice/normal、NO_REPLY 泄露；
- 同一 run 最多一次 voice send；
- 仓库中不再存在旧兼容层；
- 真实 WhatsApp 验收证据已记录。

## 12. 失败处理

禁止通过以下方式“修复”：

- 增加正则清理；
- 增加第二个 marker；
- 增加 session 级 fallback；
- 延长 OpenClaw timeout；
- 在 WhatsApp adapter 中猜测语音意图；
- 保留旧代码但不调用；
- 仅修改运行容器而不回写 Git；
- 只跑 fixture，不做真实 WhatsApp 验收。

如果 OpenClaw 原生 hook 不足，优先缩小 adapter 边界并明确失败，不得重新引入文本控制协议。

## 13. 交付物

完成后必须提交：

- ReplyEnvelope 类型、planner、validator、delivery；
- 新 TTS deadline/fallback 实现；
- OpenClaw/WhatsApp 最小接入；
- 删除旧 marker、registry、scrub、recovery 和重复 patch；
- focused/unit/integration/architecture tests；
- 更新后的架构文档；
- 真实验收 checkpoint；
- rollback 说明。

版本、部署和 runtime checkpoint 按仓库 AGENTS.md 执行。该 Goal 本身不自动触发生产部署；只有用户明确要求 deploy/release 时才执行。
