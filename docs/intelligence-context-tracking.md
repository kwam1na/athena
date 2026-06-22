# Intelligence context tracking

Context tracking starts with browser-safe primitives in
`packages/athena-webapp/shared/intelligence`. Surfaces define the events they
emit on top of those primitives, then send envelopes to the backend tracking
boundary.

## Layers

- Shared primitives: event envelopes, payload compaction, idempotency keys,
  surface definitions, and compiled bundle types.
- Surface adapters: app-specific event catalogs such as storefront and Athena
  webapp context events.
- Convex tracking domain: event registration, append validation, idempotency
  protection, and durable event storage.
- Intelligence compilers: read source events or legacy source tables and emit
  ephemeral context bundles copied into `intelligenceContextSnapshot`.

The intelligence layer consumes compiled bundles. It should not reach directly
into surface analytics or raw event streams when generating prompts.
