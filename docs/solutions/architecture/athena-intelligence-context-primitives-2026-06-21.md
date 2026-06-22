---
title: Athena Intelligence Context Primitives Keep Surfaces Adapter-Owned
date: 2026-06-21
category: architecture
module: athena-webapp
problem_type: intelligence_context_tracking_boundary
component: intelligence
resolution_type: shared_primitives_surface_adapters_context_bundles
severity: medium
tags:
  - intelligence
  - context
  - tracking
  - storefront
  - convex
  - security
---

# Athena Intelligence Context Primitives Keep Surfaces Adapter-Owned

## Problem

Athena needs richer context for intelligence, but raw storefront analytics,
Athena webapp interactions, POS activity, and future surface signals have
different shapes and trust boundaries. Letting the intelligence layer read each
surface's raw event table directly couples recommendations to implementation
details, makes provenance inconsistent, and creates a tempting path for browser
events to become trusted business evidence.

## Solution

Define browser-safe context primitives once in
`packages/athena-webapp/shared/intelligence`, then let each surface define its
own event catalog and adapter on top. Convex owns durable append validation in
`convex/contextTracking`, and intelligence capabilities consume compiled
context bundles rather than raw surface rows.

The durable `contextEvent` table stores minimized envelopes with surface id,
event id, schema version, scoped actor/session/subject refs, compact payload,
idempotency hashes, retention class, visibility mode, status, and source refs.
Surface definitions own event ids, required/allowed payload keys, visibility,
retention, and primary subject mapping. Compilers turn events or legacy source
tables into bounded bundles with source refs, data windows, snapshot hashes,
freshness, redaction mode, omitted evidence counts, hidden source counts, and
limited-evidence markers.

## Boundaries

- Shared primitives are browser-safe. They cannot import Convex runtime code or
  domain tables.
- Surfaces own what they track. Storefront and Athena webapp adapters declare
  event catalogs; future POS/operations/inventory adapters should do the same.
- Convex append helpers are authoritative. Client-side builders are developer
  ergonomics only.
- Public HTTP tracking routes must derive trusted store, organization, actor,
  visibility, retention, and primary subjects server-side. They cannot persist
  client-supplied actor refs, source refs, visibility, retention, or durable
  subject refs without corroboration.
- Intelligence capabilities consume compiled bundles. Raw domain reads are
  allowed inside compilers only when the compiler owns authorization,
  redaction, evidence refs, and freshness semantics.
- Context snapshots copy bundle metadata into intelligence rows so later review
  can explain evidence quality without rereading raw events.

## Security Rules

- Do not use wildcard preview-origin allowlists for credentialed tracking
  writes. Exact owned storefront origins are required until a signed telemetry
  scheme exists.
- Treat customer-authored, store-authored, URL, route, search, campaign, and
  browser payload text as untrusted. It can inform context, but it cannot
  modify prompt instructions, bypass approvals, or widen visibility.
- Public payload validation must reject unexpected keys, nested objects, large
  strings, secrets, payment material, proof/PIN material, and broad free-form
  customer text.
- Synthetic monitor events are excluded from customer/business intelligence by
  default and should be explicitly included only by diagnostic compilers.

## Regression Targets

- Shared builder tests prove required keys, idempotency hashing, and source refs
  survive envelope construction.
- Event definition tests reject unknown payload keys, nested values, and missing
  required keys.
- HTTP route tests reject unowned origins such as arbitrary `vercel.app`
  previews.
- Public route tests prove actor kind distinguishes `user_id` from `guest_id`
  and primary subject refs are derived from event payload, not request body.
- Compiler tests prove guest/customer source refs point at the correct table and
  limited/partial evidence is carried into snapshots.
- Intelligence action tests prove capability prompts use compiled bundles and
  preserve untrusted-context warnings.

## Prevention

- Add new surfaces by defining a surface adapter and compiler, not by changing
  intelligence prompts to read raw domain tables.
- Keep event schemas versioned and additive. When an event shape changes, accept
  old versions in the compiler until all clients have moved forward.
- Keep context bundle size bounded. Add hidden/omitted counts rather than
  dumping unavailable or sensitive rows.
- When reviewers flag provenance spoofing, fix the server derivation boundary
  rather than adding more client-side validation.
