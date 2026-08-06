# Intelligence context tracking

Context tracking starts with browser-safe primitives in
`packages/athena-webapp/shared/intelligence`. Surfaces define the events they
emit on top of those primitives, then send envelopes to the backend tracking
boundary.

## Layers

- Shared primitives: event envelopes, payload compaction, idempotency keys,
  surface definitions, and compiled bundle types.
- Surface adapters: app-specific event catalogs such as storefront, Athena
  webapp, and shared-demo context events.
- Convex tracking domain: event registration, append validation, idempotency
  protection, and durable event storage.
- Intelligence compilers: read source events or legacy source tables and emit
  ephemeral context bundles copied into `intelligenceContextSnapshot`.

The intelligence layer consumes compiled bundles. It should not reach directly
into surface analytics or raw event streams when generating prompts.

## Operator-only surfaces

Not every surface feeds intelligence. The `shared_demo` surface records demo
visitor behavior for operators: its events are registered `support`-visible and
appended with `nonCompilable: true`, so they never enter a compiled bundle.
Choose that combination whenever a surface observes the people using Athena
rather than the merchant's own customers.
