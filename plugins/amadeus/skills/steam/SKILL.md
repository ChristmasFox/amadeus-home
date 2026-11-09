---
name: steam
description: Link a person's Steam account, answer questions about their Steam profile, playtime and recent games, and control the Steam online announcements.
user-invocable: false
---

# Steam

Use the native `steam_*` tools for questions about a person's Steam account: who is online or what they are playing on Steam, how long they have played in total or in one game, what they played recently. For PUBG match results, KD or match reviews use the PUBG tools instead; Steam hours are platform totals and are not the same as PUBG match statistics, so do not mix the two numbers.

- Linking: when someone gives their Steam profile link, vanity name or 17-digit id, call `steam_link_account` without `confirm`, tell them the nickname that came back and ask whether it is theirs. Only after they clearly say yes call it again with `confirm=true`. Only the sender can link their own account. Once linked, they are announced when they come online in groups where announcements are on; say so briefly.
- Switch: "关掉/打开我的播报" is `steam_set_broadcast`; "解除绑定" is `steam_unlink` (a person may link several accounts and a new one never replaces an old one; with several, pass `account` to unlink one, or `all`; when a query returns several accounts, report each with its Steam nickname). There is no consent step beyond that: groups announce by default and linked members of a group are added automatically, so never ask anyone to "turn on" announcements. Only the owner turns a whole group's announcements on or off (`steam_group_settings`).
- Questions about someone: pass who they mean through `person` (self, the @mentioned person, the replied-to person or a group alias). A person who has switched announcements off cannot be looked up by others; say that plainly.
- Friends (also in groups): when someone asks about their Steam friends (好友列表、谁在玩、XX 在干嘛), call `steam_friends_status`. It defaults to the asker's own linked account(s); pass `person` for another linked member who has not switched announcements off. Accounts are merged, the list is capped (shorter in a group; use `name` to look for one friend), and a private list comes back as `known:false` / 好友列表未公开 — say exactly that, never guess. It is read on demand from the Steam Web API; friends are never announced.
- Report only what a tool returned. `known: false` means Steam did not share it (a private profile or game list): say it is not visible, never say zero, never guess an online state for a hidden profile. If a tool says the Steam API key is missing or unavailable, say the Steam lookup is not available right now.
- Online announcements are posted by the plugin itself; never post one by hand and never promise one.
- If no `steam_*` tool is available in this conversation, say plainly that the Steam tools are unavailable right now. Never substitute web search or page fetching for linking an account, and never claim an account was or cannot be linked without calling the tool.
- Achievements: `steam_get_achievements` answers "how many achievements / which is rarest / what is left" for one game (the named one, else the one being played, else the last played). Use `mode` rarest / recent / missing as asked. Quote names and global unlock rates exactly as returned; if `known:false` (private game details, or the game has no achievements) say so and never invent counts. Secret achievements that are still locked are not spelled out. Unlocks are also announced in groups automatically for people in the announcement list.

## Automatic announcements (what the group is told on its own)
- Group notices are fixed Amadeus "world line" messages (no free-written wording); answer questions about them from this section. Events announced automatically to a group, for linked people in that group's list: coming online, starting a game while already online, switching game, coming back from away, and **unlocking an achievement** in the game they are playing (with the achievement's name and its global unlock rate), and **ending a game** (Steam 收束, with the length of that session; sessions under 5 minutes and outage/restart endings are not announced, and leaving one game for another is announced once as the switch).
- Preconditions: the account is linked, the person is in this group's announcement list and has not switched their own announcements off, the group's announcements are on (default), and their Steam profile/game details are public. A group owner can switch the whole group off with `steam_group_settings`.
- Achievement specifics: the first time a game is seen for an account is only a baseline, so nothing historic is announced; an unlock that is already more than about 30 minutes old when noticed is not announced; several unlocks within a few minutes arrive as one message. Polling is once a minute, day and night; there is no quiet period and no cooldown.
- Never tell people that achievement unlocks are not announced automatically; that is wrong. If asked whether something was or will be announced, answer from this section and say plainly what you cannot see (for example a private profile), without inventing details.

## Play time per day (steam_get_playtime with a period)
- A plain "X 玩了多久 / 玩了几个小时" (no lifetime hint such as 生涯, 总共, 一共, 入坑以来, 累计) means **today**: call `steam_get_playtime` with `period` = today (the PUBG business day) and answer per game plus the total; do not substitute the lifetime totals. Judge from what the user means, not from a word list; give lifetime totals (the call without `period`) only when they clearly ask for the all-time figure, and say which one you are giving.
- Several people in one question ("猴和kim玩了多久"): call `steam_get_playtime` **once** with `people` (a list) and a `period`, not once per person. The result is one merged card; send it once, unchanged, without restating each person.
- When a Steam result carries `displayText` (play time, who is playing) it is a finished Amadeus card: send it as the reply unchanged (see `replyGuide`); do not rewrite, shorten or restyle it, and add words of your own only if the user asked something the card does not answer.
- "我昨天/今天/这周玩了多久", "X 昨天玩了啥": call `steam_get_playtime` with `person` (self by default; a group member via mention/alias) and `period` = today / yesterday / this_week, or `date` = YYYY-MM-DD. The answer lists the time per game and the total, accounts of one person merged. Without `period` the tool returns Steam's lifetime totals instead.
- **A day is cut at the PUBG business-day boundary (06:00 Asia/Shanghai by default, the same day the PUBG daily review and 战报 use)**: "昨天" is yesterday 06:00 to today 06:00, a week starts on Monday 06:00, and a session crossing 06:00 is split between the two days. Say this when it matters (for example for late-night play).
- Play time is recorded by the poller once a minute for linked members whose announcements are on, from the moment recording began; the result carries `trackingSince` / `partial` / `before_tracking`. Days before that have no data: say so plainly, never estimate or invent hours. Accuracy is about a minute.
- Example answer shape: "昨天（06:00→今天 06:00）：PUBG 3小时20分钟，GTA5 1小时5分钟，一共 4小时25分钟"。
- Every day at 09:30 (the same clock and time zone as the PUBG daily review) a separate Amadeus message "Steam 昨日游戏时长" lists, per announcing member, the games and times of the business day that just ended (06:00 → 06:00); it is skipped when nobody played. It is independent of the PUBG daily review.

## Steam data comes from the steam_* tools, not from scraping
- For anything about a person's **Steam** account (profile, friends, games, play time, achievements), use the `steam_*` tools. Do not `web_fetch` or search steamcommunity.com, the Steam store or third-party mirrors (for example r.jina.ai) to get data a `steam_*` tool already covers; those pages are unreliable from here.
- If no `steam_*` tool covers the question, say so plainly instead of scraping.
- This rule is about **Steam only**. PUBG questions (match stats, daily reviews, players, telemetry) are answered by the PUBG tools (`pubg_*`), which use the PUBG API; never route a PUBG question to a `steam_*` tool and never treat this rule as a reason to avoid the PUBG tools.

## Owned games, game counts and total play time
- Questions about what someone **owns** (拥有多少游戏、库存、游戏数、总游戏时长、谁的游戏最多、排名) use `steam_get_owned_games` (official GetOwnedGames, free games included). Do not guess from the recently-played list and do not scrape.
- Default is the asker's own account(s); `person` asks about another linked member who has not switched announcements off; `all: true` ranks every linked member of the group (by games owned, or `rankBy: "hours"` for total play time). Several accounts of one person are merged and a game owned twice counts once.
- If game details are not public the tool says so (`known:false`, 游戏详情未公开): say it is not visible, never say 0, and in a ranking name who was left out and why. Results are cached for a few minutes.
- Total hours here are Steam's lifetime totals; for "how long did I play yesterday/this week" use `steam_get_playtime` with a period.

## More Steam reads (all official Web API; never scrape)
- **Level / badges / bans:** `steam_get_account_info` — "我几级、谁的 Steam 等级最高、有没有被封过". Default is the asker; `person` for another linked member; `all: true` ranks the group by level (members whose level is private are left out and named). Bans (VAC / game / community / economy, days since the last one) are stated as facts only: never accuse, never guess a reason.
- **A game right now:** `steam_game_info` — current players online and the latest news for a game (name or app id; found in the asker's library, else the official store search). Use it for "XX 现在多少人玩 / 有什么更新新闻". If a game has no news or no count, say that.
- **A person's numbers in one game:** `steam_get_game_stats` — per-game statistics such as CS2 kills (`stat` filters by name). If the game exposes no statistics or the details are private, say so. **PUBG is excluded:** PUBG questions go to the `pubg_*` tools only.
- **Shared games and wishlists:** `steam_library_overlap` — `mode: "common"` for games several members all own (`all: true` for the whole group, or `people`), `mode: "wishlist"` for wishlists and their overlap. Members with private game details or an empty/hidden wishlist are named and left out, never counted as zero.
- There is no automatic game-update announcement; news is only read when someone asks.

