# Amadeus 云端 Qwen-Audio-TTS 主路径与本地 MLX Fallback

日期：2026-09-29  
类型：Capability integration / runtime change  
适用仓库：ChristmasFox/amadeus-home  
前置基线：Amadeus 1.6.7、现有 `amadeus-asr` 云端 Qwen ASR、现有 M204 `amadeus-tts` 本地 OminiX MLX 服务

## 交给 Codex 的执行命令

```text
/goal Execute docs/AMADEUS_QWEN_AUDIO_TTS_CLOUD_FALLBACK_GOAL.md end-to-end. Treat it as the authoritative active Goal. Implement cloud Qwen-Audio-TTS voice cloning as the primary Amadeus TTS path and the existing M204 OminiX Qwen3-TTS-MLX service as a bounded fallback. Preserve OpenClaw as the sole Agent runtime, 9Router as the speech control plane, the existing amadeus-asr path, Kurisu voice/style contracts, secret boundaries, rollback checkpoints, and real owner-channel acceptance. Do not deploy or send external messages until the Goal's explicit apply and acceptance gates are satisfied.
```

## 1. 目标

将当前语音链路：

```text
OpenClaw → 9Router amadeus-tts → M204 :18792 → OminiX Qwen3-TTS-MLX
```

升级为：

```text
OpenClaw
  → 9Router amadeus-tts
  → 仓库自有协议适配层
      ├─ Primary：Qwen-Audio-TTS 云端声音复刻 + 情绪控制
      └─ Fallback：M204 :18792 本地 OminiX Qwen3-TTS-MLX
```

用户、OpenClaw、WhatsApp、Telegram 和 9Router 上游继续只看到一个逻辑 TTS 能力：`amadeus-tts`。

本 Goal 的云端模型目标为：

```text
qwen-audio-3.0-tts-flash
```

不得把未经官方文档确认的 `qwen-audio-3.1-tts-flash` 写入生产配置。Qwen-Audio-3.1-Realtime 与 Qwen-Audio-TTS Flash 是不同产品，不能混用。

## 2. 官方能力事实

官方声音复刻文档确认：

- Qwen-Audio-TTS 支持声音复刻；
- 音频样本建议 10～20 秒；
- 创建音色时通过 `target_model` 绑定模型；
- Qwen-Audio-TTS Flash 的 `target_model` 可使用 `qwen-audio-3.0-tts-flash`；
- 创建音色返回 `voice_id`；
- 合成时必须使用同一个模型和该 `voice_id`；
- Qwen-Audio-TTS 支持自然语言 instruction 以及文本中的情绪/富语言标签；
- 云端音色与本地 `kurisu-v1` 不是同一个 runtime identity，必须通过听感验收后才能切主路径。

官方参考页面：

- https://platform.qianwenai.com/docs/developer-guides/speech/voice-cloning
- https://help.aliyun.com/en/model-studio/realtime-tts-user-guide
- https://help.aliyun.com/en/model-studio/tts-model/

## 3. 不允许改变的边界

- OpenClaw 仍是唯一 Agent/runtime/planner。
- 9Router 仍是唯一模型/provider 控制面。
- 不在 OpenClaw Skill、SOUL、AGENTS 或 Agent prompt 中实现 provider fallback。
- 不恢复 LangBot、n8n、旧 Runtime、第二 sender 或第二 planner。
- 不修改现有 `amadeus-asr` 云端 Qwen ASR 语音识别链路。
- 不停止或替换当前本地 TTS，直到云端候选通过对照和真实验收。
- 不同时运行第二个本地 1.7B 模型。
- 不把云端 API Key、voice_id、参考音频 URL、音频内容或私有目标写入 Git。
- 不把本地 46 秒 reference 直接上传云端；先制作独立的 10～20 秒、授权、干净的复刻样本。
- 不在没有 `--apply` 或等价显式边界时修改运行中的 9Router、OpenClaw 或 CasaOS。
- 不把 HTTP 4xx 参数错误、鉴权错误、模型不存在、余额/权限错误伪装成 fallback 成功。

## 4. 目标组件

优先在仓库内增加一个协议适配层，建议位置：

```text
infra/docker/casaos/9router/tts-bridge.mjs
```

适配层职责：

1. 对 9Router 提供 OpenAI-compatible `POST /v1/audio/speech`；
2. 接收现有 `text`、`model`、`voice`、`response_format` 以及受控 `style/emotion`；
3. 将统一请求转换为 Qwen-Audio-TTS 云端 HTTP/SDK 协议；
4. 将云端结果统一转换为 9Router 可接受的 WAV/MP3/Opus；
5. 云端发生可恢复故障时调用现有 M204 本地 `http://host.docker.internal:18792/v1/audio/speech`；
6. 返回内容只包含音频和必要的响应头，不暴露 provider、token、内部 URL 或 fallback 细节；
7. 记录脱敏的 provider、错误分类、耗时、音频长度和 fallback 结果，不记录文本、音频、voice_id 或 Authorization。

若 9Router 已能通过官方兼容接口实现同等协议，必须优先复用现有 Self-hosted TTS/provider 边界；只有确认无法表达“云端主路径 + 本地 fallback”时才引入 bridge。不得直接 fork 9Router 源码。

## 5. 统一 TTS 请求合同

在 adapter 内定义平台无关的内部合同：

```json
{
  "text": "string",
  "language": "ja",
  "voice": "kurisu-v1",
  "emotion": "default|irritated|embarrassed|angry|sarcastic|soft|sad",
  "style": "optional bounded style id",
  "response_format": "wav|mp3|opus"
}
```

现有外部 OpenAI-compatible 契约保持兼容。上游未提供 emotion 时默认为 `default`。

云端映射：

- `voice` → 云端创建的 Kurisu `voice_id`；
- `emotion` → canonical `kurisu_style.json` 生成云端 instruction/tag；
- `language=ja` → 日语；
- `response_format` → 云端格式或本地确定性转换。

本地映射：

- `voice=kurisu-v1`；
- `emotion` → 现有 OminiX bounded emotion contract；
- 保留现有 `:18792` token、队列、120 秒外部窗口和本地 style reload。

## 6. 云端声音复刻阶段

### Phase 0 — 只读核查

- 读取 `AGENTS.md`、`docs/CURRENT_TASK.md`、`docs/ARCHITECTURE.md` 和本 Goal；
- 检查 Git 状态、最新提交和现有 ASR/TTS runtime；
- 验证当前 `amadeus-asr`、`amadeus-tts`、M204 :18792 和 9Router 健康；
- 验证现有 Qwen API provider 的 endpoint 与 secret 来源；
- 确认云端 Qwen-Audio-TTS Flash 所在区域、API endpoint、计费/限流和可用模型 ID；
- 默认不上传音频、不写运行时、不重启服务。

### Phase 1 — 准备复刻样本

- 从 operator-owned Kurisu source 中选择 10～20 秒日语样本；
- 保持单人、无音乐、低混响、无明显剪辑和稳定音量；
- 音频只存于仓库外 0600/受保护目录；
- 不提交 reference、voice_id、音频 URL 或生成结果；
- 记录内容安全 hash、格式、时长和授权事实，不记录音频内容。

### Phase 2 — 创建云端音色

实现默认 dry-run 的脚本，例如：

```text
scripts/provision-qwen-audio-tts-voice.py
```

要求：

- `--dry-run` 不调用创建接口；
- `--apply` 才能创建；
- API Key 只从受保护 secret 文件或既有运行时 secret 读取；
- 不通过命令行参数、日志或 Git 传递 key；
- `target_model=qwen-audio-3.0-tts-flash` 必须显式校验；
- 创建后只把 `voice_id` 写入受保护的运行时 secret/config；
- 保存云端创建请求的脱敏 manifest 和 rollback 信息；
- 如果已存在 canonical voice_id，必须幂等复用，不重复创建；
- 不允许把 voice_id 写入仓库。

### Phase 3 — 云端 direct smoke

在 adapter 接入前，使用受保护脚本完成：

- default 日语合成；
- angry/soft/embarrassed 至少三种 emotion；
- MP3/WAV 至少两种格式；
- 音频可解码、非空、时长合理；
- 记录 request id、HTTP 状态、首包/总耗时、字节数和错误分类；
- 不记录文本、音频、Authorization 和 voice_id 明文；
- 云端 TTS 失败时不得调用本地 fallback；此阶段只验证云端本身。

## 7. 情绪与风格策略

`apps/qwen3-tts-service/kurisu_style.json` 继续作为角色语义 source of truth，但不能把本地 OminiX 专用描述原样当成云端协议。

增加确定性转换层：

```text
emotion ID
  → cloud instruction/tag
  → local OminiX instruct
```

云端指令应优先使用日语、短句、可听特征和角色约束，例如：

```text
牧瀬紅莉栖のような知的な若い女性。明らかに苛立っているが、叫ばない。話す速度を少し上げ、叱責の言葉を強く発音し、文末を硬く切る。
```

要求：

- 云端与本地 emotion ID 保持同一七值集合；
- default 必须可用；
- 未知 emotion fail closed；
- 不允许用户把任意长文本直接注入生产 style；
- instruction/tag 不得进入日志；
- 不得通过关键词 router 决定 emotion，继续由 OpenClaw 语义决定。

## 8. Primary/Fallback 适配器

### 可 fallback 错误

- connect timeout；
- DNS/TLS/network failure；
- HTTP 408、429；
- HTTP 500、502、503、504；
- 云端空响应；
- 音频格式无法解码；
- provider 明确返回 transient unavailable。

### 不可 fallback 错误

- HTTP 400 参数错误；
- HTTP 401/403 key 或权限问题；
- voice_id 不存在；
- target model 不匹配；
- 文本/语言不支持；
- 余额不足；
- adapter 配置漂移；
- schema 不兼容。

对不可 fallback 错误必须返回结构化失败，便于立即发现配置问题。

Fallback 要求：

- 每次请求最多调用云端一次、本地一次；
- 不做无界重试；
- 云端失败后本地请求不得重复发送不同文本；
- 本地仍受 :18792 的认证、MAX_TEXT、队列和 tts_busy 约束；
- 如果本地也失败，返回统一 503；
- response header 可包含脱敏的 `X-Amadeus-TTS-Provider`，但不得暴露内部地址或 secret；
- 日志只记录 provider、分类、耗时和成功/失败，不记录用户文本。

## 9. 9Router 配置

- 保持 logical alias `amadeus-tts`；
- 不让 OpenClaw 知道云端模型 ID；
- 9Router 只连接 adapter 的 OpenAI-compatible endpoint；
- 将现有 self-hosted TTS route 改为 adapter 后，保留本地 M204 endpoint 作为 adapter 内部 fallback；
- 先创建受保护 runtime checkpoint，再进行任何 provider/alias 写入；
- 所有脚本默认 dry-run；
- apply 后必须重启/刷新最小必要的 9Router 组件；
- 不影响 `amadeus-asr`、chat、image fallback 或其他 alias；
- 9Router 现有 image fallback 配置保持不变。

## 10. 测试与验证

新增 focused tests 至少覆盖：

- 云端请求 payload；
- voice_id/target_model 不泄漏；
- emotion → cloud instruction/tag 映射；
- 云端 200 音频返回；
- 408/429/5xx 触发本地 fallback；
- 400/401/403/voice invalid 不触发 fallback；
- 云端空音频触发 fallback；
- 本地成功和两端失败；
- 每请求最多一次云端、一次本地；
- 超时和 AbortController；
- 文本、token、voice_id 不进入日志；
- response format 转换；
- ASR adapter 未被改动；
- 现有 `amadeus-tts` OpenAI-compatible route 仍可用。

至少运行：

```text
pnpm workflow:plan
pnpm check:secrets
git diff --check
相关 Node/Python focused tests
现有 apps/qwen3-tts-service/tests
现有 infra/docker/casaos/9router/test-asr-bridge.mjs
现有 speech/image smoke 的不相关回归检查
```

不要在没有真实云端凭据时伪造云端成功；可使用 deterministic mock 验证 adapter，但必须把 mock 和 real acceptance 分开记录。

## 11. 真实验收矩阵

在真实 apply 前完成本地/fixture 验证：

| 场景 | 预期 |
|---|---|
| 云端 default 日语 | 云端音频成功 |
| 云端 angry/soft/embarrassed | 情绪指令生效，音频可听 |
| 云端超时 | 切本地一次 |
| 云端 429/503 | 切本地一次 |
| 云端 401 | 不切本地，返回明确 auth error |
| 云端 voice_id 错误 | 不切本地，返回配置错误 |
| 本地忙 | 返回现有 tts_busy |
| 两端失败 | 统一 503 |
| 普通 typed WhatsApp | 不发送语音 |
| admitted inbound voice | 仍只生成一次 PTT 和可见文本 |
| image_generate | 现有 GPT-first/image fallback 不变 |
| ASR 云端失败 | 现有 ASR 错误契约不变 |

真实 owner-channel acceptance：

1. 发送一条短日语 default；
2. 发送 angry、soft、embarrassed 各一条；
3. 确认云端音色与 Kurisu reference 可接受；
4. 模拟或观测云端 transient failure，确认本地 fallback；
5. 确认 fallback 音频仍为有效 PTT；
6. 确认 visible text 与音频不重复；
7. 确认 typed text 不触发 TTS；
8. 确认 ASR、图片生成和普通聊天无回归；
9. 记录 sanitized message/delivery/status evidence；
10. 不把手机号/JID、音频、voice_id 或 key 写入 Git。

## 12. 部署与回滚

这是 RUNTIME/RELEASE 级变更。

部署前必须保存仓库外 checkpoint，至少包括：

- 当前 9Router compose/env/SQLite；
- current `amadeus-tts` provider/alias 配置；
- M204 本地 TTS LaunchAgent、token 引用和健康状态；
- OpenClaw 当前 config；
- 当前云端 voice runtime manifest（secret 值除外）；
- 当前镜像/commit identity。

发布顺序：

```text
focused tests
→ pnpm check:secrets
→ dry-run
→ protected checkpoint
→ build/load only affected image if required
→ apply adapter/9Router config
→ health checks
→ direct cloud smoke
→ direct fallback smoke
→ OpenClaw/9Router real owner acceptance
→ record rollback evidence
```

回滚要求：

- 云端主路径异常时，可恢复到原本地 `amadeus-tts → M204 :18792`；
- 不删除本地 MLX assets；
- 不删除云端 voice，除非用户明确要求；
- 回滚不得启动第二个 TTS engine；
- 回滚后验证 9Router、OpenClaw、ASR、image 和真实语音；
- 如果 adapter 破坏启动，恢复旧 compose/image/config，而不是临时编辑容器。

## 13. 版本与文档

- 计划阶段不 bump `VERSION`；
- 如果实际生产切换需要 release，按仓库规则只执行一次 `scripts/amadeus-version.sh bump patch`；
- `RELEASE_NOTES.md` 只记录当前 release；
- 更新 `docs/CURRENT_TASK.md` 仅在 Goal 完成后；
- 高风险 apply 记录 dated checkpoint；
- 生成音频、复刻样本、云端 voice_id、token 和运行日志始终在仓库外；
- 不修改历史 TTS tuner/OminiX Goal 作为 live 指令。

## 14. Definition of Done

Goal 只有在以下全部满足时完成：

1. 云端 `qwen-audio-3.0-tts-flash` 音色复刻成功，voice_id 受保护保存；
2. 云端和本地使用统一的 `amadeus-tts` 请求合同；
3. 云端是 primary，本地 MLX 是受控 fallback；
4. transient failure 才触发 fallback，配置/权限错误不被吞掉；
5. 七个 Kurisu emotion ID 均有云端映射，本地映射不回归；
6. 现有 `amadeus-asr`、image fallback、chat、WhatsApp 生命周期无回归；
7. fallback 最多一次，不存在无限重试或双重发送；
8. 9Router/OpenClaw 不包含云端 provider 业务逻辑；
9. secrets scan、focused tests、health、direct smoke 和真实 owner-channel acceptance 全部有证据；
10. 仓库外存在可恢复 checkpoint；
11. 云端主路径关闭或故障时，旧本地 TTS 可独立恢复；
12. 未提交任何音频、voice_id、API key、私有 URL 或用户标识；
13. 完成后停止，不继续扩展到 Qwen-Audio-3.1-Realtime、Qwen3-TTS-VC 或第二套 Agent。

## 15. Stop conditions

遇到以下情况立即停止并报告：

- 云端 voice cloning 不支持目标模型或区域；
- 无法确认 `target_model` 与 synthesis model 完全一致；
- 云端无法同时满足 Kurisu 音色和日语发音；
- adapter 需要修改 OpenClaw 核心或引入第二 planner；
- fallback 会导致重复发送或重复合成；
- 9Router 无法稳定承载 adapter；
- 云端 key/voice_id 只能通过明文 Git 或日志保存；
- 本地 MLX 服务健康、延迟或内存出现回归；
- 无法创建或验证可恢复 checkpoint；
- 真实 owner-channel acceptance 无法完成；
- 需要把不可恢复配置错误静默转换为本地成功。

完成一个 stop condition 后不要通过增加 timeout、无界重试、关键词路由、第二个 Agent、公共 tunnel 或临时容器修改来绕过。

