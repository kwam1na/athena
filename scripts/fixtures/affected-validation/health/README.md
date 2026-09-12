# Validation health contract fixtures

V26-2068 supplies a callable qualification module. V26-2069 owns workflow,
schedule, protected-main classification file and gate wiring. V26-2071 alone
activates affected validation. The workflow ID/path and check names here are
fictional fixtures, not deployed settings.

## Call boundary

`readValidationHealth(policy, options)` reads GitHub Actions through the existing
`gh api` authentication facility. Policy must come from trusted protected-base
configuration, not the candidate. It pins the main commit before reading the
maintainer-approved classification document. That document must exist (an empty
`entries` array is valid). Supply `verifyClassificationApproval(entry, pinnedMainSha)` from a trusted host
capability verifying actual maintainer approval of that exact classification.
Main membership alone is insufficient: the current ruleset has required statuses
but no approving-review rule. An absent or false verifier cannot narrow scope or
close findings. V26-2069 owns the concrete GitHub approval adapter; this module
does not create or enforce branch protection.

The health producer uploads a ZIP artifact with exactly one `health.json` member.
The versioned digest binds repository, run ID, attempt and head. `complete: true`
means every check in the trusted inventory has a success/failure result. A green
workflow with empty/partial inventory is invalid. Selected coverage cannot write
a complete full-health result. Scope comes from trusted check policy, not from
artifact-authored localization; unknown checks conservatively use repo scope.

`findings` is the cumulative unresolved ledger, not only the current run's
failures. The producer must carry it across runs, even when the latest checks
pass. Missing artifacts never mean closure. A caller passes its previous trusted
snapshot on subsequent reads; the reader preserves known failures even on an API
outage or omission in a newer artifact. Fresh consumers depend on the trusted
producer's cumulative ledger. Do not build that ledger from candidate artifacts.

`evaluateValidationHealth({ health, candidate, proofs, plannedHealthRevision })`
is a pure decision function. Call the reader at planning and again at final
admission. The candidate reference binds the actual prepared inputs; scopes use
canonical package IDs and exact repository-relative paths (not glob patterns).
An empty candidate scope list means unknown impact. Output includes status,
reason, health revision, reevaluation flag and scoped repair obligations.

Proofs are **already verified product evidence**, not untrusted JSON receipts.
This module evaluates scope/binding; it does not duplicate the product's evidence
signature, input, inventory or provenance verifier. Local and hosted profiles
remain separate. A successful local repair proof can permit local record and
pre-push while CI independently produces its own hosted proof. Neither changes
the global finding, nor can another candidate reuse that discharge.

When required health is unavailable, `recovery.mode` requests `full-health` from
the same planner. A product-verified `fullValidation` proof can discharge only
the unavailable-state requirement for that candidate/profile/health revision.
Known intersecting failures still need matching repair proofs. Full recovery
neither updates `lastComplete` nor pretends to be a hosted scheduled health run.

## Global resolution

A protected-main entry in `approved-resolution.json` names the exact finding
revision, approved reference and revalidation run. The reader closes the finding
only when the approval capability verifies that exact classification, a newer
trusted complete main result passes the failed check, and its
commit is an ancestor of (or identical to) approved main. Until then it stays
open. An optional approved `scope` localizes a finding; removal of that approval
restores declared package/repo scope. Revisioned closure references are retained.

## Availability and retained history

No seed, API failure, invalid/expired/foreign artifacts, incomplete history and
results at least 48 hours old cannot appear healthy. A cancelled latest attempt
may use a sufficiently recent complete result and retains open failures. A
bounded history scan that cannot establish completeness returns unavailable.
The sensor emits no external mutation and registers no CLI or live obligation.

Run `bun test scripts/harness-validation-health.test.ts` for the offline contract
corpus. The integration owner runs the combined repository gate and generated
artifact checks. These fixtures do not claim hosted qualification.
