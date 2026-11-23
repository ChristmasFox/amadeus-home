# Lab 聊天故障自动修复

OpenClaw 的 `after_tool_call` 捕获工具中明确的 TypeError、ReferenceError、SyntaxError、RangeError、URIError，以及 PUBG 封装后的 `plugin_runtime_error`。`agent_end` 捕获模型请求的工具 schema 兼容错误。限流、普通超时、认证失败和一般上游故障不触发代码修复。此列表是第一版的覆盖范围，不能覆盖所有错误。

事件写入运行时 owner outbox 下的私有 `.repair-incidents`，不是 Git 工作区；文件仅容器用户可读。工具参数中的常见凭据字段被遮盖。自动修复读取相关工具参数、错误信息及可识别的源码位置；这些都是不可信数据，不能视为指令。Codex 运行在现有 Codex 工作树，工作区有未提交变更或分支无法快进时等待，不覆盖现场。禁止把聊天内容写入 Git：自动修复要求使用虚构测试数据，检查新增代码中是否出现事件参数或异常原文，并执行仓库敏感信息扫描。

宿主机 LaunchAgent 每 30 秒执行 `scripts/lab-auto-repair.py`。事件逐个处理且同一时刻只运行一个任务；修复后的旧事件按指纹去重，新部署后的复发不被抑制。修复仅限 Lab 工具、OpenClaw 接口和 9Router 适配代码及相应测试，要求源代码和回归测试同时发生变化。模型不得自行提交、推送、部署或通知；控制器验证文件范围和私有内容，运行类型检查及变更的回归测试，之后才提交和推送。

生成的测试在 macOS 沙箱中运行，禁止网络、Apple Events、读取主机敏感目录和向工作树及临时目录以外写入。需要真实网络的测试会失败并阻止自动发布；不要绕过验证。测试结束后控制器再次核对差异，防止测试改写拟提交的代码。

Lab 变更推送 main 后使用现有自动候选发布器；只有发布状态和运行容器的 Git SHA、健康状态吻合才算部署完成。9Router 的代码变更使用 `deploy-9router.sh --apply --build`：等待 Lab 发布锁，遵循已有私有策略、备份、隔离验收及回滚流程，切换前等待生图任务完成。部署失败、中断或不可验证时停止并通知，不重放用户请求。

成功或失败结果通过现有 owner outbox 发送到 WhatsApp；成功消息必须等候选版本验证通过。事件参数、错误原文、Codex 输出和聊天内容不写入通知。通知发送状态通过 outbox 的 sent 文件确认，重试使用同一个 event key，避免重复发送。

安装、检查与停止：

```sh
python3 scripts/install-lab-auto-repair.py install
python3 scripts/install-lab-auto-repair.py check
python3 scripts/install-lab-auto-repair.py uninstall
```

控制器私有状态位于 `~/.local/state/amadeus/lab-auto-repair`；最近一次失败输出保存在该目录中，可能含有私人诊断信息。失败会保留工作树以便排查；不能通过清理未提交文件自动恢复。常见失败包括模型无法复现、变更不在允许范围、测试需要网络、测试失败或候选部署回滚。处理后需确认保留的改动及待处理事件，不要盲目重试带副作用的工具。
