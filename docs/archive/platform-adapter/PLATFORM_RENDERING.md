# Platform Rendering

## Pipeline

```text
StructuredResult
      ▼
PUBG Presentation Builder
      ▼
PresentationModel
      ▼
PlatformRenderer
      ▼
BotResponse.messages
      ▼
PlatformSender
```

实现位置：

- Core contract：`pubg-query-engine-v3/src/platform/core/contracts.ts`
- Generic renderer：`pubg-query-engine-v3/src/platform/core/renderer.ts`
- Chunking：`pubg-query-engine-v3/src/platform/core/chunking.ts`
- KOOK renderer：`pubg-query-engine-v3/src/platform/kook/renderer.ts`
- Telegram mock renderer：`pubg-query-engine-v3/src/platform/telegram/renderer.ts`
- PUBG presentation builder：`pubg-query-engine-v3/src/renderers/renderers.ts`

## PUBG Output

V3 的 Template A 保持不变：

- 纵向玩家卡片。
- KD 排名、击杀/死亡/助攻、伤害/场均、倒地/救援、吃鸡/Top10/最佳排名、Chicken Index。
- 小队总览与本期亮点。
- 禁止 Markdown 宽表格。

`renderResult()` 仍保留作为 V3 兼容文本模板；`buildPresentation()` 同时生成结构化 sections，Runtime 对外返回 `presentation` 和 `messages`。

## Platform Differences

KOOK 和 Telegram mock 当前都使用文字 Renderer，数据、排序和 Chicken Index 由同一 StructuredResult 提供，因此差异只允许出现在换行、消息长度和 transport payload，不允许改变 PUBG 数字。

## Sender Boundary

LangBot `KookAdapter.reply_response()` 是当前需要理解 LangBot MessageChain 的发送边界。它消费 Runtime 返回的 `messages` 分片；PUBG bridge 只传入 normalized message 并保留结构化结果，不读取 KOOK raw event。
