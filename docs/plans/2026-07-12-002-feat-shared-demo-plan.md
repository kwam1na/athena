# Simplified shared Athena demo

Linear: V26-1039
Execution: coordinated single PR from `origin/main`; test-first
Environment: both `ATHENA_SHARED_DEMO_ENABLED=true` and a server-verified deployment identity allowlist must match QA/dev. Either check missing, unknown, or production fails closed; copying the flag alone cannot enable production.

## Outcome

`/demo` opens Athena's real owner application without showing credentials. Every visitor uses one dedicated, synthetic demo user and one shared demo store. The application remains Athena: the demo layer only labels the environment, explains the current store day, links to real workflows, discloses simulated effects, and restores the shared baseline.

## Authority and admission

- Add a Convex Auth credentials provider dedicated to shared-demo admission. It accepts only a short-lived, opaque, single-use ticket minted server-side when the runtime allowlist is enabled.
- `/demo` obtains the ticket in a response body and immediately exchanges it through Convex Auth; tickets never appear in URLs, rendered UI, persistent browser storage, logs, fixtures, or docs.
- Persist a demo-principal marker plus a non-renewable, server-clock expiry keyed to an individual server-derived auth-session/admission identifier. All demo-aware authorization resolves the authenticated user and its exact admission to `kind: "shared_demo"`; clients cannot assert this kind. A later visitor never refreshes or extends an older admission.
- The demo principal is valid only for the configured demo store and current admission expiry. A wrong store, expired admission, disabled environment, or missing marker fails closed.
- The browser signs out when the bounded demo window expires. Backend checks remain authoritative even if the client timer is bypassed.
- Ticket mint and exchange are separately rate-limited. Exchange validates and consumes the opaque ticket atomically in one transaction, so replay and concurrent double exchange fail.

## Server policy

The shared demo is allowlist-first. Reads are allowed only within the demo store. Writes are allowed only for these capabilities, routed through existing Athena domain commands:

1. POS sale completion.
2. Inventory adjustment.
3. Cash-control operational writes (for example deposits/session activity), without bank/payment movement.
4. Order fulfillment/status progression, without customer notification or payment effects.
5. Internal staff communication, without staff identity, credential, role, or permission management.
6. Daily Operations acknowledgements/actions.

Reports remain read-only and reflect these writes only where current Athena read models already do so.

The following are server-denied for demo actors even if UI controls are reached or a function is called directly: account/identity lifecycle; invitations and credentials; roles/permissions; billing; payment collection/refunds/reversals; integrations, secrets and webhooks; exports/download generation; destructive catalog/organization administration; store deletion; production/deployment controls. Unclassified demo writes and effects are denied.

Central actor resolution and capability helpers must preserve existing normal-user behavior. Each in-scope command adopts the shared actor/capability boundary. Each prohibited category receives a direct backend test against its actual function boundary; route hiding is supplementary.

A static coverage sensor inventories every public mutation/action and every external-effect gateway. The gate fails whenever a new surface lacks an explicit demo classification, preserving default deny as the codebase evolves.

External provider gateways resolve demo-store descendants and return truthful simulated results without loading provider credentials or dispatching network calls. Scheduled descendants are subject to the same policy. UI copy names the suppressed effect (for example, "No customer message will be sent").

## Shared baseline and restore

- A versioned fixture seeds one organization/store identity, the demo auth user/membership, owner/cashier operational profiles, catalog/SKUs/stock, a register and active session, cash posture, seeded orders, staff conversation, open operating day/work, and reporting-compatible source records.
- Seed data is synthetic and one coherent active-store narrative. It does not invent unsupported report relationships or metrics.
- Restore is a transactional, idempotent replace of mutable demo-store data back to the fixture version. Protected demo identity/store foundation remains stable so active navigation and future admission continue to work.
- A singleton restore lease/epoch serializes hourly and manual restores. Every allowed demo mutation reads that lease/epoch in the same Convex transaction as its business write, forcing a conflict instead of allowing an already-authorized stale write to land after restore. Writes fail calmly while restore is active; completion is published only after counts/invariants match the baseline. A failed restore never reports ready.
- An hourly UTC cron invokes the same internal restore function. Manual restore is restricted to the live demo principal/store and rate-limited. Both emit existing operational audit evidence.
- No generation, per-visitor ownership, retention/purge, capacity admission, isolated materialization, POS IndexedDB fencing, or lifecycle coordinator is introduced.

## Product and design

Visual thesis: Athena's existing calm operational shell with a thin native demo-status layer, using current tokens, typography, surfaces, focus treatment, dialogs, and navigation.

Content order:

1. Restrained `/demo` state: "Opening the shared demo store..." with retry/failure handling.
2. Real owner shell and navigation.
3. Persistent compact label: "Shared demo store" and "Other visitors may change this store. Athena restores the baseline every hour."
4. Optional owner home answering: what happened today, what needs attention, where to look next.
5. Six links into real routes: Make a sale, Manage stock, Control cash, Fulfill an order, Coordinate the team, Run today. Reports are linked from connected evidence, not presented as a seventh write workflow.
6. Optional contextual guide with focus return and real-route explanations.
7. Manual "Restore demo" confirmation: "This removes demo changes for everyone currently using it."

No forced tour, synthetic workflow panel, spotlight, gamification, expiry language, or claim that changes stay in a visitor session. The layer is responsive, keyboard accessible, reduced-motion safe, uses 44px targets, semantic landmarks/headings, visible focus, AA contrast, and `aria-live` status.

The persistent disclosure also says not to enter personal, financial, credential, or other sensitive information because shared writes are visible to other visitors. Free-text and collection inputs, especially staff communication, have server-side size and rate limits. Operational audit/telemetry records admission outcome, policy category, and restore status/version only; it never records ticket values or visitor-entered payloads.

## Selective reuse

From `codex/V26-1022-1032-demo-sandbox`, use only concepts and small adapted pieces: owner-home information hierarchy, six-domain labels/icons, optional guide focus behavior, persistent labeling/reset affordance, connected-evidence copy, coherent narrative shape, effect classification ideas, and relevant tests/docs.

Do not port custom OIDC/JWKS/proof/cookies/key stores/tab coordination; anonymous sessions or authorities; per-visitor generations; admission capacity; isolated seeding/materialization; purge/retention/artifact manifests; successor switching; generation-fenced POS storage; sandbox readiness/lifecycle coordination; or deployment topology machinery.

## Test-first units

1. Admission and actor tests: both environment gates, one-time ticket, malformed/expired/replay/concurrent exchange rejection, mint/exchange rate limits, per-admission non-renewable expiry, no secret serialization, correct demo store, normal auth unchanged.
2. Policy tests: allowed capability matrix, cross-store denial, expired/restore-active denial, direct prohibited-function tests, provider/network spies, input bounds/rate limits, static classification coverage, normal owner characterization.
3. Baseline/restore tests: fixture relationships, exact counts/values, idempotence, hourly/manual equivalence, overlapping lease, failed restore, concurrent/stale write.
4. Domain tests: representative real write and meaningful end state in all six domains; assert report propagation only for relationships Athena currently supports.
5. UI tests: seamless entry, persistent shared copy, real-route links, optional guide/focus, restore confirmation/progress/failure, mobile/a11y.
6. Documentation: coverage matrix, effect policy, baseline ownership, QA/dev runbook and rollback (disable flag + restore).

## Acceptance and sensors

- Two independent browser contexts enter the same store; one observes the other's write.
- Complete one real workflow in each domain and inspect supported connected evidence/Reports.
- Directly attempt every prohibited category and observe normalized server rejection.
- Prove no provider network call/credential load for simulated effects.
- Manual and hourly restore converge to the same versioned fixture; concurrent clients see calm stale/restore handling.
- Run focused Vitest suites with `bun run test -- ...`, generated-artifact repair, `bun run graphify:rebuild`, `git diff --check`, and full `bun run pr:athena`.
- Deploy only to the existing QA/dev surface, then run live in-app browser scenarios at desktop/mobile widths including keyboard and accessibility checks.
- Review loops for requirements, security, and product/design continue until all report APPROVE. GitHub feedback and required checks must be clear before the PR is marked ready.

## Finish boundary

Open a ready, mergeable PR. Do not merge, deploy production, change `codex/V26-1022-1032-demo-sandbox` or its dirty worktree, remove that worktree, or align/switch the local root checkout.
