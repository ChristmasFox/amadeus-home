# Fixture 说明

`matches.json` 是脱敏的归一化 Match fixture，字段仅包含比赛元数据和关注玩家统计，不包含 API Key、KOOK token 或完整原始响应。

`tests/pubg_query_engine_v2/test_core.py` 仍保留与该 fixture 等价的最小内嵌数据，用于保证单元测试不依赖文件系统或外部服务。

真实 PUBG API 只在必要的 integration smoke test 中调用；核心测试不访问外部 API。
