---
date: 2026-04-25
topic: product-copy-tone-foundation
---

# Product Copy Tone Foundation

## Problem Frame

Athena currently communicates with operators through a mix of direct UI copy, toasts, blocking states, and surfaced backend messages. In the POS session flow, that language is inconsistent in tone, message shape, and clarity. Some messages are calm and situational, while others are abrupt, overly technical, or too dependent on underlying command output. The product needs a single in-product copy tone foundation that agents and teammates can follow consistently, with POS as the first applied use case.

---

## Actors

- A1. Operator: Uses Athena in real-time workflows and needs fast, low-friction guidance.
- A2. Product builder: Writes or updates product copy in UI states, forms, alerts, and system feedback.
- A3. Coding agent: Generates or edits product-facing copy and needs an explicit repo source of truth to follow.

---

## Key Flows

- F1. Define the product tone foundation
  - **Trigger:** A builder wants a reusable standard for in-product copy.
  - **Actors:** A2, A3
  - **Steps:** Review current messaging patterns, define the shared voice principles, define message anatomy by surface, add preferred and avoid examples, and place the guidance in repo docs with explicit instruction hooks.
  - **Outcome:** Product copy work has a durable, referenced tone standard.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Apply the tone foundation to POS session messaging
  - **Trigger:** A builder uses the new guide to rewrite operator-facing POS session copy.
  - **Actors:** A1, A2, A3
  - **Steps:** Audit current POS session copy, normalize it to the new tone rules, rewrite operator-facing messages across success, warning, error, recovery, and blocking states, and ensure surfaced backend wording is rewritten before display.
  - **Outcome:** POS becomes the first consistent implementation of the shared product tone.
  - **Covered by:** R6, R7, R8, R9

---

## Requirements

**Tone foundation**
- R1. The repo must include a markdown tone guide for broad in-product product copy, written to serve as the default reference for future copy decisions.
- R2. The guide must define one shared voice for in-product copy: calm, clear, restrained, and operational rather than playful, reassuring, or dramatic.
- R3. The guide must describe how message compression changes by surface, with terse patterns for toasts and fuller guidance for inline, blocking, and recovery states.
- R4. The guide must define default sentence construction for system feedback: system-state-first wording, plain language over internal jargon, and explicit next action whenever the system knows the fix.
- R5. The guide must include concrete `preferred`, `avoid`, and rewrite examples so agents and teammates can apply it without interpretation drift.

**Agent-followability**
- R6. The foundation must include an explicit agent-facing instruction hook in the root `AGENTS.md` so repo-wide copy work points to the tone guide.
- R7. The foundation must include a more specific instruction hook in `packages/athena-webapp/AGENTS.md` so Athena Webapp work, including POS, inherits the same rule with local relevance.

**POS pilot**
- R8. The POS session flow must be the first implementation pass for the tone guide.
- R9. The POS pilot must rewrite all operator-facing session-flow copy, including success states, warnings, errors, confirmations, blocking states, recovery states, and drawer/auth/session guidance.
- R10. The POS pilot must normalize awkward or technical backend-originated messages before they are shown to operators rather than passing raw command-layer phrasing through directly.

---

## Acceptance Examples

- AE1. **Covers R2, R3, R4, R5.** Given a blocking POS condition, when the guide shows examples, it demonstrates a short, calm system-state-first pattern such as “Drawer closed. Open the drawer to continue.” and contrasts it against more dramatic, apologetic, or jargon-heavy alternatives.
- AE2. **Covers R3, R9.** Given a lightweight toast and a blocking recovery view in POS, when both are rewritten, the toast stays short while the blocking view is allowed a fuller but still restrained explanation.
- AE3. **Covers R4, R10.** Given a backend-originated message that is technically correct but awkward for operators, when the POS pilot applies the foundation, the displayed copy is normalized into plain operational language rather than shown raw.

---

## Success Criteria

- Operators experience POS session messaging as consistent, calm, and immediately actionable across routine, blocking, and recovery states.
- Builders and agents can update in-product copy by following a single repo-documented tone guide instead of inventing phrasing case by case.
- The POS pilot produces a concrete before-and-after implementation that can be reused as the reference pattern for broader rollout.

---

## Scope Boundaries

- This work defines the in-product copy tone foundation first; it does not yet standardize marketing, support, or transactional content outside product UI.
- This work focuses on operator-facing product copy, not visual redesign of the affected states.
- This work creates tone rules and a POS pilot, not a full product-wide message catalog in the first pass.
- This work does not require preserving or explicitly narrating state continuity in default system messaging unless a later product decision changes that rule.

---

## Key Decisions

- Shared voice: Use one calm, clear, restrained voice across in-product product copy.
- Message shape: Use short defaults, but allow fuller guidance for blockers and recovery states.
- Wording model: Prefer system-state-first language over operator-centered phrasing.
- Vocabulary model: Prefer plain language and replace internal terms when possible.
- Backend handling: Normalize operator-facing command-layer messages before display instead of surfacing raw wording.
- Rollout strategy: Establish the guide first, then pilot it in the POS session flow before wider expansion.
- Agent adoption: Add both a repo-level and webapp-level instruction hook so agents are explicitly directed to follow the guide.

---

## Dependencies / Assumptions

- `AGENTS.md` and `packages/athena-webapp/AGENTS.md` are the right instruction surfaces for making the tone guide agent-followable.
- The current POS session flow contains enough representative message types to serve as a meaningful first pilot for the broader product system.
- Existing backend or command-layer messages may need UI-layer rewriting or mapping to align with the guide.

---

## Next Steps

- Write the product copy tone guide markdown document and link it from the root and webapp `AGENTS.md` files.
- Audit operator-facing POS session copy and map current strings to target rewrites under the new guide.
- -> `/ce-plan` for structured implementation planning
