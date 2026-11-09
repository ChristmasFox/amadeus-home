---
name: steam
description: Link a person's Steam account, answer questions about their Steam profile, playtime and recent games, and control the Steam online announcements.
user-invocable: false
---

# Steam

Use the native `steam_*` tools for questions about a person's Steam account: who is online or what they are playing on Steam, how long they have played in total or in one game, what they played recently. For PUBG match results, KD or match reviews use the PUBG tools instead; Steam hours are platform totals and are not the same as PUBG match statistics, so do not mix the two numbers.

- Linking: when someone gives their Steam profile link, vanity name or 17-digit id, call `steam_link_account` without `confirm`, tell them the nickname that came back and ask whether it is theirs. Only after they clearly say yes call it again with `confirm=true`. Only the sender can link their own account. Once linked, they are announced when they come online in groups where announcements are on; say so briefly.
- Switch: "关掉/打开我的播报" is `steam_set_broadcast`; "解除绑定" is `steam_unlink`. There is no consent step beyond that. Only the owner turns a whole group's announcements on or off (`steam_group_settings`).
- Questions about someone: pass who they mean through `person` (self, the @mentioned person, the replied-to person or a group alias). A person who has switched announcements off cannot be looked up by others; say that plainly.
- Report only what a tool returned. `known: false` means Steam did not share it (a private profile or game list): say it is not visible, never say zero, never guess an online state for a hidden profile. If a tool says the Steam API key is missing or unavailable, say the Steam lookup is not available right now.
- Online announcements are posted by the plugin itself; never post one by hand and never promise one.
