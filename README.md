# Athena

Athena is an operating system for a solo business owner. The product goal is to
put the daily control loop of a business in one place: sell in person,
sell online, track stock, fulfill orders, manage cash, handle services, assign
staff work, understand customer behavior, and keep enough operational evidence
that the owner can trust what happened without becoming a full-time systems
operator.

## Business OS Audit

Current coverage is closest to a retail and service business OS:

- **Sales and checkout:** POS register, online checkout, orders, refunds,
  returns/exchanges, reviews, offers, rewards, saved bags, and customer-facing
  storefront flows are already present.
- **Inventory and procurement:** Product catalog, SKUs, stock movements,
  adjustments, purchase orders, receiving, replenishment, vendors, unresolved
  product cleanup, and bulk operations are represented.
- **Operations and accountability:** Staff profiles, credentials, register
  sessions, cash controls, payment allocation, approvals, operational work
  items, workflow traces, and app logs give the owner a control plane instead
  of isolated screens.
- **Service businesses:** Service intake, appointments, active service cases,
  service catalog management, and service inventory usage are first-class
  backend and UI surfaces.
- **Owner visibility:** Analytics, customer behavior timelines, storefront
  observability, production health checks, generated route/test indexes, and
  graphify give both product and engineering visibility.

The main gaps before it feels like a complete solo-business OS are:

- **Financial operating picture:** Cash controls and payment allocations exist,
  but owner-level profit, expense, payout, tax, and reconciliation views are not
  yet the central cockpit.
- **Cross-domain command center:** Work items, approvals, traces, services,
  stock, orders, and POS flows exist, but the owner still needs stronger
  unified queues and exception views across domains.
- **Automation and guidance:** The LLM/provider foundation exists, but the OS
  does not yet consistently turn data into proactive recommendations, next
  actions, or owner-facing decision support.
- **External system coverage:** Payments, email, storage, and monitoring are
  wired, but accounting, banking, payroll, supplier, and broader CRM
  integrations are still outside the core loop.

## Repo Setup

This is a Bun workspace with three primary packages:

- `packages/athena-webapp`: the authenticated owner/operator app plus the
  Convex backend.
- `packages/storefront-webapp`: the customer-facing storefront.
- `packages/valkey-proxy-server`: local request/response proxy support for
  Valkey-backed flows.

Install dependencies from the repo root:

```bash
bun install
```

Run the main authenticated app:

```bash
bun run --filter '@athena/webapp' dev
```

Run the storefront app:

```bash
bun run --filter '@athena/storefront-webapp' dev
```

## VPS Agent Readiness

For a remote deployment, point the agent at
[docs/deployment/vps-production.md](./docs/deployment/vps-production.md) as the
authoritative runbook. Before the agent starts, the VPS and external accounts
need the small amount of access that cannot be created from inside the repo:

- **Root SSH access:** the agent must be able to reach the VPS as `root`, either
  through an SSH alias such as `ssh-do` or a direct `ssh root@<vps-ip>` target.
- **Ubuntu with `apt`:** the bootstrap script assumes a fresh Ubuntu-style VPS.
  It installs nginx, git, Node.js 22, PM2, Valkey, rsync, and related packages.
- **Cloudflare Tunnel credential or token:** provide either the tunnel
  credential JSON for `/etc/cloudflared/` or the Cloudflare dashboard's tunnel
  install token. These secrets must stay out of the repo.
- **Cloudflare DNS and tunnel permissions:** the agent needs account access if
  it should create or update hostname routes such as `athena-qa.wigclub.store`.
  Otherwise, create those routes before handing over.
- **GitHub deploy key registration:** the agent can generate the VPS SSH key,
  but a human or GitHub-authorized agent must add the public key to the
  `kwam1na/athena` repo as a deploy key before `scripts/deploy-vps.sh check-git`
  can pass.
- **Convex deploy auth, if needed:** only required when the agent should run
  `scripts/deploy-vps.sh convex-prod`. Static app deploys and QA can point at
  existing Convex deployments.

Once those prerequisites are in place, the agent should follow the deployment
runbook, starting with:

```bash
scripts/setup-production-vps.sh
scripts/deploy-vps.sh check-git
scripts/deploy-vps.sh all
```

The setup script owns the nginx bootstrap. It writes the Athena config to
`/etc/nginx/conf.d/wigclub.conf`, disables Ubuntu's default enabled site, and
the runbook includes the nginx verification commands the agent should run before
checking Cloudflare.

QA deploys are automatic after merges to `main` through the
`Athena QA Deploy` GitHub Actions workflow. The workflow uses the same
`scripts/deploy-vps.sh qa` path and requires the QA VPS SSH secrets documented
in the deployment runbook.

Production static app rollback is also script-backed. Use
`scripts/deploy-vps.sh rollback athena previous` or
`scripts/deploy-vps.sh rollback storefront <version>` locally, or run the
manual `Athena Production Rollback` GitHub Actions workflow. New static
deployments keep timestamped version directories and write `deploy.json`
metadata with the Git SHA and deployment time for rollback auditability.

## Backend Shape

The primary backend lives in `packages/athena-webapp/convex`.

- `convex/http.ts` composes the public Hono HTTP boundary.
- `convex/http/domains/core` contains owner/admin core routes such as
  organizations, stores, catalog, analytics, and auth.
- `convex/http/domains/customerChannel` contains customer-facing commerce
  routes such as bags, checkout, orders, reviews, rewards, offers, and
  storefront session flows.
- `convex/http/domains/moneyMovement` contains payment collection and webhook
  routes.
- `convex/operations`, `convex/pos`, `convex/cashControls`,
  `convex/stockOps`, `convex/serviceOps`, `convex/storeFront`, and
  `convex/workflowTraces` hold the business workflows behind those public
  boundaries.

## Harness

The harness is the repo's agent-readiness and delivery safety system. It keeps
the codebase navigable for agents, turns local changes into reviewable evidence,
and prevents stale generated docs or graph artifacts from drifting away from
the code.

At a high level, it does five jobs:

- **Documents the repo shape:** generated route, test, folder, validation, and
  graph indexes give agents a fast map of what exists before they edit.
- **Checks implementation health:** package tests, architecture checks, Convex
  audits, graphify freshness, and harness script tests catch broken contracts
  before a PR reaches CI.
- **Reviews changes:** deterministic self-review and inferential review compare
  a branch against `origin/main` and look for missing tests, stale docs, risky
  edits, and harness regressions.
- **Exercises runtime behavior:** behavior scenarios boot representative flows
  and record structured runtime signals, latency thresholds, and optional
  videos for browser-based evidence.
- **Repairs generated artifacts:** pre-commit and pre-push paths regenerate
  harness docs and graphify artifacts when safe, then stop so the repaired
  files can be reviewed and committed intentionally.

Key repo-level commands:

- `bun run harness:test`
- `bun run harness:check`
- `bun run harness:audit`
- `bun run harness:review`
- `bun run harness:inferential-review`
- `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow bun run harness:inferential-review`
- `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow bun run harness:inferential-review --persist-history`
- `bun run harness:scorecard`
- `bun run harness:janitor`
- `bun run harness:self-review --base origin/main`
- `bun run harness:behavior --scenario <name>`
- `bun run harness:behavior --scenario <name> --record-video`
- `cat <behavior-log-file> | bun run harness:runtime-trends`
- `cat <behavior-log-file> | bun run harness:runtime-trends --persist-history`
- `bun run architecture:check`
- `bun run pre-push:review`
- `bun run pr:athena`
- `bun run graphify:check`

Run `bun install` (or `bun run prepare`) after cloning to point Git at the tracked hooks in `.husky/`. Worktrees inherit the repo config, so using the tracked `.husky` directory avoids the missing generated shim problem we saw with `.husky/_`.

For repo-harness edits such as `scripts/harness-app-registry.ts`, keep
`bun run harness:review --base origin/main` and
`bun run harness:inferential-review` in the local ladder so a missing sibling
test update like `scripts/harness-app-registry.test.ts` fails before push.

`bun run harness:test` is the canonical harness implementation gate for harness scripts, graphify tooling, and pre-push review wiring.
It targets repo-root `scripts/*.test.ts` files only (excluding cloned worktree trees).
Use `bun run harness:test -- --dry-run` to print the selected files without executing tests.
The repo pins Bun via `package.json` (`bun@1.1.29` today), and GitHub Actions reads that same repo-declared version so CI and local harness runs stay aligned.

`pre-commit:generated-artifacts` automatically runs `bun run harness:generate` and `bun run graphify:rebuild`, then stages the tracked generated harness docs and graphify outputs before the commit is finalized, so the pushed ref includes refreshed generated artifacts.
`bun run pr:athena` starts with that same generated-artifact repair step before the blocking harness checks, so deterministic generated-doc drift is repaired locally instead of failing as stale docs.
`pre-push:review` starts with `bun run graphify:check` before the rest of the local validation suite. If tracked graphify artifacts are stale, the hook runs `bun run graphify:rebuild` once, reruns `bun run graphify:check`, and then stops so you can review and commit the repaired graphify artifacts before pushing again.
If `harness:self-review` or `harness:review` gets blocked by stale generated harness docs, the hook runs `bun run harness:generate` once, retries the blocked step on the repaired tree, and:
- Blocks so you can review, commit, and push the repaired generated docs instead of sending a stale ref to CI.

List runtime behavior scenarios with `bun run harness:behavior --list`.
Bundled scenarios include:

- `sample-runtime-smoke`
- `athena-admin-shell-boot`
- `athena-convex-storefront-composition`
- `athena-convex-storefront-failure-visibility`
- `valkey-proxy-local-request-response`
- `storefront-backend-first-load`
- `storefront-checkout-bootstrap`
- `storefront-checkout-validation-blocker`
- `storefront-checkout-verification-recovery`

Add `--record-video` to persist browser-flow evidence under
`artifacts/harness-behavior/videos/<scenario>/<run-stamp>/`.

`harness:behavior` now emits a machine-parseable per-scenario report line:

- `[harness:behavior:report] { ...json... }`

Each report includes phase durations, runtime-signal summaries, and threshold diagnostics.
Scenario thresholds are configured in `scripts/harness-behavior-scenarios.ts` via:

- `runtimeSignals[].minMatches` / `runtimeSignals[].maxMatches`
- `thresholds.latency.maxPhaseDurationMs`
- `thresholds.latency.maxTotalDurationMs`

`harness:scorecard` emits a deterministic quality artifact at:

- `artifacts/harness-scorecard/latest.json`

`harness:inferential-review` has two lanes:

- deterministic findings remain the blocking source of truth
- `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow` adds a semantic shadow lane for telemetry without changing the exit code

When `ANTHROPIC_API_KEY` is not configured, the shadow lane records a skipped status instead of failing the deterministic lane.

Use `--persist-history` when you want append-only timestamped inferential snapshots alongside the latest artifact:

- `artifacts/harness-inferential-review/latest.json`
- `artifacts/harness-inferential-review/history/<run-stamp>.json`

`harness:runtime-trends` consumes `[harness:behavior:report]` lines from stdin and
prints aggregated scenario trend telemetry (pass/fail rates, latency stats, and
runtime-signal health diagnostics).

Use `--persist-history` to keep timestamped runtime trend snapshots alongside the latest trend artifact:

- `artifacts/harness-behavior/trends/latest.json`
- `artifacts/harness-behavior/trends/history/<run-stamp>.json`

GitHub Actions wiring:

- PR CI runs `bun run harness:inferential-review` with `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow`
- scheduled and manual harness runs persist inferential history by default
- manual runs can paste `[harness:behavior:report]` lines through the workflow dispatch input to persist runtime trend history
- PR and scheduled/manual harness jobs upload inferential, runtime-trend, and scorecard artifacts for inspection

`harness:janitor` runs drift sensors in report mode by default. Add `--repair` to
apply safe automated repair steps (`harness:generate` and `graphify:rebuild`) before
re-running checks.

## Graphify

The repo keeps a graphify knowledge graph at `graphify-out/`.

Start with [the Graphify wiki index](./graphify-out/wiki/index.md) for repo-wide navigation, package landing pages, and graph hotspots.

Use [the packages agent router](./packages/AGENTS.md) plus each package's `AGENTS.md` and `docs/agent/*` docs as the operational source of truth for edits and validation.

Use `bun run graphify:check` as the freshness gate for tracked graphify artifacts.

Use `bun run graphify:rebuild` as the repair path when the check reports stale artifacts. The rebuild command uses the interpreter recorded in `.graphify_python` (default `python3` in this repo). Local `pre-commit:generated-artifacts` runs this repair step with `bun run harness:generate` and stages the tracked graphify outputs plus generated harness docs before the commit is finalized. `pre-push:review` can also run this repair once for stale tracked graphify artifacts, reruns `bun run graphify:check`, and then blocks until you commit the repaired tracked artifacts.

If you need to repair the local graphify setup, install the repo-pinned runtime with `python3 -m pip install -r .graphify-requirements.txt`.

Tracked graphify artifacts:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/wiki/index.md`
- `graphify-out/wiki/packages/*.md`

Local-only graphify artifacts:

- `graphify-out/cache/`
- `artifacts/harness-inferential-review/`
- `artifacts/harness-scorecard/`
- `artifacts/harness-behavior/trends/`
- `artifacts/harness-behavior/videos/`

`graphify-out/cache/` is intentionally ignored because it is a large local acceleration cache, not a reviewable source artifact.

The `artifacts/harness-*/` paths above are also intentionally ignored because they are machine-generated local or CI evidence outputs, not reviewable source artifacts.
