# Athena Operation Admission Rail - Requirements Summary

## Objective

Create a general operation-admission rail for Athena so public operations declare what they do, while actor-specific policies determine who may perform them.

Shared demo will be the first non-human policy consumer. The rail itself must contain no demo-specific behavior or naming.

## Problem

Public Convex operations are currently classified by capability, but runtime enforcement is separately and optionally wired inside handlers. This allows an operation to be allowlisted while still failing because it reaches ordinary Athena authentication before shared-demo admission.

The design must make admission enforcement structural and prevent new operations from silently bypassing or omitting it.

## Core Model

Every public operation declares:

- Capability: what the operation does.
- Scope: the organization, store, or resource it affects.
- Readiness: any platform-level precondition required before execution.
- Effect requirements: protected external effects the operation may invoke, where applicable.

The admission rail resolves:

- Actor identity and kind.
- Capability decision.
- Scope constraints.
- Readiness constraints.
- Provenance required for auditing.
- Effect mode when external effects are involved.

Domain handlers continue to own business authorization and state-transition rules.

## Functional Requirements

- R1. Capability-bound operations: every exported public mutation must be defined through a common Athena operation boundary. Capability and scope declarations must be mandatory where applicable. Omission must fail through static validation rather than at runtime.
- R2. Normalized actor resolution: the rail must resolve the request into a typed actor before the domain handler executes. Initial actor kinds are authenticated Athena user and shared-demo principal, with support for future automation, integration credential, support session, or constrained/delegated principals. Recognized actor kinds must never fall through into another actor's authentication path.
- R3. Extensible actor policies: actor-specific behavior must be implemented through policy adapters registered with the rail. The generic rail must not import from `sharedDemo` or contain checks such as `if demoActor`.
- R4. Shared-demo policy: the adapter must enforce server-owned principal resolution, admission expiry, the closed capability grant set, server-owned org/store scope, store restoration/readiness fencing, stable denial behavior, and shared-demo provenance.
- R5. Normal-user compatibility: the normal-user adapter must preserve existing authentication, membership checks, store membership and role checks, domain authorization, and live external effects.
- R6. Domain authorization remains local: the rail must not absorb business-specific authorization such as staff roles, ownership, approval requirements, workflow transitions, register state, transaction state, or inventory invariants.
- R7. Explicit denial: operations unavailable to a given actor must produce explicit policy denial. A recognized shared-demo request must not fall through to ordinary user authentication and return misleading errors such as "Sign in again to continue."
- R8. Store and resource constraints: scope must be part of the operation declaration. The rail must support no resource scope, store scope, organization scope, and a path for future resource-specific scope.
- R9. Authorized operation context: handlers must receive normalized context containing resolved actor, actor kind, Athena user identity where applicable, authorized constraints, provenance metadata, and policy decision metadata needed by infrastructure.
- R10. External-effect extension point: the design must leave a compatible extension point for live, simulated, or denied protected external effects. Command admission is first priority; general provider/effect dispatch migration may follow after command admission is stable.

## Structural Enforcement

Static coverage must ensure:

- Every exported public mutation uses the Athena admission boundary.
- Every public operation declares a valid catalog capability.
- Required scope metadata is present.
- Raw exported `mutation(...)` definitions are rejected.
- Internal mutations remain distinguishable and are not incorrectly treated as public admission boundaries.
- Exceptional dynamic-capability operations use an explicit supported variant.
- Capability declarations and runtime enforcement cannot drift apart.
- The current hand-maintained representative public-function inventory is no longer treated as proof of runtime enforcement.

## Testing Requirements

The rail must have focused behavioral coverage for:

- Authenticated user admitted.
- Unauthenticated request rejected.
- Shared-demo actor admitted for an allowed capability.
- Shared-demo actor denied for a protected capability.
- Shared-demo actor denied for the wrong store.
- Expired demo admission rejected.
- Restore-in-progress write rejected.
- Domain handler not invoked after admission failure.
- Recognized demo actor never falling through to normal authentication.
- Normal-user behavior remaining unchanged.
- Actor provenance reaching the authorized context.
- Static detection of a raw or incompletely declared public mutation.

## Migration Requirements

### Phase 1: Rail Foundation

- Introduce the generic actor and admission types.
- Implement the public mutation boundary.
- Implement normal-user and shared-demo adapters.
- Add structural coverage.
- Migrate the failing open-work inventory-review command as the first proving path.

### Phase 2: Demo-Reachable Writes

- Migrate every public write classified under a shared-demo-allowed capability.
- Remove redundant handler-level demo admission calls.
- Confirm unsupported operations receive stable policy denials.

### Phase 3: Complete Public-Write Adoption

- Migrate remaining public writes.
- Prohibit raw exported public mutations repository-wide.
- Remove the optional shared-demo capability path from generic Athena-user authentication once no callers depend on it.
- Retire redundant hand-maintained enforcement inventories.

### Follow-On Work

- Extend the same actor model to public reads.
- Generalize external-effect dispatch.
- Add future actor adapters only when a concrete consumer exists.

## Non-Goals

This work will not:

- Redesign Athena's role or membership model.
- Move domain-specific authorization into a central policy engine.
- Change demo fixture behavior or presentation.
- Introduce a general-purpose policy language.
- Redesign Convex internal functions.
- Add speculative actor types beyond the extension contract.

## Acceptance Criteria

The work is complete when:

- An operation's capability declaration automatically installs the appropriate admission enforcement.
- Enabling an existing declared capability for shared demo does not require patching the operation's authentication code.
- Shared-demo actors receive either authorized execution or an intentional policy denial, never accidental normal-auth failure.
- Normal authenticated users retain existing behavior.
- Store scope and restore readiness are enforced before domain execution.
- New public mutations cannot be added without an explicit capability and admission boundary.
- Shared demo is implemented entirely as a consumer of the generic rail.
- Focused Vitest coverage passes; browser validation remains with the user, and heavy repository sensors are deferred unless separately requested.
