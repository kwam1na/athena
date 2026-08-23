/**
 * Reusable `AgentRuntimeAdapter` contract suite.
 *
 * The contract tests run it against the deterministic fake; every real
 * adapter must run the identical suite by supplying a harness whose `scriptTurn`
 * drives a scripted model. The suite only ever touches the Athena-owned
 * contract: opaque refs, normalized events, the kernel tool-dispatch ledger,
 * and the usage reconciler. It imports nothing runtime-native.
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_RUNTIME_EVENT_KINDS,
  AGENT_RUNTIME_PROTOCOL_VERSION,
  createAgentToolDispatchLedger,
  createUsageReconciler,
  validateRuntimeEvent,
  type AgentRuntimeEvent,
  type AgentToolDefinition,
  type AgentToolDispatchResult,
  type AgentToolHandlerOutcome,
  type AgentToolRegistration,
  type AgentRuntimeTurnHooks,
} from "./agentRuntime";
import type { AgentRuntimeContractHarness } from "./agentRuntimeHarness";
import { scanForRawIdentifiers } from "./results";
import { opaqueRef } from "./values";

export type { AgentRuntimeContractHarness, AgentRuntimeScriptStep } from "./agentRuntimeHarness";

/** Let pending microtasks and continuations drain without any fake-owned timer. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The turn's event skeleton with narration removed. Whether a scripted turn's
 * own final prose reaches the host as `narrative_delta` events is an adapter
 * property — an adapter that consumes a provider text stream emits it, the
 * deterministic fake hands it over only in `turn_completed` — so narration is
 * asserted exactly in the narration case and elsewhere left out of the
 * skeleton.
 */
function eventSkeleton(events: readonly AgentRuntimeEvent[]): AgentRuntimeEvent["kind"][] {
  return events.map((event) => event.kind).filter((kind) => kind !== "narrative_delta");
}

// ---------------------------------------------------------------------------
// Kernel-side fixtures (Athena-owned tools and handlers)
// ---------------------------------------------------------------------------

type EchoArgs = { readonly value: string };
type SlowArgs = { readonly gate: string };

function makeEchoTool(): AgentToolDefinition<EchoArgs, { echoed: string }> {
  return {
    toolId: "athena.test.echo",
    description: "Echo a validated string (test tool).",
    validateInput: (raw) => {
      if (typeof raw !== "object" || raw === null || typeof (raw as { value?: unknown }).value !== "string") {
        return { ok: false, issues: [{ path: "value", message: "value must be a string" }] };
      }
      return { ok: true, args: { value: (raw as { value: string }).value } };
    },
  };
}

function makeGateTool(): AgentToolDefinition<SlowArgs, { released: string }> {
  return {
    toolId: "athena.test.gate",
    description: "Resolve once the named gate is released (test tool).",
    validateInput: (raw) => {
      if (typeof raw !== "object" || raw === null || typeof (raw as { gate?: unknown }).gate !== "string") {
        return { ok: false, issues: [{ path: "gate", message: "gate must be a string" }] };
      }
      return { ok: true, args: { gate: (raw as { gate: string }).gate } };
    },
  };
}

function makeOutcomeTool(): AgentToolDefinition<{ readonly mode: string }, { ok: true }> {
  return {
    toolId: "athena.test.outcome",
    description: "Return the requested typed outcome (test tool).",
    validateInput: (raw) => {
      const mode = (raw as { mode?: unknown } | null)?.mode;
      if (typeof mode !== "string") return { ok: false, issues: [{ path: "mode", message: "mode required" }] };
      return { ok: true, args: { mode } };
    },
  };
}

class Gates {
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly released = new Set<string>();

  wait(gate: string): Promise<void> {
    if (this.released.has(gate)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.waiters.get(gate) ?? [];
      list.push(resolve);
      this.waiters.set(gate, list);
    });
  }

  release(gate: string) {
    this.released.add(gate);
    for (const resolve of this.waiters.get(gate) ?? []) resolve();
    this.waiters.delete(gate);
  }
}

function buildKernel(adapterVersion: string) {
  const gates = new Gates();
  const handlerCalls: { toolId: string; args: unknown; callId: string }[] = [];
  const echo: AgentToolRegistration<EchoArgs, { echoed: string }> = {
    definition: makeEchoTool(),
    handler: async (args, context) => {
      handlerCalls.push({ toolId: "athena.test.echo", args, callId: context.callId });
      return { kind: "success", result: { echoed: args.value } };
    },
  };
  const gate: AgentToolRegistration<SlowArgs, { released: string }> = {
    definition: makeGateTool(),
    handler: async (args, context) => {
      handlerCalls.push({ toolId: "athena.test.gate", args, callId: context.callId });
      await gates.wait(args.gate);
      if (context.signal.aborted) return { kind: "canceled", reason: "aborted_by_kernel" };
      return { kind: "success", result: { released: args.gate } };
    },
  };
  const outcome: AgentToolRegistration<{ readonly mode: string }, { ok: true }> = {
    definition: makeOutcomeTool(),
    handler: async (args, context) => {
      handlerCalls.push({ toolId: "athena.test.outcome", args, callId: context.callId });
      switch (args.mode) {
        case "throw":
          throw new Error("handler exploded");
        case "failure":
          return { kind: "failure", error: { code: "upstream_failed", message: "upstream failed", retryable: true } };
        case "denied":
          return { kind: "denied", denial: { code: "unauthorized_capability", message: "not granted" } };
        case "canceled":
          return { kind: "canceled", reason: "handler_canceled" };
        default:
          return { kind: "success", result: { ok: true } };
      }
    },
  };
  const ledger = createAgentToolDispatchLedger({
    adapterVersion,
    tools: [echo, gate, outcome],
  });
  const events: AgentRuntimeEvent[] = [];
  const usage = createUsageReconciler();
  const hooks: AgentRuntimeTurnHooks = {
    onEvent: (event) => {
      events.push(event);
      if (event.kind === "turn_started" || event.kind === "turn_resumed") ledger.beginTurn(event.turnRef);
      if (event.kind === "usage") usage.record(event.usage);
      if (event.kind === "turn_completed") ledger.terminalizeTurn(event.turnRef, `turn_${event.outcome}`);
    },
    dispatchTool: (request) => ledger.dispatch(request),
  };
  return {
    gates,
    handlerCalls,
    ledger,
    events,
    usage,
    hooks,
    tools: [echo.definition, gate.definition, outcome.definition] as readonly AgentToolDefinition[],
  };
}

async function openTurn(
  harness: AgentRuntimeContractHarness,
  kernel: ReturnType<typeof buildKernel>,
  turnKey: string,
  threadKey = "contract|thread-1",
) {
  const thread = await harness.adapter.ensureThread({
    threadKey,
    contextBindingRef: opaqueRef("context_binding", "ctx-1"),
    correlation: { operatorRef: "athenaUser:operator-1", profileId: "contract_profile" },
  });
  const input = await harness.adapter.saveInput({
    threadRef: thread.threadRef,
    turnKey,
    prompt: {
      text: "What needs attention?",
      egressClass: "operational",
      promptHash: "sha256:prompt",
      untrustedDataLabel: "retrieved_store_data",
    },
    history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: 1 },
  });
  const started = await harness.adapter.startTurn(
    {
      threadRef: thread.threadRef,
      inputRef: input.inputRef,
      turnKey,
      tools: kernel.tools,
      model: { providerId: "fixture", modelId: "fixture-1", region: "eu" },
      limits: { maxToolCalls: 8, maxElapsedMs: 60_000 },
    },
    kernel.hooks,
  );
  return { thread, input, turnRef: started.turnRef };
}

function outcomeOf(result: AgentToolDispatchResult): AgentToolHandlerOutcome<unknown> | undefined {
  return result.kind === "outcome" ? result.outcome : undefined;
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

export function runAgentRuntimeAdapterContractSuite(
  name: string,
  createHarness: () => AgentRuntimeContractHarness,
) {
  describe(`AgentRuntimeAdapter contract: ${name}`, () => {
    it("declares the protocol version and only opaque references", async () => {
      const harness = createHarness();
      expect(harness.adapter.descriptor.protocolVersion).toBe(AGENT_RUNTIME_PROTOCOL_VERSION);
      expect(harness.adapter.descriptor.adapterKind).toBeTruthy();
      expect(harness.adapter.descriptor.adapterVersion).toBeTruthy();
      const first = await harness.adapter.ensureThread({
        threadKey: "contract|thread-x",
        contextBindingRef: opaqueRef("context_binding", "ctx"),
        correlation: { operatorRef: "athenaUser:o", profileId: "p" },
      });
      const second = await harness.adapter.ensureThread({
        threadKey: "contract|thread-x",
        contextBindingRef: opaqueRef("context_binding", "ctx"),
        correlation: { operatorRef: "athenaUser:o", profileId: "p" },
      });
      expect(first.created).toBe(true);
      expect(second).toEqual({ threadRef: first.threadRef, created: false });
      expect(first.threadRef.startsWith("runtime_thread:")).toBe(true);
      expect(scanForRawIdentifiers({ threadRef: first.threadRef })).toEqual([]);
    });

    it("drives start, server-authored progress, completion, projection, and cleanup with normalized events", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-1", [
        { kind: "progress", milestone: "checking_sources" },
        { kind: "progress", milestone: "composing_answer" },
        { kind: "complete", narrative: "All registers are open." },
      ]);
      const { thread, turnRef } = await openTurn(harness, kernel, "turn-1");
      await harness.settle(turnRef);

      expect(eventSkeleton(kernel.events)).toEqual([
        "turn_started",
        "progress",
        "progress",
        "turn_completed",
      ]);
      const sequences = kernel.events.map((event) => event.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      expect(new Set(sequences).size).toBe(sequences.length);
      for (const event of kernel.events) {
        expect(event.turnRef).toBe(turnRef);
        expect(validateRuntimeEvent(event)).toEqual({ ok: true });
        expect(AGENT_RUNTIME_EVENT_KINDS).toContain(event.kind);
        expect(scanForRawIdentifiers(event)).toEqual([]);
        expect(JSON.parse(JSON.stringify(event))).toEqual(event);
      }
      const completed = kernel.events.find((event) => event.kind === "turn_completed");
      expect(completed).toMatchObject({ outcome: "completed", narrative: "All registers are open." });

      const projection = await harness.adapter.projectCompletion({
        threadRef: thread.threadRef,
        turnRef,
        idempotencyKey: "project:turn-1",
        artifact: {
          artifactRef: "artifact:turn-1",
          narrative: "All registers are open.",
          egressClass: "operational",
          citations: [{ citationKey: "c1", label: "Store day" }],
          committedAt: 10,
        },
      });
      expect(projection).toMatchObject({ kind: "projected", replayed: false });
      if (projection.kind !== "projected") return;
      const replay = await harness.adapter.projectCompletion({
        threadRef: thread.threadRef,
        turnRef,
        idempotencyKey: "project:turn-1",
        artifact: {
          artifactRef: "artifact:turn-1",
          narrative: "All registers are open.",
          egressClass: "operational",
          citations: [{ citationKey: "c1", label: "Store day" }],
          committedAt: 10,
        },
      });
      expect(replay).toEqual({ kind: "projected", projectionRef: projection.projectionRef, replayed: true });
      expect(kernel.events.at(-1)).toMatchObject({ kind: "completion_projected", projectionRef: projection.projectionRef });

      const cleanup = await harness.adapter.cleanup({
        threadRef: thread.threadRef,
        turnRef,
        projectionRef: projection.projectionRef,
        reason: "retention_expired",
      });
      expect(cleanup.ok).toBe(true);
      const again = await harness.adapter.cleanup({ threadRef: thread.threadRef, reason: "retention_expired" });
      expect(again.ok).toBe(true);
    });

    it("resumes an active turn without duplicating it and reports terminal turns as terminal", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-r", [
        { kind: "pause", gate: "resume-gate" },
        { kind: "complete", narrative: "done" },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-r");
      const resumed = await harness.adapter.resumeTurn({ turnRef }, kernel.hooks);
      expect(resumed).toEqual({ resumed: true, state: "running" });
      harness.release("resume-gate");
      await harness.settle(turnRef);
      const terminal = await harness.adapter.resumeTurn({ turnRef }, kernel.hooks);
      expect(terminal).toEqual({ resumed: false, state: "terminal" });
      expect(kernel.events.filter((event) => event.kind === "turn_started")).toHaveLength(1);
      expect(kernel.events.filter((event) => event.kind === "turn_completed")).toHaveLength(1);
      const unknown = await harness.adapter.resumeTurn(
        { turnRef: opaqueRef("runtime_turn", "never-existed") },
        kernel.hooks,
      );
      expect(unknown).toEqual({ resumed: false, state: "unknown" });
    });

    it("streams ordered narrative deltas per draft and nothing after the turn completes", async (context) => {
      const harness = createHarness();
      if (!harness.supportsNarrativeStreaming) {
        // The adapter's scripted model cannot narrate yet; the suite is opt-in
        // per adapter so the contract stays one shared case.
        context.skip();
        return;
      }
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-n", [
        { kind: "narrative", deltas: ["Checking which shifts are open", " on the current day."] },
        { kind: "tool_call", callId: "call-n", toolId: "athena.test.echo", args: { value: "shifts" } },
        { kind: "narrative", deltas: ["Two shifts are still open."] },
        { kind: "complete", narrative: "Two shifts are still open." },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-n");
      await harness.settle(turnRef);

      expect(kernel.events.map((event) => event.kind)).toEqual([
        "turn_started",
        "narrative_delta",
        "narrative_delta",
        "tool_call_requested",
        "tool_call_completed",
        "narrative_delta",
        "turn_completed",
      ]);
      const deltas = kernel.events.filter((event) => event.kind === "narrative_delta");
      expect(deltas.map((event) => (event.kind === "narrative_delta" ? event.draftOrdinal : -1))).toEqual([0, 0, 1]);
      expect(deltas.map((event) => (event.kind === "narrative_delta" ? event.text : ""))).toEqual([
        "Checking which shifts are open",
        " on the current day.",
        "Two shifts are still open.",
      ]);
      const sequences = kernel.events.map((event) => event.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      expect(new Set(sequences).size).toBe(sequences.length);
      for (const event of deltas) {
        expect(event.turnRef).toBe(turnRef);
        expect(validateRuntimeEvent(event)).toEqual({ ok: true });
        expect(AGENT_RUNTIME_EVENT_KINDS).toContain(event.kind);
        expect(scanForRawIdentifiers(event)).toEqual([]);
        expect(JSON.parse(JSON.stringify(event))).toEqual(event);
      }
      // `turn_completed.narrative` is the model's own final prose — the last
      // draft, not every draft joined, and never the committed answer (that is
      // the independent `athena.completeRun` argument the kernel holds).
      const completed = kernel.events.at(-1);
      expect(completed).toMatchObject({ kind: "turn_completed", outcome: "completed", narrative: "Two shifts are still open." });
      expect(kernel.events.findIndex((event) => event.kind === "turn_completed")).toBe(kernel.events.length - 1);

      // A late delta after terminalization never reaches the kernel.
      const eventCount = kernel.events.length;
      await flush();
      expect(kernel.events).toHaveLength(eventCount);
    });

    it("dispatches validated tool calls through the kernel ledger and back", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-t", [
        { kind: "tool_call", callId: "call-1", toolId: "athena.test.echo", args: { value: "hi", extra: "dropped" } },
        { kind: "complete", narrative: "echoed" },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-t");
      await harness.settle(turnRef);
      expect(kernel.handlerCalls).toEqual([{ toolId: "athena.test.echo", args: { value: "hi" }, callId: "call-1" }]);
      const results = harness.dispatchResults(turnRef);
      expect(results).toHaveLength(1);
      expect(outcomeOf(results[0])).toEqual({ kind: "success", result: { echoed: "hi" } });
      expect(results[0]).toMatchObject({ kind: "outcome", callId: "call-1", toolId: "athena.test.echo", replayed: false });
      expect(eventSkeleton(kernel.events)).toEqual([
        "turn_started",
        "tool_call_requested",
        "tool_call_completed",
        "turn_completed",
      ]);
      expect(kernel.events[2]).toMatchObject({ callId: "call-1", outcomeKind: "success" });
    });

    it("rejects invalid arguments before any handler runs", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-i", [
        { kind: "tool_call", callId: "call-bad", toolId: "athena.test.echo", args: { value: 42 } },
        { kind: "tool_call", callId: "call-unknown", toolId: "athena.test.nope", args: {} },
        { kind: "complete", narrative: "tried" },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-i");
      await harness.settle(turnRef);
      expect(kernel.handlerCalls).toEqual([]);
      const [bad, unknownTool] = harness.dispatchResults(turnRef);
      expect(bad).toMatchObject({ kind: "protocol_violation", code: "invalid_arguments", callId: "call-bad" });
      expect(unknownTool).toMatchObject({ kind: "protocol_violation", code: "unknown_tool", callId: "call-unknown" });
      expect(kernel.events.filter((event) => event.kind === "tool_call_completed")).toHaveLength(2);
      expect(kernel.events.find((event) => event.kind === "tool_call_completed")).toMatchObject({
        outcomeKind: "protocol_violation",
      });
    });

    it("replays only an exact fingerprint and never invokes a handler for a mismatch", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-k", [
        { kind: "tool_call", callId: "call-1", toolId: "athena.test.echo", args: { value: "a" }, idempotencyKey: "key-1" },
        { kind: "tool_call", callId: "call-1", toolId: "athena.test.echo", args: { value: "a" }, idempotencyKey: "key-1" },
        { kind: "tool_call", callId: "call-1", toolId: "athena.test.outcome", args: { mode: "ok" }, idempotencyKey: "key-1" },
        { kind: "tool_call", callId: "call-1", toolId: "athena.test.echo", args: { value: "b" }, idempotencyKey: "key-1" },
        { kind: "tool_call", callId: "call-2", toolId: "athena.test.echo", args: { value: "a" }, idempotencyKey: "key-1" },
        { kind: "complete", narrative: "replayed" },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-k");
      await harness.settle(turnRef);
      expect(kernel.handlerCalls).toHaveLength(1);
      const [first, replay, otherTool, otherArgs, otherCall] = harness.dispatchResults(turnRef);
      expect(first).toMatchObject({ kind: "outcome", replayed: false });
      expect(replay).toMatchObject({ kind: "outcome", replayed: true, outcome: { kind: "success", result: { echoed: "a" } } });
      expect(replay.kind === "outcome" && first.kind === "outcome" && replay.fingerprint === first.fingerprint).toBe(true);
      expect(otherTool).toMatchObject({ kind: "protocol_violation", code: "fingerprint_mismatch", mismatch: ["toolId", "argsHash"] });
      expect(otherArgs).toMatchObject({ kind: "protocol_violation", code: "fingerprint_mismatch", mismatch: ["argsHash"] });
      expect(otherCall).toMatchObject({ kind: "protocol_violation", code: "fingerprint_mismatch", mismatch: ["callId"] });
      for (const violation of [otherTool, otherArgs, otherCall]) {
        expect(JSON.stringify(violation)).not.toContain("echoed");
      }
    });

    it("rejects a call id reused across turns", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-a", [
        { kind: "tool_call", callId: "shared-call", toolId: "athena.test.echo", args: { value: "a" } },
        { kind: "complete", narrative: "a" },
      ]);
      harness.scriptTurn("turn-b", [
        { kind: "tool_call", callId: "shared-call", toolId: "athena.test.echo", args: { value: "b" } },
        { kind: "complete", narrative: "b" },
      ]);
      const first = await openTurn(harness, kernel, "turn-a");
      await harness.settle(first.turnRef);
      const second = await openTurn(harness, kernel, "turn-b");
      await harness.settle(second.turnRef);
      expect(kernel.handlerCalls).toHaveLength(1);
      expect(harness.dispatchResults(second.turnRef)[0]).toMatchObject({
        kind: "protocol_violation",
        code: "call_id_reused_across_turns",
      });
    });

    it("correlates parallel calls whose results arrive out of order", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-p", [
        {
          kind: "tool_calls_parallel",
          calls: [
            { callId: "slow", toolId: "athena.test.gate", args: { gate: "g-slow" } },
            { callId: "fast", toolId: "athena.test.gate", args: { gate: "g-fast" } },
          ],
        },
        { kind: "complete", narrative: "both" },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-p");
      await flush();
      expect(kernel.ledger.inFlight(turnRef).map((entry) => entry.callId).sort()).toEqual(["fast", "slow"]);
      kernel.gates.release("g-fast");
      await flush();
      expect(kernel.ledger.inFlight(turnRef).map((entry) => entry.callId)).toEqual(["slow"]);
      kernel.gates.release("g-slow");
      await harness.settle(turnRef);
      const results = harness.dispatchResults(turnRef);
      const byCall = Object.fromEntries(results.map((result) => [result.callId, outcomeOf(result)]));
      expect(byCall.fast).toEqual({ kind: "success", result: { released: "g-fast" } });
      expect(byCall.slow).toEqual({ kind: "success", result: { released: "g-slow" } });
      const completedOrder = kernel.events
        .filter((event) => event.kind === "tool_call_completed")
        .map((event) => (event.kind === "tool_call_completed" ? event.callId : ""));
      expect(completedOrder).toEqual(["fast", "slow"]);
    });

    it("propagates typed handler failure, denial, cancellation, and thrown errors", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-o", [
        { kind: "tool_call", callId: "c-throw", toolId: "athena.test.outcome", args: { mode: "throw" } },
        { kind: "tool_call", callId: "c-fail", toolId: "athena.test.outcome", args: { mode: "failure" } },
        { kind: "tool_call", callId: "c-deny", toolId: "athena.test.outcome", args: { mode: "denied" } },
        { kind: "tool_call", callId: "c-cancel", toolId: "athena.test.outcome", args: { mode: "canceled" } },
        { kind: "complete", narrative: "outcomes" },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-o");
      await harness.settle(turnRef);
      const outcomes = harness.dispatchResults(turnRef).map(outcomeOf);
      expect(outcomes[0]).toMatchObject({ kind: "failure", error: { code: "handler_threw", retryable: false } });
      expect(JSON.stringify(outcomes[0])).not.toContain("exploded");
      expect(outcomes[1]).toEqual({ kind: "failure", error: { code: "upstream_failed", message: "upstream failed", retryable: true } });
      expect(outcomes[2]).toEqual({ kind: "denied", denial: { code: "unauthorized_capability", message: "not granted" } });
      expect(outcomes[3]).toEqual({ kind: "canceled", reason: "handler_canceled" });
      expect(kernel.events.filter((event) => event.kind === "tool_call_completed").map((event) => (event.kind === "tool_call_completed" ? event.outcomeKind : ""))).toEqual([
        "failure",
        "failure",
        "denied",
        "canceled",
      ]);
    });

    it("cancels during execution and suppresses late results after terminalization", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-c", [
        { kind: "tool_call", callId: "in-flight", toolId: "athena.test.gate", args: { gate: "g-cancel" } },
        { kind: "complete", narrative: "should not complete" },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-c");
      await flush();
      expect(kernel.ledger.inFlight(turnRef)).toHaveLength(1);
      const accepted = await harness.adapter.cancelTurn({ turnRef, reason: "operator_cancel" });
      expect(accepted).toEqual({ accepted: true });
      await harness.settle(turnRef);
      const completed = kernel.events.find((event) => event.kind === "turn_completed");
      expect(completed).toMatchObject({ outcome: "canceled" });
      expect(kernel.ledger.inFlight(turnRef)).toHaveLength(0);
      const inFlightResult = harness.dispatchResults(turnRef)[0];
      expect(outcomeOf(inFlightResult)).toMatchObject({ kind: "canceled" });

      const eventCount = kernel.events.length;
      kernel.gates.release("g-cancel");
      await flush();
      expect(kernel.events).toHaveLength(eventCount);
      const entry = kernel.ledger.entries().find((candidate) => candidate.callId === "in-flight");
      expect(entry?.outcome).toMatchObject({ kind: "canceled" });
      expect(entry?.lateOutcome).toBeDefined();
      expect(entry?.lateOutcome).toMatchObject({ kind: "canceled", reason: "aborted_by_kernel" });
      const repeat = await harness.adapter.cancelTurn({ turnRef, reason: "operator_cancel" });
      expect(repeat).toEqual({ accepted: false });
      const late = await kernel.ledger.dispatch({
        callId: "after-terminal",
        turnRef,
        toolId: "athena.test.echo",
        rawArgs: { value: "late" },
        idempotencyKey: "late-key",
      });
      expect(late).toMatchObject({ kind: "protocol_violation", code: "turn_terminal" });
      expect(kernel.handlerCalls.map((call) => call.callId)).toEqual(["in-flight"]);
    });

    it("reports failed turns as typed terminal outcomes", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-f", [{ kind: "fail", code: "provider_failure", message: "model unavailable" }]);
      const { turnRef } = await openTurn(harness, kernel, "turn-f");
      await harness.settle(turnRef);
      expect(kernel.events.at(-1)).toMatchObject({
        kind: "turn_completed",
        outcome: "failed",
        error: { code: "provider_failure", message: "model unavailable" },
      });
    });

    it("emits normalized usage per provider invocation stream and never a native usage object", async () => {
      const harness = createHarness();
      const kernel = buildKernel(harness.adapter.descriptor.adapterVersion);
      harness.scriptTurn("turn-u", [
        { kind: "usage", providerInvocationRef: "inv-1", retryIndex: 0, sequence: 1, eventKey: "u1", mode: "delta", tokens: { input: 10, output: 2 }, terminal: false },
        { kind: "usage", providerInvocationRef: "inv-1", retryIndex: 0, sequence: 1, eventKey: "u1", mode: "delta", tokens: { input: 10, output: 2 }, terminal: false },
        { kind: "usage", providerInvocationRef: "inv-1", retryIndex: 0, sequence: 2, eventKey: "u2", mode: "delta", tokens: { output: 5 }, terminal: true },
        { kind: "usage", providerInvocationRef: "inv-1", retryIndex: 1, sequence: 1, eventKey: "u3", mode: "cumulative", tokens: { input: 12, output: 3 }, terminal: true },
        { kind: "complete", narrative: "usage" },
      ]);
      const { turnRef } = await openTurn(harness, kernel, "turn-u");
      await harness.settle(turnRef);
      const usageEvents = kernel.events.filter((event) => event.kind === "usage");
      expect(usageEvents).toHaveLength(4);
      for (const event of usageEvents) {
        expect(Object.keys(event).sort()).toEqual(["at", "kind", "sequence", "turnRef", "usage"]);
        expect(Object.keys((event as { usage: object }).usage).sort()).toEqual([
          "eventKey",
          "mode",
          "providerInvocationRef",
          "retryIndex",
          "sequence",
          "terminal",
          "tokens",
        ]);
      }
      const settlement = kernel.usage.settleAll("terminal_total");
      expect(settlement.tokens).toEqual({ input: 22, output: 10, cachedInput: 0, reasoning: 0 });
      expect(settlement.streams.map((stream) => stream.streamKey)).toEqual(["inv-1#0", "inv-1#1"]);
    });
  });
}
