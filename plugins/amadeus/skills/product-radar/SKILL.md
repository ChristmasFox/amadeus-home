---
name: product-radar
description: Manage Product Radar watches through explicit structured operations.
user-invocable: false
---

# Product Radar

Use `amadeus_product_radar` with an explicit structured `action`. Keep source,
target, rules, and watch identifiers in the tool input; do not parse commands
or add a keyword router. Report the service's returned status and details as
facts. Watch deletion, pause, resume, and execution remain bounded to the
explicit watch selected by the user.
