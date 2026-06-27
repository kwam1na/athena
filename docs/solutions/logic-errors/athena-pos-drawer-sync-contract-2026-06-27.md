---
title: Athena POS Drawer Sync Contract
date: 2026-06-27
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos-register-sync
symptoms:
  - "POS could loop the open-drawer gate after the cloud drawer was active"
  - "Replacement drawers could be blocked by a prior closeout variance review"
  - "Cash Controls and POS could disagree about local versus cloud register identity"
root_cause: drawer_lifecycle_rules_were_split_across_local_readiness_cloud_projection_and_repair_paths
resolution_type: code_fix
severity: high
tags:
  - pos
  - register-session
  - local-sync
  - cash-controls
  - drawer-authority
---

# Athena POS Drawer Sync Contract

## Problem

The drawer lifecycle contract was spread across local readiness, local read
models, cloud projection, repair preview, and Cash Controls. Each boundary used
slightly different evidence for the same decision: whether a drawer can sell,
whether a prior drawer can be superseded, and whether a conflicted local open is
safe to repair.

That split allowed regressions where a replacement drawer opened locally but did
not become a usable cloud drawer. POS could keep showing the open-drawer gate or
label the drawer by a local id while Cash Controls had no matching cloud drawer.

## Solution

Keep drawer lifecycle decisions behind a shared policy and pass explicit facts
into it:

- Sale-blocking drawer authority must match the active drawer identity. Authority
  for a superseded local or cloud drawer is review evidence, not a sale blocker.
- Replacement opens must prove same store and terminal scope, a distinct drawer
  identity, and freshness against the closeout or review boundary. Unknown
  freshness fails closed unless the caller opts into a legacy compatibility path.
- Direct local ids that are already valid cloud register-session ids may only be
  reused when they are the same sale-usable drawer and have no open closeout
  review.
- Repair-created mappings need a source-event marker so projection can avoid
  mistaking repair idempotency for a conflicting client replay.
- Clearing drawer-authority state should delete the exact local drawer state
  being settled while read paths may still resolve local and cloud aliases.

## Prevention

- Add shared-policy tests before changing drawer lifecycle behavior.
- Cover local read model, readiness, cloud projection, repair preview, and repair
  mutation with the same local/cloud identity cases.
- Fixture closeout variance conflicts with `closeoutOccurredAt` when testing a
  replacement open after review; otherwise the repair path falls back to conflict
  creation time and correctly treats unknown ordering as unsafe.
- Keep Cash Controls labels honest: show cloud register targets where they exist
  and local ids only as local-session diagnostics.
- When source-event provenance is added to sync mappings, preserve compatibility
  for legacy rows that lack the field so existing repair mappings are not
  stranded.
