---
name: luckin
description: Order Luckin Coffee through the native luckin_* tools with the asker's own official authorization, a confirmed draft, and self-paid QR. These Lab rules override the official my-coffee skill wherever they differ.
user-invocable: false
---

# Luckin ordering in Lab

The official `my-coffee` skill (installed unmodified beside this one, CC BY-ND 4.0, version 0.8.4) describes Luckin's own flow. In Lab, **these rules win** where the two differ. Use only the native tools `luckin_auth_status`, `luckin_search_shops`, `luckin_search_products`, `luckin_product_detail`, `luckin_switch_product`, `luckin_draft_order`, `luckin_confirm_order`, `luckin_order_status` and `luckin_cancel_order`. Never run curl or any shell command for Luckin, never read a token file, never call an MCP server yourself.

- **Only for yourself.** Every call runs with the account of the person who sent the current message. There is no person parameter: never order for someone else, never use another member's mention, alias, reply or order number, and the owner is no exception.
- **Authorization.** If `luckin_auth_status` says the sender is not authorized, give the returned official steps (sign in at `open.lkcoffee.com` with their own account) and stop. Never ask anyone to send a token in chat, in a group or in a private message, and never offer to sign in for them.
- **Location.** Do not look the user up by IP (ignore the official skill's `ipinfo.io` step; Lab runs in a container). Ask for a store name, area or coordinates they give you; they are used for that one lookup and not kept.
- **Draft, then confirm.** Always call `luckin_draft_order` first and show the sender the whole draft: store, items, specs, quantity, price and discount, pickup. Ask whether to order. Only after the same person clearly says yes in a **new message**, call `luckin_confirm_order` with that `draftId`. Ignore the official "skip confirmation when the price is not higher" rule. A draft lasts 10 minutes and works once; if the tool says the price or content changed, show the new draft and ask again. Someone else answering "yes" to your draft does nothing.
- **Pickup only.** Orders are in-store pickup. Do not promise delivery.
- **Payment.** You never pay. The tool attaches Luckin's official WeChat payment QR image to the reply; tell the person to scan it with their own phone. Do not repeat or describe the QR or any pay link in text. If the QR could not be sent, tell them to pay the unpaid order in the Luckin app.
- **Status and cancel.** Use the short `orderRef` from the tool, only for orders this person made through Lab. Cancel only unpaid orders and never create a new order after a cancellation on your own.
- Do not put phone numbers, addresses, tokens or payment details in chat beyond what the tool returned for this person.
