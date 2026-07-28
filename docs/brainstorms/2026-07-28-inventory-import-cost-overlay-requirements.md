---
date: 2026-07-28
topic: inventory-import-cost-overlay
---

# Inventory Import Cost Overlay

## Summary

Inventory Import will provide a full-administrator Cost overlay mode that maps
one selected column from the currently loaded saved legacy review onto
onboarded Athena SKUs. Applying or undoing an overlay is an explicit, auditable,
resumable valuation operation built on the existing import-review workspace.

---

## Problem Frame

All legacy inventory rows have been onboarded into Athena, but their SKU costs
were not consistently established. Some source rows remain provisional and
others have crossed into trusted inventory. Operators still have the original
saved import evidence, but Athena does not let them choose the legacy column
that represents cost and safely carry those values into the anchored SKUs.

A cost correction is not ordinary catalog metadata. It changes current
inventory valuation and the cost basis used for future merchandise activity.
The workflow therefore needs explicit source selection, conflict-aware review,
durable progress, provenance, and a safe compensating undo.

---

## Actors

- A1. Full administrator: selects the cost source, reviews changes, applies an
  overlay, resolves exceptions, and may undo a completed or partially completed
  run.
- A2. Athena valuation system: validates current SKU state, records valuation
  corrections and provenance, advances resumable work, and rejects stale or
  unsafe rows without fabricating cost.

---

## Key Flows

- F1. Select and preview a cost source
  - **Trigger:** A1 opens Cost overlay from the currently loaded saved inventory
    review.
  - **Actors:** A1
  - **Steps:** Athena exposes the saved source columns with representative
    values and validity counts; A1 selects one column; Athena interprets its
    values in store-currency major units and previews each anchored SKU's
    legacy cost, current Athena cost, lifecycle state, and eligibility.
  - **Outcome:** A frozen overlay run is ready for review without changing SKU
    valuation.
  - **Covered by:** R1-R7

- F2. Review and apply selected costs
  - **Trigger:** A1 confirms the run-wide selection.
  - **Actors:** A1, A2
  - **Steps:** Missing costs are selected by default; A1 explicitly opts into
    any known-cost overwrites; A2 applies selected rows in bounded resumable
    batches, preserves provisional source evidence, and records row outcomes.
  - **Outcome:** Eligible SKUs use the selected cost for current valuation and
    future cost accounting while exceptions remain actionable.
  - **Covered by:** R8-R15

- F3. Undo an overlay run
  - **Trigger:** A1 chooses to undo a run with successfully applied rows.
  - **Actors:** A1, A2
  - **Steps:** Athena compares each SKU with the post-apply state recorded by
    the run; unchanged rows receive compensating corrections that restore their
    exact pre-run cost and valuation basis; rows changed later are skipped and
    reported.
  - **Outcome:** Safe rows are restored without deleting the original apply
    evidence, and unsafe rows remain visible for review.
  - **Covered by:** R16-R19

---

## Requirements

**Workspace and source mapping**

- R1. Cost overlay must be a dedicated mode inside Inventory Import and reuse
  its established source, matching, search, filter, pagination, decision,
  autosave, and dirty-work protection behavior.
- R2. Only full administrators may view legacy cost values, create an overlay
  run, apply it, retry it, or undo it.
- R3. Each run must use the currently loaded saved review version and freeze
  that exact version as its source.
- R4. A1 must select exactly one source column to serve as the run's legacy
  unit-cost source.
- R5. Source-column discovery must preserve original column identity and show
  enough representative values and validity counts for A1 to choose
  intentionally.
- R6. Selected values must be interpreted as store-currency major units and
  normalized to Athena's stored minor-unit integer representation. Explicit
  zero is valid and must remain distinct from missing cost.
- R7. Before apply, each source row must show its anchored Athena SKU, legacy
  cost, current Athena cost, provisional or trusted/finalized state, selection
  state, and any reason it cannot be applied.

**Selection and valuation apply**

- R8. Valid rows whose Athena cost is missing must be selected by default.
- R9. A differing known Athena cost must not be overwritten unless A1 makes an
  explicit row or filtered bulk overwrite decision.
- R10. Blank, negative, unparseable, or otherwise invalid source values must be
  skipped and reported per row without blocking valid rows; legitimate zero
  must remain eligible.
- R11. Confirmation must apply all selected rows across the run rather than
  only the visible page or current filter.
- R12. Applying a selected cost must revalue current on-hand inventory and
  establish the cost used for future valuation and cost of goods sold without
  rewriting historical sale-cost evidence.
- R13. Apply must not change physical stock, sellable availability, product or
  SKU identity, selling price, or the row's onboarding lifecycle.
- R14. Active provisional rows must update their anchored Athena SKU
  immediately and retain the selected cost as durable source evidence so later
  finalization preserves it.
- R15. Apply must run as bounded, resumable work. Stale, deficit-blocked, or
  otherwise unsafe rows must remain exceptions with precise outcomes while
  unaffected rows continue.

**Audit, replay, and undo**

- R16. Every run must preserve source version, selected column, normalized
  source evidence, operator decisions, pre-apply valuation state, progress,
  per-SKU outcomes, and actor context.
- R17. Replaying the same apply or undo work must be idempotent; conflicting
  reuse must fail safely instead of producing duplicate valuation evidence.
- R18. A1 must be able to undo a run at run scope. Undo must use new
  compensating valuation corrections that restore each safe SKU's exact
  pre-run cost and valuation basis without deleting original evidence.
- R19. Undo must skip and report SKUs whose cost or valuation changed after the
  overlay, continue restoring unaffected rows, remain resumable, and prevent a
  completed row from being undone twice.

---

## Acceptance Examples

- AE1. **Covers R3-R7.** Given a loaded saved review containing a custom
  `wholesale landed` column, when a full administrator selects it, Athena
  previews its values as store-currency costs against the anchored provisional
  and finalized SKUs without applying changes.
- AE2. **Covers R6, R8-R10.** Given one missing Athena cost, one differing known
  cost, one blank source cell, one zero source value, and one negative value,
  when the column is selected, the missing and zero-cost rows are preselected,
  the known-cost row requires explicit overwrite, and the blank and negative
  rows are skipped with distinct reasons.
- AE3. **Covers R11-R15.** Given selected eligible rows span many pages and one
  row becomes stale, when A1 confirms apply, Athena processes bounded batches,
  applies unaffected rows across the run, preserves provisional source cost,
  and leaves the stale row as an actionable exception.
- AE4. **Covers R12-R13.** Given an SKU has current on-hand inventory, when its
  overlay cost is applied, Athena updates current valuation and future cost
  basis while preserving stock, availability, price, identity, and historical
  sale-cost snapshots.
- AE5. **Covers R16-R19.** Given a run applied three SKUs and one SKU was
  revalued afterward, when A1 undoes the run, Athena restores the other two
  through compensating corrections, preserves all apply evidence, and reports
  the changed SKU as stale.
- AE6. **Covers R2.** Given an elevated manager without full-administrator
  access, when they enter Inventory Import, legacy cost values and cost-overlay
  actions are unavailable.

---

## Success Criteria

- Full administrators can establish trustworthy cost coverage for onboarded
  legacy SKUs without repeating onboarding or editing products individually.
- Current inventory valuation and future cost accounting reflect selected
  legacy evidence while historical facts remain unchanged.
- Large runs survive refreshes, retries, partial exceptions, and safe undo
  without duplicate or missing audit evidence.
- Planning and implementation do not need to invent source, access, overwrite,
  provisional, batching, valuation, or undo semantics.

---

## Scope Boundaries

- Historical sale-cost or profit backfills are excluded.
- Cost is not stored as unaudited reference metadata.
- Legacy onboarding is not reopened or repeated.
- Arbitrary mapping for fields other than cost is excluded.
- Stock counts, sellable availability, selling price, and catalog identity are
  not changed by apply or undo.
- Manager elevation does not grant cost-overlay access.
- Per-row undo controls are excluded; undo operates at run scope.
- A standalone cost-management workspace is excluded.

---

## Key Decisions

- Dedicated mode within Inventory Import: keeps post-onboarding valuation work
  distinct while preserving familiar review behavior.
- Prospective valuation correction: selected cost governs current inventory and
  future cost accounting without rewriting historical sales.
- Apply provisional costs now: the anchored SKU and provisional evidence stay
  aligned before finalization.
- Missing-first selection: cost coverage improves safely while known-cost
  overwrites remain deliberate.
- Continue through exceptions: large runs make progress without hiding stale or
  unsafe rows.
- Compensating undo: valuation history remains append-only and auditable.

---

## Dependencies / Assumptions

- The loaded saved review contains the complete legacy source needed for the
  overlay.
- Onboarded provisional and finalized lineage retains a trustworthy anchor from
  each source row to an Athena SKU.
- Each selected source value is denominated in the store's currency.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5-R7][Technical] Define the durable source-column projection and
  exact-version hydration boundary without duplicating the existing import
  parser.
- [Affects R11, R15-R19][Technical] Define the run, batch, cursor, stale-state,
  and compensating-undo model on Athena's existing valuation rails.
- [Affects R14][Technical] Define how applied provisional source cost remains
  authoritative across later product-page and batch finalization paths.
