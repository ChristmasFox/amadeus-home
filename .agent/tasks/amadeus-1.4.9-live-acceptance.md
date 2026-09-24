# Amadeus 1.4.9 live acceptance

Source implementation is pushed at `32653e5`. Market runtime now requires the
official Longbridge SDK cache under
`/DATA/AppData/openclaw/data/longbridge-sdk-home/.longbridge/openapi/tokens`;
the operator exchange helper writes it alongside canonical OAuth state.

OAuth and host prerequisites are now provisioned on M204. The release image still needs deployment and
live acceptance:

1. Deploy the glibc-compatible release image with a protected rollback checkpoint.
2. Verify the 0600 OAuth state survives an OpenClaw restart without browser interaction.
3. Verify the two OpenClaw host tools and launchd recovery.
4. Record sanitized live quote/session, public group scope, opening/closing preview and event-idempotency
   evidence; never record tokens or private account material.
