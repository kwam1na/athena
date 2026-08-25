---
title: Shell-owned contextual agent panels preserve route continuity
date: 2026-08-24
category: architecture-patterns
module: Athena agent host
problem_type: architecture_pattern
component: assistant
resolution_type: code_fix
severity: medium
applies_when:
  - "A contextual assistant must remain available while authenticated route content changes"
  - "The assistant context must stay pinned until the operator explicitly switches it"
tags:
  - agent-panel
  - authenticated-shell
  - context-pinning
  - session-continuity
delivery_diff_fingerprint: d884c9c24699367fae7af8d5dc41881fcbfe847a2072add0d6182af7c612fca5
---

# Shell-owned contextual agent panels preserve route continuity

## Problem

A contextual assistant mounted inside a route disappears when that route unmounts. The conversation may survive on the backend, but local interaction state such as open state, draft text, width, scroll position, and focus return is lost or becomes coupled to navigation. Automatically rebuilding context from the next route is also unsafe because visible navigation is not the same as explicit authorization to change what the assistant is answering about.

## Solution

Separate contextual entry from panel ownership:

- Mount one generic panel provider at the normal authenticated-shell composition root.
- Let a feature surface register a presentation adapter plus a serializable context snapshot without mutating the pinned conversation merely because the route rendered.
- Make the shell-owned floating launcher the explicit activation gesture. It activates the currently registered surface when one exists, or reopens the pinned target elsewhere in the app.
- Keep the active target, draft, width, scroll position, and open state in the shell provider so route content can unmount without taking the conversation with it.
- Treat a contextual entry click or New thread as the only way to switch the active target. Route navigation alone leaves the origin context pinned.
- Register supported presentation adapters at the composition root. Persist only the adapter identity and bounded context snapshot, then resolve the adapter from that registry on reload.
- Validate browser-session data before restoring it. A stored profile must exist in the registry, ids must be strings, and context and route parameters must be string records.
- Restore the conversation target after reload but initialize the panel as closed, avoiding an unexpected overlay.
- Keep shell-bypassing surfaces outside the provider boundary and preserve the existing full-screen mobile adaptation.

The panel component remains profile-neutral. Feature knowledge lives in presentation adapters, while the authenticated shell is the only layer that knows which adapters are available globally.

## Why This Matters

Shell ownership makes the assistant behave like a durable workspace without making it follow navigation implicitly. The operator can move through the app and reopen the same conversation, while Athena continues to answer against the context the operator deliberately established. Composition-root registration also preserves dependency direction: the reusable host does not import Daily Operations or branch on profile ids.

For desktop, a detached fixed panel anchored to the floating launcher's bottom-right origin, sized to 60% of the dynamic viewport height, with full border, depth, and no scrim communicates parallel work without reflowing or blocking the underlying route. The existing mobile dialog remains the appropriate constrained-screen behavior.

## Prevention

- Do not mount the production panel beneath route-owned content when continuity across routes is required.
- Do not infer an assistant context from the current URL merely because a global launcher was selected.
- Keep the global launcher unavailable until a supported surface is registered or a validated pinned target can be restored.
- Test route-content unmount, explicit context switch, reload-closed restoration, focus return, desktop detachment, and mobile full-screen continuity.
- Keep browser storage to reconnect handles and bounded context metadata; never persist prompt text or model-authored content as a convenience copy.

## Examples

Route-owned shape:

```tsx
<DailyOperationsView>
  <AthenaAgentSurface />
</DailyOperationsView>
```

Shell-owned shape:

```tsx
<AthenaAgentShellProvider presentations={[dailyOperationsPresentation]}>
  <AuthenticatedAppShell />
</AthenaAgentShellProvider>
```

The Daily Operations surface registers its current store-day target through the provider. Selecting the floating launcher explicitly activates that target. Navigating to Reports replaces route content, not the provider, so the panel and its pinned target remain intact.

## Related

- `docs/brainstorms/2026-08-24-detached-athena-agent-panel-requirements.md`
- `packages/athena-webapp/src/components/agent/AthenaAgentPanel.tsx`
- `packages/athena-webapp/src/routes/-authed-layout.tsx`
