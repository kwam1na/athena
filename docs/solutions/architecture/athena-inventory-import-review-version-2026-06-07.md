---
title: "Athena Inventory Import Review Versions"
date: 2026-06-07
category: architecture
module: athena-webapp
problem_type: legacy_inventory_import
component: operations
resolution_type: durable_review_boundary
severity: medium
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
- Save the current export as an `inventoryImportReviewVersion` record that
  stores raw content, parsed row data, file metadata, notes, counts, and actor
  context.
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
- Store raw export content with parsed rows so later reviewers can compare the
  normalized preview against the source file.
- Use Convex indexes by store and creation time for latest-review lookup.
- Preserve manager elevation terminal context when operations mutations require
  elevated access outside the POS terminal surface.
- Add focused tests for import parsing, review-version save/load, and elevated
  terminal propagation whenever the import workflow changes.
