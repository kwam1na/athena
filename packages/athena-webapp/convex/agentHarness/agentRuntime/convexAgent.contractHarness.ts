/**
 * Test harness that drives the real Convex Agent adapter over a convex-test
 * backend with the Agent component registered and a scripted AI SDK mock
 * model, so the shared runtime-adapter contract suite runs unchanged against it.
 *
 * Adapter-specific test support (may name native types); not a test file.
 */
import type { LanguageModelV4, LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import type { AgentComponent } from "@convex-dev/agent";
import { MockLanguageModelV4 } from "ai/test";
import { convexTest, type TestConvex } from "convex-test";

import { resolveScriptArgs, type AgentRuntimeContractHarness, type AgentRuntimeScriptArgs, type AgentRuntimeScriptStep } from "../../../shared/agentHarness/agentRuntimeHarness";
import type { AgentModelSelection, RuntimeTurnRef } from "../../../shared/agentHarness/agentRuntime";
import { components } from "../../_generated/api";
import schema from "../../schema";
import agentComponentSchema from "../../../../../node_modules/@convex-dev/agent/dist/component/schema.js";
import {
  createConvexAgentRuntimeAdapter,
  fromNativeToolName,
  toNativeToolName,
  type ConvexAgentRuntimeAdapter,
  type ConvexAgentRuntimeCtx,
} from "./convexAgent";

/**
 * Vite rewrites glob keys for files inside this directory to `./name.ts`; convex-test
 * resolves modules as `<root> + <function path>`, so every key is normalised to the
 * convex root (`../../`) first.
 */
const CONVEX_ROOT_URL = new URL("../../", import.meta.url);
function normaliseModuleKeys(modules: Record<string, () => Promise<unknown>>): Record<string, () => Promise<unknown>> {
  return Object.fromEntries(
    Object.entries(modules).map(([key, loader]) => {
      const absolute = new URL(key, import.meta.url).pathname;
      const relative = absolute.startsWith(CONVEX_ROOT_URL.pathname) ? `../../${absolute.slice(CONVEX_ROOT_URL.pathname.length)}` : key;
      return [relative, loader];
    }),
  );
}

const appModules = normaliseModuleKeys(import.meta.glob("../../**/*.*s"));
const agentComponentModules = import.meta.glob("../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js");

export const AGENT_COMPONENT: AgentComponent = components.agent;

export function createConvexTestBackend(extraModules: Record<string, () => Promise<unknown>> = {}): TestConvex<typeof schema> {
  const t = convexTest(schema, { ...appModules, ...extraModules });
  registerAgentComponent(t);
  return t;
}

/** Register the mounted Agent component on a backend the caller built (keeps runtime-native paths inside this directory). */
export function registerAgentComponent(t: TestConvex<typeof schema>): TestConvex<typeof schema> {
  t.registerComponent("agent", agentComponentSchema, agentComponentModules);
  return t;
}

export function runtimeCtxFor(t: TestConvex<typeof schema>): ConvexAgentRuntimeCtx {
  type AnyCall = (reference: unknown, args: unknown) => Promise<unknown>;
  const query = t.query as unknown as AnyCall;
  const mutation = t.mutation as unknown as AnyCall;
  const action = t.action as unknown as AnyCall;
  return {
    runQuery: ((reference: unknown, args: unknown) => query(reference, args)) as unknown as ConvexAgentRuntimeCtx["runQuery"],
    runMutation: ((reference: unknown, args: unknown) => mutation(reference, args)) as unknown as ConvexAgentRuntimeCtx["runMutation"],
    runAction: ((reference: unknown, args: unknown) => action(reference, args)) as unknown as ConvexAgentRuntimeCtx["runAction"],
  };
}

type NativeUsageInput = { readonly inputTokens?: number; readonly outputTokens?: number };

function nativeUsage(tokens: NativeUsageInput = {}): LanguageModelV4Usage {
  return {
    inputTokens: { total: tokens.inputTokens, noCache: tokens.inputTokens, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: tokens.outputTokens, text: tokens.outputTokens, reasoning: undefined },
  };
}

class ScriptedModelError extends Error {
  readonly athenaCode: string;
  constructor(athenaCode: string, message: string) {
    super(message);
    this.athenaCode = athenaCode;
  }
}

type NativeFailure = { readonly message: string; readonly statusCode?: number };

/** Turn an ordered part list into the `ReadableStream` a provider's `doStream` returns. */
function streamOf(parts: readonly LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/**
 * One provider text block per scripted delta: the block end is a hard flush
 * boundary for the adapter's coalescer, so the scripted deltas map one to one
 * onto `narrative_delta` events no matter how the coalescer is tuned. Streams
 * built from `scriptRawStream` exercise the coalescer itself.
 */
function textBlock(id: string, text: string): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, delta: text },
    { type: "text-end", id },
  ];
}

export type ConvexAgentContractHarness = AgentRuntimeContractHarness & {
  readonly adapter: ConvexAgentRuntimeAdapter;
  readonly t: TestConvex<typeof schema>;
  /** Usage the scripted model reports per model call (consumed in order). */
  readonly modelUsage: (turnKey: string, usages: readonly NativeUsageInput[]) => void;
  /** Make the scripted `fail` step throw a provider-shaped error instead of an Athena-coded one. */
  readonly failWithNativeError: (turnKey: string, failure: NativeFailure) => void;
  readonly resolvedModels: () => readonly AgentModelSelection[];
  /**
   * Queue verbatim provider stream parts for the next model call(s) on this
   * turn, bypassing the step script. The harness only prepends `stream-start`;
   * the caller owns every content and control part (including `finish`), so
   * part-level scenarios — reasoning and tool-input noise, token-sized text
   * chunks, a mid-stream `error` part, an empty stream — stay explicit.
   */
  readonly scriptRawStream: (turnKey: string, parts: readonly LanguageModelV4StreamPart[]) => void;
  /** Every model call the scripted models received, for provider-request inspection. */
  readonly modelCalls: (turnKey: string) => readonly MockLanguageModelV4["doStreamCalls"][number][];
  /** A fresh adapter over the same backend, as a new action invocation would construct. */
  readonly reopen: () => { readonly adapter: ConvexAgentRuntimeAdapter };
};

export type ConvexAgentContractHarnessOptions = {
  readonly clock?: () => number;
  /** Provider id the scripted model answers for (default `fixture`); runtime host tests select the profile's fake provider. */
  readonly providerId?: string;
  /** Share a backend with the caller (runtime host parity tests) instead of creating a fresh one. */
  readonly backend?: TestConvex<typeof schema>;
};

export function createConvexAgentContractHarness(options: ConvexAgentContractHarnessOptions = {}): ConvexAgentContractHarness {
  const t = options.backend ?? createConvexTestBackend();
  const ctx = runtimeCtxFor(t);
  const scripts = new Map<string, readonly AgentRuntimeScriptStep[]>();
  const cursors = new Map<string, number>();
  const usageQueues = new Map<string, NativeUsageInput[]>();
  const nativeFailures = new Map<string, NativeFailure>();
  const rawStreams = new Map<string, LanguageModelV4StreamPart[][]>();
  const idempotencyKeys = new Map<string, Map<string, string>>();
  const models = new Map<string, MockLanguageModelV4>();
  const resolved: AgentModelSelection[] = [];
  const turnRefsByKey = new Map<string, RuntimeTurnRef>();
  const gateWaiters = new Map<string, Array<() => void>>();
  const releasedGates = new Set<string>();

  const waitGate = (gate: string) =>
    releasedGates.has(gate)
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const list = gateWaiters.get(gate) ?? [];
          list.push(resolve);
          gateWaiters.set(gate, list);
        });

  const rememberKey = (turnKey: string, callId: string, key: string | undefined) => {
    if (!key) return;
    const map = idempotencyKeys.get(turnKey) ?? new Map<string, string>();
    map.set(callId, key);
    idempotencyKeys.set(turnKey, map);
  };

  const toolCallPart = async (call: { callId: string; toolId: string; args: AgentRuntimeScriptArgs }): Promise<LanguageModelV4StreamPart> => ({
    type: "tool-call",
    toolCallId: call.callId,
    toolName: toNativeToolName(call.toolId),
    input: JSON.stringify((await resolveScriptArgs(call.args)) ?? {}),
  });

  let adapter!: ConvexAgentRuntimeAdapter;

  const scriptedModel = (turnKey: string): MockLanguageModelV4 => {
    const existing = models.get(turnKey);
    if (existing) return existing;
    const model = new MockLanguageModelV4({
      provider: "athena-scripted",
      modelId: `scripted:${turnKey}`,
      doStream: async () => {
        const queuedRaw = rawStreams.get(turnKey)?.shift();
        if (queuedRaw) return { stream: streamOf([{ type: "stream-start", warnings: [] }, ...queuedRaw]) };
        const steps = scripts.get(turnKey) ?? [];
        const turnRef = turnRefsByKey.get(turnKey);
        const usage = nativeUsage(usageQueues.get(turnKey)?.shift());
        const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
        let narrated = false;
        let blocks = 0;
        while (true) {
          const index = cursors.get(turnKey) ?? 0;
          const step = steps[index];
          cursors.set(turnKey, index + 1);
          if (!step) throw new ScriptedModelError("script_ended_without_completion", "The scripted model never completed the turn.");
          switch (step.kind) {
            case "progress":
              if (turnRef) await adapter.reportProgress(turnRef, step.milestone);
              break;
            case "usage":
              if (turnRef) {
                await adapter.ingestNativeUsage(turnRef, {
                  inputTokens: step.tokens.input,
                  inputTokenDetails: { noCacheTokens: step.tokens.input, cacheReadTokens: undefined, cacheWriteTokens: undefined },
                  outputTokens: step.tokens.output,
                  outputTokenDetails: { textTokens: step.tokens.output, reasoningTokens: undefined },
                  totalTokens: (step.tokens.input ?? 0) + (step.tokens.output ?? 0),
                }, {
                  providerInvocationRef: step.providerInvocationRef,
                  retryIndex: step.retryIndex,
                  sequence: step.sequence,
                  eventKey: step.eventKey,
                  mode: step.mode,
                  terminal: step.terminal,
                });
              }
              break;
            case "narrative":
              for (const text of step.deltas) parts.push(...textBlock(`${turnKey}:text:${blocks++}`, text));
              narrated = true;
              break;
            case "pause":
              await waitGate(step.gate);
              break;
            case "tool_call":
              rememberKey(turnKey, step.callId, step.idempotencyKey);
              parts.push(await toolCallPart(step), { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_calls" } });
              return { stream: streamOf(parts) };
            case "tool_calls_parallel":
              for (const call of step.calls) rememberKey(turnKey, call.callId, call.idempotencyKey);
              parts.push(...(await Promise.all(step.calls.map(toolCallPart))), { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_calls" } });
              return { stream: streamOf(parts) };
            case "complete":
              // A model call that narrated has already produced its text; the
              // narration *is* the model's final prose. `complete.narrative`
              // supplies the text only for scripts that never narrate.
              if (!narrated) parts.push(...textBlock(`${turnKey}:text:${blocks++}`, step.narrative));
              parts.push({ type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } });
              return { stream: streamOf(parts) };
            case "fail": {
              const native = nativeFailures.get(turnKey);
              if (native) {
                throw Object.assign(new Error(native.message), { name: "APICallError", statusCode: native.statusCode });
              }
              throw new ScriptedModelError(step.code, step.message);
            }
          }
        }
      },
    });
    models.set(turnKey, model);
    return model;
  };

  const buildAdapter = () =>
    createConvexAgentRuntimeAdapter({
      ctx,
      component: AGENT_COMPONENT,
      clock: options.clock,
      resolveModel: (selection, context) => {
        resolved.push(selection);
        if (selection.providerId !== (options.providerId ?? "fixture")) throw new Error(`no model for provider ${selection.providerId}`);
        turnRefsByKey.set(context.turnKey, context.turnRef);
        return scriptedModel(context.turnKey) as unknown as LanguageModelV4;
      },
      idempotencyKeyFor: ({ turnRef, turnKey, callId }) => idempotencyKeys.get(turnKey)?.get(callId) ?? `${turnRef}:${callId}`,
    });

  adapter = buildAdapter();

  return {
    adapter,
    t,
    supportsNarrativeStreaming: true,
    scriptTurn: (turnKey, steps) => {
      scripts.set(turnKey, steps);
      cursors.set(turnKey, 0);
    },
    release: (gate) => {
      releasedGates.add(gate);
      for (const resolve of gateWaiters.get(gate) ?? []) resolve();
      gateWaiters.delete(gate);
    },
    settle: (turnRef) => adapter.inspect.settled(turnRef),
    supportsPreExecutedExchange: true,
    observedPreExecutedExchange: (turnRef) => {
      // Observed from the provider request itself: the synthetic pair must be
      // present in the messages the scripted model actually received.
      const turnKey = [...turnRefsByKey.entries()].find(([, ref]) => ref === turnRef)?.[0];
      if (!turnKey) return undefined;
      for (const call of models.get(turnKey)?.doStreamCalls ?? []) {
        const prompt = (call as { prompt?: unknown }).prompt;
        if (!Array.isArray(prompt)) continue;
        let found: { toolCallId: string; toolName: string; args: unknown } | undefined;
        let result: unknown;
        for (const message of prompt as { role?: string; content?: unknown }[]) {
          if (!Array.isArray(message.content)) continue;
          for (const part of message.content as Record<string, unknown>[]) {
            if (message.role === "assistant" && part.type === "tool-call" && String(part.toolCallId ?? "").startsWith("preexec-")) {
              found = { toolCallId: String(part.toolCallId), toolName: String(part.toolName), args: part.input ?? part.args };
            }
            if (message.role === "tool" && part.type === "tool-result" && found && part.toolCallId === found.toolCallId) {
              const output = part.output as { value?: unknown } | undefined;
              result = output && typeof output === "object" && "value" in output ? output.value : part.result;
            }
          }
        }
        if (found && result !== undefined) {
          return {
            toolId: fromNativeToolName(found.toolName),
            exchangeKey: found.toolCallId.replace(/^preexec-/, ""),
            args: found.args as never,
            result: result as never,
          };
        }
      }
      return undefined;
    },
    dispatchResults: (turnRef) => adapter.inspect.dispatchResults(turnRef),
    modelUsage: (turnKey, usages) => usageQueues.set(turnKey, [...usages]),
    failWithNativeError: (turnKey, failure) => nativeFailures.set(turnKey, failure),
    scriptRawStream: (turnKey, parts) => {
      const queue = rawStreams.get(turnKey) ?? [];
      queue.push([...parts]);
      rawStreams.set(turnKey, queue);
    },
    resolvedModels: () => [...resolved],
    modelCalls: (turnKey) => [...(models.get(turnKey)?.doStreamCalls ?? [])],
    reopen: () => ({ adapter: buildAdapter() }),
  };
}
