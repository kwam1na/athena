# athena

## Harness

This repo uses a docs-first agent harness for `packages/athena-webapp` and `packages/storefront-webapp`.

Key repo-level commands:

- `bun run harness:test`
- `bun run harness:check`
- `bun run harness:audit`
- `bun run harness:review`
- `bun run harness:behavior --scenario <name>`
- `bun run harness:behavior --scenario <name> --record-video`
- `bun run architecture:check`
- `bun run pre-push:review`
- `bun run pr:athena`
- `bun run graphify:check`

`bun run harness:test` is the canonical harness implementation gate for harness scripts, graphify tooling, and pre-push review wiring.

List runtime behavior scenarios with `bun run harness:behavior --list`.
Bundled scenarios include:

- `sample-runtime-smoke`
- `athena-admin-shell-boot`
- `athena-convex-storefront-composition`
- `athena-convex-storefront-failure-visibility`

Add `--record-video` to persist browser-flow evidence under
`artifacts/harness-behavior/videos/<scenario>/<run-stamp>/`.

## Graphify

The repo keeps a graphify knowledge graph at `graphify-out/`.

Use `bun run graphify:check` as the non-mutating freshness gate for tracked graphify artifacts.

Use `bun run graphify:rebuild` as the repair path when the check reports stale artifacts. The rebuild command uses the interpreter recorded in `.graphify_python` (default `python3` in this repo).

If you need to repair the local graphify setup, make sure `python3` can import `graphify` and upgrade it with `python3 -m pip install --upgrade graphifyy`.

Tracked graphify artifacts:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`

Local-only graphify artifacts:

- `graphify-out/cache/`

`graphify-out/cache/` is intentionally ignored because it is a large local acceleration cache, not a reviewable source artifact.
