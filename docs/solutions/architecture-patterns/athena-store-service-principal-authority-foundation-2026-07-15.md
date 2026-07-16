---
title: "Athena store service principals separate identity from granted authority"
date: 2026-07-15
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: authentication
resolution_type: code_fix
severity: high
applies_when:
  - "Adding a store-owned non-human application, device fleet, or integration to Athena"
  - "Replacing a shared or synthetic human account with a store-scoped service identity"
  - "Designing revocation across principal, capability, Auth session, credential, and consumer-proof lanes"
  - "Preserving local-first operation with server-minted, expiring offline authority"
  - "Migrating stores incrementally while legacy and service-principal authentication coexist without fallback"
related_components:
  - convex
  - pos
  - offline-continuity
  - data-migrations
tags:
  - service-principals
  - authentication
  - authorization
  - capability-catalog
  - store-scope
  - session-revocation
  - local-first
  - convex
delivery_diff_fingerprint: 058a2f944c7f73cdc92138720e79a57a2b1146de2b57c592d3984d9bf1c1e437
---

# Athena store service principals separate identity from granted authority

## Problem

Athena's legacy POS login represented machine authority with one shared,
human-shaped account plus per-store recovery credentials. That coupled a global
identity to store-scoped authority, made a `pos_only` membership look like an
application permission, and left terminal registration, application access,
Auth sessions, offline continuity, and revocation without independent lineage.

The reusable rule is: **a service principal exists without authority until a
consumer explicitly grants a capability from a closed catalog.** Identity,
capability, transport session, device proof, consumer credential, and offline
continuity remain separate authority lanes; no valid lane implies another.

## Solution

### Keep the foundation consumer-neutral

Represent a store-owned non-human identity as a first-class
`servicePrincipal`, scoped to organization and store, with an explicit lifecycle
and revision. Bind it one-to-one to a neutral Convex Auth transport user. Do not
create an `athenaUser`, `organizationMember`, email identity, or role for the
machine.

Consumers own frozen capability catalogs and reconcile grants explicitly. POS
is the first adapter and declares `pos.application`; the generic foundation does
not import POS modules or know POS identifiers. Reconciliation is idempotent,
fails on duplicates or scope drift, and never silently reactivates an inactive
principal.

### Bind application authority to the exact Auth session

A stable transport user is not an application session. Each service session is
bound to one exact `authSessions` row. POS recovery therefore uses a two-phase
exchange:

1. An isolated browser Auth namespace submits terminal proof and the recovery
   code.
2. The server revalidates terminal, store, principal, grant, credential, and
   revisions; creates an exact Auth session; and prepares an exchange for the
   exact `(userId, sessionId)` pair.
3. The credentials provider returns that pair, not merely a stable user ID.
4. Only the authenticated exact session can activate the exchange.
5. Activation creates the service session and terminal application binding and
   supersedes only the predecessor for the same principal, terminal, and
   consumer lineage.
6. The browser promotes the isolated namespace only after activation and an
   exact-session check.

The browser journal contains routing metadata, never authority or secrets.
Ambiguous failures remain resumable; cleanup and abort decisions are
server-derived and bounded.

### Reload current authority at every protected server boundary

For each POS business call, reload and cross-check the backing Auth session,
service session, immutable transport binding, current store, principal
lifecycle and revision, current `pos.application` grant and revision, recovery
credential status and revision, terminal lifecycle and proof revisions, and the
terminal-specific application binding. Clamp resource IDs to the actor's store
and normalize denials.

Maintain a source-derived inventory that classifies callable POS surfaces as
human administration, POS business operation, device control, or intentionally
public. Unknown endpoints fail the sensor. Staff, manager, drawer, register,
and command checks remain additional gates; application access never implies
operational authority.

### Revoke each lane independently

Disconnecting a terminal revokes only its application binding and advances its
terminal lifecycle and proof revisions. It preserves the terminal row, cloud
identity, local ledger, sync cursor, and sibling terminals.

A disconnected browser may use its old terminal proof only to request a short,
opaque reconnect intent. That intent cannot verify the recovery credential,
create a service session, or authorize POS work. Same-store full-admin sign-in
on the affected browser can consume the single-use intent, reactivate the same
terminal row, and rotate proof. Fresh POS recovery is still required.

### Make offline continuity finite and verifiable

Offline operation is a bounded receipt of earlier online authority, not an
offline authority source. The server signs canonical, store- and
terminal-scoped receipts containing principal/session/binding IDs, relevant
revisions, issuance, expiry, nonce, and key version. The browser verifies them
against a reviewed public-key registry and never mints, extends, or changes
scope offline.

Events within a valid lease may ingest normally. Missing, post-expiry, or
ambiguous evidence is durably routed to `needs_review`; forged or copied-scope
evidence is rejected. Infrastructure failures and nondurable outcomes never
advance the local sync cursor. Keeping the browser public-key registry empty
until a reviewed production JWK is installed makes rollout fail closed.

### Migrate additively and close fallback explicitly

Use bounded preview/apply pages, conflict census, stable fingerprints,
idempotent per-store apply, and explicit `compatibility -> shadow -> enforced`
states. Preserve terminal IDs, proofs, fingerprints, revisions, ledgers, and
cursors. Create neutral transport users; never bind the legacy shared POS user.
Legacy credentials that cannot be safely migrated become `rotation_required`.

An enforced store never falls back to the legacy account. Global retirement is
blocked until every active store is enforced, terminal recovery evidence is
complete, conflicts and plaintext credentials are absent, and the rollback
window is closed. Keep production key rollout, mode transitions, retirement,
and schema narrowing as explicit operator actions rather than side effects of
the migration code.

## Why This Matters

- Current-state authorization makes online revocation effective on the next
  protected server request instead of waiting for token expiry.
- Independent lifecycle and revision lanes keep a terminal disconnect from
  revoking sibling terminals or the store application.
- A bound service user cannot fall through to human membership, shared-demo, or
  email-based authorization when its service state is invalid.
- Exact Auth-session lineage prevents an old or parallel session for the same
  transport user from inheriting newly activated application authority.
- Signed, expiring receipts preserve IndexedDB-first cashier work without
  letting offline state enroll, recover, refresh, or switch stores.
- Preview evidence and explicit cutover modes make migration incompleteness
  measurable instead of hiding it behind a permanent compatibility predicate.

## Prevention

- Never treat principal existence, an Auth user, `pos_only` membership,
  recovery credential, terminal proof, or offline receipt as sufficient
  application authority by itself.
- Never let a service-bound Auth user fall back into human or shared-demo actor
  resolution.
- Bind service sessions to exact Auth session IDs and reload all mutable lanes
  required by the consumer on every protected server boundary.
- Keep consumer capabilities outside the generic foundation and reject unknown
  catalog entries by default.
- Preserve consumer-specific staff, manager, device, drawer, and command gates
  as independent checks.
- Use expected revisions and stop on stale state, duplicates, or scope drift.
- Never persist recovery plaintext, terminal proofs, tokens, receipts, peppers,
  or private signing material in audit logs, reports, or tickets.
- Never authorize an enforced store through a legacy fallback.
- Keep production trust configuration and irreversible retirement actions out
  of ordinary migration execution.

## Examples

The consumer-neutral lifecycle, actor, and grant rules live in
`convex/servicePrincipals/`. `foundationBoundary.test.ts` prevents POS coupling;
`capabilities.test.ts` proves principal existence defaults to deny; and
`actor.test.ts` proves an invalid bound service identity cannot appear unbound.

POS adapts the foundation in `convex/pos/application/`. The
`posApplicationAuthority` tests exercise current-state and cross-store denial;
the boundary inventory test fails new unclassified callables; terminal
lifecycle tests prove same-row reconnect and proof rotation; offline receipt
tests cover canonical signatures, lease boundaries, key rotation, and copied
scope; and migration tests cover stale previews, preserved terminal identity,
neutral transport users, no enforced fallback, and closed retirement gates.

## Supersedes and Related Guidance

- Supersedes the shared `pos@wigclub.store`, `pos_only` membership, and
  user-ID-only provider authorization guidance in
  `docs/solutions/architecture/athena-pos-recovery-code-login-2026-06-03.md`.
  Its recovery-secret handling and separation from staff authority remain
  valid.
- Supersedes the blanket membership-guard rule for POS business endpoints in
  `docs/solutions/security-issues/pos-public-surface-authz-and-rejected-sale-loss-2026-07-15.md`.
  Its resource ownership and boundary-inventory lessons remain valid.
- Extends, rather than replaces,
  `docs/solutions/architecture/athena-pos-offline-sales-continuity-2026-06-04.md`,
  `docs/solutions/architecture/athena-pos-hub-app-session-continuity-2026-06-02.md`,
  and `docs/solutions/architecture/athena-pos-local-staff-authority-2026-05-14.md`.
- Reuses the closed-catalog and source-inventory technique from
  `docs/solutions/architecture-patterns/shared-demo-principal-policy-and-restore-boundary-2026-07-12.md`
  while giving durable store service principals independent lifecycle,
  transport, session, and consumer adapters.
