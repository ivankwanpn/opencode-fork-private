# TUI Native Provider Authentication

## Goal

Remove the TUI's V1 provider discovery and authentication calls while preserving
provider selection, OAuth code/automatic flows, API keys, and custom provider
credentials.

## Implementation

1. Hydrate provider/model catalogs and integrations through the native client.
2. Keep native integration records in sync state and render connection status
   from their connections.
3. Start OAuth with an integration method ID, complete code attempts explicitly,
   and poll automatic attempts until they settle.
4. Store API keys through the native integration endpoint. Permit a key for an
   unknown integration ID so custom provider credentials remain supported, but
   continue rejecting keys for known integrations that do not advertise a key
   method.
5. Re-bootstrap the catalog after a successful connection.

## Verification gate

Per the agreed Phase 8 workflow, defer tests, typecheck, and build until the
whole phase implementation is complete.
