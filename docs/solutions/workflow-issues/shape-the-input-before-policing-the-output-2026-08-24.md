---
title: Shape the Input Before Policing the Output — Mechanical Tone Enforcement for Agent Prose
date: 2026-08-24
last_updated: 2026-08-24
category: docs/solutions/workflow-issues
module: Agent harness (agentHarness), product copy tone
problem_type: workflow_issue
component: agent_harness
resolution_type: architecture_improvement
severity: high
applies_when:
  - "A model's operator-facing output violates a product convention (vocabulary, formatting, units) and the first instinct is to add instructions"
  - "A harness serves the model internal data (field names, enum spellings, minor-unit amounts) and expects product wording back"
  - "An enforcement denial or retry loop is being considered to police model output"
  - "Money or unit-bearing values cross a model boundary without their display convention"
tags: [agent-harness, product-tone, disclosure, enforcement, lexicon, prompt-engineering]
delivery_diff_fingerprint: ddb040b10416fb55ad93b562991947bc1dbbae2d90e6c8ad9b834c8b8393380c
---

# Shape the Input Before Policing the Output — Mechanical Tone Enforcement for Agent Prose

## Problem

The Daily Operations agent's committed answers leaned technical: backend field
names in 34 of 40 answers (`lifecycleStage = close_blocked`), capability paths
in 24 (`reports.daySales`), read-mechanics jargon ("truncated by partition
ceiling"), and — worst — every money figure inflated 100×, because capability
results carried minor units (`{ amount: 1414900, currency: "GHS" }`) with no
unit disclosure and the model did the only reasonable thing.

The repo has an explicit tone guide (`docs/product-copy-tone.md`: calm, clear,
restrained, operational) and a runtime rewrite table for backend errors
(`operatorMessages.ts`) — but the agent's narrative, the one surface written
by a model, had no mechanical connection to either. The instruction budget in
the system prompt was entirely protocol (call the tool, cite verbatim refs)
and said nothing about the reader.

## Solution

A layered mechanism, measured phase by phase on a 20-question regression set.
The measurements ranked the layers unambiguously:

1. **Input shaping first (largest win, zero cost).** Annotate every
   money-shaped value at the result boundary with the product display string
   (`display: "GH₵14,149"`, computed by the app's own `currencyFormatter`);
   disclose field labels in the catalog (`grossRevenue (say: revenue)`) and
   enum wording (`close_blocked → close blocked`). The model parrots the
   vocabulary it is shown. Enforcement **without** this disclosure made prose
   measurably worse (jargon density 8.0 → 10.9 per 1k chars, 73 s p90 from
   retry tails): the model was punished without being shown the right words.
2. **Deterministic normalization at commit (the floor).**
   `normalizeNarrative` rewrites internal tokens in the committed narrative
   under two safety rules that keep prose grammatical and free text
   untouchable: *structure-preserving substitutions only* (humanize camelCase
   and snake_case in place — "lifecycle stage", never a free-form label like
   "where the day stands" that garbles mid-sentence grammar; amounts become
   their display value in the same numeric slot; namespaces become curated
   noun phrases) and *platform-known tokens only* (the run's own served
   evidence plus lexicon keys — free prose is never pattern-matched, so
   "iPhone" and "snake_oil" are untouchable by construction).
3. **A bounded sensor for what mechanics cannot fix (the backstop).**
   `senseTone` findings name the exact fix; enforce mode spends exactly one
   corrective denial and only fires for stubs once normalization handles
   vocabulary. Telemetry rides `turn_report.tone`.

Committed operator text went from 8.0 to 0.5 jargon tokens per 1k chars with
20/20 commits and the best latency of any phase (12.8 s median — the denial
retry tax disappeared when denials dropped 15/20 → 1/20).

## Prevention

- **When a model output violates a convention, ask first what the harness
  knew and did not disclose.** Every failure class here — money units,
  vocabulary, enum spellings, the "Sources:" footer duplicating the UI's own
  citation rendering — was the model being punished for information the
  platform had and withheld. Instructions are the weakest layer; measured
  twice on this branch (the discover-first habit and the sources footer both
  survived explicit instructions and died to mechanism).
- **Rewrite model prose only under the two safety rules.** Structure-preserving
  and platform-known. Anything looser garbles grammar or free text; anything
  tighter leaks. Unknown residue (workflow step ids) is telemetry, and each
  leftover becomes a one-line lexicon entry — the floor ratchets.
- **Isolate the enforcement's contribution before crediting it.** The
  labels+warn phase (7.8/1k, no denials) versus labels+enforce (5.5/1k)
  is what proved the denial earns ~30% on top of disclosure — and the
  enforce-without-labels phase is what proved policing alone is negative.
- **Measure committed text, not model-submitted text.** After kernel
  normalization the two differ by design; the operator-visible number is the
  one that matters (`view.answer.narrative`, not `tool_dispatch` args).
