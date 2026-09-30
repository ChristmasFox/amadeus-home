# Follow-up: Kurisu GPT-SoVITS MLX optimization

- Date: 2026-09-29 (Asia/Shanghai)
- Status: `SUPERSEDED_BY_2026-10-01_QWEN3_TTS_MLX_REBASELINE`
- Resolution: the active rebaseline retires GPT-SoVITS rather than converting or optimizing it. This file is historical audit context only; do not execute its proposed follow-up.
- The upstream GPT-SoVITS v2Pro MPS candidate passed Gate B and is accepted for further integration.
- MLX conversion is intentionally deferred and must not be mixed into the MPS production cutover.

Future scope includes Japanese normalization/G2P, v2Pro checkpoint conversion, tensor/parity validation against the pinned upstream runtime, eight-line A/B comparison, resource measurements and a separate owner-approved production decision.
