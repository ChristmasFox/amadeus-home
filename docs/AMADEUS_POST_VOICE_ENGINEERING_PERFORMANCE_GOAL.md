# Amadeus Post-Voice Engineering & TTS Performance Goal

更新时间：2026-09-26

## 1. Goal

语音功能已经完成并进入稳定阶段。下一阶段不再扩展新的 Voice 产品能力，而是对 Amadeus 做一次**工程化收敛 + TTS 性能专项优化**，目标是在不改变当前产品架构的前提下：

1. 恢复 Git 分支与生产状态的一致性，结束长期 Voice 集成分支；
2. 降低 Codex 日常开发的上下文、验证、checkpoint 和 Docker 构建成本；
3. 将当前 OpenClaw Voice compatibility patch 从持续膨胀的编译产物补丁收敛为窄适配层；
4. 精确拆解 Qwen3-TTS MPS 热路径，找到真实性能瓶颈；
5. 通过 reference/profile、language、backend 等受控实验显著降低日语短语音生成耗时；
6. 保持当前 OpenClaw 单 Agent、plugin/domain/presentation 边界和现有生产能力不回退。

本 Goal 是**性能与工程化 Goal**，不是新功能 Goal。

---

## 2. Current verified baseline

以当前 `work/amadeus-1.5.3-voice-io` / Amadeus `1.5.9` 为真实基线，不以仍停留在 `1.5.2` 的旧 `main` 作为实现事实来源。

当前已确认：

- OpenClaw 是唯一 Agent runtime；不得重新引入 LangBot、n8n、Mastra、LangGraph、第二 planner 或第二 sender；
- WhatsApp voice 已完成 ASR → Agent → Japanese TTS → PTT 的真实链路；
- 去掉冗余 Voice Skill `read` 后，已有 direct-DM 样本：
  - ASR ≈ `0.7s`；
  - Agent 单次模型调用 ≈ `3.47s`；
  - Qwen3-TTS + MP3 ≈ `35.16s`；
  - 总端到端 ≈ `42.46s`；
- 另一组分段 timing 已显示 MP3 encode 仅约 `0.2–0.3s`，而 engine generation 可在约 `15.8–39.7s` 之间波动；
- 现有 Qwen3-TTS service：
  - `Qwen/Qwen3-TTS-12Hz-1.7B-Base`；
  - PyTorch MPS / FP16；
  - resident model；
  - reusable voice clone prompt；
  - `x_vector_only_mode=False`；
  - 当前 private voice reference 约 `46s`；
  - requests 在 engine 内通过单个 `threading.Lock` 串行；
  - `language="Auto"`；
- 历史存在长语音 inference 长时间占 lock，导致后续短句一起阻塞以及 120s TTS timeout 的事实；
- `scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs` 已同时承担 lifecycle、queue、TTS input selection、visible text/audio guard 等职责，并直接 patch pinned OpenClaw 编译产物；
- 当前 Voice 工作分支相对 `main` 已积累大量提交，不能继续把它当长期开发主线。

所有优化必须先保留上述 baseline evidence，再进行改变；不要用主观感受替代 benchmark。

---

## 3. Non-goals / hard constraints

### 3.1 不换顶层 Agent 架构

禁止为了本 Goal：

- 替换 OpenClaw；
- 引入第二 Agent runtime；
- 引入新的关键词路由；
- 把 deterministic domain 逻辑重新塞回 prompt/SOUL；
- 为了 TTS 性能把 voice routing 特化到业务 domain。

现有架构方向保持：

```text
Channel
  -> OpenClaw
    -> native plugin / Skill
      -> deterministic capability/domain
    -> native TTS boundary
```

### 3.2 不通过延长 timeout 掩盖慢推理

当前目标是降低 inference latency，而不是把 120s 改成更大的数字。

除非真实 benchmark 证明现有 timeout 与正常 p95 冲突，否则不得把“延长等待”作为性能修复。

### 3.3 不先优化 ffmpeg

已有 evidence 显示 MP3 encode 约 `0.2–0.3s`，当前主要瓶颈不在 format encode。

可以在后续为了简化链路评估 direct Opus，但它不是 P0 性能工作。

### 3.4 不牺牲 Kurisu voice quality 后直接宣称成功

TTS backend、reference length、x-vector-only、量化模型等改变都必须包含：

- latency benchmark；
- voice quality 人工听感验收；
- 日语自然度验收；
- 与当前 profile 的可回滚对照。

速度更快但音色明显退化不能直接替代生产。

### 3.5 不边优化边增加新 Voice 产品需求

本 Goal 执行期间，除非是阻断性回归，否则不新增：

- 新语音语言策略；
- 新 channel voice feature；
- 新 persona 规则；
- 新 TTS UI/命令；
- 新业务 Skill。

先完成收敛和性能基线。

---

## 4. Success metrics

### P0 engineering success

- 当前 Voice 1.5.9 状态被整理成可从 canonical branch 重建的 source of truth；
- 不再保留“生产已经 1.5.9、默认 main 仍 1.5.2”的长期漂移状态；
- 普通源码修改不再默认触发 release/checkpoint/documentation ceremony；
- 日常 Voice/Amadeus targeted verification 可以在不 build Docker、不 deploy CasaOS 的情况下完成；
- OpenClaw Voice compatibility patch 的职责和变化面明显缩小，并有 regression tests 覆盖。

### P0 TTS observability success

每次 TTS request 至少能区分：

```text
queue_wait_ms
generate_or_model_ms
decode_or_postprocess_ms
wav_serialize_ms
encode_ms
total_ms
audio_duration_ms
RTF
input_length_bucket
```

如果当前 qwen-tts API 无法自然拆开 generate/decode，必须至少精确做到：

```text
queue_wait_ms
engine_inside_lock_ms
wav_serialize_ms
encode_ms
total_ms
RTF
```

并明确记录“不可进一步拆分”的 library boundary，不允许伪造阶段数据。

### TTS performance target

以下是优化目标，不是发布前的伪造门槛：

- routine Japanese reply（优先 `<=50` 日文字符）：
  - 目标 p50 TTS total `<=10s`；
  - 目标 p95 TTS total `<=15s`；
- ASR 保持约 `<=1s` 级；
- 不需要工具的常规 Agent turn 保持约 `3–5s` 级；
- 普通短语音端到端期望进入约 `10–18s` 级；
- 若当前硬件 / voice-quality constraint 下无法达到，必须输出真实 benchmark 和瓶颈结论，不得通过删内容、隐藏失败或增大 timeout 假装达标。

---

## 5. Execution phases

## Phase 0 — Freeze baseline and restore branch hygiene

### Objective

先结束 Voice 长期集成态，再开始性能优化。

### Tasks

1. 读取并确认：
   - `README.md`
   - `AGENTS.md`
   - `docs/ARCHITECTURE.md`
   - `docs/PROJECT_STATE.md`
   - `docs/CURRENT_TASK.md`
   - `.agent/state.md`
   - 本 Goal
2. 检查：
   - `git status --short --branch`
   - `git log --oneline --decorate --graph --all -30`
   - `main...HEAD` divergence；
3. 证明当前 `1.5.9` Voice runtime source 与 Git 对应；
4. 将已完成的 Voice release history 与真正当前状态分开：
   - `PROJECT_STATE` 只保留当前可操作状态和少量关键已知问题；
   - 历史 release/checkpoint 继续留作审计，不再要求新会话完整阅读；
5. 规划并执行当前 Voice branch 向 canonical `main` 的安全收口：
   - 优先 fast-forward / normal merge；
   - 若存在冲突，先停下来分析 source-of-truth，不得用 `ours/theirs` 粗暴覆盖；
   - merge 后必须确保 `main` 能表达当前生产 1.5.9 状态；
6. 后续工程化优化使用新的短生命周期 goal/work branch，不继续沿用 `work/amadeus-1.5.3-voice-io` 作为永久主线。

### Acceptance

- canonical branch 与当前生产 source 不再长期漂移；
- Git history 清楚；
- 当前 Voice release 可从 canonical source 重建；
- 不删除历史 checkpoint，仅停止把每个 checkpoint 当日常上下文。

---

## Phase 1 — Reduce Codex development ceremony

### Objective

减少“改一行代码需要大量状态文档、checkpoint、全量验证”的开发摩擦，同时保留真正高风险操作的审计和恢复能力。

### Tasks

1. 重写阶段完成规则：
   - 普通 FAST/RUNTIME 开发：只要求对应源码、focused test/typecheck、`git diff --check`；
   - checkpoint 仅用于：
     - deploy；
     - release；
     - migration；
     - storage/database mutation；
     - security-sensitive runtime change；
     - 需要明确 rollback point 的高风险操作；
2. `docs/CURRENT_TASK.md` 只描述当前 Goal、phase、blocked/open items；
3. `docs/PROJECT_STATE.md` 只描述当前系统事实，不再持续追加 release diary；
4. 如果必要，增加一个简短 canonical context 文件，例如 `docs/CONTEXT.md`，目标控制在约 100–200 行，避免每次 Codex session 读取大量历史；
5. 更新 `AGENTS.md` 的新会话读取规则，使新会话默认读取最小必要上下文；
6. 保留现有 secrets、rollback、production apply 安全边界，不因“提速”削弱它们。

### Acceptance

普通小改动不再产生无价值 checkpoint；新 Codex session 的必读上下文显著缩小；历史 evidence 仍可追溯。

---

## Phase 2 — Make local verification genuinely fast

### Objective

日常开发使用 targeted verification；全量 test 只在 CI/release/显式请求时运行。

### Tasks

1. 保留 `scripts/developer-workflow.sh` 的 diff-aware 设计，并继续修正 path ownership；
2. 新增或整理明确入口：

```text
pnpm verify:amadeus
pnpm verify:voice
pnpm verify:openclaw-patch
```

3. `verify:voice` 应只包含：
   - qwen service unit tests；
   - voice prompt/policy unit tests；
   - OpenClaw patch regression fixture；
   - syntax/type checks；
   - `git diff --check`；
   - 不下载模型；
   - 不跑真实 MPS；
   - 不 build Docker；
   - 不 deploy CasaOS；
4. 把真实硬件/运行时验证单独命名为：

```text
accept:voice
```

或等价显式入口；
5. root `pnpm test` 继续作为 full suite，但不作为 Codex 每次改动默认路径；
6. 测量 targeted verification 实际 wall time，并记录 baseline/after。

### Target

纯本地 `verify:voice` 尽量控制在约 `10s` 级；若依赖本身无法做到，报告真实构成，不人为跳过关键 test。

---

## Phase 3 — Instrument the real TTS hot path

### Objective

在改变模型前，先把 Qwen3-TTS 真正耗时拆开。

### Required service changes

1. 将 lock wait 与 inference 分离计时；
2. 将 HTTP request 外层 timing 与 engine 内部 timing 分离；
3. 记录 RTF：

```text
RTF = synthesis_wall_time / generated_audio_duration
```

4. 保持日志不包含：
   - 输入文本；
   - transcript；
   - voice reference；
   - 用户标识；
5. 对 timing 日志只保留长度 bucket 和阶段耗时；
6. 若 library boundary 允许，进一步拆 generate/decode；若不允许，只记录可真实测量边界。

### Queue safety

评估把“HTTP thread 直接等待 `threading.Lock`”改为明确 single inference worker + bounded queue：

```text
HTTP request
  -> bounded TTS queue
    -> one inference worker
      -> Qwen engine
```

要求：

- queue 长度必须有界；
- queue full 时快速 fail closed，例如 `503 tts_busy`；
- 不允许无限堆积到 120s timeout；
- 保留当前 single-model concurrency safety；
- shutdown/restart 行为可测试；
- 不引入第二 Agent/runtime。

### Acceptance

可以回答：一条慢请求到底慢在 queue、Qwen engine、serialization 还是 encoding；后续短请求不会因为无界等待而全部假死。

---

## Phase 4 — Controlled TTS benchmark matrix

### Objective

不用猜，系统比较 reference 长度、clone mode、language policy。

### Test text

建立固定、无敏感内容的日语 fixture，至少三档：

- short：约 20 日文字符；
- normal：约 50 日文字符；
- long：约 100 日文字符。

每一档每个配置至少运行 5 次；冷启动与 warmed run 分开。

### Reference/profile matrix

不得覆盖当前生产 profile。复制受保护 profile 做实验版本：

```text
A: current ~46s ICL baseline
B: ~15s clean reference
C: ~8s clean reference
D: ~5s clean reference
E: suitable short reference + x_vector_only_mode=True
```

reference 必须来自已有合法 private profile 的受控裁剪/替代，不得把实际音频提交 Git。

### Language matrix

至少比较：

```text
language="Auto"
language="Japanese"
```

Voice policy 已固定输出日语，因此若 `Japanese` 在质量不回退的情况下更稳定/更快，优先固定语言。

### Metrics

每次记录：

```text
profile_id
clone_mode
language
input_bucket
cold_or_warm
queue_wait_ms
engine_ms
encode_ms
total_ms
audio_duration_ms
RTF
success/error
```

不要记录实际文本或 voice bytes。

### Quality acceptance

性能数据之外，由 owner 人工听感确认：

- Kurisu voice similarity；
- 音质；
- 日语自然度；
- 是否出现明显 pronunciation regression；
- 音量/节奏是否异常。

最终选择必须是 latency + quality 的共同结果，而不是单纯最快配置。

---

## Phase 5 — MLX backend PoC on Apple Silicon

### Objective

验证 PyTorch MPS 是否本身是主要性能限制。

### Rules

1. 不替换现有 OpenAI-compatible API contract；
2. 在 TTS service 内引入可替换 engine boundary，例如：

```text
SpeechEngine
  |- QwenMpsEngine
  `- QwenMlxEngine   # experimental
```

3. MLX implementation 必须明确标记第三方/社区 backend，不伪装成 upstream official implementation；
4. 先做 side-by-side benchmark，不直接切生产；
5. 优先测试与当前 voice clone 能力对应的 1.7B 方案；可以评估 8-bit；
6. 如果必须使用 0.6B 才达到目标，必须单独进行 voice quality 对比；
7. 不把模型权重、reference、generated samples 提交 Git。

### Required comparison

相同 fixture / reference / output length 下比较：

```text
PyTorch MPS FP16 current
vs
MLX candidate
```

至少比较：

- startup/warmup；
- RSS / unified memory；
- p50/p95 total；
- RTF；
- output quality；
- crash/recovery；
- dependency complexity。

### Decision

只有在性能、质量、稳定性和维护成本整体更优时，才允许把 MLX 设为 production engine；否则保留 MPS 并记录 benchmark 结论。

---

## Phase 6 — Shrink OpenClaw Voice compatibility patch

### Objective

降低对 pinned OpenClaw compiled bundle 的字符串 patch 面积和升级风险。

### Tasks

1. 将可独立测试的纯逻辑从 `scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs` 移出，例如：
   - Japanese speech text selection；
   - voice payload normalization；
   - queue/lease state helper；
   - guard decisions；
2. compatibility patch 脚本只保留：
   - anchor discovery；
   - 最小 bridge injection；
   - marker/idempotency；
   - pinned-version fail-closed；
3. 所有纯逻辑用普通 TS/JS module + unit tests；
4. 为 OpenClaw 2026.9.4 pinned fixture 保留 integration patch regression；
5. 不为了“代码漂亮”强行 fork 整个 OpenClaw；
6. 如果 upstream 已存在稳定 hook 能替代某个 patch 点，优先迁移到官方 hook；若没有，保持窄 patch。

### Acceptance

- compatibility script 主要是 adapter，不再拥有业务/策略主体；
- OpenClaw minor upgrade 时能快速知道是哪一个 anchor 失效；
- Voice policy 不散落到多个 compiled-file replace block。

---

## Phase 7 — Docker build/cache optimization

### Objective

让日常 candidate build 不因小 patch/plugin 改动重跑昂贵系统依赖层。

### Tasks

重排 `infra/docker/casaos/openclaw/Dockerfile` layer，按变化频率排序：

```text
base image
  -> stable OS deps (ffmpeg)
  -> stable glibc/runtime compatibility
  -> dependency manifests / npm dependency install
  -> plugin dist + skills
  -> OpenClaw compatibility patch
```

根据实际 Docker dependency graph 调整，不机械照抄顺序。

重点验证：

- 只改 voice patch 时，不应重新 apt install ffmpeg；
- 只改 plugin dist 时，不应重新下载系统 glibc；
- `--build-auto` 仍只构建受影响 image；
- immutable Git image tag、rollback、CasaOS `--no-build` switch 规则保持。

可以评估独立 `openclaw-amadeus-base` image，但只有确实降低维护/构建时间时才引入；不要为了多一层抽象而增加 release complexity。

记录 before/after candidate build wall time。

---

## Phase 8 — Optional audio packaging simplification

这是 P2，不得抢占 engine optimization。

当前大致链路：

```text
Qwen -> WAV -> MP3 -> OpenClaw/WhatsApp -> Ogg/Opus -> PTT
```

TTS service 已支持 Opus。验证 OpenClaw / WhatsApp 当前 native delivery 是否可以安全接受 service 直接输出的 Ogg/Opus，从而减少一次格式转换。

只有同时满足：

- WhatsApp PTT 正常；
- MIME/container 正确；
- duration metadata 正常；
- 不破坏其他 TTS channel；

才切换。

即使成功，也把它视为链路简化和故障面缩减，而不是主要 latency win。

---

## 6. Verification strategy

### Per-code-change

只跑最低充分验证：

```text
focused unit tests
affected typecheck/syntax check
git diff --check
```

### TTS local unit phase

不得要求下载模型或真实 MPS。

### Real TTS benchmark phase

只在明确 benchmark/acceptance 阶段运行真实 MPS/MLX。

### Candidate runtime phase

需要真实 runtime 才能证明的改变使用 candidate apply；保留 rollback checkpoint，但不要在每个源码 commit deploy。

### Release phase

最终 production 切换才执行完整：

```text
tests
-> secrets
-> immutable image build if needed
-> protected checkpoint
-> CasaOS switch
-> health/smoke
-> real WhatsApp voice acceptance
-> release evidence
```

---

## 7. Required benchmark/report artifact

最终必须生成一个简洁、机器可复查的性能报告，例如：

`docs/reports/AMADEUS_TTS_PERFORMANCE_2026_09.md`

至少包含：

1. original production baseline；
2. instrumentation methodology；
3. reference/profile matrix；
4. Auto vs Japanese；
5. MPS vs MLX（若 MLX PoC 成功运行）；
6. p50 / p95 / min / max；
7. RTF；
8. memory；
9. owner quality acceptance；
10. chosen production configuration；
11. rejected alternatives and why；
12. remaining bottleneck；
13. rollback instructions。

报告不得包含实际用户 voice reference、transcript、secret 或消息内容。

---

## 8. Stop / rollback conditions

出现以下任一情况，停止当前优化并回滚到最近已验证状态：

- voice quality 明显退化；
- WhatsApp PTT 丢失或重复；
- typed input 被错误触发 TTS；
- voice request 污染普通 typed session policy；
- queue/worker 引入死锁或无法重启；
- OpenClaw patch anchor 不唯一；
- runtime source 与 Git 不一致；
- candidate 需要修改/暴露 secret；
- storage/database 出现非预期 side effect。

不得为了完成 Goal 绕过 fail-closed gate。

---

## 9. Definition of Done

本 Goal 只有在以下全部满足后完成：

### Source / engineering

- canonical branch 对应当前生产 source；
- Voice 长期 branch 已收口；
- Codex 新会话必读上下文显著精简；
- checkpoint policy 已从“每阶段”收敛为“高风险/部署/发布”；
- targeted verification 入口可用并有真实 wall-time evidence；
- OpenClaw Voice compatibility patch 的职责明显缩窄；
- Docker cache boundary 有 before/after evidence。

### TTS

- queue wait 与 engine timing 可区分；
- 已完成固定 fixture benchmark；
- 已比较至少 current 46s reference 与一个明显更短的 clean reference；
- 已比较 `Auto` vs `Japanese`；
- 已评估 x-vector-only 是否适合；
- 已完成 MLX PoC 或明确记录无法可靠运行的技术原因；
- 最终 engine/profile 配置经过 owner 听感确认；
- 真实 WhatsApp voice acceptance 通过；
- 性能报告已写入 Git；
- 所有 secrets/reference/generated sensitive audio 均未进入 Git。

### Performance

优先达到：

```text
routine <=50 Japanese chars
TTS p50 <= 10s
TTS p95 <= 15s
```

如果未达到，也允许 Goal 完成，但必须已经：

- 找到并证明剩余主要 bottleneck；
- 做完本 Goal 中合理的 MPS/reference/MLX 实验；
- 给出下一步基于 evidence 的选择；
- 不把未达到的数字描述成成功。

---

## 10. Codex execution policy

执行本 Goal 时：

1. 先建立 baseline，不直接开始重构；
2. 一次只改变一个主要变量；
3. benchmark 与 source change 分开提交；
4. 不手动指定 `/goal` token budget；
5. 不重复读取已经注入/已知的大型历史文档；
6. 遇到真实 runtime 问题优先增加可观测性，而不是直接叠加 hotfix；
7. 所有性能判断必须引用 benchmark evidence；
8. 不将当前 Goal 扩展成新 Voice feature roadmap；
9. 每个 phase 使用短生命周期 commit，避免再次积累几十个不可审查的混合提交；
10. 在任何生产 apply 前先保证 Git clean、source-of-truth 一致、rollback 可用。

推荐执行顺序：

```text
Phase 0  branch/source hygiene
  -> Phase 1 development ceremony reduction
  -> Phase 2 fast verification
  -> Phase 3 TTS instrumentation + bounded queue
  -> Phase 4 controlled MPS/reference benchmark
  -> Phase 5 MLX PoC
  -> Phase 6 patch shrink
  -> Phase 7 Docker cache optimization
  -> Phase 8 optional Opus simplification
  -> candidate acceptance
  -> final benchmark report
  -> release
```

不要并行改 TTS backend、reference profile、queue、OpenClaw patch 和 Dockerfile 后再测一次；那样无法归因性能变化。

---

## 11. Expected end state

目标结束后的 Amadeus 应保持当前产品架构，但变成更轻、更快、更容易继续开发：

```text
WhatsApp / Telegram
        |
        v
     OpenClaw
        |
        +--> plugins/amadeus / pubg
        |
        `--> voice boundary
               |
               v
         OpenAI-compatible TTS service
               |
               +-- production engine (benchmark-selected)
               `-- explicit experimental engine only if retained
```

工程流程应从：

```text
small change
-> large context read
-> many docs/checkpoints
-> broad test
-> image rebuild
-> deploy
```

收敛为：

```text
small change
-> focused context
-> focused verification
-> commit

real-runtime-needed change
-> candidate
-> benchmark / acceptance

release
-> full gate + rollback + evidence
```

最终标准不是“多写了多少框架和文档”，而是：**Amadeus 的单 Agent 架构继续稳定，开发迭代明显更快，语音回复的主要等待时间被真实测量并显著降低。**
