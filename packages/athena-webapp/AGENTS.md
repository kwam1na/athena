# Athena Webapp Agent Guide

- Use [the Athena Webapp graph page](../../graphify-out/wiki/packages/athena-webapp.md) for graph-guided orientation and hotspot discovery.
- Start implementation and validation from [docs/agent/index.md](./docs/agent/index.md); the local package docs are the operational source of truth.
- Read [docs/agent/architecture.md](./docs/agent/architecture.md) before changing router, auth-shell, or Convex boundaries.
- Use [docs/agent/testing.md](./docs/agent/testing.md) to choose the smallest honest validation set.
- Use [docs/agent/code-map.md](./docs/agent/code-map.md) when tracing ownership across `src/` and `convex/`.
- For product-copy changes, follow the repo guide at [../../docs/product-copy-tone.md](../../docs/product-copy-tone.md) and normalize operator-facing system text instead of surfacing raw backend phrasing.
- When generated Convex client artifacts need to refresh, start `bunx convex dev` from `packages/athena-webapp`. Do not use `bunx convex codegen` in this repo's normal agent flow because local workspaces may not have `CONVEX_DEPLOYMENT` configured.
