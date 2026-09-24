# Amadeus 1.4.9 live acceptance

Blocked only on external operator state, not source implementation:

1. Provision the Longbridge OAuth client id at the protected CasaOS secret path.
2. Run the M204 operator OAuth authorization and exchange flow; verify the
   0600 state file survives an OpenClaw restart without browser interaction.
3. Install `infra/macos/machostagent.py` through the explicit installer after
   placing a protected bearer token, then verify launchd recovery and the two
   OpenClaw host tools.
4. Record sanitized live quote/session, public group scope, opening/closing
   preview and event-idempotency evidence; never record tokens or private
   account material.
