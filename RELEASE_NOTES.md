# Amadeus 1.1.2

PUBG 周期复盘现在按比赛实际开局时间正序输出，保证从第一局到最后一局阅读；“最近一局/最新比赛”仍保持最新优先，显式 `sort` 仍由调用方控制。
复盘链路继续由 LLM 识别语义意图，再使用结构化 `relative_period` selector；Domain 统一按 Asia/Shanghai 的 06:00 业务日解析，不再让模型自行计算日界线。
复盘必须使用当前会话内新鲜的 `pubg_search_matches` resultSetId；旧 matchId、旧 facts 或超过 5 分钟的搜索结果会被拒绝。Telemetry 状态改为 `HIT`、`FETCHED`、`UNAVAILABLE`，其中 `FETCHED` 明确表示官方请求成功并已写入缓存，底层 `cacheLookup=MISS` 不再被渲染成数据缺失。
小时预取、每日 00:00 的 `Amadeus • D-mail` 同步通知和 `dataUpdatedAt` 契约保持不变，通知继续以 `El Psy Kongroo.` 收束。
