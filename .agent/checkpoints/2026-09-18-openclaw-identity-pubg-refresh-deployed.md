# OpenClaw Identity/PUBG preset refresh（线上切换）

日期：2026-09-18（Asia/Shanghai）  
状态：DEPLOYED_LIVE_REAL_INPUT_PENDING

## 发布结果

- 提交 `1ccd6f0` 已完成 Identity 8、PUBG domain 9、PUBG plugin 7、Amadeus 7 定向测试，
  受影响 build/typecheck、secrets scan、Docker image build 和 live apply。
- 新 OpenClaw image：
  `local/openclaw-amadeus:git-1ccd6f09c6f1-20260918103442`；容器状态 `running`、health
  `healthy`。
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918103442`；compose 已以
  immutable image 和 `--no-build` 启动。

## Preset 热刷新边界

- Amadeus IdentityStore 和 PUBG plugin 缓存 IdentityStore 都会在下一次相关 tool 调用前
  检查外部 preset 文件指纹。
- preset 文件新增或修改后，无需重启即可让 Identity 与 PUBG 边界看到新 Person、alias 和
  provider account；已确认绑定不会被低优先级 preset 覆盖。
- 线上当前没有外部 `identity-presets.json`，Identity 四张表保持 0 行，未伪造人物映射。

## 线上证据

- OpenClaw、Product Radar、media adapter network、NAS read-only smoke、owner WhatsApp outbox
  smoke 均通过。
- 生产 Telegram/WhatsApp ID/JID 不写入 Git；真实群成员映射等待用户填写外部 preset。

## 验收边界

仍需用户在真实 Telegram/WhatsApp 入口确认 sender binding、昵称/群 alias、PUBG account link，并
在产生非空数据后重启 OpenClaw 验证持久化。
