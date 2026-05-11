---
title: Athena Webapp Data Loading Placeholders Should Render Null
date: 2026-05-10
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: frontend
symptoms:
  - "Workspaces showed skeleton cards or Loading labels while protected data queries resolved"
  - "Loading placeholders created a different visual contract from Store Ops and Services workspaces"
  - "Tests asserted placeholder copy instead of the settled workspace state"
root_cause: loading_state_contract_drift
resolution_type: code_fix
severity: low
tags:
  - frontend
  - loading-state
  - workspaces
  - design-system
---

# Athena Webapp Data Loading Placeholders Should Render Null

## Problem

Athena workspace pages should not show skeleton layouts or "Loading ..." labels for query readiness states. Store Ops and Services already treat protected-access and data-query readiness as an empty intermediate state, but older surfaces still rendered placeholder cards, table rows, or status labels.

That created two problems:

- Operators saw transient UI that did not match the final workspace.
- Tests locked in placeholder copy and skeleton geometry instead of the real loaded, empty, denied, or signed-out states.

## Solution

For read-side loading states in Athena webapp components, return `null` until the data needed to render the real surface is available.

```tsx
if (isLoadingAccess || queryResult === undefined) {
  return null;
}
```

For composed workspace shells that accept a loading slot, pass `null` instead of a skeleton component:

```tsx
<OperationReviewWorkspace
  isLoading={snapshot === undefined}
  loadingContent={null}
  main={snapshot ? <ReadyWorkspace snapshot={snapshot} /> : null}
/>
```

Keep action-level loading affordances, such as disabled submit buttons or mutation spinners, when they communicate that the operator already initiated an action. This note covers data readiness placeholders, not command progress feedback.

## Prevention

- Do not introduce new `Skeleton` imports for Athena webapp read-side query loading.
- Avoid visible "Loading ..." copy for workspace/query readiness. Prefer `return null`.
- Tests should assert the absence of placeholder copy and then assert the loaded, denied, empty, or signed-out state separately.
- If a page needs a loading affordance for accessibility or command progress, keep it scoped to the specific user action instead of the whole workspace.
