---
title: "Provisional Exposure Is Its Own Class: Delete-Only Rows, Reauthorizing Reads, and a Log Line as the Acceptance Sensor"
date: 2026-08-23
last_updated: 2026-08-23
category: harness
module: agentHarness
problem_type: architecture_pattern
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "Operators must watch text form before the system is willing to stand behind it"
  - "A release gate exists (one reauthorized transaction) and streaming must not become an early release"
  - "Unverified text must be readable only while a turn is live and admitted, and never retained"
  - "A behaviour can only be proven against a real provider, not a mock"
tags:
  - harness
  - streaming
  - provisional-narrative
  - retention
  - reauthorization
  - delete-only-table
  - driveturn-log
  - convex
delivery_diff_fingerprint: 84816520eb214cb7d172c253226c4bacf54d77fd2a3ffff107deffcb995b2091
---

# Provisional Exposure Is Its Own Class: Delete-Only Rows, Reauthorizing Reads, and a Log Line as the Acceptance Sensor

## Problem

The agent-harness foundation buffered the model's narrative server-side and streamed only server-authored milestones, so release stayed one reauthorized `completeRun` transaction and revocation landed before anything was fully recallable. The cost: a real provider turn showed nothing for ten to fifteen seconds and then the whole answer. Operators expect to watch an answer form.

Streaming the narrative the obvious way — persist deltas through the Convex Agent component and subscribe from the browser — would have turned streamed text into an early release: it would reach the durable record, the component's replay context, and possibly citations, with no per-read authority check and no deletion story. Three narrower questions had to be answered instead: where does in-flight text live so it is readable by exactly one authorized operator and by nobody after any terminal cause; how does a host stream into that place without contending with the commit transaction; and how is "the model now narrates before its first tool call" proven, given that the deployed smoke's single-tool prompt is exactly the configuration that suppresses narration?

## Solution

**Name the exposure class and give it one table with no state column.** The streamed text is the assistant *thinking out loud*, a different string from the `completeRun` narrative, so the UI says so and replaces it rather than morphing it. It lives in `agentProvisionalNarrative` — `retentionClass: "short_lived"`, indexed by binding, `expiresAt`, store and organization, no status field — with a leaf helper (`convex/agentHarness/provisionalNarrative.ts`) that carries its own 5-minute TTL literal so `lifecycle.ts`, `completionOutbox.ts`, `retention.ts` and `turns.ts` can all call the delete without closing an import cycle. Nothing derived from the text is retained: two irrevocable markers on the turn binding (`provisionalReleasedAt`, `provisionalViewedAt`) and a derived exposure fact (`describeTurnExposure`) are the whole audit trail.

**Enumerate every terminal cause and delete at each one, never inside the commit.** The lifecycle clamp deletes for every non-`completed` terminal status (cancel, failure, kill switch, fence repair), placed outside the binding-state guard and keyed on `run.turnBindingId`; `suppressReleaseWithCtx` deletes outside its `already` guard so a repeat suppression from the outbox cron still cleans a dead host's row; `finalizeTurnWithCtx` deletes above its `already_terminal` early return at the end of every driven turn (covering successful commit and commit-then-provider-failure, where the later `failed` transition does not re-clamp); scope removal deletes by store/organization index; the repair sweep gains a counted, logged expiry phase. The commit transaction itself is untouched, so a successful `completeRun` reads as `superseded`, never as a withdrawal.

**Make the write the enforcement point and the read a ladder.** The host coalesces deltas and flushes through one host-only internal mutation (a named ref in `AgentTurnHostRefs`, not public ingress) that reauthorizes the grant, enforces the profile's required `narrativePolicy`, compares the turn's write-once stamped egress class against the operator's current grant, caps text at the last whole codepoint under 16 KiB, refreshes `expiresAt` from the server clock, and deletes the row on any refusal. The single-flight chain drops an OCC-failed flush (the next carries the full draft), sets a stop flag and drains at the `completeRun` `tool_call_requested` so the commit is never contended, and resumes with a new draft on a non-success outcome. The `previewTurnNarrative` query delegates to the existing `reauthorizeTurnAccess`, then the epoch fence, then policy, then egress rank against the invocation row (never the provisional row, so the verdict survives deletion), then run state, then expiry — and only its `streaming` arm carries text; every refusal arm is shape-asserted to carry no payload.

**Keep the client honest with one derived field.** `provisionalState` is derived client-side from the two subscriptions with a fixed precedence (`disabled > withdrawn > superseded > committing > reset > paused_at_limit > streaming > awaiting_first_text > stalled > none`); the kernel's `AgentHostState` is untouched. The review panel caught that three text-bearing arms lacked the `rowExpired` guard the `streaming` arm had, so the client's single `ttlMs` timer — the only wall-clock signal, because a Convex query never re-runs on the clock alone — must gate every arm that paints text.

**Prove the narration directive from a structured turn log, not the smoke.** `driveTurn` emits one `[agentHarness:driveTurn] {...}` line per turn with run-length-collapsed event kinds, `firstDeltaMs`, `completionMs`, `elapsedMs` and opaque refs only. The acceptance evidence for "the model narrates before its first tool call" is a production-shaped operator turn on the dev deployment read back through `bunx convex logs --history <n>`:

```text
[agentHarness:driveTurn] {"outcome":"completed","events":"turn_started,narrative_delta×7,tool_call_requested,progress,tool_call_completed,usage,narrative_delta×6,…,narrative_delta×37,usage,turn_completed,completion_projected","firstDeltaMs":12483,"firstProgressMs":13069,"completionMs":45554,"elapsedMs":46298}
```

`narrative_delta` precedes the first `tool_call_requested`; `firstDeltaMs` is the time-to-first-provisional-text metric the rollout monitors.

## Why This Matters

Streaming looks like a UI feature but it is an exposure-policy change. Every place the foundation's release gate was strong — one transaction, per-read reauthorization, revocation before recall — is a place a naive stream would be weak. Treating streamed text as its own class with its own markers, its own table, and its own deletion contract keeps the release invariant intact ("the narrative never enters Athena's durable record, projected history, a citation, or a prompt, and never survives a terminal cause") while still giving operators the thing they asked for.

The deletion enumeration is the reusable part. "Delete on terminal" sounds like one hook; it is five, each at a different transaction with a different guard to stand outside of, and the review's testing audit found the two that were implemented but not individually proven (fence repair, commit-then-provider-failure). When a table must never outlive a lifecycle, list the lifecycle's exits explicitly and write one re-query assertion per exit.

The log line matters because the generic smoke cannot see the behaviour under test: a single-tool prompt gives the provider no reason to narrate. A sensor that measures the real thing on the real deployment — and is cheap enough to read during rollout — is worth more than a green mock.

## Prevention

- When a feature streams or previews unreleased content, write its exposure rule first ("Provisional stream, recallable view") and derive the table, markers, flush refusals, preview ladder and deletion list from it; do not reuse a table whose sweep has side effects (the prompt-payload sweep patches the grant).
- Enumerate terminal causes in the plan and assert each with a real re-query after the transition (`loadProvisionalNarrativeByBindingWithCtx(...) === null`), never by inspecting the code path.
- Every client arm that paints text must carry the client-side expiry guard; table-test precedence with inputs that make adjacent branches *both* true, not fixtures where the later branch is false by construction.
- A flush that reauthorizes on every write and a query that reauthorizes on every read should refuse on the same conditions; when one fails closed on a missing fact (`egress_class_missing`), the other must not skip that rung once anything has been released.
- For behaviour only a real provider exhibits, ship a structured log line with opaque refs and timings and read it back with `bunx convex logs --history`; make that line the acceptance criterion.
- Bootstrapping a worktree with `scripts/worktree-manager.sh setup-env` can leave `@convex-dev/agent` uninstalled; 39 harness tests then fail with `Could not find the "_generated" directory`. Run `bun install` in the worktree before reading failures as your own.

## Examples

Preview ladder refusal arms carry no payload (shape-asserted):

```ts
const withdrawn = await preview(t, owner, args);
expect(withdrawn).toEqual({ state: "withdrawn", reason: "membership_revoked", released: true });
expect(Object.keys(withdrawn).sort()).toEqual(["reason", "released", "state"]);
```

Deletion proof per terminal cause (suppression outside the `already` guard):

```ts
await provisionalRow("late draft");
expect(await suppressReleaseWithCtx(ctx, { bindingId, reason: "membership_revoked", now }))
  .toEqual({ outcome: "already_suppressed", cleanup: "already_succeeded" });
expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, bindingId)).toBeNull();
```

Client precedence with the expiry guard on every text-bearing arm:

```ts
if (row && !input.rowExpired && input.finalizingAt !== null && input.finalizingAt >= row.updatedAt) return "committing";
if (row && !input.rowExpired && input.lastRenderedOrdinal !== null && row.draftOrdinal > input.lastRenderedOrdinal) return "reset";
if (row?.truncated && !input.rowExpired) return "paused_at_limit";
if (row && !input.rowExpired) return "streaming";
```

## Related

- Plan: `docs/plans/2026-08-22-001-feat-agent-response-streaming-plan.md`; foundation amendment in `docs/plans/2026-08-21-001-feat-athena-agent-harness-foundation-plan.md`.
- Docs: `packages/athena-webapp/docs/agent/agent-harness-runtime.md` §5, `capability-authoring.md` §11/§14, `architecture.md`, `intelligence.md`.
- Linear: V26-1305 (epic), V26-1290, V26-1298, V26-1299, V26-1300, V26-1301.
- Related notes: `docs/solutions/performance/athena-convex-read-amplification-2026-06-29.md`, `docs/solutions/harness/convex-query-write-boundary-proof-2026-06-18.md`, `docs/solutions/harness/convex-return-validator-contract-proof-2026-06-18.md`, `docs/solutions/architecture-patterns/athena-answering-a-non-human-caller-2026-08-22.md`.
