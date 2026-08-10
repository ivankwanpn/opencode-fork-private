# OpenAI OAuth Attempt Lifecycle

## Problem

The V2 provider dialog starts an OAuth attempt through
`integration.oauth.connect`, but it does not call the existing
`integration.oauth.cancel` endpoint when the user goes back, closes the dialog,
or unmounts the component.

For OpenAI browser OAuth, the attempt owns the callback server on
`localhost:1455`. A leaked attempt therefore leaves the port occupied. Starting
the browser method again fails with `EADDRINUSE`, which the server currently
maps to `Authentication failed`.

The failure is reproducible in the dev desktop application:

1. Start `ChatGPT Pro/Plus (browser)`.
2. Return to the method list without completing authorization.
3. Start the browser method again.
4. The second `POST /api/integration/openai/connect/oauth` returns HTTP 400.

## Scope

Fix OAuth attempt ownership in the provider connection dialog. Do not change
OpenAI endpoints, callback ports, provider protocols, Core concurrency rules,
or generated clients.

## Design

Introduce a small OAuth attempt lifecycle controller used by
`dialog-connect-provider.tsx`.

The controller owns:

- a generation number for in-flight `connect` requests;
- the currently accepted OAuth attempt;
- the callback that invokes `integration.oauth.cancel`.

It provides these operations:

- `begin`: invalidate older connect responses and return the current generation;
- `accept`: accept an authorization only when its generation is current,
  otherwise cancel the stale authorization immediately;
- `cancel`: invalidate in-flight responses, clear the active authorization,
  cancel it through the server, and return a swallowed `Promise<void>` that
  callers may await before exposing an immediate retry;
- `complete`: invalidate in-flight responses and clear the active authorization
  without canceling a successfully completed attempt.

The provider dialog will:

- begin tracking before every OAuth connect request;
- accept the returned authorization before rendering it;
- await cancellation before method reset so an immediate retry cannot race the
  callback server shutdown;
- start best-effort cancellation on dialog cleanup and navigation away;
- complete tracking before closing after successful authorization;
- ignore cancellation failures because cancellation is best-effort cleanup and
  must not replace the primary UI result.

This also covers the race where the dialog closes while the connect request is
still pending: cleanup invalidates the generation, and the late response is
canceled as soon as it arrives.

## Error Handling

Starting an OAuth attempt continues to surface its existing server error.
Cancellation errors are swallowed after the lifecycle state is cleared, because
the attempt may already be terminal or the server may be an older compatibility
target without the V2 cancellation route. Awaiting cancellation therefore only
orders cleanup before an immediate retry; it never replaces the primary UI
result with a cancellation error.

## Testing

Unit tests for the lifecycle controller will verify:

- canceling an accepted attempt;
- canceling a response that arrives after cancellation;
- canceling only the active attempt when generations change;
- completing an attempt without sending cancellation;
- resolving cancellation even when the cancellation callback rejects, without
  an unhandled promise rejection.

The focused App tests and package typecheck will run after implementation.
The dev desktop flow will then be repeated twice to verify that returning from
the first OpenAI OAuth attempt releases port `1455` and the second attempt
starts successfully.
