# Store service-principal operations

This runbook covers the generic store-owned service-principal foundation and
the POS implementation that uses it first. The service principal is scoped to
one organization and one store. POS access is a separately revisioned
capability grant; it is not the principal's identity.

## Delivery status: no production action

This delivery adds contracts, controls, tests, and this runbook. It does **not**
authorize or perform a production migration, environment change, key rotation,
capability change, terminal reconnect, legacy-account retirement, or schema
narrowing. The browser offline trust-anchor list is currently empty, and the
migration mode and global-retirement controls do not yet have an operator-callable
mutation. Treat every production procedure below as a gated future operation.
Do not patch Convex tables directly to work around a missing operator surface.

Before any future production action, record the approved change, operator,
deployment, release SHA, UTC start time, store scope, and correlation or run ID.
Use the product's full-admin surface when one exists. Use an internal function
from the restricted Convex dashboard or authenticated CLI only when this
runbook names that function.

## Authoritative contracts

- Generic lifecycle and immutable Auth binding:
  [`servicePrincipals/lifecycle.ts`](../../packages/athena-webapp/convex/servicePrincipals/lifecycle.ts)
- Generic capability grants:
  [`servicePrincipals/capabilities.ts`](../../packages/athena-webapp/convex/servicePrincipals/capabilities.ts)
- POS capability adapter:
  [`pos/application/posServicePrincipal.ts`](../../packages/athena-webapp/convex/pos/application/posServicePrincipal.ts)
- Full-admin POS access mutations:
  [`pos/public/posApplicationAccess.ts`](../../packages/athena-webapp/convex/pos/public/posApplicationAccess.ts)
- POS recovery and keyed verifier:
  [`pos/public/posRecoveryCodes.ts`](../../packages/athena-webapp/convex/pos/public/posRecoveryCodes.ts) and
  [`posRecoveryCodeVerifier.ts`](../../packages/athena-webapp/convex/pos/application/security/posRecoveryCodeVerifier.ts)
- Terminal lifecycle and public controls:
  [`terminalLifecycle.ts`](../../packages/athena-webapp/convex/pos/application/terminalLifecycle.ts) and
  [`terminals.ts`](../../packages/athena-webapp/convex/pos/public/terminals.ts)
- Exact-session activation and cleanup:
  [`terminalAppSessions.ts`](../../packages/athena-webapp/convex/pos/public/terminalAppSessions.ts)
- Offline receipt signing and browser trust anchors:
  [`offlineAuthorityReceipt.ts`](../../packages/athena-webapp/convex/pos/application/offlineAuthorityReceipt.ts) and
  [`offlineAuthorityPublicKeys.ts`](../../packages/athena-webapp/src/lib/pos/security/offlineAuthorityPublicKeys.ts)
- Additive migration controls:
  [`backfillStoreServicePrincipals.ts`](../../packages/athena-webapp/convex/migrations/backfillStoreServicePrincipals.ts)

## Generic store-principal lifecycle

The stable key is `store.service`. `reconcileServicePrincipal` creates one
active principal for an organization/store/stable-key scope or returns the
existing row. It does not reactivate an inactive principal. Duplicate rows,
scope drift, and stale revisions are stop conditions.

Normal store workflows own lifecycle changes:

- Store creation calls `reconcileServicePrincipal` and records
  `service_principal.reconciled`.
- Store deletion first decommissions the exact Auth binding, then transitions
  the principal to `decommissioned`, records
  `service_principal.decommissioned`, and only then deletes the store.
- Do not delete a principal, binding, grant, or session row manually.

Allowed principal transitions are:

| Current          | Allowed next state                      |
| ---------------- | --------------------------------------- |
| `active`         | `disabled`, `revoked`, `decommissioned` |
| `disabled`       | `active`, `revoked`, `decommissioned`   |
| `revoked`        | `decommissioned`                        |
| `decommissioned` | none                                    |

Every transition requires the current `lifecycleRevision`. A `stale_revision`
result means another operation won; read current state and reassess instead of
retrying with a guessed revision. There is no standalone production operator
mutation for generic disable/revoke in this delivery.

An Auth transport binding is one-to-one with a principal and one-to-one with a
blank, non-human Auth user. The legacy `pos@wigclub.store` Auth user is never a
service-principal transport identity. Reconcile accepts only the same exact
binding; a different user or principal is a conflict. Decommission is
one-way and revision-checked.

## Enable or revoke POS capability

POS declares consumer `pos` and capability `pos.application`. A full admin uses
the POS settings surface, which calls:

- `pos/public/posApplicationAccess:getApplicationAccessStatus`
- `pos/public/posApplicationAccess:enableApplicationAccess`
- `pos/public/posApplicationAccess:revokeApplicationAccess`

Read status first and pass its `grantRevision` as `expectedRevision`. Enabling
an unconfigured store reconciles the store principal and POS grant. Revoking
changes only the POS grant; it does not delete or repurpose the principal.
Both changes record an operational event.

Expected states are `enabled`, `revoked`, `not_configured`, and `unavailable`.
Stop on `stale_revision`, `duplicate_principal`, `capability_duplicated`, or
scope errors. Never repair those cases by inserting another row.

Revocation removes server authority on the next online request. A disconnected
terminal can continue only within an already issued, valid signed offline
lease; its events are checked when it reconnects. Decide whether that bounded
offline exposure is acceptable before revocation. If immediate offline denial
is required, follow the emergency signing-key procedure as a separate incident
decision and understand its deployment limits.

## Terminal proof and reconnect incidents

### Current proof is available

`pos/public/terminals:rotateTerminalProof` verifies the current proof,
fingerprint, terminal, and store before returning a replacement proof to that
browser. Use the product flow. Do not place either proof in a ticket, log, or
operator report.

### Proof is lost

Proof rotation and reconnect-intent issuance both require the current proof.
If the browser has lost it, do not invent a proof or patch `syncSecretHash`.
A full admin should disconnect the terminal from its detail page. Disconnect
sets the row to `revoked`, increments lifecycle and proof revisions, revokes
the active terminal application binding, and keeps the terminal's history.

Because a lost-proof browser cannot prove the old terminal row, it cannot use
same-row reconnect. Re-enroll the affected browser as a new terminal only after
the old row is confirmed revoked. Preserve the old terminal ID as incident and
audit evidence; do not relabel the new row as the old terminal.

### Deliberate disconnect and same-browser reconnect

When the affected browser still has its current proof, it may request a
reconnect disposition after the terminal is revoked. The server verifies the
exact terminal, fingerprint, and proof, then returns a single reconnect token
valid for five minutes. At most three intents may be issued in a 15-minute
window, and a new intent revokes earlier pending intents.

The full admin must sign in **on the affected browser**. The product resolves
the token with
`pos/public/terminals:getTerminalReconnectIntentResolution` and completes
`pos/public/terminals:reactivateTerminalFromReconnectIntent`. Completion
requires the same browser fingerprint, unchanged terminal/store lineage,
unchanged lifecycle and proof revisions, a pending unexpired token, and a
same-organization full admin. It consumes the token, rotates the proof, and
returns the new proof only to that browser.

Stop if the request is unavailable or expired. Start a new browser-originated
request; do not transfer a token to another browser or extend it in storage.

## Recovery verifier configuration and rotation

The Convex runtime requires both environment variables:

- `POS_RECOVERY_CODE_PEPPERS_JSON`: a JSON object mapping positive integer
  versions, as strings, to secret peppers of at least 32 characters.
- `POS_RECOVERY_CODE_ACTIVE_PEPPER_VERSION`: the positive integer version used
  for newly created or rotated recovery verifiers.

Credentials store their `keyedVerifierPepperVersion`, so verification requires
that exact version to remain in the pepper map. Rotate in this order:

1. Generate the new pepper in the approved secret manager. Do not print it.
2. Add the new version to `POS_RECOVERY_CODE_PEPPERS_JSON` while the old version
   remains present and active. Deploy the Convex environment change.
3. Set `POS_RECOVERY_CODE_ACTIVE_PEPPER_VERSION` to the new version while both
   peppers remain present.
4. Full admins rotate each store's recovery code through the POS settings
   surface (`pos/public/posRecoveryCodes:rotateRecoveryCode`). Deliver the
   reveal-once code through the approved operator channel.
5. Confirm no active credential references the old version. Only then remove
   the old pepper in a later approved change.

There is no time-based overlap shortcut: an unrotated credential still needs
its recorded pepper version. Missing or invalid configuration fails closed as
`The POS recovery verifier is not configured.`

Migration marks a legacy credential without recoverable plaintext as
`legacyMigrationStatus: rotation_required`. A full admin must rotate that
store's code; do not reconstruct or export the old code. A rotated credential
uses deployment-keyed PBKDF2-SHA256, increments `credentialRevision`, and
removes plaintext. Revocation and unlock remain full-admin store-scoped
operations.

## Offline signing-key deployment

The server reads `POS_OFFLINE_AUTHORITY_KEYS_JSON`. Its exact shape is:

```json
{
  "issuer": "<stable-environment-issuer>",
  "leaseMs": 3600000,
  "keys": [
    {
      "version": 1,
      "state": "current",
      "publicKeyJwk": {},
      "privateKeyJwk": {}
    }
  ]
}
```

`leaseMs` must be positive and no more than 86,400,000 milliseconds. Key
versions are unique and exactly one server key is `current`. The current key
must contain either `privateKeyJwk` or `privateKeyPkcs8Base64Url`; never both in
browser code. Keys use ECDSA P-256 with SHA-256.

The browser does not read the server environment. Reviewed public trust anchors
are compiled into `POS_OFFLINE_AUTHORITY_PUBLIC_KEYS`, with `issuer`,
`keyVersion`, `publicKeyJwk`, and `state`. This delivery leaves that list empty,
so production offline authority is not enabled by this work.

For a planned rotation:

1. Generate a new key pair and version in the approved secret system.
2. Add only the new public JWK to the browser trust-anchor list as `retiring`
   while the old public key remains `current`; deploy the browser first.
3. Confirm target-build adoption on every in-scope terminal.
4. Update the server key ring so the old key is `retiring` and the new key is
   the sole `current`; retain both public keys and the new private key. Deploy
   Convex, then have online terminals refresh their receipts through
   `pos/public/terminalAppSessions:refreshCurrentPosTerminalOfflineAuthorityReceipt`.
5. After old receipts have exceeded their maximum possible lease and fleet
   adoption is complete, deploy browser and server configurations that mark the
   old version `revoked`.
6. Remove old key material only after revoked-key evidence is no longer needed
   and the approved retention window has closed.

For emergency revocation, mark the compromised version `revoked` on the server
and make another valid key the sole `current`, then deploy immediately. The
server rejects synchronized events signed by a revoked key. Also ship a browser
trust-anchor update marking it `revoked`; an already offline browser cannot
receive that update, so server revocation cannot retroactively stop local work
before reconnect. Record that residual lease exposure in the incident.

Never place private JWKs, PKCS8 values, receipts, or recovery codes in Git,
screenshots, logs, tickets, or migration candidates.

## Exact-session cleanup

Recovery prepares one exact Convex Auth session and later activates one exact
service-principal session. Activation supersedes only the previous active
application binding for the same principal and terminal. Do not bulk-revoke
other terminal sessions as cleanup.

The browser abort path is
`pos/public/terminalAppSessions:abortPreparedPosTerminalSession`. It deletes the
prepared exchange's exact Auth session and refresh tokens after exact-session
or terminal-proof validation.

Expired or already aborted exchanges are cleaned by the bounded internal
mutation:

```bash
bunx convex run --prod \
  pos/public/terminalAppSessions:cleanupExpiredPosRecoveryArtifacts \
  '{"limit":50}'
```

This delivery does not run or schedule that production command. For a future
approved recovery, use a limit from 1 through 100, record the returned
`cleaned` count, and repeat only while a verified backlog remains. The cleanup
selects only `prepared` exchanges past `expiresAt` and `aborted` exchanges; it
does not delete activated application sessions.

## Additive migration sequence

The migration is additive. It preserves terminal IDs, fingerprint bindings,
proof hashes, lifecycle revisions, and evidence. It creates or reconciles one
canonical `store.service` principal, the POS grant, and a neutral blank Auth
transport binding. The legacy synthetic Auth user is census-only and must never
be selected as that binding.

### 1. Preview and census

From `packages/athena-webapp`, an approved restricted operator starts a bounded
preview with an automation identity tied to the change record:

```bash
bunx convex run --prod \
  migrations/backfillStoreServicePrincipals:backfillStoreServicePrincipalsBatch \
  '{"automationIdentity":"<change-id>:<operator>","dryRun":true,"limit":5}'
```

Continue with the returned `runId` and `continueCursor`:

```bash
bunx convex run --prod \
  migrations/backfillStoreServicePrincipals:backfillStoreServicePrincipalsBatch \
  '{"automationIdentity":"<same-value>","dryRun":true,"limit":5,"runId":"<run-id>","cursor":"<continue-cursor>"}'
```

The maximum accepted limit is 10. Continue until `isDone: true`. The preview
must report `status: completed`, `coverageComplete: true`, and
`conflictCount: 0`. Review every candidate, including non-blocking
`rotation_required`, reconciliation, and terminal-recovery work. A `blocked`
run is not eligible for apply.

Conflicts include duplicate or cross-scope principals, POS grants, transport
bindings, credentials, terminal fingerprints, organization drift, missing
proof, legacy-account or membership anomalies, non-neutral or legacy transport
identities, secret exposure, and census overflow. Resolve the source condition
and run a new full preview; never edit the candidate fingerprint.

### 2. Apply the exact preview

Only after approval, apply the completed preview by passing its `runId` as
`previewRunId`:

```bash
bunx convex run --prod \
  migrations/backfillStoreServicePrincipals:backfillStoreServicePrincipalsBatch \
  '{"automationIdentity":"<same-value>","dryRun":false,"limit":5,"previewRunId":"<preview-run-id>"}'
```

Continue the apply with its returned apply `runId` and `continueCursor`, while
keeping the same `previewRunId` and automation identity. Apply refuses a store
whose current census fingerprint differs from preview. Do not retry a stale
preview; run a new full preview. Reapplying the same preview is idempotent per
store.

### 3. Terminal recovery evidence

Apply creates `pending` evidence for active terminals and `dispositioned`
evidence for terminals already revoked or lost. An active terminal becomes
`recovered` only after successful exact service-session recovery records the
credential revision, recovery version, service session, terminal lifecycle
revision, and proof revision. Preserve this evidence; do not mark rows recovered
manually.

### 4. Shadow and per-store enforcement

The intended progression is `compatibility` to `shadow` to `enforced`.
Starting shadow requires the current migration-state revision and a future
`rollbackDeadlineAt`. Enforcement requires shadow first, a fresh conflict-free
census, no pending terminal evidence, an active keyed credential, and no
`rotation_required` status. Enforced mode sets `legacyFallbackAllowed: false`;
there is no legacy fallback attempt.

`transitionPosServicePrincipalMigrationModeWithCtx` is currently a code-level
contract, not an operator-callable Convex mutation. Therefore this delivery
must stop before shadow or enforcement. Do not patch migration-state rows.

Rollback to compatibility is allowed only before the recorded deadline and
before global retirement. A missing or passed deadline returns
`rollback_deadline_passed`; retirement returns `global_authority_retired`.

### 5. Global retirement gate

Global retirement is allowed only when all of these are true:

- no conflicted stores;
- enforced store count equals active store count;
- no pending terminal recovery evidence;
- no plaintext credentials;
- no `rotation_required` credentials; and
- the latest rollback deadline has passed.

`evaluatePosGlobalRetirement` is currently a pure code-level evaluator, not a
production retirement mutation. A passing evaluation is necessary but does
not itself retire anything.

## Legacy POS-account retirement

Retire `pos@wigclub.store` only after the global gate passes, an approved
retirement surface exists, and rollback is intentionally closed. Before
retirement, confirm the account is not used as any
`servicePrincipalAuthBinding.authUserId`, all stores are enforced, and no
active exact session depends on legacy authority.

Retirement order for a future approved implementation is:

1. Freeze new legacy membership or credential creation.
2. Re-run the complete census and global gate.
3. Revoke or expire legacy sessions and credentials through their owning
   lifecycle controls.
4. Remove the legacy `pos_only` organization memberships and synthetic account
   only through a dedicated audited retirement mutation.
5. Record `retiredAt`, the operator/change reference, final counts, and the
   irreversible rollback boundary.
6. Narrow optional legacy schema fields only in a later release after retained
   data and rollback requirements are satisfied.

No such retirement mutation is delivered here. Do not delete the legacy Auth
user, Athena account, memberships, or credential rows manually.

## Secret-safe evidence and closeout

Record IDs, revisions, states, counts, deployment/release identifiers, UTC
timestamps, correlation IDs, candidate fingerprints, and operational-event
IDs. Do not record:

- recovery codes or plaintext credentials;
- pepper values or private signing keys;
- terminal proofs, reconnect tokens, refresh tokens, or Auth session tokens;
- offline receipt envelopes;
- keyed-verifier digests or salts; or
- raw production rows or logs that contain any of the above.

Candidate fingerprints are comparisons, not secret exports. If an audit needs
proof of a key or secret change, record the secret-manager version and platform
audit reference, not the value.

Close a future operation only after expected state and revision changes are
verified, operational events are present, affected terminals report the target
build and recover successfully, no unexpected cross-store rows exist, and the
change record states whether rollback remains open. A missing signal is
`Hold`, not `Pass`.
