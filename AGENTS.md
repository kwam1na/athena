# Athena Agent Guide

## Orientation

This is a monorepo with agent docs that are themselves validated by the harness. Route work through them:

- [packages/AGENTS.md](packages/AGENTS.md) — package router plus shared Git/PR rules.
- Per-package: `packages/<pkg>/AGENTS.md`, then `packages/<pkg>/docs/agent/*` — the operational source of truth for that package (`harness:check` fails when these docs go stale).
- For `athena-webapp`: read [docs/agent/architecture.md](packages/athena-webapp/docs/agent/architecture.md) before touching router/auth-shell/Convex boundaries, and [docs/agent/testing.md](packages/athena-webapp/docs/agent/testing.md) to pick the smallest honest validation set.
- Graph-guided navigation: [graphify-out/wiki/index.md](graphify-out/wiki/index.md).

## Repo shape

- Bun workspace, pinned to `bun@1.1.29` via `packageManager`. Use `bun`, not npm/pnpm/node.
- Packages:
  - `packages/athena-webapp` (`@athena/webapp`) — owner/operator app (React + Vite + TanStack Router) **and the entire Convex backend** under its `convex/` dir; public HTTP boundary is Hono composed in `convex/http.ts`.
  - `packages/storefront-webapp` (`@athena/storefront-webapp`) — customer storefront.
  - `packages/valkey-proxy-server` — local Valkey request/response proxy.
- Root `convex/` only holds `_generated/ai/guidelines.md`; the real backend is `packages/athena-webapp/convex`.
- After cloning: `bun install` (also points Git at `.husky/` hooks via the `prepare` script). Re-run it if hooks seem unconfigured.

## Commands

| Task | Command |
| --- | --- |
| Operator app dev server | `bun run --filter '@athena/webapp' dev` |
| Storefront dev server | `bun run --filter '@athena/storefront-webapp' dev` |
| Focused webapp test | from `packages/athena-webapp`: `bun run test -- path/to/file.test.ts -t "test name"` (use package-relative paths) |
| Webapp typecheck | `bun run --filter '@athena/webapp' typecheck` |
| Single Playwright spec | `bun run --filter '@athena/webapp' test:e2e -- src/tests/.../<spec>.ts` (builds the app and serves the production build first) |
| Runtime behavior scenarios | `bun run harness:behavior --list`, then `--scenario <name>` |

Webapp tests are Vitest. Do not run test files with `bun test`; it lacks Vitest globals such as `vi.hoisted` and produces false failures.

## Validation ladder

- While iterating: focused sensors per surface (see `docs/agent/testing.md` escalation lists).
- Merge-ready: `bun run pr:athena` from repo root is the authority. It owns prerequisite ordering, documentation/generated-artifact checks, expensive provider validation, and reusable pre-push proof. Never assemble your own broad suite as a substitute final gate.
- `bun run harness:test` after changing anything under `scripts/`.
- Any change under `packages/athena-webapp/convex/`: also run `audit:convex` and `lint:convex:changed` inside that package before handoff.
- Added/removed/re-wrapped a public Convex function or Hono route: `bun scripts/convex-operation-admission-check.ts` must exit 0 with zero findings.
- After modifying code files: `bun run graphify:rebuild`; `graphify:check` blocks PRs when tracked graph artifacts are stale.

## Hooks and gates behave differently than defaults

- Pre-commit repair is fail-closed: hooks regenerate stale docs/graph artifacts, then stop. Review and commit the repaired artifacts instead of fighting the hook.
- Pre-push output is bounded: the terminal shows heartbeats only; the full log path is printed to a retained temp file.
- Substantial behavior-bearing changes are blocked by `compound:check` without a reusable note under `docs/solutions/`. Small edits, test-only, and docs-only changes are exempt.
- Never hand-edit generated files: `src/routeTree.gen.ts`, anything under `convex/_generated`, and the generated `docs/agent/validation-guide.md` / `validation-map.json` (derived from `scripts/harness-app-registry.ts`; update registry metadata and rerun `bun run harness:generate`).
- Refresh Convex generated artifacts with `bunx convex dev --once` from `packages/athena-webapp`. Plain `bunx convex dev` enters watch mode; do not use `bunx convex codegen` (local workspaces may lack `CONVEX_DEPLOYMENT`).

## Architecture facts that change how you write code

- One business action commits everything about itself in **one Convex transaction**. Cross-domain calls are direct `*WithCtx` helper imports inside the caller's transaction — not scheduled jobs. A sale never exists without its stock movement or evidence.
- `convex/inventoryLedger` is the single write path for every stock movement and valuation; nothing else mutates quantity-on-hand.
- Reporting is an append-only fact ledger (`reportFact` + pure `foldDay`), not live queries over domain tables; replay mismatches quarantine rather than overwrite.
- Privileged commands require manager approval proofs consumed in-transaction; a client-supplied staff id is never authorization.
- POS is genuinely local-first (IndexedDB event log under `src/lib/pos`, background sync drain); only in-store sales touch register cash.

## Git & PR

Shared rules live in [packages/AGENTS.md](packages/AGENTS.md). Hard requirements:

- Branches use the `codex/` prefix; start each new task from latest `main`.
- PR titles: `[V26-123]: title`. Body must contain `## Summary`, `## Why`, `## Validation`, and end with a direct Linear link to that ticket.
- Sync with latest `origin/main` before opening or updating a PR, then rerun PR-equivalent checks.

## tracking

- project_tracker: linear
- linear_team: yaegars
- linear_team_key: V26
- linear_team_id: 1c947ba4-dd56-4973-b205-3424bfdede61
- linear_project: athena
- linear_project_id: 0a9f3894-fdbb-45dc-b3ff-000af5ba49cc
- linear_project_url: https://linear.app/v26-labs/project/athena-22769268c360

## solutions

Reusable implementation learnings live under docs/solutions/.
Before changing a known bug pattern, search docs/solutions/ for related guidance.

## skills

Athena vendors its agent skill system under `.agents/`.

Rules:

- Agents working in this repo must use repo-local skills from `.agents/skills/`.
- Do not use global `~/.codex`, plugin-cache, marketplace, or Superpowers skills for Athena workflow behavior when a repo-local skill exists.
- Use repo-local `track` and `execute` for Linear planning and ticket execution workflows.
- External connectors and platform tools may be used as runtime capabilities, but they are not skill sources for Athena workflow policy.

## product copy

For in-product copy work, follow [docs/product-copy-tone.md](docs/product-copy-tone.md).
Keep operator-facing language calm, clear, restrained, and operational, and normalize raw backend wording before it reaches the UI.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read the Convex AI guidelines first** for
important guidance on how to correctly use Convex APIs and patterns. The
canonical file lives at `convex/_generated/ai/guidelines.md`, and Athena also
keeps a package-local mirror at
`packages/athena-webapp/convex/_generated/ai/guidelines.md` for agents working
from inside the webapp package. These files contain rules that override what you
may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
