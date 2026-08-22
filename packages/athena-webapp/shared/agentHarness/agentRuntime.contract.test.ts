/**
 * Runtime contract tests.
 *
 * Runs the reusable adapter suite against the deterministic contract fake and
 * proves the kernel-owned tool-dispatch ledger and usage reconciler directly.
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_RUNTIME_EVENT_KINDS,
  calculateUsageCost,
  computeToolFingerprint,
  createAgentToolDispatchLedger,
  createUsageReconciler,
  validateRuntimeEvent,
  type AgentRuntimeEvent,
  type AgentToolRegistration,
  type AgentUsageEvent,
} from "./agentRuntime";
import { runAgentRuntimeAdapterContractSuite } from "./agentRuntime.contractSuite";
import { createAgentRuntimeContractFake, createDeterministicClock } from "./agentRuntimeFake";
import { opaqueRef } from "./values";

runAgentRuntimeAdapterContractSuite("deterministic contract fake", () =>
  createAgentRuntimeContractFake({ clock: createDeterministicClock(1_000) }),
);

describe("contract fake determinism", () => {
  it("produces identical event streams and refs for identical scripts", async () => {
    const run = async () => {
      const harness = createAgentRuntimeContractFake({ clock: createDeterministicClock(5_000) });
      const events: AgentRuntimeEvent[] = [];
      harness.scriptTurn("t", [{ kind: "progress", milestone: "reading_sources" }, { kind: "complete", narrative: "x" }]);
      const thread = await harness.adapter.ensureThread({
        threadKey: "k",
        contextBindingRef: opaqueRef("context_binding", "c"),
        correlation: { operatorRef: "o", profileId: "p" },
      });
      const input = await harness.adapter.saveInput({
        threadRef: thread.threadRef,
        turnKey: "t",
        prompt: { text: "q", egressClass: "operational", promptHash: "h", untrustedDataLabel: "d" },
        history: { messages: [], projectionDigest: "e", reauthorizedAt: 1 },
      });
      const { turnRef } = await harness.adapter.startTurn(
        {
          threadRef: thread.threadRef,
          inputRef: input.inputRef,
          turnKey: "t",
          tools: [],
          model: { providerId: "f", modelId: "m", region: "eu" },
          limits: { maxToolCalls: 1, maxElapsedMs: 1 },
        },
        {
          onEvent: (event) => {
            events.push(event);
          },
          dispatchTool: async () => {
            throw new Error("unused");
          },
        },
      );
      await harness.settle(turnRef);
      return { turnRef, events };
    };
    expect(await run()).toEqual(await run());
  });

  it("rejects runtime event kinds outside v1 as versioned extensions", () => {
    const result = validateRuntimeEvent({
      kind: "model_thought_stream",
      sequence: 1,
      turnRef: opaqueRef("runtime_turn", "t"),
      at: 1,
    } as unknown as AgentRuntimeEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        code: "versioned_extension_required",
        primitive: "runtimeEvent.kind",
        value: "model_thought_stream",
      });
    }
    expect(AGENT_RUNTIME_EVENT_KINDS).not.toContain("model_thought_stream");
  });
});

// ---------------------------------------------------------------------------
// Tool dispatch ledger (scenario 9, kernel side)
// ---------------------------------------------------------------------------

function ledgerFixture() {
  const calls: unknown[] = [];
  const echo: AgentToolRegistration<{ value: string }, { echoed: string }> = {
    definition: {
      toolId: "echo",
      description: "echo",
      validateInput: (raw) =>
        typeof (raw as { value?: unknown })?.value === "string"
          ? { ok: true, args: { value: (raw as { value: string }).value } }
          : { ok: false, issues: [{ path: "value", message: "string required" }] },
    },
    handler: async (args) => {
      calls.push(args);
      return { kind: "success", result: { echoed: args.value } };
    },
  };
  const ledger = createAgentToolDispatchLedger({ adapterVersion: "fake.1", tools: [echo] });
  const turnRef = opaqueRef("runtime_turn", "turn-1");
  ledger.beginTurn(turnRef);
  return { ledger, turnRef, calls, echo };
}

describe("tool dispatch ledger", () => {
  it("binds idempotency keys to an immutable fingerprint of adapter version, turn, tool, args hash, and call id", async () => {
    const { ledger, turnRef } = ledgerFixture();
    const result = await ledger.dispatch({
      callId: "c1",
      turnRef,
      toolId: "echo",
      rawArgs: { value: "x" },
      idempotencyKey: "k1",
    });
    expect(result.kind).toBe("outcome");
    if (result.kind !== "outcome") return;
    expect(result.fingerprint).toBe(
      computeToolFingerprint({
        adapterVersion: "fake.1",
        turnRef,
        toolId: "echo",
        argsHash: result.argsHash,
        callId: "c1",
      }),
    );
    expect(result.fingerprint).not.toBe(
      computeToolFingerprint({
        adapterVersion: "fake.2",
        turnRef,
        toolId: "echo",
        argsHash: result.argsHash,
        callId: "c1",
      }),
    );
  });

  it("canonicalizes arguments so key order does not change the fingerprint", async () => {
    const { ledger, turnRef, calls } = ledgerFixture();
    const first = await ledger.dispatch({ callId: "c1", turnRef, toolId: "echo", rawArgs: { value: "x", z: 1, a: 2 }, idempotencyKey: "k1" });
    const second = await ledger.dispatch({ callId: "c1", turnRef, toolId: "echo", rawArgs: { a: 2, value: "x", z: 1 }, idempotencyKey: "k1" });
    expect(second).toMatchObject({ kind: "outcome", replayed: true });
    expect(first.kind === "outcome" && second.kind === "outcome" && first.argsHash === second.argsHash).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("reports a mismatched adapter version as a protocol violation", async () => {
    const { ledger, turnRef, echo } = ledgerFixture();
    await ledger.dispatch({ callId: "c1", turnRef, toolId: "echo", rawArgs: { value: "x" }, idempotencyKey: "k1" });
    const other = createAgentToolDispatchLedger({ adapterVersion: "fake.2", tools: [echo], restoreEntries: ledger.entries() });
    other.beginTurn(turnRef);
    const result = await other.dispatch({ callId: "c1", turnRef, toolId: "echo", rawArgs: { value: "x" }, idempotencyKey: "k1" });
    expect(result).toMatchObject({ kind: "protocol_violation", code: "fingerprint_mismatch", mismatch: ["adapterVersion"] });
  });

  it("rejects a different idempotency key for an already-bound call id within the turn", async () => {
    const { ledger, turnRef } = ledgerFixture();
    await ledger.dispatch({ callId: "c1", turnRef, toolId: "echo", rawArgs: { value: "x" }, idempotencyKey: "k1" });
    const conflict = await ledger.dispatch({ callId: "c1", turnRef, toolId: "echo", rawArgs: { value: "x" }, idempotencyKey: "k2" });
    expect(conflict).toMatchObject({ kind: "protocol_violation", code: "call_id_conflict" });
  });

  it("refuses dispatch for turns it has not begun", async () => {
    const { ledger } = ledgerFixture();
    const result = await ledger.dispatch({
      callId: "c9",
      turnRef: opaqueRef("runtime_turn", "other"),
      toolId: "echo",
      rawArgs: { value: "x" },
      idempotencyKey: "k9",
    });
    expect(result).toMatchObject({ kind: "protocol_violation", code: "turn_unknown" });
  });
});

// ---------------------------------------------------------------------------
// Usage parity (scenario 10)
// ---------------------------------------------------------------------------

function usageEvent(overrides: Partial<AgentUsageEvent>): AgentUsageEvent {
  return {
    providerInvocationRef: "inv-1",
    retryIndex: 0,
    sequence: 1,
    eventKey: "e1",
    mode: "delta",
    tokens: {},
    terminal: false,
    ...overrides,
  };
}

describe("usage reconciliation", () => {
  it("deduplicates and sums delta events, including out-of-order arrivals", () => {
    const reconciler = createUsageReconciler();
    expect(reconciler.record(usageEvent({ sequence: 2, eventKey: "e2", tokens: { output: 5 } })).disposition).toBe("accepted");
    expect(reconciler.record(usageEvent({ sequence: 1, eventKey: "e1", tokens: { input: 10 } })).disposition).toBe("accepted_out_of_order");
    expect(reconciler.record(usageEvent({ sequence: 1, eventKey: "e1", tokens: { input: 10 } })).disposition).toBe("duplicate");
    expect(reconciler.record(usageEvent({ sequence: 3, eventKey: "e3", tokens: { output: 1 }, terminal: true })).disposition).toBe("accepted");
    const settlement = reconciler.settleAll("terminal_total");
    expect(settlement.tokens).toEqual({ input: 10, output: 6, cachedInput: 0, reasoning: 0 });
    expect(settlement.streams[0]).toMatchObject({ settledBy: "terminal_total", conservative: false });
  });

  it("reconciles cumulative events monotonically and ignores stale cumulative snapshots", () => {
    const reconciler = createUsageReconciler();
    reconciler.record(usageEvent({ mode: "cumulative", sequence: 1, eventKey: "c1", tokens: { input: 10, output: 1 } }));
    reconciler.record(usageEvent({ mode: "cumulative", sequence: 3, eventKey: "c3", tokens: { input: 10, output: 8 }, terminal: true }));
    expect(reconciler.record(usageEvent({ mode: "cumulative", sequence: 2, eventKey: "c2", tokens: { input: 10, output: 4 } })).disposition).toBe(
      "accepted_out_of_order",
    );
    const settlement = reconciler.settleAll("terminal_total");
    expect(settlement.tokens).toEqual({ input: 10, output: 8, cachedInput: 0, reasoning: 0 });
  });

  it("rejects a mode change within one provider-invocation/retry stream", () => {
    const reconciler = createUsageReconciler();
    reconciler.record(usageEvent({ mode: "delta", sequence: 1, eventKey: "d1", tokens: { input: 3 } }));
    const changed = reconciler.record(usageEvent({ mode: "cumulative", sequence: 2, eventKey: "d2", tokens: { input: 30 } }));
    expect(changed.disposition).toBe("rejected_mode_change");
    expect(reconciler.settleAll("terminal_total").tokens.input).toBe(3);
    expect(reconciler.streams()[0]).toMatchObject({ mode: "delta", rejectedCount: 1 });
  });

  it("attributes retried provider invocations as separate streams", () => {
    const reconciler = createUsageReconciler();
    reconciler.record(usageEvent({ retryIndex: 0, sequence: 1, eventKey: "r0", tokens: { input: 10 }, terminal: true }));
    reconciler.record(usageEvent({ retryIndex: 1, sequence: 1, eventKey: "r1", tokens: { input: 12, output: 4 }, terminal: true }));
    const settlement = reconciler.settleAll("terminal_total");
    expect(settlement.streams.map((stream) => [stream.streamKey, stream.tokens.input, stream.tokens.output])).toEqual([
      ["inv-1#0", 10, 0],
      ["inv-1#1", 12, 4],
    ]);
    expect(settlement.tokens).toEqual({ input: 22, output: 4, cachedInput: 0, reasoning: 0 });
  });

  it("settles canceled and missing-final streams conservatively, exactly once", () => {
    const reconciler = createUsageReconciler();
    reconciler.record(usageEvent({ sequence: 1, eventKey: "p1", tokens: { input: 100, output: 2 } }));
    const first = reconciler.settleStream("inv-1#0", { reason: "cancel", estimate: { output: 50 } });
    expect(first).toMatchObject({ settled: true, settledBy: "cancel", conservative: true });
    expect(first.tokens).toEqual({ input: 100, output: 50, cachedInput: 0, reasoning: 0 });
    const second = reconciler.settleStream("inv-1#0", { reason: "terminal_total" });
    expect(second).toMatchObject({ settled: false, settledBy: "cancel" });
    expect(second.tokens).toEqual(first.tokens);

    const missing = createUsageReconciler();
    missing.record(usageEvent({ sequence: 1, eventKey: "m1", tokens: { input: 7 } }));
    const settled = missing.settleAll("missing_final");
    expect(settled.streams[0]).toMatchObject({ settledBy: "missing_final", conservative: true });
    expect(settled.tokens.input).toBe(7);
    const timeout = createUsageReconciler();
    timeout.record(usageEvent({ sequence: 1, eventKey: "t1", tokens: { input: 7 } }));
    expect(timeout.settleAll("timeout", { output: 9 }).tokens).toEqual({ input: 7, output: 9, cachedInput: 0, reasoning: 0 });
  });

  it("keeps late events as evidence only and never lowers settled spend", () => {
    const reconciler = createUsageReconciler();
    reconciler.record(usageEvent({ mode: "cumulative", sequence: 1, eventKey: "l1", tokens: { input: 40, output: 10 } }));
    const settlement = reconciler.settleAll("timeout");
    expect(settlement.tokens).toEqual({ input: 40, output: 10, cachedInput: 0, reasoning: 0 });
    const late = reconciler.record(usageEvent({ mode: "cumulative", sequence: 2, eventKey: "l2", tokens: { input: 40, output: 4 }, terminal: true }));
    expect(late.disposition).toBe("late_evidence_only");
    const bigger = reconciler.record(usageEvent({ mode: "cumulative", sequence: 3, eventKey: "l3", tokens: { input: 400, output: 40 }, terminal: true }));
    expect(bigger.disposition).toBe("late_evidence_only");
    expect(reconciler.settled().tokens).toEqual({ input: 40, output: 10, cachedInput: 0, reasoning: 0 });
    expect(reconciler.lateEvents()).toHaveLength(2);
    expect(reconciler.settleAll("terminal_total").tokens).toEqual({ input: 40, output: 10, cachedInput: 0, reasoning: 0 });
  });

  it("rejects malformed usage and lets Athena own cost calculation", () => {
    const reconciler = createUsageReconciler();
    expect(reconciler.record(usageEvent({ tokens: { input: -1 } })).disposition).toBe("rejected_invalid");
    expect(reconciler.record(usageEvent({ mode: "streaming" as unknown as "delta" })).disposition).toBe("rejected_invalid");
    expect(
      calculateUsageCost(
        { input: 1_000_000, output: 500_000, cachedInput: 0, reasoning: 0 },
        { perMillion: { input: 300, output: 1_500, cachedInput: 30, reasoning: 1_500 } },
      ),
    ).toBe(1_050);
    expect(
      calculateUsageCost(
        { input: 1, output: 0, cachedInput: 0, reasoning: 0 },
        { perMillion: { input: 300, output: 1_500, cachedInput: 30, reasoning: 1_500 } },
      ),
    ).toBe(1);
  });
});
