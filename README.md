# Athena

Athena is an operating system for a solo business owner. The goal is to put the
daily control loop of a business in one place: sell in person, sell online,
track stock, fulfill orders, manage cash, handle services, assign staff work,
understand customer behavior, and keep enough operational evidence that the
owner can trust what happened without becoming a full-time systems operator.

Today it is closest to a **retail and service business OS**. It is not a
complete business OS yet; the honest gaps are listed below.

## Status

Built and in use:

| Domain | Coverage |
| --- | --- |
| Sales and checkout | POS register, online checkout, orders, refunds, returns and exchanges, reviews, offers, rewards, saved bags |
| Inventory and procurement | Catalog, SKUs, stock movements, adjustments, purchase orders, receiving, replenishment, vendors |
| Operations and accountability | Staff profiles and credentials, register sessions, cash controls, Daily Close, payment allocation, manager approvals, work items, workflow traces |
| Services | Service intake, appointments, active cases, service catalog, service inventory usage |
| Reporting and visibility | Reports workspace (overview, inventory exposure, item performance, revenue contribution, SKU evidence), storefront analytics, customer behavior timelines, health checks |

Not there yet:

- **A complete financial picture.** The Reports workspace covers revenue
  contribution, inventory exposure, and item performance, and expenses are
  tracked through the POS expense flows. Profit and margin, payouts, tax, and
  bank reconciliation are still missing, so the owner cannot yet answer "did I
  make money this month" inside Athena.
- **A cross-domain command center.** Work items, approvals, traces, services,
  stock, orders, and POS flows each have good individual surfaces. The owner
  still has to move between them instead of working one unified queue of
  exceptions.
- **Automation and guidance.** The intelligence and automation layers exist
  (`convex/intelligence`, `convex/automation`), but the OS does not yet
  consistently turn its data into proactive recommendations or next actions.
- **External system coverage.** Payments, email, storage, and monitoring are
  wired. Accounting, banking, payroll, supplier, and broader CRM integrations
  are outside the core loop.

## Getting Started

A Bun workspace with three packages:

| Package | Role |
| --- | --- |
| `packages/athena-webapp` (`@athena/webapp`) | The authenticated owner/operator app plus the Convex backend. |
| `packages/storefront-webapp` (`@athena/storefront-webapp`) | The customer-facing storefront. |
| `packages/valkey-proxy-server` | Local request/response proxy support for Valkey-backed flows. |

```bash
bun install                                        # also points Git at .husky hooks
bun run --filter '@athena/webapp' dev              # operator app
bun run --filter '@athena/storefront-webapp' dev   # storefront
```

Run `bun install` (or `bun run prepare`) after cloning so Git picks up the
tracked hooks in `.husky/`. Those hooks run the delivery gates described under
[Working In This Repo](#working-in-this-repo).

## Documentation

| Doc | Covers |
| --- | --- |
| [Athena webapp architecture](./packages/athena-webapp/docs/agent/architecture.md) | The real architecture reference: routing, the Convex HTTP boundary, command-result and approval contracts, money handling, reporting, POS local-first boundaries |
| [Packages agent router](./packages/AGENTS.md) | Per-package `AGENTS.md` and `docs/agent/*` — the operational source of truth for edits and validation |
| [Repo harness and sensors](./docs/harness.md) | The delivery safety system, plus the full command, artifact, and CI reference |
| [Graphify](./docs/graphify.md) | The repo knowledge graph, its freshness gate, artifacts, and Python runtime |
| [VPS production runtime](./docs/deployment/vps-production.md) | Deployment topology, access prerequisites, nginx and Cloudflare setup, QA deploys, rollback |
| [Graphify wiki index](./graphify-out/wiki/index.md) | Generated repo-wide navigation and package landing pages |

Deeper material lives under `docs/`: `docs/solutions/` holds durable solution
notes for architecture foundations and recurring bug classes, `docs/plans/`
holds delivery plans, and `docs/operations/` holds production runbooks.

## Backend Shape

The primary backend lives in `packages/athena-webapp/convex`, with
`convex/http.ts` composing the public Hono boundary over four HTTP domains:

- `core` — owner/admin routes such as organizations, stores, catalog,
  analytics, and auth.
- `customerChannel` — customer commerce routes such as bags, checkout, orders,
  reviews, rewards, offers, and storefront sessions.
- `customerMessaging` — customer messaging surfaces.
- `moneyMovement` — payment collection and webhook routes.

Business workflows sit behind those boundaries in domain folders including
`convex/operations`, `convex/pos`, `convex/cashControls`, `convex/stockOps`,
`convex/serviceOps`, `convex/storeFront`, `convex/reporting`,
`convex/inventory`, `convex/intelligence`, `convex/automation`, and
`convex/workflowTraces`.

See the [architecture doc](./packages/athena-webapp/docs/agent/architecture.md)
for how to choose a boundary before editing.

### Daily Operations Vocabulary

Four similar-sounding concepts are deliberately distinct, and conflating them
causes real bugs:

| Concept | Scope |
| --- | --- |
| **Daily Close** | The store day. Composes operational state into close readiness, a daily summary, and carry-forward work for the next opening. |
| **Cash Controls** | The drawer/session. Cash counting, variance, and closeout review. |
| **POS session** | The sale/cart lifecycle at a terminal. |
| **`registerSession`** | The drawer/shift ledger that backs cash-control closeout. |

The durable note is
[Athena Daily Close Is A Store-Day Boundary](./docs/solutions/logic-errors/athena-daily-close-store-day-boundary-2026-05-07.md).

## Working In This Repo

Changes are gated by the harness rather than by convention. The commands you
will actually reach for:

| Command | When |
| --- | --- |
| `bun run harness:check` | Quick repo health check. |
| `bun run harness:test` | After changing anything under `scripts/`. |
| `bun run pr:athena` | The full delivery ladder; records reusable pre-push proof. |
| `bun run graphify:check` | Freshness gate for tracked graph artifacts. |

Three behaviors are worth knowing up front:

- **Repair is fail-closed.** Hooks will regenerate stale docs and graph
  artifacts for you, then **stop**, so you review and commit the repair instead
  of pushing a stale ref.
- **Pre-push output is bounded.** The hook keeps complete validation output in
  a unique temporary log while the terminal receives heartbeats, a concise
  success summary, or byte-capped failure diagnostics with the retained path.
- **Substantial changes need a solution note.** `compound:check` blocks
  behavior-bearing work that does not also add a note under `docs/solutions/`.
  Small edits, test-only changes, and docs-only changes pass without one.

[The harness doc](./docs/harness.md) explains each sensor and how to read a
failure.

## Deployment

Production and QA run on an Ubuntu VPS behind Cloudflare Tunnel, with Convex
hosting the backend. [The VPS runbook](./docs/deployment/vps-production.md) is
authoritative, including the access prerequisites needed before a deploy can
start.

- QA deploys automatically after merges to `main` through the **Athena QA
  Deploy** workflow.
- Production static rollback is script-backed via
  `scripts/deploy-vps.sh rollback athena previous`, or the manual **Athena
  Production Rollback** workflow. Static deploys keep timestamped version
  directories and write `deploy.json` metadata with the Git SHA for
  auditability.
