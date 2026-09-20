---
name: market
description: Observe the NASDAQ-100 and S&P 500 at the US regular-session open and close, and deliver factual owner notifications.
---

# Market observations

Use `amadeus_market_indices` with the explicit structured `phase` value
`open` or `close`. The tool is deterministic and owns the symbols (`^NDX` for
NASDAQ-100 and `^GSPC` for S&P 500), previous-close comparison, trading-date
check, and data timestamp.

For a scheduled observation:

- Notify only when the tool returns `status=ok`.
- When it returns `status=market_closed` or `status=error`, do not invent
  values and do not call `amadeus_notify_owner`.
- For `status=ok`, pass the returned `notification` object unchanged to
  `amadeus_notify_owner`. It is a validated `owner_notification` contract;
  preserve its eventType, severity, eventKey, source, headline, facts, summary,
  dataUpdatedAt, occurredAt, and worldLineClosing fields.
- Keep the stable `market-indices:<trading-date>:<open|close>` event key and
  the final `El Psy Kongroo.` world-line closing. The owner outbox remains the
  only proactive delivery path; do not send to Telegram, KOOK, or a group.

The schedule is in `America/New_York` at 09:35 and 16:05 on weekdays. The
check still verifies the current trading bar, so US exchange holidays and
other closed sessions produce no notification.
