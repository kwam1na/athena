# Shared demo backend coverage

The shared demo is a server-side principal and store mode. Unknown writes and
unknown external effects are denied. UI visibility is not an authorization
control.

## Where demo authority is declared

**Every** backend ingress — public Convex mutation, query, and action, and
every Hono route — now declares an operation definition and runs through the
admission rail. There is no migration inventory, no exemption list, and no
"legacy write group" left: `bun scripts/convex-operation-admission-check.ts`
exits 0 with zero findings, and `convex/operationAdmission/coverage.test.ts`
asserts it. See `convex/operationAdmission/README.md` for the contract.

The demo's reach is therefore stated in exactly two closed grant sets and one
field per operation:

| what | where |
| --- | --- |
| Which write capabilities the demo holds | `SHARED_DEMO_ALLOWED_CAPABILITIES` (`convex/platform/capabilityCatalog.ts`) |
| Which read intents the demo holds | `SHARED_DEMO_ALLOWED_READ_INTENTS` (`convex/sharedDemo/policy.ts`) |
| Whether a given operation admits the demo | `actors.sharedDemo: "admit" \| "deny"` on its definition |

Being *classified* never grants access. An operation admits the demo only when
it says so AND its capability/intent is in the matching grant set — asserted
statically in both directions by `sharedDemo/policy.test.ts`:

- **forward** — every granted capability and intent has at least one
  demo-admitted definition representing it, so a grant cannot outlive the
  surface it was added for;
- **reverse** — no demo-admitted definition declares an ungranted capability or
  intent, so demo reach cannot widen without editing a grant set.

Four hand-maintained registries used to approximate this and have been deleted:
`SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY`, `SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS`,
`classifyAthenaPublicWrite` with its module→capability map, and the hand-listed
`sharedDemoCapabilityValidator`. Each is now derived from the definitions
(`deriveSharedDemoRepresentedCapabilities`, `deriveSharedDemoGatewayBindings`,
the definition's own `capability`, and `SHARED_DEMO_ALLOWED_CAPABILITIES`
respectively). They were deleted because they had each drifted: the validator
accepted six capabilities the demo was never granted, and the gateway-binding
check passed by matching identifiers that survived only inside comments.

## Athena view surfaces

The UI has a separate, presentation-only catalog in
`src/components/shared-demo/sharedDemoSurfaceCatalog.ts`. It assigns every
authenticated route template to an outcome-oriented surface such as POS
checkout, cash register control, order fulfillment, product catalog, reports,
or administration. Surface metadata records whether the intended demo
presentation is interactive, read-only, or observational.

`SHARED_DEMO_VISIBLE_SURFACES` is an explicit allowlist. A route being present
in the catalog does not make it visible, and an unknown route is denied by
default. The focused route coverage test discovers every authenticated route
file and fails if it cannot be classified. Literal route templates take
precedence over parameterized detail templates so a path such as
`products/new` cannot be mistaken for `products/:productSlug`.

The visible demo families are:

- Owner orientation and dashboard
- POS checkout, sales history, expenses, terminal health, and read-only POS
  settings
- Cash register control
- Daily operations, approvals, read-only inventory import, stock activity,
  procurement, and receiving
- Order fulfillment
- Product and complimentary-product browsing
- Storefront context, reviews, customers, and checkout sessions
- Reports and operational observability
- Read-only service intake, appointments, and case work

Organization settings, app and store configuration, members and permissions,
bulk administration, product creation/editing,
archived products, complimentary-product creation, and promotion administration
are cataloged but not visible in the demo. Service catalog administration is
also cataloged separately and hidden.

This surface allowlist is not an authorization boundary. It controls what the
demo presents; the server capability allowlist below remains authoritative for
reads, writes, and external effects.

Public reads, public actions, and every HTTP route are now admitted too, so
there is no longer a category of ingress that sits outside the rail. Admission
never belongs in `convex/lib/athenaUserAuth.ts`: declare it on the operation
definition and let the shared-demo adapter apply policy. The demo read grants
themselves were not widened by the migration — `SHARED_DEMO_ALLOWED_READ_INTENTS`
was the same closed set, and `readIntentGrants.test.ts` plus the reverse-direction
assertion in `policy.test.ts` fence it from both sides.

That set has since gained four intents, and the reason matters: not new demo
reach, but reach the migration removed by accident. `expenses.view`,
`service_ops.view`, `store.configuration.view` and `storefront.reviews.view`
back eight surfaces the demo sidebar links to — the POS hub, POS settings,
expense reports, Reviews, and all four Services views — every one of which was
an unwrapped query the demo answered before the rails, and every one of which
threw on load afterwards. See
`docs/solutions/architecture-patterns/athena-demo-reachable-reads-need-their-own-sensor-2026-08-24.md`.

## Athena capability families

- Store operations: cash controls, Daily Operations, approvals, expenses,
  staff authentication/management/communication, and store configuration.
- Selling: POS catalog, sales, transaction corrections/voids, customers,
  sessions, synchronization, terminals, and recovery.
- Inventory and supply: catalog, import, adjustments/counts, and procurement.
- Service work: intake, appointments, service catalog, and service cases.
- Commerce: order creation/management/fulfillment/returns, storefront content
  and sessions, reviews, rewards, customer messaging, billing, and refunds.
- Platform: identity, permissions, organizations, integrations, Remote Assist,
  intelligence, reporting, exports, maintenance, destructive administration,
  and demo lifecycle.

## Allowed business capabilities

| Capability | Demo behavior |
| --- | --- |
| POS sale completion | Real shared-store write |
| Inventory adjustment | Real shared-store write |
| Cash control | Real operational write; no money movement |
| Operational approvals | Real manager decisions within the shared store |
| Order fulfillment | Real status write; notification suppressed |
| Order management and returns | Real shared-store line-item, cancellation, restock, return, and exchange writes |
| Refunds | Real shared-store refund state with the payment-provider refund simulated |
| Customer messaging | Real sent-status write with order and feedback emails simulated |
| Reviews | Real feedback-request status write; no customer email sent |
| Staff communication | Real bounded shared message; no identity management |
| Daily Operations | Real store-day start write |
| Reports | Read-only existing projections |
| Staff authentication | Shared manager sign-in and bounded approval proofs |

Identity, permissions, billing, integrations, exports, payment collection,
destructive administration, and store deletion are denied.

Four capabilities are deliberately **not** demo-granted even though the demo
shows adjacent surfaces, and this narrowing was preserved rather than quietly
widened during the migration: `pos.session.manage`, `expenses.view`,
`storefront.reviews.view`, and `storefront.analytics.view`. Whether the demo
should demonstrate them is a product question, not a migration question.

Demo authority is declared on the operation definition
(`convex/operationAdmission/domains/**`) and adapted by
`convex/sharedDemo/operationAdapter.ts`. `convex/sharedDemo/policy.ts` owns the
read-intent grant set and the external-effect classifications; it no longer
owns a public-function inventory.

## External effects

Customer messages, order notifications, and payment refunds return labeled
simulated outcomes. Payment collection, export, and integration gateways are
denied. A shared-demo caller never receives a live-effect permit and provider
secrets are not loaded.

## Restore contract

`sharedDemoRestoreState` is the singleton store lease and monotonic epoch. Every
allowed demo mutation must read it in the same Convex transaction as the
business write through `requireReadySharedDemoWriteWithCtx`. Restore replaces
the versioned baseline rows, verifies expected domain counts, then publishes
`ready`. The nightly and manual callers use the same internal `restoreBaseline`
mutation and idempotency contract.

The scheduled restore runs **once a day at midnight**, registered in
`convex/crons.ts` as `shared-demo-daily-restore` on `0 0 * * *`. Midnight UTC is
also the demo store's own midnight, because the store runs `Africa/Accra`
(UTC+0, no daylight saving), so the reset lands on the same boundary the
operating day rolls over on rather than partway through a trading day someone is
reading. A demo store in another zone would need that cron hour moved to match.

The idempotency key is `daily:<UTC day number>` — deliberately exactly one reset
cycle wide. A narrower bucket would let a retried firing restore the baseline a
second time mid-day; a wider one would swallow the next day's genuine reset.
Audit rows written before this change carry `source: "hourly"`, which the schema
retains as a legacy literal so historical rows still validate; nothing writes it
now.

A second cron, `shared-demo-hourly-provision-heal` on `0 * * * *`, runs
provisioning **only** — it begins no restore lease and replaces no visitor rows.
Admission rejects every visitor while the persisted `baselineVersion` trails
`SHARED_DEMO_BASELINE_VERSION`, and `scripts/deploy-vps.sh` migrates that row
right after `convex deploy`; this job is what bounds the damage if that step
fails, repairing the lockout within the hour. Keeping the two jobs separate is
the point: provisioning is idempotent and non-destructive and so is safe hourly,
while restoring wipes visitor activity and belongs only at the daily boundary.

Every store-scoped demo read or write also compares its target store to the
server-owned principal before ordinary organization authorization runs. A
restore verification, missing-row, or capacity error is intentionally allowed
to escape the Convex mutation so all table replacements roll back atomically.

The baseline capture stores exact source documents and stable IDs for the six
domain tables plus POS and order line items. Restore deletes visitor-added rows,
replaces modified baseline rows, refuses to recreate a destructively removed
protected row, and schedules the existing Reports materializer after source
truth is restored. Adding a new demo-writable source table requires adding it to
`SHARED_DEMO_MUTABLE_TABLES`; the static coverage review treats an omitted table
as a release blocker.

## Visitor activity visibility

Demo visitor behavior is recorded on the context event rail under its own
`shared_demo` surface, registered in
`convex/contextTracking/eventDefinitions.ts`. Six events cover session start,
surface views, blocked surfaces, admitted actions, denied actions, and observed
restores.

Capture splits by outcome because of a transaction rule, not a preference. A
denied shared-demo admission throws, and a Convex mutation throw rolls back
every write in its transaction, so the server cannot record its own denial.
Admitted actions are appended inside the operation's transaction from
`convex/operationAdmission/publicMutation.ts` — a surviving row therefore means
the operation committed. Denials are reported by the browser through
`src/lib/errors/sharedDemoDenialObserver.ts`, and carry only the surface the
visitor was on, because the denial error exposes no capability or reason.

Every demo-reachable write now routes through operation admission, so
`shared_demo.action_admitted` covers the whole demo write surface. Convex
*actions* cannot use `admitPublicMutation` — they have no `db` — so they use
`admitPublicAction`, which calls the registered `admitOperation` internal
mutation via `ctx.runMutation`, carrying the caller's
identity and applies the same definition, capability, store clamp, restore
fence, and gateway policy.

One semantic differs there and is not papered over: an action is not
transactional, so its admission and recorded event commit on their own. An
action's row means "admitted and started"; a mutation's row means "committed".

The `reports.read` write capability is deleted. It only ever existed so the
demo could READ the Reports surface, which is what a read intent is for; its
successor is `reports.view` in `SHARED_DEMO_ALLOWED_READ_INTENTS`. Reports
queries are admitted like every other read and emit no admitted-action event.

Every `shared_demo` event is `support`-visible and non-compilable. This is a
privacy boundary, not a preference: demo visitors are store admins of the one
shared store, so store-visible telemetry would expose one visitor's behavior to
the next. The per-visitor key is the auth user behind the demo principal —
every principal shares one `athenaUser`, which cannot separate visitors.
Navigation records the catalog's route template rather than the visited
pathname, so no slug or record id is captured. The rollup
(`convex/contextTracking/sharedDemoActivity.ts`) is an internal query.

## Provisioning

Run the internal `sharedDemo/provision:provisionSharedDemo` mutation once on the
approved deployment. It is idempotent by the stable organization/store
slugs and returns the Athena user, organization, and store IDs required by the
runtime configuration. It creates the synthetic owner and cashier, catalog and
stock, terminal/register and cash posture, completed sale and line item,
inventory movement, pickup order and line item, a started store day with its
Opening Handoff completed, and operational narrative. The nightly and manual
restores roll that opening state to the current store operating date. Baseline documents
are captured transactionally before the mutation reports `created`; a partial
pre-existing foundation fails closed.
