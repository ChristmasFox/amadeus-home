# Product Radar follow-ups

- Run a real changedetection deployment smoke after explicit RELEASE approval, including create/update/delete and webhook delivery to Product Radar.
- Install the Product Radar LangBot plugin through the explicit plugin workflow and verify Telegram callback rendering plus KOOK text fallback without sending test notifications to real recipients.
- Add retry/backoff scheduling for failed notification outbox rows if operational behavior requires more than the current next-run retry.
