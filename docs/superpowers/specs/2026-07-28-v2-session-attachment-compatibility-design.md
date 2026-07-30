# V2 Session Attachment Compatibility

## Problem

Opening an existing V2 session that contains an attachment can crash the App
renderer in `userParts()` with:

```text
TypeError: Cannot read properties of undefined (reading 'type')
```

The durable V2 attachment shape stores the renderable location at top-level
`uri`. Its optional `source` is mention metadata:

```ts
{ uri, mime, name?, source?: { text, start, end } }
```

The App converter still assumes the legacy shape, where `source` described how
to obtain the file and `mention` held mention metadata:

```ts
{ data, mime, name?, source: { type, uri? }, mention?: { text, start, end } }
```

A current V2 attachment without mention metadata therefore has no `source`, and
the stale `file.source.type` read crashes the whole session view. Sessions that
do not contain this attachment shape continue to open normally.

## Design

Keep compatibility at the App message projection boundary:

- prefer a current attachment's top-level `uri`;
- retain legacy URI and inline base64 URL conversion;
- accept current `source` or legacy `mention` as mention metadata;
- apply the same mention compatibility to agent attachments;
- leave persisted session data unchanged.

The projection should not discard attachments. This keeps current V2 sessions
renderable while preserving older records during the migration period.

## Scope

Only `packages/app/src/utils/session-message.ts` and its focused unit test are
changed. Protocol schemas, generated clients, durable rows, and attachment
materialization are not changed.

## Testing

