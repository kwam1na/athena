---
title: Athena Shared Demo Polish Needs One Story Contract Across Seed Data, Policy, and UI
date: 2026-07-22
category: workflow-issues
module: athena-webapp
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - Polishing the shared demo experience across Convex seed data and React operator surfaces
  - Expanding demo permissions while keeping external provider effects simulated
  - Updating seeded story state that must survive restore and browser-local POS flows
tags: [shared-demo, convex, seeded-data, policy, operator-ui]
delivery_diff_fingerprint: 0136f8cb858e110b72299f53986cd64a36b4240b573250f73bb51407137c1eb1
---

# Athena Shared Demo Polish Needs One Story Contract Across Seed Data, Policy, and UI

## Problem

Small demo-polish requests become risky when they are treated as isolated UI tweaks. The shared demo is a real synthetic Athena tenant: seed data, effect policy, restore behavior, local POS state, and operator UI copy all have to tell the same story or the demo drifts into contradictions.

## Solution

Treat the shared demo as a cross-layer story contract:

- Put narrative facts in seed/story fixtures, not in one-off component fallbacks. Customer names, phone numbers, online-order timing, already-sent emails, expense transactions, terminal heartbeat behavior, and restore baselines should be initialized where the demo store is provisioned or restored.
- Route exits consistently. Explicit demo exit buttons and demo sign-out behavior should return to the landing route so visitors do not fall into the normal login flow.
- Keep policy broad but explicit. When the demo should allow an operational workspace action, add a named capability and public-function inventory coverage. If an external provider effect would normally occur, decide it centrally as simulated rather than letting UI affordances imply a live call.
- Preserve product behavior outside the demo unless the request says otherwise. For example, disabling partial refunds on single-item orders belongs in the shared refund UI logic because it is true for every experience, not just the demo.
- Validate with focused tests near the touched seams, then let the repo delivery sensors require durable docs/report artifacts for large cross-layer batches.

## Why This Matters

The demo works because it is close to production behavior while being safe to explore. If policy allows an action but the seed story says the opposite, the visitor loses trust. If UI hides a button but the public mutation still performs the effect, the system is unsafe. If a provider effect is live instead of simulated, the demo can leak outside the synthetic tenant.

One contract also makes future requests faster. A future agent can look for story facts in `sharedDemoStory`, provision/restore code, and the shared demo policy catalog before patching a visible component.

## Prevention

- Before changing demo copy or affordances, find the canonical source of the visible fact: story fixture, provision seed, restore reset, policy decision, or shared UI utility.
- When enabling demo actions, update both the capability allowlist and coverage inventory so admission stays auditable.
- When a demo action represents an email, payment, refund, export, integration, or other external side effect, add or preserve an explicit simulated decision and test it.
- Keep cross-experience business rules in shared components/utilities, with tests proving both demo and normal paths see the same disabled/enabled state.
- After code changes, rebuild Graphify and run the focused tests for the surfaces touched before handing browser validation back to the requester.

## Examples

- The seeded online order should carry its own realistic customer, phone number, story-day timestamp, and already-sent order-received email state instead of relying on page-level placeholder text.
- The refund option logic should disable partial refund for a one-item order everywhere, while the demo policy should separately decide whether a refund effect is simulated.
- Expense restore should reset the right transaction state while preserving completed-transaction item counts in the POS completion view.

## Related

- [Athena Cross-Layer Delivery Needs Bounded Reads and Contract Proof](./athena-cross-layer-delivery-contracts-2026-07-18.md)
- [Athena Landing Story Day, Dark Mode, and Cash Policy Need Shared Time Contracts](./athena-landing-story-day-dark-mode-and-cash-policy-2026-07-20.md)
