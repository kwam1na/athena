---
title: Athena Storefront Analytics Compile Into Context Primitives
date: 2026-06-22
category: architecture
module: athena-webapp
problem_type: historic_storefront_analytics_context_migration
component: intelligence
resolution_type: compile_time_legacy_adapter_with_bounded_evidence
severity: medium
tags:
  - intelligence
  - context
  - storefront
  - analytics
  - security
---

# Athena Storefront Analytics Compile Into Context Primitives

## Problem

Historic storefront analytics rows predate context tracking, but storefront
user and store insight capabilities need that data. Reading raw analytics rows
directly from intelligence prompts couples AI context to legacy event shapes and
can leak browser-controlled URL, error, payment, or contact text into durable
snapshots.

## Solution

Keep the read path indexed on legacy `analytics` tables, then compile rows into
storefront context-primitive records before building insight bundles. The
adapter maps known legacy action families into registered storefront event ids,
preserves source refs to the original analytics rows, and reports omitted
evidence when rows cannot safely compile.

Payload fields must be field-specific and bounded:

- product/cart ids read top-level `productId`, `data.productId`, and legacy
  `data.product`
- route values keep only pathnames and strip query strings/fragments
- referrers reduce to safe `http` or `https` origins only
- checkout states and blockers use closed allowlists rather than arbitrary
  status-shaped text
- prompt snapshots cap payload keys and string length before persistence

## Boundaries

- This is a compile-time/read-time migration. It does not rewrite legacy
  analytics rows.
- Synthetic monitor rows remain excluded from business context by default.
- Dropped rows must be visible through `omittedEvidenceCount` and quality flags;
  bundles should not look complete when recent rows were skipped.
- Source refs should continue to point at `analytics` rows until durable
  `contextEvent` actor indexes exist for user-scoped bundle reads.

## Regression Targets

- Legacy cart/bag/saved action names compile before broad product matching.
- Legacy `data.product` and promo ids are preserved when safe.
- Contact, token, payment, and raw checkout error text are dropped before prompt
  snapshots.
- Store and user bundles assert source refs, data windows, hidden counts,
  omitted evidence, quality flags, and actor source refs.
- Prompt snapshots enforce payload budgets for worst-case legacy rows.

## Prevention

When adding new storefront analytics mappings, start with production action names
and payload keys, then add table-driven compiler tests plus a bundle-level test.
Do not add generic string passthroughs for browser-controlled fields; prefer a
closed enum, safe id/slug parser, or omission with an omitted-evidence count.
