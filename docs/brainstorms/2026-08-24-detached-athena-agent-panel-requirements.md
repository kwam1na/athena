---
date: 2026-08-24
topic: detached-athena-agent-panel
---

# Detached Athena Agent Panel

## Summary

Make the existing Ask Athena conversation a persistent authenticated-shell workspace that can remain available across app surfaces. On desktop it appears as a detached, resizable floating panel; on mobile it retains the existing full-screen presentation.

---

## Problem Frame

Ask Athena currently belongs to the Daily Operations surface that launched it. Navigating away removes the panel and its local interaction state, even though the conversation and its original store-day context are still relevant. This makes the agent feel like a page accessory instead of an app-level workspace and interrupts follow-up work across operational surfaces.

The current edge-to-edge desktop sheet also reads as a structural region of the page. That visual weight is disproportionate for a parallel, non-blocking conversation and makes it harder to preserve the underlying workspace as the primary surface.

---

## Actors

- A1. Operator: asks contextual questions while moving between authenticated operational surfaces.
- A2. Athena: answers against the explicitly established store, operating date, and originating surface context.
- A3. Authenticated app shell: preserves panel and conversation state independently of route content.

---

## Key Flows

- F1. Start a contextual conversation
  - **Trigger:** An operator selects Ask Athena from Daily Operations.
  - **Actors:** A1, A2, A3
  - **Steps:** Daily Operations establishes its current store-day context, the shell opens the existing conversation panel, and the operator asks a question.
  - **Outcome:** The conversation is attached to a stable origin context and remains available after route navigation.
  - **Covered by:** R1, R2, R3, R5

- F2. Continue work across surfaces
  - **Trigger:** An operator navigates away from the surface that established the conversation.
  - **Actors:** A1, A2, A3
  - **Steps:** The shell retains the conversation and panel state, the underlying route changes without reflow, and the operator can close or reopen the same conversation from the persistent shell control.
  - **Outcome:** Navigation does not silently change Athena's context or discard the operator's in-session work.
  - **Covered by:** R2, R4, R6, R7, R8

- F3. Explicitly change context
  - **Trigger:** An operator invokes Ask Athena from a different supported context or starts a new thread.
  - **Actors:** A1, A2, A3
  - **Steps:** The initiating surface presents the new context, the operator explicitly activates it, and the shell replaces or resets the active conversation as appropriate.
  - **Outcome:** Context changes are deliberate and visible rather than inferred from navigation.
  - **Covered by:** R3, R4, R9

- F4. Resume after reload
  - **Trigger:** The authenticated app reloads during the same browser session.
  - **Actors:** A1, A3
  - **Steps:** The shell restores the latest conversation and origin context, keeps the panel closed, and makes the conversation available from the shell control.
  - **Outcome:** Conversation continuity survives reload without unexpectedly covering the current surface.
  - **Covered by:** R6, R8

---

## Requirements

**Shell ownership and context**

- R1. The existing Ask Athena panel must be owned by the authenticated app shell rather than by Daily Operations route content.
- R2. The panel must remain available while the operator navigates among normal authenticated-shell surfaces.
- R3. Invoking Ask Athena from Daily Operations must establish or explicitly switch to that surface's current store, operating date, and surface context.
- R4. Route navigation alone must not change the active conversation context.
- R5. The implementation must reuse the existing agent profile, capabilities, transcript, composer, and response behavior.

**Continuity and controls**

- R6. During a browser session, the shell must preserve the active conversation, panel width, transcript position, composer draft, and open or closed state across route navigation.
- R7. A persistent authenticated-shell control must reopen the preserved conversation without creating or inferring a new context.
- R8. On reload, the shell must restore the latest conversation and its origin context but leave the panel closed.
- R9. Starting a new thread or invoking a different supported context must be an explicit action and must not happen as a side effect of navigation.

**Presentation**

- R10. On desktop, the panel must appear as a right-anchored floating workspace inset from the viewport edges, with clear surface separation and no background scrim or page reflow.
- R11. The desktop panel width must remain directly resizable, while the panel itself must not be draggable.
- R12. On mobile, the panel must retain the existing full-screen experience.
- R13. The panel must preserve accessible close, reopen, resize, focus, keyboard, reduced-motion, reduced-transparency, and increased-contrast behavior appropriate to its presentation.

**Surface boundaries**

- R14. Public, login, restricted, and other surfaces that bypass the normal authenticated shell must not receive the detached panel or its launcher.
- R15. Before a supported surface establishes context, the shell control must remain unavailable and must not fabricate a default store-day context.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4, R6.** Given an open Daily Operations conversation with a draft and a resized panel, when the operator navigates to another authenticated surface, the same panel, context, width, transcript position, and draft remain available.
- AE2. **Covers R3, R4, R9.** Given a conversation pinned to Wigclub on 2026-08-24, when the operator navigates to a different store or date without invoking Ask Athena there, Athena remains pinned to Wigclub on 2026-08-24.
- AE3. **Covers R3, R9.** Given an existing pinned conversation, when the operator invokes Ask Athena from a different supported context and confirms that entry action, the active context switches deliberately rather than following navigation automatically.
- AE4. **Covers R7, R15.** Given no supported context has been established, when the authenticated shell renders, its Ask Athena control cannot open a contextless conversation; after Daily Operations establishes context, the control can reopen that conversation from another route.
- AE5. **Covers R8.** Given an established conversation in the current browser session, when the page reloads, the conversation and origin context are restored but the panel remains closed until the operator reopens it.
- AE6. **Covers R10, R11, R12.** Given a desktop viewport, the panel floats over the workspace with viewport insets and can be width-resized without moving the page; given a mobile viewport, the existing full-screen presentation is used.
- AE7. **Covers R14.** Given a public, login, restricted, or shell-bypassing surface, when it renders, neither the detached panel nor the authenticated-shell launcher is present.

---

## Success Criteria

- Operators can keep and resume one contextual Athena conversation while moving through authenticated operational work without losing local interaction state.
- Athena's store-day context changes only through an explicit contextual entry or new-thread action.
- The desktop panel reads as a calm parallel workspace rather than a page-level sheet, while mobile behavior remains familiar.
- Focused automated coverage proves shell persistence, context pinning, reload behavior, desktop detachment, and mobile continuity without requiring downstream product decisions.

---

## Scope Boundaries

- No new agent profiles, capabilities, context adapters, or answer behaviors.
- No automatic context switching based on route navigation.
- No draggable desktop panel or general-purpose window-management system.
- No redesign of the mobile full-screen experience.
- No automatic reopening after reload or browser restart.
- No panel on public, login, restricted, or shell-bypassing surfaces.

---

## Key Decisions

- Preserve origin context across navigation: conversational continuity is more important than automatically following the currently visible route.
- Use explicit contextual entry to switch context: the operator remains in control of what Athena can see and answer about.
- Use a detached desktop panel without a scrim: the conversation is parallel work, not a blocking task.
- Keep width resize but omit dragging: resizing supports reading needs without adding window-management complexity.
- Restore closed after reload: continuity is preserved without unexpectedly obscuring the current surface.

---

## Dependencies / Assumptions

- The existing Daily Operations agent presentation remains the only supported contextual entry in this slice.
- Existing conversation handles can be restored from browser-session storage without changing backend contracts.
- The authenticated app shell remains mounted across normal authenticated route transitions.
