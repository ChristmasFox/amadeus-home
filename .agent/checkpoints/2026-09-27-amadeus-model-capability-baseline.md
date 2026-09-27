# Amadeus model-capability adapter — pre-change policy and runtime baseline

Date: 2026-09-27 local. Goal: `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`.
This is read-only baseline evidence, **not** a production apply or a completed
rollback checkpoint. No group identifiers, sender identifiers, credentials,
prompts, generated media, or voice samples are recorded here.

- Source base: `5705e79ab62b65fc1ce114077e36569c756d2a68` (version 1.6.4).
- Live OpenClaw: `local/openclaw-amadeus:git-b389e869d6a2-20260927084301`,
  image digest `sha256:2d985de9f458da4211767d5c5984dc79a10e7b7f8c42a42c7394c33ef90cf366`;
  container healthy at baseline. Live 9Router:
  `local/9router:git-0296df534708-20260925T051532Z`, digest
  `sha256:5ce7653f8b258a4166ebb95856939b6546986296905985bcb96d8629a81b7696`.
- Authenticated loopback 9Router management read: `arthur-combo` and
  `dev-combo` exist; `amadeus-image` does not. Global Combo strategy is
  `fallback`; there is no `amadeus-image` override. No provider/account or
  alias write was performed.
- Live OpenClaw config read-only projection: full tool profile, global Agent
  deny `tts,message`; non-owner sender wildcard permits only `web_search` and
  `web_fetch`; exact owner sender matches permit `*`. Both WhatsApp and
  Telegram have one wildcard group rule, with no group-scoped tool override;
  neither channel has a direct-chat override. Image default is still the
  concrete Gemini model; `tts.auto=inbound`.

## C1 effective tool surface before change

The pinned 2026.9.4 policy applies global deny and then sender allowlists to
the remaining native tools. With no group-scoped override:

| Originating requester | `image_generate` | Effective representative tools |
| --- | --- | --- |
| Owner, WhatsApp direct chat | Present | Full profile minus globally denied `tts,message` |
| Owner, WhatsApp group chat | Present | Same owner profile; no group tool override |
| Non-owner, admitted WhatsApp/Telegram group | Absent | `web_search,web_fetch` only |

This is **sender-policy filtering**, not an approval workflow. The production
change must not make image generation available to non-owner WhatsApp direct
chats or lift the global `tts,message` deny. The source-managed group policy
and pinned OpenClaw policy integration are being tested against that boundary.

The protected external OpenClaw config/image rollback checkpoint and the
minimal 9Router Combo pre-apply snapshot are pending and must precede any
production mutation.
