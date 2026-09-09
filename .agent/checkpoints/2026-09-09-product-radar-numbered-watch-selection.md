# Product Radar numbered watch selection checkpoint — 2026-09-09

## Scope

为 Product Radar LangBot 入口增加低记忆成本的 Watch 操作：列表使用稳定的当前返回顺序编号；“取消监控”返回逐条选择按钮；按钮和“取消1号”都执行确定性的 Watch 删除并返回刷新后的列表；“查看1号 / 第2个监控的记录”复用序号上下文。

## Source changes

- `components/watch_presentation.py`：集中保存编号列表、删除菜单、Telegram callback data 的纯展示 helper。
- `components/intent_planner.py`：增加 `watchOrdinal` structured entity、`selectionRequired` structured field，以及受 Product Radar context 约束的 ordinal fallback；不改变 Luna 作为主语义路由。
- `components/context.py`：保存 caller-scoped `watchListIds`，context key 仍包含 platform、chat、sender、domain。
- `components/listeners/product_radar.py`：处理 `pr1:delete:<watchId>`，校验当前 caller 的列表映射，删除后重新列出 Watch。
- `main.py`：增加 caller-scoped 的最近列表映射；manifest 升级到 `0.5.1`。

## Verification

- LangBot Product Radar tests：29/29 passed。
- Python compile：passed。
- `git diff --check`：passed。
- Product Radar database：未创建、删除或修改真实 Watch。

## Release status

Source/doc changes are ready for commit. Live LangBot installation is pending; Product Radar runtime image and CasaOS compose are intentionally unchanged.
