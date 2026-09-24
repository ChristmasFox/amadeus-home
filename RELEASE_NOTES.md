# Amadeus 1.5.1

Keep the Longbridge trading-day calendar request within the service limit.

- Bound the default calendar window to fourteen days before and after the current date.
- Preserve explicit caller-provided start and end dates.
- Keep the OAuth-backed read-only market path and deterministic session contract.
