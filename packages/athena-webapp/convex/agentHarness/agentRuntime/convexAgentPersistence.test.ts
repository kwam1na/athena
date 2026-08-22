// @vitest-environment node
/**
 * Actual Convex Agent component persistence and provider requests across
 * success, retry, cancellation, and failure, inspected
 * through the registered component under convex-test.
 *
 * Allowlist: the operator prompt text, summaries (committed artifact
 * narratives), opaque bindings, and hashes. Never tool calls, tool results,
 * or intermediate capability bodies. The provider must receive only the
 * Athena-projected history and prompt, never the component's stored history.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createAgentToolDispatchLedger,
  type AgentRuntimeEvent,
  type AgentRuntimeTurnHooks,
  type AgentToolDefinition,
  type AgentToolRegistration,
} from "../../../shared/agentHarness/agentRuntime";
import { scanForRawIdentifiers } from "../../../shared/agentHarness/results";
import { opaqueRef } from "../../../shared/agentHarness/values";
import { AGENT_COMPONENT, createConvexAgentContractHarness, type ConvexAgentContractHarness } from "./convexAgent.contractHarness";
import { CONVEX_AGENT_PERSISTED_METADATA_KINDS, CONVEX_AGENT_PINNED_VERSIONS, athenaMetadataOf } from "./convexAgent";

const SECRET_ROW = "SECRET-ROW-VALUE-7731";
const RAW_REPLAY_CANARY = "RAW-REPLAY-CANARY-0042";

const readTool: AgentToolDefinition<{ readonly ref: string }, { rows: string[] }> = {
  toolId: "athena.test.read",
  description: "Read rows for a source ref (test tool).",
  validateInput: (raw) => {
    const ref = (raw as { ref?: unknown } | null)?.ref;
    if (typeof ref !== "string") return { ok: false, issues: [{ path: "ref", message: "ref must be a string" }] };
    return { ok: true, args: { ref } };
  },
};

function kernel(adapterVersion: string) {
  const events: AgentRuntimeEvent[] = [];
  const handlerCalls: string[] = [];
  const readRegistration: AgentToolRegistration<{ readonly ref: string }, { rows: string[] }> = {
    definition: readTool,
    handler: async (args, context) => {
      handlerCalls.push(context.callId);
      return { kind: "success", result: { rows: [`${SECRET_ROW}:${args.ref}`] } };
    },
  };
  const ledger = createAgentToolDispatchLedger({ adapterVersion, tools: [readRegistration] });
  const hooks: AgentRuntimeTurnHooks = {
    onEvent: (event) => {
      events.push(event);
      if (event.kind === "turn_started" || event.kind === "turn_resumed") ledger.beginTurn(event.turnRef);
      if (event.kind === "turn_completed") ledger.terminalizeTurn(event.turnRef, `turn_${event.outcome}`);
    },
    dispatchTool: (request) => ledger.dispatch(request),
  };
  return { events, handlerCalls, ledger, hooks };
}

async function openTurn(harness: ConvexAgentContractHarness, hooks: AgentRuntimeTurnHooks, turnKey: string, threadKey = "persist|thread") {
  const thread = await harness.adapter.ensureThread({
    threadKey,
    contextBindingRef: opaqueRef("context_binding", "ctx-persist"),
    correlation: { operatorRef: "athenaUser:operator-9", profileId: "daily_operations" },
  });
  const input = await harness.adapter.saveInput({
    threadRef: thread.threadRef,
    turnKey,
    prompt: {
      text: "What needs attention today?",
      egressClass: "operational",
      promptHash: "sha256:prompt-9",
      untrustedDataLabel: "retrieved_store_data",
    },
    history: {
      messages: [
        { role: "operator", content: "Earlier question", egressClass: "operational" },
        { role: "assistant", content: "Earlier committed answer", egressClass: "operational", artifactRef: "artifact:earlier" },
      ],
      projectionDigest: "sha256:projection-9",
      reauthorizedAt: 1,
    },
  });
  const { turnRef } = await harness.adapter.startTurn(
    {
      threadRef: thread.threadRef,
      inputRef: input.inputRef,
      turnKey,
      tools: [readTool],
      model: { providerId: "fixture", modelId: "fixture-1", region: "eu" },
      limits: { maxToolCalls: 8, maxElapsedMs: 60_000 },
    },
    hooks,
  );
  return { thread, input, turnRef };
}

type StoredMessage = {
  _id: string;
  id?: string;
  status: string;
  text?: string;
  tool?: boolean;
  message?: { role: string; content: unknown };
  providerMetadata?: Record<string, Record<string, unknown>>;
};

async function storedMessages(harness: ConvexAgentContractHarness, threadKey = "persist|thread"): Promise<StoredMessage[]> {
  const threads = await harness.t.query(AGENT_COMPONENT.threads.listThreadsByUserId, {
    userId: `athena:thread:${(await harness.adapter.ensureThread({
      threadKey,
      contextBindingRef: opaqueRef("context_binding", "ctx-persist"),
      correlation: { operatorRef: "athenaUser:operator-9", profileId: "daily_operations" },
    })).threadRef.replace("runtime_thread:", "")}`,
    paginationOpts: { cursor: null, numItems: 5 },
  });
  expect(threads.page).toHaveLength(1);
  const page = await harness.t.query(AGENT_COMPONENT.messages.listMessagesByThreadId, {
    threadId: threads.page[0]._id,
    order: "asc",
    statuses: ["pending", "success", "failed"],
    paginationOpts: { cursor: null, numItems: 100 },
  });
  return page.page as unknown as StoredMessage[];
}

describe("Convex Agent component persistence", () => {
  it("persists only allowlisted content across success, retry, cancellation, and failure", async () => {
    const harness = createConvexAgentContractHarness();
    const k = kernel(harness.adapter.descriptor.adapterVersion);

    // Success with a tool call whose result carries a sensitive row.
    harness.scriptTurn("t-success", [
      { kind: "tool_call", callId: "c-read", toolId: "athena.test.read", args: { ref: "source:a" } },
      { kind: "complete", narrative: `Two registers need attention. ${SECRET_ROW}` },
    ]);
    const success = await openTurn(harness, k.hooks, "t-success");
    await harness.settle(success.turnRef);

    // Retry: a second attempt on the same input (new turn, same inputRef) that fails.
    harness.scriptTurn("t-success", [{ kind: "fail", code: "provider_failure", message: "model unavailable" }]);
    const retry = await harness.adapter.startTurn(
      {
        threadRef: success.thread.threadRef,
        inputRef: success.input.inputRef,
        turnKey: "t-success",
        tools: [readTool],
        model: { providerId: "fixture", modelId: "fixture-1", region: "eu" },
        limits: { maxToolCalls: 8, maxElapsedMs: 60_000 },
      },
      k.hooks,
    );
    await harness.settle(retry.turnRef);

    // Cancellation mid-turn.
    harness.scriptTurn("t-cancel", [
      { kind: "pause", gate: "never" },
      { kind: "complete", narrative: "unreachable" },
    ]);
    const canceled = await openTurn(harness, k.hooks, "t-cancel");
    expect(await harness.adapter.cancelTurn({ turnRef: canceled.turnRef, reason: "operator_cancel" })).toEqual({ accepted: true });
    await harness.settle(canceled.turnRef);

    // Projection of a committed artifact for the successful turn only.
    const projection = await harness.adapter.projectCompletion({
      threadRef: success.thread.threadRef,
      turnRef: success.turnRef,
      idempotencyKey: "project:t-success",
      artifact: {
        artifactRef: "artifact:t-success",
        narrative: "Two registers need attention.",
        egressClass: "operational",
        citations: [{ citationKey: "c1", label: "Store day" }],
        committedAt: 10,
      },
    });
    expect(projection).toMatchObject({ kind: "projected", replayed: false });

    const messages = await storedMessages(harness);
    const kinds = messages.map((message) => athenaMetadataOf(message)?.kind);
    // One input per turn key, one turn record per attempt, one projection.
    expect(kinds.filter((kind) => kind === "input")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "turn")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "projection")).toHaveLength(1);
    expect(messages.every((message) => CONVEX_AGENT_PERSISTED_METADATA_KINDS.includes(athenaMetadataOf(message)?.kind as never))).toBe(true);

    // No tool messages, tool calls, or tool results anywhere in the component.
    expect(messages.some((message) => message.tool === true)).toBe(false);
    expect(messages.some((message) => message.message?.role === "tool")).toBe(false);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain(SECRET_ROW);
    expect(serialized).not.toContain("tool-call");
    expect(serialized).not.toContain("tool-result");
    expect(serialized).not.toContain("source:a");
    expect(serialized).not.toContain("model unavailable");

    // Inputs carry the prompt text plus hashes and opaque refs only; turn records are empty until projected.
    const inputs = messages.filter((message) => athenaMetadataOf(message)?.kind === "input");
    for (const input of inputs) {
      expect(input.text).toBe("What needs attention today?");
      expect(athenaMetadataOf(input)).toMatchObject({ promptHash: "sha256:prompt-9", projectionDigest: "sha256:projection-9", egressClass: "operational" });
      expect(JSON.stringify(input)).not.toContain("Earlier committed answer");
    }
    const turns = messages.filter((message) => athenaMetadataOf(message)?.kind === "turn");
    expect(turns.map((turn) => turn.status).sort()).toEqual(["failed", "failed", "success"]);
    for (const turn of turns) expect(turn.text ?? "").toBe("");
    const projected = messages.find((message) => athenaMetadataOf(message)?.kind === "projection");
    expect(projected?.text).toBe("Two registers need attention.");
    expect(projected && athenaMetadataOf(projected)).toMatchObject({ artifactRef: "artifact:t-success", citations: [{ citationKey: "c1", label: "Store day" }] });

    // Opaque bindings only: nothing Athena wrote looks like a raw document id.
    for (const message of messages) expect(scanForRawIdentifiers(athenaMetadataOf(message) ?? {})).toEqual([]);

    // No streaming deltas were persisted.
    const streams = await harness.t.query(AGENT_COMPONENT.streams.list, { threadId: threads0(messages) });
    expect(streams).toEqual([]);
    expect(k.handlerCalls).toEqual(["c-read"]);
  });

  it("sends the provider only Athena-projected history and prompt, never the component's stored messages", async () => {
    const harness = createConvexAgentContractHarness();
    const k = kernel(harness.adapter.descriptor.adapterVersion);
    // Seed a raw message directly into the runtime thread before the turn.
    const thread = await harness.adapter.ensureThread({
      threadKey: "persist|thread",
      contextBindingRef: opaqueRef("context_binding", "ctx-persist"),
      correlation: { operatorRef: "athenaUser:operator-9", profileId: "daily_operations" },
    });
    const threads = await harness.t.query(AGENT_COMPONENT.threads.listThreadsByUserId, {
      userId: `athena:thread:${thread.threadRef.replace("runtime_thread:", "")}`,
      paginationOpts: { cursor: null, numItems: 1 },
    });
    await harness.t.mutation(AGENT_COMPONENT.messages.addMessages, {
      threadId: threads.page[0]._id,
      messages: [{ message: { role: "user", content: RAW_REPLAY_CANARY } }],
    });

    harness.scriptTurn("t-provider", [
      { kind: "tool_call", callId: "c-read", toolId: "athena.test.read", args: { ref: "source:b" } },
      { kind: "complete", narrative: "done" },
    ]);
    const { turnRef } = await openTurn(harness, k.hooks, "t-provider");
    await harness.settle(turnRef);

    const calls = harness.modelCalls("t-provider");
    expect(calls).toHaveLength(2);
    const first = calls[0];
    const roles = first.prompt.map((message) => message.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    const text = JSON.stringify(first.prompt);
    expect(text).toContain("Earlier question");
    expect(text).toContain("Earlier committed answer");
    expect(text).toContain("What needs attention today?");
    expect(text).not.toContain(RAW_REPLAY_CANARY);
    expect(text).not.toContain("source:a");
    // Tools reach the provider as native names with Athena descriptions only.
    expect(first.tools?.map((candidate) => candidate.name)).toEqual(["athena__test__read"]);
    // The second call carries the tool result the kernel produced (the model must see data), and still no raw replay.
    const second = JSON.stringify(calls[1].prompt);
    expect(second).toContain(SECRET_ROW);
    expect(second).not.toContain(RAW_REPLAY_CANARY);
    // The stored history after the turn still holds nothing from the tool exchange.
    const stored = JSON.stringify(await storedMessages(harness));
    expect(stored).not.toContain(SECRET_ROW);
  });

  it("fails the contract the moment the pinned runtime packages change without an upgrade record", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, "../../../../..");
    const installed = (name: string) =>
      (JSON.parse(readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;
    expect(installed("@convex-dev/agent")).toBe(CONVEX_AGENT_PINNED_VERSIONS["@convex-dev/agent"]);
    expect(installed("ai")).toBe(CONVEX_AGENT_PINNED_VERSIONS.ai);
    expect(installed("@ai-sdk/openai")).toBe(CONVEX_AGENT_PINNED_VERSIONS["@ai-sdk/openai"]);
    const manifest = JSON.parse(readFileSync(path.resolve(here, "../../../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    for (const [name, version] of Object.entries(CONVEX_AGENT_PINNED_VERSIONS)) {
      expect(manifest.dependencies[name], `${name} must stay exact-pinned`).toBe(version);
    }
    const doc = readFileSync(path.resolve(here, "../../../docs/agent/agent-harness-runtime.md"), "utf8");
    expect(doc).toContain(CONVEX_AGENT_PINNED_VERSIONS["@convex-dev/agent"]);
    expect(doc).toMatch(/rollback/i);
  });
});

function threads0(messages: StoredMessage[]): string {
  const first = messages[0] as StoredMessage & { threadId?: string };
  return first.threadId ?? "";
}
