# PUBG 复盘全量测试 runner 卡点

- 日期：2026-09-11
- 状态：OPEN / FOLLOW-UP
- 现象：部署前执行根 `pnpm test` 时，测试输出完成前置模块和 supplemental 复盘测试后，进入 `review-v3-2.test.ts` 长时间无新输出；本次主动停止，未将中断过程计为通过。
- 当前边界：复盘模板相关定向测试 `18/18`、模板夹具 `3/3`、typecheck、secret scan、diff check 和线上只读 smoke 均已通过；本卡点不阻塞已完成的模板部署，但需要单独定位测试文件的 open handle 或 runner 生命周期问题。
- 下一步：使用单文件、单测试名和 open-handle 诊断逐项缩小卡点；修复后补跑根测试，不改变线上数据或发送平台消息。
