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
- Friends: only when the owner asks in their own direct chat about their own Steam friends (谁在玩、XX 在干嘛), call `steam_friends_status` (needs their own account linked first). Never use it or mention any friend in a group, and friends are never announced. A private friend list is `known:false`; friends who look offline may just have hidden profiles, so say "没在玩/看不到" rather than claiming they are offline.
- Report only what a tool returned. `known: false` means Steam did not share it (a private profile or game list): say it is not visible, never say zero, never guess an online state for a hidden profile. If a tool says the Steam API key is missing or unavailable, say the Steam lookup is not available right now.
- Online announcements are posted by the plugin itself; never post one by hand and never promise one.
- If no `steam_*` tool is available in this conversation, say plainly that the Steam tools are unavailable right now. Never substitute web search or page fetching for linking an account, and never claim an account was or cannot be linked without calling the tool.
- Achievements: `steam_get_achievements` answers "how many achievements / which is rarest / what is left" for one game (the named one, else the one being played, else the last played). Use `mode` rarest / recent / missing as asked. Quote names and global unlock rates exactly as returned; if `known:false` (private game details, or the game has no achievements) say so and never invent counts. Secret achievements that are still locked are not spelled out. Unlocks are also announced in groups automatically for people in the announcement list.

## Automatic announcements (what the group is told on its own)
- Events announced automatically to a group, for linked people in that group's list: coming online, starting a game while already online, switching game, coming back from away, and **unlocking an achievement** in the game they are playing (with the achievement's name and its global unlock rate).
- Preconditions: the account is linked, the person is in this group's announcement list and has not switched their own announcements off, the group's announcements are on (default), and their Steam profile/game details are public. A group owner can switch the whole group off with `steam_group_settings`.
- Achievement specifics: the first time a game is seen for an account is only a baseline, so nothing historic is announced; an unlock that is already more than about 30 minutes old when noticed is not announced; several unlocks within a few minutes arrive as one message. Polling is once a minute, day and night; there is no quiet period and no cooldown.
- Never tell people that achievement unlocks are not announced automatically; that is wrong. If asked whether something was or will be announced, answer from this section and say plainly what you cannot see (for example a private profile), without inventing details.

## Play time per day (steam_get_playtime with a period)
- "我昨天/今天/这周玩了多久", "X 昨天玩了啥": call `steam_get_playtime` with `person` (self by default; a group member via mention/alias) and `period` = today / yesterday / this_week, or `date` = YYYY-MM-DD. The answer lists the time per game and the total, accounts of one person merged. Without `period` the tool returns Steam's lifetime totals instead.
- **A day is cut at 06:00 Singapore time**: "昨天" is yesterday 06:00 to today 06:00, a week starts on Monday 06:00, and a session crossing 06:00 is split between the two days. Say this when it matters (for example for late-night play).
- Play time is recorded by the poller once a minute for linked members whose announcements are on, from the moment recording began; the result carries `trackingSince` / `partial` / `before_tracking`. Days before that have no data: say so plainly, never estimate or invent hours. Accuracy is about a minute.
- Example answer shape: "昨天（06:00→今天 06:00）：PUBG 3小时20分钟，GTA5 1小时5分钟，一共 4小时25分钟"。
- The 09:30 daily squad review also carries a 🎮 Steam 游戏时长 block for the business day that just ended.

