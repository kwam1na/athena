---
title: feat: Establish product copy tone foundation and POS pilot
type: feat
status: active
date: 2026-04-25
origin: docs/brainstorms/2026-04-25-product-copy-tone-foundation-requirements.md
---

# feat: Establish product copy tone foundation and POS pilot

## Overview

Define a reusable in-product copy tone foundation for Athena, make that guidance agent-followable through repo instructions, and use the POS session flow as the first implementation pass. The plan should leave the repo with one durable tone reference, one clear adoption path for agents, and one concrete product slice whose operator-facing messaging fully reflects the new standard.

---

## Problem Frame

Athena’s current operator-facing copy is functionally useful but inconsistent. In the POS session flow, system feedback spans multiple surfaces and tones: terse toasts, inline drawer-gate errors, modal copy, and surfaced command-layer messages. Some strings are calm and actionable; others are abrupt, overly technical, or too close to raw backend phrasing. The requirements doc defines a broad in-product tone foundation with POS as the first use case, so planning needs to cover both the repo-level source of truth and the first real adoption path (see origin: `docs/brainstorms/2026-04-25-product-copy-tone-foundation-requirements.md`).

---

## Requirements Trace

- R1. Add a markdown tone guide for broad in-product product copy.
- R2. Define one shared voice: calm, clear, restrained, operational.
- R3. Define surface-specific compression rules for toast, inline, blocking, and recovery states.
- R4. Define system-state-first sentence construction, plain language, and explicit next action when known.
- R5. Include concrete preferred/avoid/rewrite examples.
- R6. Add a repo-level agent instruction hook in `AGENTS.md`.
- R7. Add a webapp-level agent instruction hook in `packages/athena-webapp/AGENTS.md`.
- R8. Use the POS session flow as the first implementation pass.
- R9. Rewrite all operator-facing POS session-flow copy.
- R10. Normalize awkward backend-originated messages before display.

**Origin actors:** A1 (Operator), A2 (Product builder), A3 (Coding agent)
**Origin flows:** F1 (Define the product tone foundation), F2 (Apply the tone foundation to POS session messaging)
**Origin acceptance examples:** AE1 (blocking-state tone example), AE2 (surface-specific compression), AE3 (backend message normalization)

---

## Scope Boundaries

- Do not expand this first pass into marketing, support, or transactional content outside the product UI.
- Do not build a full product-wide message catalog in this pass.
- Do not redesign POS layouts or interaction flows solely to accommodate rewritten copy.
- Do not let raw `CommandResult` or command-layer wording continue to leak directly into operator-visible POS messaging when the wording does not fit the new guide.

### Deferred to Follow-Up Work

- Apply the tone guide outside the POS session flow in later feature slices.
- Broaden normalization and copy review beyond operator-facing surfaces after the POS pilot proves the pattern.

---

## Context & Research

### Relevant Code and Patterns

- `AGENTS.md` and `packages/athena-webapp/AGENTS.md` are the existing instruction entry points for repo-wide and package-local agent behavior.
- `packages/athena-webapp/docs/agent/index.md` already frames the Athena Webapp docs as the operational source of truth, making it a natural place to reference a new tone guide from package-local instructions.
- `packages/athena-webapp/src/lib/errors/runCommand.ts`, `packages/athena-webapp/src/lib/errors/presentCommandToast.ts`, and `packages/athena-webapp/src/lib/errors/presentUnexpectedErrorToast.ts` form the current browser-safe error normalization and toast presentation path.
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts` contains the highest-density operator-facing POS session copy today, including success toasts, blocking toasts, inline drawer-gate errors, and surfaced command messages.
- `packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx` and `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx` contain operator-facing modal and blocking-state copy that is central to the POS pilot.
- Existing tests in `packages/athena-webapp/src/lib/errors/*.test.ts`, `packages/athena-webapp/src/components/pos/CashierAuthDialog.test.tsx`, `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx`, and `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts` provide established validation surfaces for message-bearing behavior.

### Institutional Learnings

- `docs/superpowers/plans/2026-04-22-client-server-error-foundation.md` established the current safe-command-result boundary and explicitly separates expected user-facing failures from generic unexpected-error fallback. This plan should extend that foundation rather than bypass it.
- `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md` reinforces that command-boundary protections stay in place even when UX improves. Copy normalization should not weaken the underlying error contract.

### External References

- Not used. The repo already has strong local context for product messaging surfaces, instruction hooks, and the client/server error contract this plan builds on.

---

## Key Technical Decisions

- Keep the tone source of truth as a markdown doc in `docs/` rather than embedding the standard only in agent instructions. Instructions should point to the guide, not replace it.
- Add both a repo-level and webapp-level instruction hook so future agents are directed to the guide from the two instruction surfaces already used in this repo.
- Treat POS as a proving slice, but build a small reusable message-normalization layer rather than hard-coding every rewrite inline inside `useRegisterViewModel.ts`.
- Keep the current safe-command-result foundation intact: unexpected failures stay generic; operator-facing expected messages are normalized at presentation time or earlier.
- Prefer a focused “operator/system message” helper layer in the webapp over a full message catalog. This keeps the first pass light enough to ship while still giving POS a reusable structure.

---

## Open Questions

### Resolved During Planning

- Should the first foundation artifact be a lightweight markdown guide or a heavier message catalog? Markdown guide, with concrete examples and repo instruction hooks.
- Should the POS pilot cover only errors or all operator-facing messaging? All operator-facing POS session-flow copy.
- Should the initial guide be broad or POS-only? Broad in-product tone, with POS as the first implementation pass.

### Deferred to Implementation

- Exact location and filename of the tone guide within `docs/`: implementation can choose the most legible repo-level location, but it must be easy to reference from both `AGENTS.md` files.
- Exact shape of the reusable webapp copy helper: implementation should choose the simplest abstraction that supports normalization without turning this into a message catalog.
- Exact mapping of raw command-layer phrases to normalized operator copy: implementation should derive this from the POS audit and keep the mapping as close as possible to presentation boundaries.

---

## Implementation Units

- U1. **Add the product copy tone guide and instruction hooks**

**Goal:** Create the durable source of truth for in-product copy tone and wire both agent instruction surfaces to it.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** None

**Files:**
- Create: `docs/product-copy-tone.md` (or equivalent repo-level docs path chosen during implementation)
- Modify: `AGENTS.md`
- Modify: `packages/athena-webapp/AGENTS.md`
- Test: `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx` (regression safety for nearby touched instructions is not applicable)

**Approach:**
- Write a compact tone guide that defines voice principles, message anatomy by surface, preferred and avoid patterns, and before/after rewrites.
- Make the guide broad enough for in-product copy across Athena, but grounded in operator/system feedback rather than marketing voice.
- Add a short repo-level rule in `AGENTS.md` that directs agents to the tone guide for product copy work.
- Add a webapp-local rule in `packages/athena-webapp/AGENTS.md` that reinforces the same requirement for Athena Webapp changes.

**Patterns to follow:**
- Existing repo guidance style in `AGENTS.md`.
- Existing package-local instruction style in `packages/athena-webapp/AGENTS.md`.

**Test scenarios:**
- Test expectation: none -- documentation and instruction-surface change only.

**Verification:**
- The tone guide exists at a stable repo-relative path.
- Both `AGENTS.md` files point future agents to it explicitly.

---

- U2. **Introduce a reusable operator message normalization layer**

**Goal:** Give Athena Webapp a small reusable path for applying the tone guide to operator-facing system messages, especially messages currently surfaced from command-layer results.

**Requirements:** R2, R3, R4, R5, R10

**Dependencies:** U1

**Files:**
- Create: `packages/athena-webapp/src/lib/errors/operatorMessages.ts` (or equivalent helper path selected during implementation)
- Create: `packages/athena-webapp/src/lib/errors/operatorMessages.test.ts`
- Modify: `packages/athena-webapp/src/lib/errors/presentCommandToast.ts`
- Modify: `packages/athena-webapp/src/lib/errors/presentCommandToast.test.ts`
- Review/modify: `packages/athena-webapp/src/lib/errors/presentUnexpectedErrorToast.ts`
- Review/modify: `packages/athena-webapp/src/lib/errors/presentUnexpectedErrorToast.test.ts`

**Approach:**
- Add a lightweight helper that expresses the new tone rules in code, especially where raw or awkward operator-facing messages need normalization before display.
- Keep the abstraction small: it should normalize or select operator-facing phrasing, not become a full message registry.
- Use the helper from toast presentation first, since `presentCommandToast.ts` is already the shared expected-failure path.
- Preserve generic unexpected-error fallback behavior; the new layer should refine expected operator messaging, not increase surface area for leaked backend text.

**Patterns to follow:**
- The safe-command-result foundation in `packages/athena-webapp/shared/commandResult.ts`.
- Existing normalization path in `packages/athena-webapp/src/lib/errors/runCommand.ts`.

**Test scenarios:**
- Happy path: a known awkward but expected operator-facing error message is normalized into calm, system-state-first copy.
- Happy path: a message that already matches the tone guide passes through unchanged.
- Error path: unexpected-error presentation still uses generic fallback copy rather than route-specific normalization.
- Edge case: normalization preserves actionable specificity when the system knows the fix.

**Verification:**
- Toast presentation no longer blindly forwards every safe command message unchanged.
- The normalization helper is small, reusable, and isolated from POS-specific UI components.

---

- U3. **Rewrite POS session-flow messaging to use the foundation**

**Goal:** Make POS the first consistent implementation of the new tone guide across operator-facing session-flow messaging.

**Requirements:** R2, R3, R4, R5, R8, R9, R10

**Dependencies:** U1, U2

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Modify: `packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx`
- Modify: `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`
- Review/modify: `packages/athena-webapp/src/components/pos/register/RegisterActionBar.tsx`
- Review/modify: `packages/athena-webapp/src/components/pos/register/RegisterSessionPanel.tsx`
- Review/modify: `packages/athena-webapp/src/components/pos/OrderSummary.tsx`
- Test: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`
- Test: `packages/athena-webapp/src/components/pos/CashierAuthDialog.test.tsx`
- Test: `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx`

**Approach:**
- Audit every operator-facing string in the POS session flow and group them by surface: toast, inline form/gate error, blocking state, modal/dialog, confirmation.
- Rewrite the strings to the new tone: calm, plain-language, system-state-first, explicit action when known.
- Replace internal jargon where it is not essential to operators.
- Route surfaced command messages through the new normalization layer rather than displaying them raw when they do not meet the guide.
- Keep success, warning, blocking, and recovery language in the same voice system, with surface-appropriate compression.

**Patterns to follow:**
- Existing message-bearing tests in `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`.
- Existing modal and drawer-gate component coverage in `packages/athena-webapp/src/components/pos/CashierAuthDialog.test.tsx` and `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx`.

**Test scenarios:**
- Happy path: successful session creation, hold, resume, void, drawer opening, and transaction completion use the calm operational tone without drifting into celebratory or dramatic language.
- Error path: drawer-required, sign-in-required, missing-session, and invalid-input messages use system-state-first phrasing with an explicit next action when one exists.
- Recovery path: drawer gate and cashier auth states use fuller but still restrained guidance compared with toast surfaces.
- Edge case: command-layer errors that previously surfaced as raw `result.message` or `result.error.message` are normalized before reaching the operator when they do not match the guide.
- Integration: POS tests that assert message text are updated to the new canonical phrasing rather than brittle legacy wording.

**Verification:**
- POS session-flow copy reads as one coherent system across modal, gate, toast, and success states.
- No known operator-facing POS path still depends on raw backend wording unless the wording already conforms to the tone guide.

---

- U4. **Audit rollout boundaries and future adoption notes**

**Goal:** Leave the repo with a clear boundary between the POS pilot and later product-wide rollout so future copy work can extend the same foundation intentionally.

**Requirements:** R1, R8

**Dependencies:** U1, U3

**Files:**
- Modify: `docs/product-copy-tone.md` (or chosen guide path)
- Review/modify: `docs/brainstorms/2026-04-25-product-copy-tone-foundation-requirements.md`
- Test: none

**Approach:**
- Add a short section to the tone guide describing how the POS pilot demonstrates the system and what remains out of scope for this pass.
- Keep the scope explicit so future product-copy work can extend the standard without reopening the original decisions.

**Patterns to follow:**
- Existing “scope boundaries” and next-step articulation in repo planning/brainstorm docs.

**Test scenarios:**
- Test expectation: none -- documentation and rollout-boundary capture only.

**Verification:**
- The guide and origin artifact clearly distinguish the shipped POS pilot from later broader rollout work.

---

## System-Wide Impact

- **Interaction graph:** Changes touch repo instructions, shared error presentation utilities, and multiple POS session UI entry points. This is a cross-cutting copy/system-feedback change rather than a single-surface component tweak.
- **Error propagation:** Expected command failures should continue flowing through `runCommand.ts` and `presentCommandToast.ts`, but the final operator-facing phrasing should now reflect the tone guide rather than raw server wording.
- **State lifecycle risks:** Copy changes must not accidentally alter behavioral guards or hide meaningful distinctions between drawer, sign-in, session, and completion states.
- **API surface parity:** POS becomes the first adopter, but the guide and normalization helper should be portable to other Athena surfaces later.
- **Integration coverage:** Unit tests alone will not prove that all POS session strings were captured; implementation should include a targeted message audit across the known entry points.
- **Unchanged invariants:** The safe-command-result foundation, generic unexpected-error fallback, and existing POS command boundaries remain unchanged; this plan changes the copy layer, not the underlying operational rules.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The tone guide stays too abstract and agents continue improvising | Require concrete preferred/avoid examples and link both instruction surfaces directly to the guide |
| A helper layer becomes a premature message catalog | Keep the abstraction narrow: normalization and selection only, not a comprehensive registry |
| POS rewrites accidentally blur operational distinctions between states | Preserve message tests by scenario and keep system-state-first wording that names the actual condition |
| Raw backend messages still leak through less obvious paths | Audit all `toast.error(result.message)` / `toast.error(result.error.message)` POS paths during implementation and route them through the normalization helper where needed |

---

## Documentation / Operational Notes

- The new tone guide becomes a standing repo artifact and should be treated as the default reference for in-product copy work.
- The POS pilot should provide enough concrete rewrites that later work can copy existing patterns instead of reinterpreting the guide from scratch.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-25-product-copy-tone-foundation-requirements.md`
- Related docs: `AGENTS.md`
- Related docs: `packages/athena-webapp/AGENTS.md`
- Related docs: `packages/athena-webapp/docs/agent/index.md`
- Related code: `packages/athena-webapp/src/lib/errors/runCommand.ts`
- Related code: `packages/athena-webapp/src/lib/errors/presentCommandToast.ts`
- Related code: `packages/athena-webapp/src/lib/errors/presentUnexpectedErrorToast.ts`
- Related code: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Related code: `packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx`
- Related code: `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`
- Related plan: `docs/superpowers/plans/2026-04-22-client-server-error-foundation.md`
