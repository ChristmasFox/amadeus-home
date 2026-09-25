# Amadeus 1.5.3

Keep WhatsApp voice replies responsive through final delivery while preserving the bilingual voice contract.

- Refresh WhatsApp composing during an active audio reply and clear it after PTT/text delivery, cancellation, failure, disconnect, or the 120-second safety limit.
- Queue same-session WhatsApp messages during an active voice turn so they do not steer or alter the current reply; leave typed-only behavior unchanged.
- Add pinned lifecycle regression tests and checkpoint the mounted WhatsApp package before deployment patches.
