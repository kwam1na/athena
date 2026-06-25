---
title: Athena Context Events And Search URL State Stay Retry Safe
date: 2026-06-25
category: logic-errors
module: athena-webapp
problem_type: context_event_idempotency_and_url_pagination_drift
component: context-events-products-workspace
symptoms:
  - "Adding storefront device context could turn duplicate tracking retries into idempotency conflicts"
  - "Deep-linked product search pages could render empty results when page exceeded the loaded result count"
  - "URL page normalization could run before async SKU search results loaded"
root_cause: mutable_context_fields_and_loading_state_were_mixed_into_durable_identity
resolution_type: idempotency_hash_boundary_and_loaded_state_pagination_clamp
severity: medium
tags:
  - context-events
  - idempotency
  - products
  - url-state
  - pagination
  - storefront
---

# Athena Context Events And Search URL State Stay Retry Safe

## Problem

Two durable identity boundaries can drift when UI context is added after the
original event or URL was created:

- Storefront context events need coarse device and environment metadata for
  intelligence, but the same idempotency key can be retried after viewport,
  user-agent classification, or deployment behavior changes.
- Product search pages restore from URL state, but the current result count is
  async. A deep link can request a page before SKU search results have loaded.

If these runtime details participate directly in duplicate detection or route
normalization, Athena can create false conflicts or erase useful navigation
state before the data boundary has settled.

## Solution

Keep contextual metadata as evidence, not identity:

- Persist coarse context-event `environment` fields for prompt compilation and
  device distribution.
- Exclude `environment` from the semantic idempotency envelope hash. Payload,
  event id, store, surface, schema, and idempotency key remain identity; runtime
  device context does not.
- Test both environment-to-environment stability and compatibility between
  no-environment hashes and environment-bearing retries.

For URL-backed search pagination:

- Parse and clamp the requested page for display.
- Normalize out-of-range pages back into the URL only after the async search
  query has resolved.
- Preserve the URL page while search results are loading so a valid deep link
  does not collapse to page 1.

## Prevention

- Before adding new fields to an idempotent event append command, decide whether
  they are identity, payload evidence, or runtime context. Only identity fields
  belong in the semantic envelope hash.
- Add regression tests that compare old minimal hashes to new enriched event
  shapes when adding optional context fields.
- For URL-backed pagination over async data, test both the loaded out-of-range
  case and the loading state. The former should normalize; the latter should
  preserve the URL until data arrives.
