# OpenClaw Identity preset refresh（线上切换）

日期：2026-09-18（Asia/Shanghai）  
状态：DEPLOYED_LIVE_REAL_INPUT_PENDING

## 发布结果

- 提交 `29ad1b9` 已完成 Identity/Amadeus 定向测试、受影响 build/typecheck、secrets scan、
  Docker image build 和 live apply。
- 新 OpenClaw image：
  `local/openclaw-amadeus:git-29ad1b946051-20260918102434`；容器状态 `running`、health
  `healthy`。
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918102434`；compose 已以
  immutable image 和 `--no-build` 启动。

## Preset 行为

- `IdentityStore` 按外部 preset 文件的 `mtimeMs:size` 指纹刷新；文件新增或修改后，下一次
  Identity tool 调用会导入新 preset。
- 缺失 preset 文件不会删除现有数据；预设只补充低优先级数据，不覆盖 owner-confirmed
  Person、alias 或 external account。
- 线上当前没有外部 `identity-presets.json`，Identity 四张表保持 0 行，未伪造人物映射。

## 线上证据

- OpenClaw、Product Radar、media adapter network、NAS read-only smoke、owner WhatsApp outbox
  smoke 均通过。
- 生产 Telegram/WhatsApp ID/JID 不写入 Git；真实群成员映射等待用户填写外部 preset。

## 验收边界

仍需用户在真实 Telegram/WhatsApp 入口确认 sender binding、昵称/群 alias、PUBG account link，并
在产生非空数据后重启 OpenClaw 验证持久化。
