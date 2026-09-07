# Product Radar follow-ups

- User acceptance test: use LangBot to create one real Seller Watch and one real Product Watch, then inspect the resulting state without sending synthetic platform notifications.
- Verify Telegram callback rendering and KOOK text fallback during the user acceptance test; the plugin is already installed as task `24`.
- Add retry/backoff scheduling for failed notification outbox rows if operational behavior requires more than the current next-run retry.
