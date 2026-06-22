---
title: Athena Storefront Readouts Compile From Context Events
date: 2026-06-22
category: architecture
module: athena-webapp
problem_type: storefront_readout_source_boundary
component: intelligence
resolution_type: context_event_only_compiler
severity: medium
tags:
  - intelligence
  - context
  - storefront
  - readouts
  - analytics
---

# Athena Storefront Readouts Compile From Context Events

## Problem

Store and customer readouts originally compiled storefront context from legacy
analytics rows. That kept active intelligence prompts tied to browser-era event
shapes and made historical migration too easy to treat as a live fallback path.

## Solution

Active storefront readout compilers should query `contextEvent` only. They
should use the store/surface/status/occurred-at index, compile registered
storefront event rows into compact prompt snapshots, and emit `contextEvent`
source refs into snapshots and artifacts. Legacy analytics can contribute only
after a bounded import writes safe, registered evidence into `contextEvent`
rows with lineage.

Compiler gates matter:

- exclude rejected, synthetic, non-compilable, and quarantined import evidence
- validate event id/schema version against the registry before prompt capture
- allow only registered scalar payload keys
- strip unsafe browser-controlled fields before snapshots or debug payloads
- count omitted and hidden evidence so limited context stays visible
- preserve historical quality flags without exposing analytics refs as active
  readout evidence

Readout debug payloads should expose trust metadata, not raw evidence. Include
source counts, data windows, freshness, snapshot hash, provider status, quality
flags, omitted/hidden counts, and limited-evidence state. Keep raw prompts,
raw event payloads, URLs, user-agent strings, contact/payment/auth/proof/PIN
fields, provider secrets, and raw backend errors out of browser payloads.

## Regression Targets

- `convex/contextTracking/contextBundles.test.ts` proves context-event source
  refs, historical-import lineage through context events, synthetic/quarantine
  exclusion, payload sanitization, no-context partial bundles, and a guard
  against active analytics reads.
- `convex/intelligence/capabilities/insights.test.ts` proves prompt snapshots
  use compact context-event rows and preserve untrusted-context instructions.
- `convex/intelligence/runs.test.ts` proves latest-run debug payloads expose
  metadata without raw payload details.
- Store and customer readout UI tests prove debug copy shows context quality and
  limited-evidence state without old analytics wording.

## Prevention

When adding storefront telemetry for intelligence, start in the storefront
context-event catalog and `/tracking-events` boundary. Do not add a direct
analytics read, mixed-source dedupe, or fallback in readout compilers. If
historic analytics is valuable, import safe rows into `contextEvent` first and
verify the compiler still reports `contextEvent` source refs only.
