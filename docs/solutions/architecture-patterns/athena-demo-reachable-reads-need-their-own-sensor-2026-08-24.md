---
title: Demo-Reachable Reads Need Their Own Sensor
date: 2026-08-24
category: architecture-patterns
module: athena-webapp
problem_type: logic_error
component: sharedDemo
resolution_type: policy_correction
severity: high
applies_when:
  - "Moving a Convex read onto the operation-admission read rails"
  - "A shared-demo surface renders the router error boundary instead of the store"
  - "Deciding whether a read definition should set actors.sharedDemo to admit"
tags:
  - shared-demo
  - operation-admission
  - read-intents
  - regression-sensor
  - default-deny
delivery_diff_fingerprint: 305b5f3afd5ac2d247f183f84987eeaf7d2cf7f787f2b2eaf61933c010218a9e
---

# Demo-Reachable Reads Need Their Own Sensor

## Problem

After the backend operation-admission migration (V26-1226..1239), an in-app
sweep of the shared demo found eight demo-reachable surfaces throwing
`shared_demo_action_denied` on load and rendering the router's error boundary
instead of the store: `/pos` (the destination of every "Make a sale" entry
point in the demo), `/pos/settings`, `/pos/expense-reports`, `/reviews/new`,
and all four `/services/*` views. The sidebar's Reviews badge threw on *every*
demo page.

Demo read admission takes TWO keys, checked in
`sharedDemo/readOperationAdapter.ts`:

1. the read definition's `actors.sharedDemo === "admit"`, and
2. the definition's intent being in `SHARED_DEMO_ALLOWED_READ_INTENTS`.

Two keys is a good containment property — it is why granting an intent does not
silently admit every read that happens to carry it. It is also what made the
breakage quiet. Units U3, U5 and U7 moved these reads onto the rails taking the
`sharedDemo: "deny"` default, which is the right default and the wrong answer
for a read the demo's own navigation walks into. Every one of them was an
unwrapped `query` before the migration, so the demo had always answered it.

The reason this shipped is the part worth keeping. Two sensors already guard
demo read policy, and **both stayed green**:

- `readIntentGrants.test.ts` asserts seed ⊇ derived — no demo-admitted read
  may carry an ungranted intent.
- `coverage.test.ts` asserts the grants agree in both directions — no granted
  intent without a representative, no represented intent without a grant.

Both describe the grants that EXIST. Neither can see a demo surface *losing*
its read, because a surface going dark leaves both statements true. The
missing sensor was the one nobody writes: not "are the grants coherent?" but
"can a demo visitor still reach what the demo links to?"

## Solution

Two coordinated edits, because admission needs both keys.

**Grant the four intents** in `sharedDemo/policy.ts` —
`expenses.view`, `service_ops.view`, `store.configuration.view`,
`storefront.reviews.view` — each with the surface that justifies it recorded
inline, matching how the existing entries carry their evidence.

**Admit ten read definitions**, including the reads reached one click deeper,
so that a repaired surface does not break on its next interaction:

| Intent | Definitions admitted | Demo surface |
| --- | --- | --- |
| `store.configuration.view` | `getStoreScheduleSummary` | `/pos`, `/pos/settings` |
| `expenses.view` | `getExpenseTransactions`, `getExpenseTransactionById` | `/pos/expense-reports` + detail |
| `service_ops.view` | `listAppointments`, `listServiceCatalogItems`, `listActiveServiceCases`, `getServiceCaseDetails`, `listAssignableStaff`, `searchCustomers` | all four `/services/*` views |
| `storefront.reviews.view` | `getAllReviewsForStore` | `/reviews/new`, `/reviews/published` |

Demo read reach moves 157 → 167 definitions — exactly the surfaces that
regressed. Their siblings stay denied and that is the point: the schedule
*admin* reads behind `/configuration`, the expense *session* reads, and the
customer-facing review reads are all still `deny`, because no demo surface
renders them. Granting an intent widens nothing on its own.

The sidebar's pending-review count is handled the other way, and the contrast
is the useful part. `app-sidebar.tsx` passes `"skip"` to `useQuery` for it when
`isSharedDemo`, so the demo never issues that read at all — and because nothing
reaches it, its definition stays `deny`. A badge counting a moderation backlog
is not something a shared demo needs to show; the surface behind it is.

So the two mechanisms answer different questions, and picking between them is
the judgement call:

- **Admit the read** when the demo genuinely renders the surface. The ten
  above are all of that kind.
- **Skip the query client-side, and leave the read denied** when the demo does
  not need what it returns. Silencing the call is only correct if you also
  accept that the thing it feeds is absent from the demo for good.

What is NOT correct is doing both to the same read: an admitted grant that no
caller reaches is reach nobody reviewed, and it makes the reachability sensor
below assert something the product does not do.

## Prevention

`convex/sharedDemo/demoSurfaceReads.test.ts` names the reads the demo reaches
by clicking — each demo sidebar/hub surface beside the reads its view issues —
and asserts both admission keys for every one. Re-denying any of them fails
there rather than in the demo.

The list is deliberately hand-maintained. Deriving it would mean walking the
React tree for `useQuery` calls, and that derivation would go stale in exactly
the silence the sensor exists to break. **Adding a surface to the demo sidebar
means adding its reads here.**

The general lesson: a default-deny policy with a closed grant set needs a
sensor pointed at *reachability*, not only at internal coherence. Coherence
sensors answer "do the grants agree with each other?" and stay green while the
product goes dark. Ask separately: what does the product's own navigation walk
into, and is it still admitted?

The breakage was found by an in-app sweep of the demo, not by a test — see the
landed-change report for the surface-by-surface results. The same sweep drove
the write paths (POS sale + sync, void with manager approval, cycle count,
opening-float correction, order fulfilment, customer messaging) and confirmed
the migration left all of them intact; the damage was confined to reads. The
sweep was re-run with the fix deployed: 42/42 routes clean, all eight surfaces
rendering, nothing that previously worked regressed.

The sweep could not have found the other half of this migration's damage — see
[[architecture-patterns/athena-recovery-must-not-require-what-it-restores-2026-08-24]].
That one only reproduces on a session that has passed its admission window, and
a sweep always runs on a fresh one.
