# Platform Capabilities

实现位置：`pubg-query-engine-v3/src/platform/core/capabilities.ts`。

| Platform | Markdown | Code block | Reply | Images | Files | Max text |
| --- | --- | --- | --- | --- | --- | ---: |
| `kook` | yes | yes | yes | yes | yes | 1800 |
| `telegram` | yes | yes | yes | yes | yes | 4096 |
| `wechat` | no | no | yes | yes | yes | 2000 |

这些能力属于平台层，不属于 PUBG Query Engine。PUBG 只生成 `PresentationModel`；平台 Renderer 再按能力输出 `BotResponse`。

## Canonical Names

内部只接受：

- `kook`
- `telegram`
- `wechat`

输入别名只在边界归一化，例如 `tg` → `telegram`、`wx` → `wechat`、`kook-bot` → `kook`。

## Message Splitting

`splitMessage()` 按段落、换行和空格优先切分，最后才硬切，避免在玩家卡片中间优先断开。当前只按文本长度切分；字节长度限制仍由已有 KOOK transport patch 兜底。
