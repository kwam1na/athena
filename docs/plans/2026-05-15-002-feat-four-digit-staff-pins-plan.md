---
title: feat: Move staff PIN collection to four digits
type: feat
status: active
date: 2026-05-15
---

# feat: Move staff PIN collection to four digits

## Summary

Athena should require four-digit staff PINs everywhere staff credentials are collected: initial/reset PIN setup in the organization members workspace, staff authentication, and manager elevation/approval flows. The implementation should introduce a reusable staff PIN collection component so the four-digit rule is expressed once at the UI boundary instead of repeated across each surface.

---

## Requirements

- R1. Staff PIN setup in organization members must accept and save exactly four digits.
- R2. Staff authentication surfaces must collect exactly four PIN digits before submitting credentials.
- R3. Manager authentication/elevation surfaces must inherit the same four-digit collection behavior through the shared staff authentication dialog.
- R4. The PIN input UI should be reusable and should not require each caller to hand-code length, sanitization, grouping, and validation copy.
- R5. Existing server-side hashing, local verifier creation, offline staff authority, and manager approval proof boundaries must stay unchanged except for the raw PIN length accepted by the client.
- R6. Four-digit PIN authentication must be protected by server-side failed-attempt throttling and authorized PIN reset controls.

---

## Scope Boundaries

- This plan changes the required length for newly entered PINs from six digits to four digits.
- This plan does not migrate existing stored PIN hashes or local verifier records.
- This plan does not change staff roles, manager approval policy, audit events, or POS local staff authority proof semantics.
- This plan does not add a new password/PIN complexity policy beyond numeric four-digit collection.

---

## Context & Research

### Relevant Code and Patterns

- `packages/athena-webapp/src/components/pos/PinInput.tsx` wraps `input-otp` and renders the current grouped PIN slots.
- `packages/athena-webapp/src/components/staff-auth/StaffAuthenticationDialog.tsx` collects username/PIN and is reused by cashier authentication, manager elevation, command approval, operations, transactions, and cash controls.
- `packages/athena-webapp/src/components/staff/StaffManagement.tsx` owns deferred staff PIN setup/reset in the organization members workspace.
- `packages/athena-webapp/src/components/staff-auth/StaffAuthenticationDialog.test.tsx`, `packages/athena-webapp/src/components/staff/StaffManagement.test.tsx`, and `packages/athena-webapp/src/contexts/ManagerElevationContext.test.tsx` cover the closest client behaviors.

### Institutional Learnings

- `docs/solutions/architecture/athena-pos-local-staff-authority-2026-05-14.md` says online PIN hashes are compatibility data while local staff authority uses terminal-scoped verifier metadata. Keep the hashing/verifier boundary intact.
- `docs/solutions/logic-errors/athena-command-approval-manager-fast-path-2026-05-02.md` says manager fast-path approval should pass fresh same-submission credentials and must not store or reuse PIN hashes. The reusable component must only collect the current raw PIN for submission.
- `docs/solutions/logic-errors/athena-staff-pin-length-throttling-2026-05-15.md` says shorter staff PIN policies require server-side failed-attempt throttling at the credential boundary, including manager approval proof paths.

---

## Key Technical Decisions

- Introduce a staff-specific PIN collection component near the staff authentication surface: this keeps generic slot rendering in `PinInput` while centralizing staff PIN length, numeric sanitization, submit-readiness, helper copy, and test selectors for staff credentials.
- Route both authentication and setup through that staff PIN component: `StaffAuthenticationDialog` should stop hard-coding six digits, and `CredentialPinDialog` should stop duplicating length checks and slicing.
- Keep server contracts unchanged: `pinHash`, `localPinVerifier`, and manager elevation mutations receive the same values they already receive, now derived from a four-digit raw PIN.
- Add lockout metadata to staff credentials instead of introducing a separate auth-attempt table: the shared credential row is the narrowest server boundary that protects base auth, terminal auth, and approval auth together.

---

## Open Questions

### Resolved During Planning

- Should existing credential hashes be migrated? No. Hashes/verifiers are opaque and validated from the submitted raw PIN; changing client input length only affects future authentication/setup submissions.
- Should manager auth get a separate component? No. Manager auth uses `StaffAuthenticationDialog`, so it should inherit the shared staff PIN collector.
- Should four-digit PINs ship without server throttling? No. The server credential boundary must count failed attempts and return `rate_limited` while locked.

### Deferred to Implementation

- Exact component name/location: choose the smallest path that matches local imports after implementation starts.

---

## Implementation Units

- U1. **Create shared four-digit staff PIN collection**

**Goal:** Add a reusable component for staff PIN entry that wraps the existing slot input with a four-digit numeric policy.

**Requirements:** R2, R3, R4

**Dependencies:** None

**Files:**
- Create: `packages/athena-webapp/src/components/staff-auth/StaffPinInput.tsx`
- Test: `packages/athena-webapp/src/components/staff-auth/StaffAuthenticationDialog.test.tsx`

**Approach:**
- Keep `PinInput` as the low-level visual primitive.
- Add a staff PIN component that sanitizes non-digits, caps input at four digits, exposes completion/readiness behavior through normal React props, and uses four slots.
- Preserve keyboard filtering and enter-submit behavior at the parent form/dialog level where it already exists.

**Execution note:** Implement test-first by updating authentication tests to demonstrate four-digit auto-submit and rejection of incomplete PINs before changing the component.

**Patterns to follow:**
- `packages/athena-webapp/src/components/pos/PinInput.tsx`
- `packages/athena-webapp/src/components/staff-auth/StaffAuthenticationDialog.tsx`

**Test scenarios:**
- Happy path: enter username `frontdesk` and PIN `1234`; authentication submits once with raw PIN `1234` and hash `hashed:1234`.
- Edge case: enter username and only `123`; authentication does not submit and the submit button stays disabled.
- Edge case: paste `12ab3456`; the shared staff PIN component stores only `1234`.

**Verification:**
- Authentication surfaces no longer reference a six-digit PIN length.

---

- U2. **Apply four-digit collection to staff and manager authentication**

**Goal:** Update `StaffAuthenticationDialog` so staff auth, cashier auth, manager elevation, command approval, operations, transactions, and cash controls all collect four-digit PINs through the shared component.

**Requirements:** R2, R3, R5

**Dependencies:** U1

**Files:**
- Modify: `packages/athena-webapp/src/components/staff-auth/StaffAuthenticationDialog.tsx`
- Modify: `packages/athena-webapp/src/contexts/ManagerElevationContext.test.tsx`
- Test: `packages/athena-webapp/src/components/staff-auth/StaffAuthenticationDialog.test.tsx`

**Approach:**
- Replace hard-coded `pin.length === 6`, `pin.length !== 6`, `maxLength={6}`, and six-digit error copy with the shared staff PIN policy.
- Keep the submitted credential object shape unchanged.
- Manager elevation should need no separate runtime change beyond inherited dialog behavior; tests should prove the manager path still forwards the submitted hash and username.

**Execution note:** Test-first: update dialog tests before implementation and add manager coverage only where it catches a real integration risk.

**Patterns to follow:**
- `packages/athena-webapp/src/contexts/ManagerElevationContext.tsx`
- `docs/solutions/logic-errors/athena-command-approval-manager-fast-path-2026-05-02.md`

**Test scenarios:**
- Happy path: four-digit staff auth auto-submits in authenticate mode.
- Error path: clicking submit with fewer than four digits shows copy that says four digits, not six.
- Integration: manager elevation continues to pass the submitted username and PIN hash into `startManagerElevation`.

**Verification:**
- All staff-auth dialog users inherit the four-digit policy without caller-specific length props.

---

- U3. **Apply four-digit setup/reset in organization members**

**Goal:** Update the organization members staff PIN setup/reset dialog to collect, confirm, hash, and save exactly four digits.

**Requirements:** R1, R4, R5

**Dependencies:** U1

**Files:**
- Modify: `packages/athena-webapp/src/components/staff/StaffManagement.tsx`
- Test: `packages/athena-webapp/src/components/staff/StaffManagement.test.tsx`

**Approach:**
- Replace setup/reset dialog use of `PinInput` with the shared staff PIN component.
- Replace six-digit validation, slicing, disabled-state logic, and toast copy with the four-digit policy.
- Keep `hashPin(pin)` and `createLocalPinVerifier(pin)` as-is so persistence behavior stays the same.

**Execution note:** Test-first: update staff management tests to save `1234` and verify both `pinHash` and `localPinVerifier` receive `1234`.

**Patterns to follow:**
- `packages/athena-webapp/src/components/staff/StaffManagement.tsx`
- `docs/solutions/architecture/athena-pos-local-staff-authority-2026-05-14.md`

**Test scenarios:**
- Happy path: pending credential setup accepts `1234`, saves `pinHash: "hashed:1234"`, and stores local verifier metadata for `1234`.
- Edge case: setup with mismatched `1234` and `4321` keeps the save action disabled and shows mismatch copy.
- Error path: direct submit with fewer than four digits shows `PIN must be exactly 4 digits`.

**Verification:**
- Organization members staff PIN setup/reset has no remaining six-digit UI validation.

---

- U4. **Protect four-digit staff authentication with credential throttling**

**Goal:** Add server-side failed-attempt tracking so the shorter PIN policy does not weaken staff authentication or manager approval proof minting.

**Requirements:** R6

**Dependencies:** U1, U2, U3

**Files:**
- Modify: `packages/athena-webapp/convex/operations/staffCredentials.ts`
- Modify: `packages/athena-webapp/convex/schemas/operations/staffCredential.ts`
- Test: `packages/athena-webapp/convex/operations/staffCredentials.test.ts`

**Approach:**
- Track failed attempts and lockout expiry on the staff credential row.
- Count failed hash comparisons in `authenticateStaffCredentialWithCtx`.
- Return `rate_limited` while the credential is locked.
- Reset failed attempts after a successful authentication or authorized PIN reset.
- Require authenticated store access before public staff authentication can mutate lockout state or mint approval proofs.
- Require full-admin organization membership before public credential create/update mutations can create, reset, or clear lockout state.

**Execution note:** Add tests around base authentication, terminal authentication inherited behavior, approval proof authentication, and unauthorized reset attempts.

**Patterns to follow:**
- `packages/athena-webapp/convex/operations/staffCredentials.ts`
- `docs/solutions/logic-errors/athena-staff-pin-length-throttling-2026-05-15.md`

**Test scenarios:**
- Error path: five wrong PIN hashes lock the active credential and return `rate_limited` on the next attempt.
- Recovery path: successful authentication resets failed-attempt counters.
- Recovery path: authorized PIN reset clears lockout state.
- Authorization path: public credential create/update requires full-admin access before mutating credential state.
- Authorization path: public staff authentication and approval-proof mutations require authenticated store access before mutating credential state.
- Integration: manager approval proof authentication cannot mint a proof while the credential is locked.

**Verification:**
- All public staff credential mutation paths that can reset PINs or lockout state are authorization-gated.

---

## System-Wide Impact

- **Interaction graph:** `StaffAuthenticationDialog` is the shared auth entry for POS cashier auth, manager elevation, command approval, operations, transactions, and cash controls. Changing it updates all those PIN collection surfaces together.
- **Error propagation:** Existing `presentCommandToast` behavior stays unchanged; local pre-submit copy changes from six digits to four, and server lockout returns the existing command-result `rate_limited` shape.
- **State lifecycle risks:** Stored hashes/verifiers are not migrated, so existing staff whose current PIN is six digits may need a reset to comply with the new UI length.
- **API surface parity:** Convex mutations keep the same argument names and types, with optional credential lockout metadata added to the stored row.
- **Integration coverage:** Staff setup, manager elevation, credential mutation, lockout, and approval proof tests prove setup and auth routes still forward credentials correctly while enforcing attempt limits.
- **Unchanged invariants:** Manager approval proofs, local staff authority proof wrapping, and credential version checks remain server-owned.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Existing staff with six-digit PINs cannot enter their old PIN after deploy | Treat as accepted behavior for the policy change; operators can reset staff PINs through organization members. |
| A caller bypasses the shared component and keeps six-digit assumptions | Search for `pin.length`, `maxLength={6}`, `slice(0, 6)`, and six-digit PIN copy before final validation. |
| Four-digit PINs increase brute-force feasibility | Enforce credential-level failed-attempt lockout across shared staff authentication and manager approval proof paths. |
| PIN reset could clear lockout without authorization | Require full-admin organization membership before public staff credential create/update mutations can create, reset, or clear credential state. |
| Public authentication could be used for denial-of-service lockouts or out-of-band approval proofs | Require authenticated store access before public staff authentication and approval-proof mutations can compare PIN hashes. |
| PIN UI grouping looks awkward with four slots | Keep the low-level primitive responsive and let the staff component choose four slots; browser-test the affected dialogs if local runtime is available. |

---

## Documentation / Operational Notes

- No product docs are required unless Athena has operator-facing staff onboarding documentation outside this repo.
- Production deploy should use the Athena local-build path after merge because this changes `packages/athena-webapp` browser runtime.
- Production deploy should also publish Convex changes because staff credential schema and mutation behavior changed.

---

## Sources & References

- Related code: `packages/athena-webapp/src/components/pos/PinInput.tsx`
- Related code: `packages/athena-webapp/src/components/staff-auth/StaffAuthenticationDialog.tsx`
- Related code: `packages/athena-webapp/src/components/staff/StaffManagement.tsx`
- Related code: `packages/athena-webapp/convex/operations/staffCredentials.ts`
- Related learning: `docs/solutions/architecture/athena-pos-local-staff-authority-2026-05-14.md`
- Related learning: `docs/solutions/logic-errors/athena-command-approval-manager-fast-path-2026-05-02.md`
- Related learning: `docs/solutions/logic-errors/athena-staff-pin-length-throttling-2026-05-15.md`
