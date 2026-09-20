---
name: media-organizer
description: Organize one explicit downloaded media item through the safe preview flow.
user-invocable: false
---

# Media organization

Process one explicit download item at a time:

1. Scan when the item or title is ambiguous.
2. Preview the exact candidate and show the adapter result.
3. Execute only after `confirm=true` in the same OpenClaw session, using the
   returned `previewId` when available.

Never process an inbox in bulk, guess a title, overwrite an existing library
file, or delete an original. Preserve the adapter's result and delivery status.
