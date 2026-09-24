# Amadeus 1.4.9 live acceptance

Source implementation is pushed at `32653e5`; the live 1.4.9 runtime is deployed and
the 1.5.1 market calendar hotfix is queued. Market runtime now requires the
official Longbridge SDK cache under
`/DATA/AppData/openclaw/data/longbridge-sdk-home/.longbridge/openapi/tokens`;
the operator exchange helper writes it alongside canonical OAuth state.

OAuth and host prerequisites are provisioned on M204. The 1.4.9 release image was deployed with
rollback checkpoints and live acceptance evidence:

1. Rebuild and deploy the 1.5.1 glibc-compatible image with a protected rollback checkpoint.
2. Re-run the 0600 OAuth state, official SDK quote/session, host tool, and launchd acceptance without
   browser interaction.
3. Record sanitized market/session and notification evidence; never record tokens or private account
   material.

The 1.5.0 live market session smoke still exposed Longbridge `301600 too many query days`; SDK probing
confirmed +/-14 days succeeds while +/-21 days fails. 1.5.1 bounds the default trading-day window to
 +/-14 days while preserving explicit dates. The deployed 1.5.0 image,
OAuth state, SDK cache, channel status, NAS read-only smoke, release notification, and maintenance
warning notifications are retained in the M204 checkpoint `amadeus-openclaw-20260924131115`.

Known external-service gap: M204 currently has no `media-organizer-adapter` container or rebuildable
source/image (only its protected state archive exists). The deployment script reports this as
`MEDIA_ADAPTER_NETWORK=skipped_missing_service` and does not invent a replacement. Media-organize live
acceptance remains pending until the external adapter source/image is restored through its own task.
