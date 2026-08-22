/**
 * Test harness that drives the real Convex Agent adapter over a convex-test
 * backend with the Agent component registered and a scripted AI SDK mock
 * model, so U2's reusable contract suite runs unchanged against it.
 *
 * Adapter-specific test support (may name native types); not a test file.
 */
import type { LanguageModelV4, LanguageModelV4Content, LanguageModelV4Usage } from "@ai-sdk/provider";
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

export type ConvexAgentContractHarness = AgentRuntimeContractHarness & {
  readonly adapter: ConvexAgentRuntimeAdapter;
  readonly t: TestConvex<typeof schema>;
  /** Usage the scripted model reports per model call (consumed in order). */
  readonly modelUsage: (turnKey: string, usages: readonly NativeUsageInput[]) => void;
  /** Make the scripted `fail` step throw a provider-shaped error instead of an Athena-coded one. */
  readonly failWithNativeError: (turnKey: string, failure: NativeFailure) => void;
  readonly resolvedModels: () => readonly AgentModelSelection[];
  /** Every model call the scripted models received, for provider-request inspection. */
  readonly modelCalls: (turnKey: string) => readonly MockLanguageModelV4["doGenerateCalls"][number][];
  /** A fresh adapter over the same backend, as a new action invocation would construct. */
  readonly reopen: () => { readonly adapter: ConvexAgentRuntimeAdapter };
};

export type ConvexAgentContractHarnessOptions = {
  readonly clock?: () => number;
  /** Provider id the scripted model answers for (default `fixture`); U7 host tests select the profile's fake provider. */
  readonly providerId?: string;
  /** Share a backend with the caller (U7 host parity tests) instead of creating a fresh one. */
  readonly backend?: TestConvex<typeof schema>;
};

export function createConvexAgentContractHarness(options: ConvexAgentContractHarnessOptions = {}): ConvexAgentContractHarness {
  const t = options.backend ?? createConvexTestBackend();
  const ctx = runtimeCtxFor(t);
  const scripts = new Map<string, readonly AgentRuntimeScriptStep[]>();
  const cursors = new Map<string, number>();
  const usageQueues = new Map<string, NativeUsageInput[]>();
  const nativeFailures = new Map<string, NativeFailure>();
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

  const toolCallPart = async (call: { callId: string; toolId: string; args: AgentRuntimeScriptArgs }): Promise<LanguageModelV4Content> => ({
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
      doGenerate: async () => {
        const steps = scripts.get(turnKey) ?? [];
        const turnRef = turnRefsByKey.get(turnKey);
        const usage = nativeUsage(usageQueues.get(turnKey)?.shift());
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
            case "pause":
              await waitGate(step.gate);
              break;
            case "tool_call":
              rememberKey(turnKey, step.callId, step.idempotencyKey);
              return { content: [await toolCallPart(step)], finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] };
            case "tool_calls_parallel":
              for (const call of step.calls) rememberKey(turnKey, call.callId, call.idempotencyKey);
              return { content: await Promise.all(step.calls.map(toolCallPart)), finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage, warnings: [] };
            case "complete":
              return { content: [{ type: "text", text: step.narrative }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
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
    dispatchResults: (turnRef) => adapter.inspect.dispatchResults(turnRef),
    modelUsage: (turnKey, usages) => usageQueues.set(turnKey, [...usages]),
    failWithNativeError: (turnKey, failure) => nativeFailures.set(turnKey, failure),
    resolvedModels: () => [...resolved],
    modelCalls: (turnKey) => [...(models.get(turnKey)?.doGenerateCalls ?? [])],
    reopen: () => ({ adapter: buildAdapter() }),
  };
}
