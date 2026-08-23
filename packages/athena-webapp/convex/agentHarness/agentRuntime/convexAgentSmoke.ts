"use node";
/**
 * Deployed-runtime smoke for the Convex Agent adapter: a Node 22 Convex action runs
 * a Convex Agent turn through `ConvexAgentRuntimeAdapter` and an Athena tool
 * through the QuickJS sandbox bridge. Internal only (never operator-visible);
 * invoked with `bunx convex run agentHarness/agentRuntime/convexAgentSmoke:run`.
 *
 * `model: "mock"` scripts the model with the AI SDK mock so the deployed path
 * is exercised without provider spend; `model: "openai"` uses the default
 * resolver and the deployment's credentials for a single cheap real turn.
 */
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { v } from "convex/values";

import {
  createAgentToolDispatchLedger,
  createUsageReconciler,
  type AgentRuntimeEvent,
  type AgentRuntimeTurnHooks,
  type AgentToolDefinition,
} from "../../../shared/agentHarness/agentRuntime";
import type { JsonValue } from "../../../shared/agentHarness/manifest";
import { opaqueRef } from "../../../shared/agentHarness/values";
import { components } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { createQuickJsProgramRuntime } from "../programRuntime/quickJsRuntime";
import { AGENT_PROGRAM_RUNTIME_CEILINGS, type AgentProgramHostBridge } from "../programRuntime/types";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { createConvexAgentRuntimeAdapter, toNativeToolName } from "./convexAgent";
import { summarizePersistedThread } from "./convexAgentRefs";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { CONVEX_AGENT_DEFAULT_MODEL_ID, resolveDefaultLanguageModel } from "./models";

type ProgramArgs = { readonly source: string };

const executeProgramTool: AgentToolDefinition<ProgramArgs, unknown> = {
  toolId: "athena.smoke.executeProgram",
  description:
    "Run a read-only TypeScript program against athena.* and return its single output. Arguments: { source: string } where source is the full program text (the user supplies it verbatim).",
  validateInput: (raw) => {
    const source = (raw as { source?: unknown } | null)?.source;
    if (typeof source !== "string" || source.length === 0) return { ok: false, issues: [{ path: "source", message: "source must be a non-empty string" }] };
    return { ok: true, args: { source } };
  },
};

const SMOKE_PROGRAM = `const [day, queue] = await Promise.all([
  athena.smoke.storeDay.get({ operatingDate: "2026-08-21" }),
  athena.smoke.queue.list({ limit: 3 }),
]);
return { open: day.open, queued: queue.items.length };`;

export const run = internalAction({
  args: {
    model: v.union(v.literal("mock"), v.literal("openai")),
    modelId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const bridge: AgentProgramHostBridge = {
      facade: [
        { package: "smoke", resource: "storeDay", verbs: ["get"] },
        { package: "smoke", resource: "queue", verbs: ["list"] },
      ],
      invoke: async (call): Promise<JsonValue> =>
        call.resource === "storeDay" ? { open: true, operatingDate: call.args } : { items: [{ ref: "source:q1" }, { ref: "source:q2" }] },
    };
    const programRuntime = await createQuickJsProgramRuntime();
    const programOutcomes: unknown[] = [];
    const ledger = createAgentToolDispatchLedger({
      adapterVersion: "smoke",
      tools: [
        {
          definition: executeProgramTool,
          handler: async (programArgs: ProgramArgs, context) => {
            const outcome = await programRuntime.execute({
              source: programArgs.source,
              bridge,
              ceilings: { ...AGENT_PROGRAM_RUNTIME_CEILINGS, maxElapsedMs: 10_000 },
              signal: context.signal,
            });
            programOutcomes.push(outcome);
            if (outcome.status === "completed") return { kind: "success", result: outcome.output };
            return { kind: "failure", error: { code: `program_${outcome.status}`, message: "Program did not complete.", retryable: false } };
          },
        },
      ],
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

    const mockModel = new MockLanguageModelV4({
      provider: "athena-smoke",
      modelId: "smoke-1",
      // The deployed path is the streaming path: the mock narrates before its
      // tool call and splits its closing sentence across two chunks, so the
      // smoke proves deltas reach the host and that the coalescer joins them.
      doStream: (() => {
        let call = 0;
        return async () => {
          call += 1;
          const usage = {
            inputTokens: { total: 40 * call, noCache: 40 * call, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 12, text: 12, reasoning: undefined },
          };
          const parts: LanguageModelV4StreamPart[] =
            call === 1
              ? [
                  { type: "stream-start", warnings: [] },
                  { type: "text-start", id: "smoke-preamble" },
                  { type: "text-delta", id: "smoke-preamble", delta: "Running the smoke program now." },
                  { type: "text-end", id: "smoke-preamble" },
                  {
                    type: "tool-call",
                    toolCallId: "smoke-call-1",
                    toolName: toNativeToolName(executeProgramTool.toolId),
                    input: JSON.stringify({ source: SMOKE_PROGRAM }),
                  },
                  { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
                ]
              : [
                  { type: "stream-start", warnings: [] },
                  { type: "text-start", id: "smoke-answer" },
                  { type: "text-delta", id: "smoke-answer", delta: "Smoke turn complete: " },
                  { type: "text-delta", id: "smoke-answer", delta: "the program returned its output." },
                  { type: "text-end", id: "smoke-answer" },
                  { type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } },
                ];
          return {
            stream: new ReadableStream<LanguageModelV4StreamPart>({
              start(controller) {
                for (const part of parts) controller.enqueue(part);
                controller.close();
              },
            }),
          };
        };
      })(),
    });

    const adapter = createConvexAgentRuntimeAdapter({
      ctx,
      component: components.agent,
      resolveModel: (selection) => (args.model === "mock" ? mockModel : resolveDefaultLanguageModel(selection)),
      maxRetries: 1,
    });
    const smokeKey = `smoke|${startedAt}`;
    const thread = await adapter.ensureThread({
      threadKey: smokeKey,
      contextBindingRef: opaqueRef("context_binding", "smoke"),
      correlation: { operatorRef: "athenaSystem:smoke", profileId: "smoke" },
    });
    const input = await adapter.saveInput({
      threadRef: thread.threadRef,
      turnKey: "smoke-turn",
      prompt: {
        text: `Call the executeProgram tool exactly once with the argument { "source": <program> } where <program> is exactly this text:\n\n${SMOKE_PROGRAM}\n\nThen answer in one short sentence with the values it returned.`,
        egressClass: "operational",
        promptHash: "sha256:smoke",
        untrustedDataLabel: "retrieved_store_data",
      },
      history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: startedAt },
    });
    const beforeTurn = Date.now();
    let firstProgressAt: number | undefined;
    let firstDeltaAt: number | undefined;
    const observingHooks: AgentRuntimeTurnHooks = {
      ...hooks,
      onEvent: (event) => {
        if (firstProgressAt === undefined && (event.kind === "tool_call_requested" || event.kind === "progress")) firstProgressAt = Date.now();
        if (firstDeltaAt === undefined && event.kind === "narrative_delta") firstDeltaAt = Date.now();
        return hooks.onEvent(event);
      },
    };
    const { turnRef } = await adapter.startTurn(
      {
        threadRef: thread.threadRef,
        inputRef: input.inputRef,
        turnKey: "smoke-turn",
        tools: [executeProgramTool],
        model: { providerId: "openai", modelId: args.modelId ?? CONVEX_AGENT_DEFAULT_MODEL_ID, region: "global" },
        limits: { maxToolCalls: 3, maxElapsedMs: 60_000 },
      },
      observingHooks,
    );
    await adapter.inspect.settled(turnRef);
    const completedAt = Date.now();
    const dispatch = adapter.inspect.dispatchResults(turnRef).map((result) => (result.kind === "outcome" ? result.outcome.kind : `protocol_violation:${result.code}`));
    // Allowlisted persistence inspection before cleanup: shapes and sizes only, never content.
    const persisted = await summarizePersistedThread(ctx, components.agent, thread.threadRef);
    const projection = await adapter.projectCompletion({
      threadRef: thread.threadRef,
      turnRef,
      idempotencyKey: `project:${smokeKey}`,
      artifact: { artifactRef: `artifact:${smokeKey}`, narrative: "Smoke artifact.", egressClass: "operational", citations: [], committedAt: completedAt },
    });
    const cleanup = await adapter.cleanup({ threadRef: thread.threadRef, reason: "smoke_complete" });
    const settlement = usage.settleAll("terminal_total");
    return {
      node: process.version,
      adapter: adapter.descriptor,
      programRuntime: { kind: programRuntime.kind, startupMs: programRuntime.startupMs },
      events: events.map((event) => event.kind),
      turnOutcome: events.find((event) => event.kind === "turn_completed"),
      dispatch,
      programOutcomes,
      projection,
      cleanup,
      persisted,
      usage: { tokens: settlement.tokens, streams: settlement.streams.length },
      timings: {
        firstDeltaMs: firstDeltaAt === undefined ? null : firstDeltaAt - beforeTurn,
        firstProgressMs: firstProgressAt === undefined ? null : firstProgressAt - beforeTurn,
        completionMs: completedAt - beforeTurn,
        totalMs: Date.now() - startedAt,
      },
    };
  },
});
