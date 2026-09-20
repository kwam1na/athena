# Athena Packages Agent Router

- Start with [the Graphify wiki index](../graphify-out/wiki/index.md) for repo-wide navigation, package landing pages, and graph hotspots.
- Use the package-specific wiki landing pages for graph-guided orientation:
  - [Athena Webapp graph page](../graphify-out/wiki/packages/athena-webapp.md)
  - [Storefront Webapp graph page](../graphify-out/wiki/packages/storefront-webapp.md)
  - [Valkey Proxy Server graph page](../graphify-out/wiki/packages/valkey-proxy-server.md)
- After you orient in graphify, switch to the package `AGENTS.md` files below for operational rules and validation.
- For `packages/athena-webapp`, start with [athena-webapp/AGENTS.md](./athena-webapp/AGENTS.md).
- For `packages/storefront-webapp`, start with [storefront-webapp/AGENTS.md](./storefront-webapp/AGENTS.md).
- For `packages/valkey-proxy-server`, start with [valkey-proxy-server/AGENTS.md](./valkey-proxy-server/AGENTS.md).
- If a task spans both apps, read both harnesses first, keep docs in sync with code, and finish with the root `bun run pr:athena` delivery gate.

Use focused package sensors while iterating; at the merge-ready boundary follow
root AGENTS.md and `bun run pr:athena`. The affected executor is opt-in
qualification, with legacy validation still authoritative. Its exact-membership
selection and product-owned evidence reuse do not replace independent review or
the delivery gate. Unknown consumers/configuration widen to the declared fallback;
full-health retains complete inventory and aggregate floors. See
[affected validation qualification](../docs/harness.md#affected-validation-qualification).

## Shared Repo Rules

## Git Branching
- After each merged checkpoint, start the next task from a new branch created from the latest `main`.
- Branch names must use the `codex/` prefix.

## PR Preparation
- Before opening or updating a PR, sync the working branch with the latest `origin/main` (merge or rebase).
- Run PR-equivalent test checks after syncing with `origin/main`.
- PR titles must use the format `[V26-123]: title`.
- Every PR body must include a direct Linear link at the end for the ticket referenced in the title.

## PR Body Format
- Every PR body must include these sections:
  - `## Summary`
  - `## Why`
  - `## Validation`
