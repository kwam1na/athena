---
title: Athena POS Register Search Uses A Local Catalog Index
date: 2026-05-04
category: logic-errors
module: athena-webapp
problem_type: latency_hot_path
component: pos-register-search
symptoms:
  - "Barcode scans waited on debounce and server lookup timing before adding an item"
  - "Active register product entry ran generic, barcode, and product-id searches as competing query paths"
  - "No-result and quick-add prompts depended on delayed server-search completion"
  - "Short prefix input such as dura returned no local catalog results for Durable Lace Front"
root_cause: per_input_server_search_on_register_hot_path
resolution_type: refactor_plus_local_fuzzy_matching
severity: medium
tags:
  - pos
  - register
  - catalog
  - barcode
  - quick-add
  - fuzzy-search
---

# Athena POS Register Search Uses A Local Catalog Index

## Problem

The active POS register is a hot path. Treating every product entry as a fresh
server search makes barcode scans, SKU entry, and product URL lookup feel slower
than the operator workflow allows. It also creates competing UI state: generic
text search, barcode lookup, product-id lookup, no-results, and quick-add timing
all try to describe the same input.

## Solution

Load one compact, store-scoped register catalog snapshot and build a browser-local
index for the active register. Resolve exact identifiers before text ranking:

- Barcode
- SKU
- Product SKU id
- Product id or product URL

The local index may decide whether a row is an exact, available, single match,
but it must not become the durable inventory authority. Adding still goes
through the POS add-item command so drawer, staff, session, inventory, and trace
invariants stay at the command boundary.

Local text ranking should be forgiving without turning into a broad semantic
search. Keep exact identifier resolution first, then rank text tokens with a
prefix-friendly fuzzy pass:

- Ignore fuzzy matching for query tokens shorter than three characters.
- Score direct token containment ahead of edit-distance matches so `dura`
  finds `durable` predictably.
- Use a cheap first-character or first-two-character overlap guard before
  computing edit distance.
- Use normalized Levenshtein similarity for typo tolerance, with stronger
  scores for close matches and weaker scores for borderline matches.

This keeps the register hot path local and deterministic while covering common
operator input: prefixes, partial product names, and small typos.

## Quick Add

Quick-add and no-results prompts should follow local catalog readiness, not a
server-search debounce. A no-result prompt is valid only after the snapshot has
loaded and the local search has no matches. Quick-add creation remains a backend
command, and the next snapshot refresh should make the new SKU searchable.

## Follow-up: Availability Split

The local index should be built from stable metadata only. Do not include
`quantityAvailable` or `inStock` in the full-store register catalog snapshot,
because POS cart operations mutate availability and can invalidate the whole
store catalog subscription. Fetch availability only for the bounded set of rows
currently being displayed or exact-matched, and still let the add-item command be
the final inventory authority.

## Prevention

- Do not start generic per-keystroke POS product search from active register
  product entry.
- Keep legacy search hooks available for non-register surfaces until those
  surfaces receive their own migration.
- Preserve out-of-stock exact matches in the local result list so the operator
  can see why the item was not auto-added.
- Add tests for exact single-match auto-add, out-of-stock exact results, and
  product-id variant ambiguity whenever register search changes.
- Add tests for prefix and typo matching whenever local text ranking changes.
- Add tests that prove catalog metadata rows exclude volatile availability and
  availability is overlaid from a bounded query.

## Related Issues

- Linear: V26-463, V26-464, V26-465, V26-466, V26-467, V26-468, V26-470.
