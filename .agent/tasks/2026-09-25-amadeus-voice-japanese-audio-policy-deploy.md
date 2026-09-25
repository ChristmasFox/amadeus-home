# Fixed Japanese voice-audio language policy — deployed

- Status: Amadeus 1.5.5 formal release deployed; post-release handset acceptance pending.
- Owner requested voice-response audio always stay Japanese even when asking for Chinese speech; ordinary text-message behavior remains unchanged.
- `VERSION=1.5.5`, release commit `07918b6`, pushed to `work/amadeus-1.5.3-voice-io`.
- Image `local/openclaw-amadeus:git-07918b6aea33-20260925164645`; rollback checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925164645`.
- Health passed, WhatsApp linked/connected, restart count 0, owner formal release notice sent.
- Owner retest still needed: (1) voice input explicitly asks for Chinese speech; PTT should remain Japanese and match the visible Japanese line, while keeping the Chinese summary; (2) typed-only language behavior unchanged.
- Non-blocking external-storage log-policy and maintenance warnings are separately tracked at `.agent/tasks/2026-09-26-post-deploy-storage-gate.md`.
