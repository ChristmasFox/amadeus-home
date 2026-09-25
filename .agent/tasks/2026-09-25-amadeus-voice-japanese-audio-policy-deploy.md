# Japanese voice-audio policy — hotfix follow-up

- Status: owner accepted the 1.5.5 hotfix candidate; 1.5.6 formal release is in progress.
- Sanitized trace showed the latest voice final as Chinese-only, with no `日本語：` label or `[[tts:text]]`; message text itself was not recorded.
- Root cause: pinned OpenClaw 2026.9.4 `message_received` mapping omits `runId`, while the voice Skill tracker previously required it. The Skill was not injected for that voice run.
- Hotfix binds an audio marker by `sessionKey` when runId is missing, promotes it to the actual run at `before_prompt_build`, and clears it on `agent_end`; TTL/size bounds and typed-only scope are preserved.
- Hotfix source: `plugins/amadeus/src/voice-reply-prompt.ts`; manifest/tracker regressions added.
- Keep `VERSION=1.5.5` for same-version candidate. After owner acceptance of Japanese PTT despite Chinese request and unchanged typed text behavior, bump patch to `1.5.6` and formally release.
