/**
 * Harness contract shared by the reusable `AgentRuntimeAdapter` suite and any
 * adapter under test (the deterministic fake in U2, the Convex Agent adapter in
 * U5). A harness wraps an adapter with a scripted model so the suite can drive
 * identical scenarios against every implementation. Type-only module.
 */
import type { AgentRuntimeAdapter, AgentToolDispatchResult, RuntimeTurnRef } from "./agentRuntime";

export type AgentRuntimeScriptArgs = unknown | (() => unknown | Promise<unknown>);

/** Resolve scripted args: a thunk is evaluated at call time, anything else is used as is. */
export async function resolveScriptArgs(args: AgentRuntimeScriptArgs): Promise<unknown> {
  return typeof args === "function" ? (args as () => unknown | Promise<unknown>)() : args;
}

export type AgentRuntimeScriptStep =
  | {
      readonly kind: "progress";
      readonly milestone: "checking_sources" | "reading_sources" | "composing_answer" | "finalizing";
    }
  | {
      readonly kind: "tool_call";
      readonly callId: string;
      readonly toolId: string;
      /** Static args, or a thunk resolved when the scripted model makes the call (U7 tests cite refs minted earlier in the turn). */
      readonly args: AgentRuntimeScriptArgs;
      readonly idempotencyKey?: string;
    }
  | {
      readonly kind: "tool_calls_parallel";
      readonly calls: readonly {
        readonly callId: string;
        readonly toolId: string;
        readonly args: AgentRuntimeScriptArgs;
        readonly idempotencyKey?: string;
      }[];
    }
  | {
      readonly kind: "usage";
      readonly providerInvocationRef: string;
      readonly retryIndex: number;
      readonly sequence: number;
      readonly eventKey: string;
      readonly mode: "delta" | "cumulative";
      readonly tokens: { readonly input?: number; readonly output?: number };
      readonly terminal: boolean;
    }
  | { readonly kind: "pause"; readonly gate: string }
  | { readonly kind: "complete"; readonly narrative: string }
  | { readonly kind: "fail"; readonly code: string; readonly message: string };

export type AgentRuntimeContractHarness = {
  readonly adapter: AgentRuntimeAdapter;
  /** Script what the model does on the turn bound to `turnKey`. */
  readonly scriptTurn: (turnKey: string, steps: readonly AgentRuntimeScriptStep[]) => void;
  /** Release a `pause` gate so the scripted turn continues. */
  readonly release: (gate: string) => void;
  /** Resolve once the turn reached a terminal `turn_completed` event. */
  readonly settle: (turnRef: RuntimeTurnRef) => Promise<void>;
  /** Dispatch results the adapter observed, in the order it received them. */
  readonly dispatchResults: (turnRef: RuntimeTurnRef) => readonly AgentToolDispatchResult[];
};
