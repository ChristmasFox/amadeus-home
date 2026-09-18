# WhatsApp secondary account switch checkpoint

- Date: 2026-09-18 Asia/Shanghai
- Change: replaced the previously linked WhatsApp Web account with account id
  `secondary`; the new account was paired through the OpenClaw login flow.
- Runtime config: `channels.whatsapp.defaultAccount=secondary` and
  `channels.whatsapp.accounts.secondary.enabled=true`.
- Verification: `channels status --channel whatsapp --json` reports the
  `secondary` account linked, connected, healthy, and with no status issues.
- Old account handling: its credentials were moved, not deleted, to
  `/DATA/AppData/openclaw/backups/openclaw-whatsapp-before-secondary-20260918-125109/legacy-default-whatsapp-creds`.
- Source updates: the OpenClaw example and project/state docs now describe the
  `secondary` account; pairing credentials remain external and untracked.
