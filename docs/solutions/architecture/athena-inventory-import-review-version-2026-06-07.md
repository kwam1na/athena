---
title: "Athena Inventory Import Review Versions"
date: 2026-06-07
last_updated: 2026-07-28
category: architecture
module: athena-webapp
problem_type: legacy_inventory_import
component: operations
resolution_type: durable_review_boundary
severity: medium
delivery_diff_fingerprint: 2e15fc949f8863d06a1d25f163848f3b71b7993ddb5902eb2f2b7cff61969118
tags:
  - inventory
  - imports
  - operations
  - review
---

# Athena Inventory Import Review Versions

## Problem

Legacy inventory exports do not always match Athena's internal product and SKU
shape. Strict browser validation can reject usable rows because a legacy file
uses alternate headers, sparse identifiers, numeric category references, or
fields that only become meaningful after server-side mapping.

The import review also cannot live only in device memory. Operators need a
server copy of the parsed export before an impactful import workflow applies
catalog or stock changes.

## Solution

Split import review from import execution:

- Parse legacy CSV and JSON exports leniently in the operations UI.
- Map common legacy aliases into Athena's preview fields, but keep unmapped raw
  values available in the saved review payload.
- Let operators inspect all parsed rows with shared pagination and hide noisy
  preview columns, with legacy SKU and category hidden by default.
- Move inventory comparison into a dedicated review route so the source import
  screen stays focused on file loading and review-version persistence.
- Preserve review filter and page state in the URL. Operators often leave review
  rows to inspect an Athena product, then return to the same slice of work.
- Match imported rows against Athena by strongest available evidence first:
  barcode and SKU when present, exact normalized product names across duplicate
  SKU rows, then close-name matches only when the best candidate is clear.
- Treat close-name matches and exact identifier matches with different names as
  review rows, not automatic matches. The operator still needs to decide whether
  Athena or the import file owns the product name.
- Let each review row capture separate source choices for product name, quantity,
  and price. A row is ready for handoff only after every differing field has a
  source decision, or the row is explicitly skipped.
- Save file metadata, notes, counts, and actor context on the
  `inventoryImportReviewVersion` record. Store raw content and row decisions in
  bounded `inventoryImportReviewVersionPayloadChunk` child records so realistic
  review payloads cannot cross Convex's 1 MiB document limit.
- Stage payload child records through resumable public mutations capped below
  256 KiB per call, then finalize the version from at most 8 MiB of aggregate
  payload. This leaves transaction headroom for document/query overhead and
  keeps the original browser save path off oversized Convex arguments.
- Load the latest saved review version for the store so review state survives a
  device refresh or handoff.
- Keep the destructive import mutation available only for a future dedicated
  workflow. The review view should save server-backed evidence, not apply stock
  or catalog changes.

Manager elevation should carry the terminal id returned by the elevation
response. Server mutations that require manager context can then authorize with
the elevated terminal even when the current POS terminal context is not mounted
on the operations route.

## Boundaries

Do not treat preview validation as the source of truth for import eligibility.
The browser should help operators review the file, while server workflows own
final mapping, authorization, and write decisions.

Do not add a one-click destructive import action to the review screen. Importing
inventory can create products, update SKUs, and change stock state, so it needs
a dedicated workflow with explicit review and confirmation steps.

## Prevention

- Keep legacy import parsing tolerant of alternate headers and missing optional
  fields.
- Preserve raw export content with parsed rows so later reviewers can compare
  the normalized preview against the source file, but chunk both payloads into
  bounded child documents instead of embedding unbounded data on the review
  version.
- Store row-level draft decisions with separate name, quantity, price, and action
  fields. Do not flatten those decisions into notes only; notes are audit copy,
  while structured fields are what later import execution should consume.
- Use Convex indexes by store and creation time for latest-review lookup.
- Preserve manager elevation terminal context when operations mutations require
  elevated access outside the POS terminal surface.
- Add focused tests for import parsing, product matching, review URL state,
  review-version save/load, row source decisions, and elevated terminal
  propagation whenever the import workflow changes.
