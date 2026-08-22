// @vitest-environment node
/**
 * Convex Agent adapter against the reusable `AgentRuntimeAdapter` contract
 * suite, plus adapter-specific proofs that only this
 * directory may express: native usage objects are normalized at the edge,
 * native tool names round-trip Athena tool ids, native errors map to typed
 * outcomes, and the model is an injected input.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  createAgentToolDispatchLedger,
  createUsageReconciler,
  type AgentRuntimeEvent,
  type AgentRuntimeTurnHooks,
  type AgentToolDefinition,
  type AgentToolRegistration,
} from "../../../shared/agentHarness/agentRuntime";
import { runAgentRuntimeAdapterContractSuite } from "../../../shared/agentHarness/agentRuntime.contractSuite";
import { opaqueRef } from "../../../shared/agentHarness/values";
import { AGENT_COMPONENT, createConvexAgentContractHarness, runtimeCtxFor } from "./convexAgent.contractHarness";
import { createConvexAgentCleanupHook } from "./convexAgentCleanup";
import {
  CONVEX_AGENT_ADAPTER_KIND,
  CONVEX_AGENT_ADAPTER_VERSION,
  CONVEX_AGENT_PINNED_VERSIONS,
  fromNativeToolName,
  normalizeNativeUsage,
  toNativeToolName,
} from "./convexAgent";

runAgentRuntimeAdapterContractSuite("convex agent adapter", () => createConvexAgentContractHarness());

const echoTool: AgentToolDefinition<{ readonly value: string }, { echoed: string }> = {
  toolId: "athena.test.echo",
  description: "Echo a validated string (test tool).",
  validateInput: (raw) => {
    const value = (raw as { value?: unknown } | null)?.value;
    if (typeof value !== "string") return { ok: false, issues: [{ path: "value", message: "value must be a string" }] };
    return { ok: true, args: { value } };
  },
};

function kernelFor(adapterVersion: string) {
  const events: AgentRuntimeEvent[] = [];
  const usage = createUsageReconciler();
  const echoRegistration: AgentToolRegistration<{ readonly value: string }, { echoed: string }> = {
    definition: echoTool,
    handler: async (args) => ({ kind: "success", result: { echoed: args.value } }),
  };
  const ledger = createAgentToolDispatchLedger({ adapterVersion, tools: [echoRegistration] });
  const hooks: AgentRuntimeTurnHooks = {
    onEvent: (event) => {
      events.push(event);
      if (event.kind === "turn_started" || event.kind === "turn_resumed") ledger.beginTurn(event.turnRef);
      if (event.kind === "usage") usage.record(event.usage);
      if (event.kind === "turn_completed") ledger.terminalizeTurn(event.turnRef, `turn_${event.outcome}`);
    },
    dispatchTool: (request) => ledger.dispatch(request),
  };
  return { events, usage, ledger, hooks };
}

describe("Convex Agent adapter specifics", () => {
  it("declares its kind, version, and the exact package versions it was proven against", () => {
    const harness = createConvexAgentContractHarness();
    expect(harness.adapter.descriptor.adapterKind).toBe(CONVEX_AGENT_ADAPTER_KIND);
    expect(harness.adapter.descriptor.adapterVersion).toBe(CONVEX_AGENT_ADAPTER_VERSION);
    expect(CONVEX_AGENT_ADAPTER_VERSION).toContain(CONVEX_AGENT_PINNED_VERSIONS["@convex-dev/agent"]);
    expect(CONVEX_AGENT_ADAPTER_VERSION).toContain(CONVEX_AGENT_PINNED_VERSIONS.ai);
  });

  it("maps Athena tool ids to provider-safe native names and back without collisions", () => {
    expect(toNativeToolName("athena.test.echo")).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(fromNativeToolName(toNativeToolName("athena.test.echo"))).toBe("athena.test.echo");
    expect(fromNativeToolName(toNativeToolName("athena.executeProgram"))).toBe("athena.executeProgram");
    expect(toNativeToolName("athena.a.b")).not.toBe(toNativeToolName("athena.a_b"));
  });

  it("normalizes native usage objects into Athena usage events and never leaks native keys", () => {
    const event = normalizeNativeUsage(
      {
        inputTokens: 120,
        inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 20, cacheWriteTokens: undefined },
        outputTokens: 30,
        outputTokenDetails: { textTokens: 25, reasoningTokens: 5 },
        totalTokens: 150,
        raw: { prompt_tokens: 120, completion_tokens: 30, secret_provider_field: "x" },
      },
      { providerInvocationRef: "turn:step-1", retryIndex: 0, sequence: 1, eventKey: "turn:step-1#final" },
    );
    expect(event).toEqual({
      providerInvocationRef: "turn:step-1",
      retryIndex: 0,
      sequence: 1,
      eventKey: "turn:step-1#final",
      mode: "cumulative",
      tokens: { input: 120, output: 30, cachedInput: 20, reasoning: 5 },
      terminal: true,
    });
    expect(JSON.stringify(event)).not.toContain("secret_provider_field");
    expect(JSON.stringify(event)).not.toContain("prompt_tokens");
    const sparse = normalizeNativeUsage(
      {
        inputTokens: undefined,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokens: 7,
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        totalTokens: undefined,
      },
      { providerInvocationRef: "inv", retryIndex: 1, sequence: 1, eventKey: "inv#1" },
    );
    expect(sparse.tokens).toEqual({ input: 0, output: 7, cachedInput: 0, reasoning: 0 });
    expect(sparse.retryIndex).toBe(1);
  });

  it("emits one cumulative terminal usage stream per provider invocation from real model usage", async () => {
    const harness = createConvexAgentContractHarness();
    const kernel = kernelFor(harness.adapter.descriptor.adapterVersion);
    harness.scriptTurn("turn-real-usage", [
      { kind: "tool_call", callId: "c1", toolId: "athena.test.echo", args: { value: "a" } },
      { kind: "complete", narrative: "done" },
    ]);
    harness.modelUsage("turn-real-usage", [
      { inputTokens: 10, outputTokens: 4 },
      { inputTokens: 30, outputTokens: 6 },
    ]);
    const thread = await harness.adapter.ensureThread({
      threadKey: "usage|thread",
      contextBindingRef: opaqueRef("context_binding", "ctx"),
      correlation: { operatorRef: "athenaUser:o", profileId: "p" },
    });
    const input = await harness.adapter.saveInput({
      threadRef: thread.threadRef,
      turnKey: "turn-real-usage",
      prompt: { text: "hi", egressClass: "operational", promptHash: "sha256:h", untrustedDataLabel: "retrieved_store_data" },
      history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: 1 },
    });
    const { turnRef } = await harness.adapter.startTurn(
      {
        threadRef: thread.threadRef,
        inputRef: input.inputRef,
        turnKey: "turn-real-usage",
        tools: [echoTool],
        model: { providerId: "fixture", modelId: "fixture-1", region: "eu" },
        limits: { maxToolCalls: 4, maxElapsedMs: 10_000 },
      },
      kernel.hooks,
    );
    await harness.settle(turnRef);
    const usageEvents = kernel.events.filter((event) => event.kind === "usage");
    expect(usageEvents).toHaveLength(2);
    const settlement = kernel.usage.settleAll("terminal_total");
    expect(settlement.tokens).toEqual({ input: 40, output: 10, cachedInput: 0, reasoning: 0 });
    expect(settlement.streams.map((stream) => stream.mode)).toEqual(["cumulative", "cumulative"]);
    expect(settlement.streams.every((stream) => stream.conservative === false)).toBe(true);
    expect(new Set(settlement.streams.map((stream) => stream.providerInvocationRef)).size).toBe(2);
  });

  it("reports provider exceptions as typed failed turns without raw provider payloads", async () => {
    const harness = createConvexAgentContractHarness();
    const kernel = kernelFor(harness.adapter.descriptor.adapterVersion);
    harness.scriptTurn("turn-throw", [{ kind: "fail", code: "provider_failure", message: "model unavailable" }]);
    harness.failWithNativeError("turn-throw", { message: "401 Unauthorized: api key sk-live-123", statusCode: 401 });
    const thread = await harness.adapter.ensureThread({
      threadKey: "fail|thread",
      contextBindingRef: opaqueRef("context_binding", "ctx"),
      correlation: { operatorRef: "athenaUser:o", profileId: "p" },
    });
    const input = await harness.adapter.saveInput({
      threadRef: thread.threadRef,
      turnKey: "turn-throw",
      prompt: { text: "hi", egressClass: "operational", promptHash: "sha256:h", untrustedDataLabel: "retrieved_store_data" },
      history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: 1 },
    });
    const { turnRef } = await harness.adapter.startTurn(
      {
        threadRef: thread.threadRef,
        inputRef: input.inputRef,
        turnKey: "turn-throw",
        tools: [echoTool],
        model: { providerId: "fixture", modelId: "fixture-1", region: "eu" },
        limits: { maxToolCalls: 4, maxElapsedMs: 10_000 },
      },
      kernel.hooks,
    );
    await harness.settle(turnRef);
    const completed = kernel.events.at(-1);
    expect(completed).toMatchObject({ kind: "turn_completed", outcome: "failed", error: { code: "provider_failure" } });
    expect(JSON.stringify(completed)).not.toContain("sk-live-123");
  });

  it("treats the model as an injected input and refuses an unresolvable selection before any runtime write", async () => {
    const harness = createConvexAgentContractHarness();
    const kernel = kernelFor(harness.adapter.descriptor.adapterVersion);
    const thread = await harness.adapter.ensureThread({
      threadKey: "model|thread",
      contextBindingRef: opaqueRef("context_binding", "ctx"),
      correlation: { operatorRef: "athenaUser:o", profileId: "p" },
    });
    const input = await harness.adapter.saveInput({
      threadRef: thread.threadRef,
      turnKey: "turn-model",
      prompt: { text: "hi", egressClass: "operational", promptHash: "sha256:h", untrustedDataLabel: "retrieved_store_data" },
      history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: 1 },
    });
    await expect(
      harness.adapter.startTurn(
        {
          threadRef: thread.threadRef,
          inputRef: input.inputRef,
          turnKey: "turn-model",
          tools: [echoTool],
          model: { providerId: "unknown-provider", modelId: "x", region: "eu" },
          limits: { maxToolCalls: 4, maxElapsedMs: 10_000 },
        },
        kernel.hooks,
      ),
    ).rejects.toThrow(/model selection/i);
    expect(kernel.events).toEqual([]);
    expect(harness.resolvedModels()).toEqual([{ providerId: "unknown-provider", modelId: "x", region: "eu" }]);
  });

  it("answers resume for a turn it no longer holds as unknown instead of inventing state", async () => {
    const harness = createConvexAgentContractHarness();
    const kernel = kernelFor(harness.adapter.descriptor.adapterVersion);
    harness.scriptTurn("turn-durable", [{ kind: "complete", narrative: "ok" }]);
    const thread = await harness.adapter.ensureThread({
      threadKey: "durable|thread",
      contextBindingRef: opaqueRef("context_binding", "ctx"),
      correlation: { operatorRef: "athenaUser:o", profileId: "p" },
    });
    const input = await harness.adapter.saveInput({
      threadRef: thread.threadRef,
      turnKey: "turn-durable",
      prompt: { text: "hi", egressClass: "operational", promptHash: "sha256:h", untrustedDataLabel: "retrieved_store_data" },
      history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: 1 },
    });
    const { turnRef } = await harness.adapter.startTurn(
      {
        threadRef: thread.threadRef,
        inputRef: input.inputRef,
        turnKey: "turn-durable",
        tools: [echoTool],
        model: { providerId: "fixture", modelId: "fixture-1", region: "eu" },
        limits: { maxToolCalls: 4, maxElapsedMs: 10_000 },
      },
      kernel.hooks,
    );
    await harness.settle(turnRef);
    // A fresh adapter over the same component state (new action invocation).
    const fresh = harness.reopen();
    expect(await fresh.adapter.resumeTurn({ turnRef }, kernel.hooks)).toEqual({ resumed: false, state: "terminal" });
    const again = await fresh.adapter.ensureThread({
      threadKey: "durable|thread",
      contextBindingRef: opaqueRef("context_binding", "ctx"),
      correlation: { operatorRef: "athenaUser:o", profileId: "p" },
    });
    expect(again).toEqual({ threadRef: thread.threadRef, created: false });
    expect(await fresh.adapter.saveInput({
      threadRef: thread.threadRef,
      turnKey: "turn-durable",
      prompt: { text: "hi", egressClass: "operational", promptHash: "sha256:h", untrustedDataLabel: "retrieved_store_data" },
      history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: 1 },
    })).toEqual({ inputRef: input.inputRef });
    const projected = await fresh.adapter.projectCompletion({
      threadRef: thread.threadRef,
      turnRef,
      idempotencyKey: "project:durable",
      artifact: { artifactRef: "artifact:durable", narrative: "ok", egressClass: "operational", citations: [], committedAt: 5 },
    });
    expect(projected).toMatchObject({ kind: "projected", replayed: false });
    const replayed = await harness.reopen().adapter.projectCompletion({
      threadRef: thread.threadRef,
      turnRef,
      idempotencyKey: "project:durable",
      artifact: { artifactRef: "artifact:durable", narrative: "ok", egressClass: "operational", citations: [], committedAt: 5 },
    });
    expect(replayed).toMatchObject({ kind: "projected", replayed: true });
    const cleanup = await harness.reopen().adapter.cleanup({ threadRef: thread.threadRef, reason: "store_removed" });
    expect(cleanup.ok).toBe(true);
    expect(await harness.reopen().adapter.resumeTurn({ turnRef }, kernel.hooks)).toEqual({ resumed: false, state: "unknown" });
  });

  it("cleans up from a mutation-only context through the retention hook (async component deletion)", async () => {
    const harness = createConvexAgentContractHarness();
    const kernel = kernelFor(harness.adapter.descriptor.adapterVersion);
    harness.scriptTurn("turn-hook", [{ kind: "complete", narrative: "ok" }]);
    const thread = await harness.adapter.ensureThread({
      threadKey: "hook|thread",
      contextBindingRef: opaqueRef("context_binding", "ctx"),
      correlation: { operatorRef: "athenaUser:o", profileId: "p" },
    });
    const input = await harness.adapter.saveInput({
      threadRef: thread.threadRef,
      turnKey: "turn-hook",
      prompt: { text: "hi", egressClass: "operational", promptHash: "sha256:h", untrustedDataLabel: "retrieved_store_data" },
      history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: 1 },
    });
    const { turnRef } = await harness.adapter.startTurn(
      {
        threadRef: thread.threadRef,
        inputRef: input.inputRef,
        turnKey: "turn-hook",
        tools: [echoTool],
        model: { providerId: "fixture", modelId: "fixture-1", region: "eu" },
        limits: { maxToolCalls: 4, maxElapsedMs: 10_000 },
      },
      kernel.hooks,
    );
    await harness.settle(turnRef);
    const projected = await harness.adapter.projectCompletion({
      threadRef: thread.threadRef,
      turnRef,
      idempotencyKey: "project:hook",
      artifact: { artifactRef: "artifact:hook", narrative: "ok", egressClass: "operational", citations: [], committedAt: 5 },
    });
    expect(projected.kind).toBe("projected");

    // A mutation context has no runAction: the hook must still remove everything via the async path.
    const { runQuery, runMutation } = runtimeCtxFor(harness.t);
    const hook = createConvexAgentCleanupHook(AGENT_COMPONENT);
    vi.useFakeTimers();
    try {
      const outcome = await hook(
        { runQuery, runMutation },
        {
          runtimeThreadRef: thread.threadRef,
          runtimeInputRef: input.inputRef,
          runtimeProjectionRef: projected.kind === "projected" ? projected.projectionRef : undefined,
        },
      );
      expect(outcome).toEqual({ ok: true });
      await harness.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
    const threads = await harness.t.query(AGENT_COMPONENT.threads.listThreadsByUserId, {
      userId: `athena:thread:${thread.threadRef.replace("runtime_thread:", "")}`,
      paginationOpts: { cursor: null, numItems: 5 },
    });
    expect(threads.page).toHaveLength(0);
    // Idempotent: running the hook again over deleted refs still succeeds.
    expect(await hook({ runQuery, runMutation }, { runtimeThreadRef: thread.threadRef })).toEqual({ ok: true });
    expect(await harness.reopen().adapter.resumeTurn({ turnRef }, kernel.hooks)).toEqual({ resumed: false, state: "unknown" });
  });

  it("keeps the mutation-side modules free of runtime-native value imports", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const file of ["convexAgentRefs.ts", "convexAgentCleanup.ts"]) {
      const source = readFileSync(path.join(here, file), "utf8");
      expect(source.startsWith('"use node"'), file).toBe(false);
      const valueImports = [...source.matchAll(/^import\s+(?!type\s)[^;]*from\s+"([^"]+)"/gm)].map((match) => match[1]);
      expect(valueImports.filter((specifier) => /^(@convex-dev\/agent|ai|@ai-sdk\/)/.test(specifier)), file).toEqual([]);
    }
  });
});
