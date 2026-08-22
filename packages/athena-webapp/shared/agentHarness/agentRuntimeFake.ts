/**
 * Deterministic contract fake for `AgentRuntimeAdapter`.
 *
 * It implements the Athena runtime contract with a scripted "model": tests
 * describe what the model does on a turn (progress, tool calls, usage,
 * pauses, completion, failure) and the fake drives the kernel through the
 * same hooks a real adapter would. No `Date.now`, no `Math.random`, no
 * timers: references come from counters, timestamps from an injected clock,
 * and ordering from the script plus microtask scheduling, so U6/U7 tests can
 * assert exact event streams. It is not a production runtime.
 */
import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  type AgentProjectedHistory,
  type AgentProjectedPrompt,
  type AgentRuntimeAdapter,
  type AgentRuntimeEvent,
  type AgentRuntimeEventPayload,
  type AgentRuntimeTurnHooks,
  type AgentToolDispatchResult,
  type AgentUsageEvent,
  type RuntimeInputRef,
  type RuntimeProjectionRef,
  type RuntimeThreadRef,
  type RuntimeTurnRef,
} from "./agentRuntime";
import { resolveScriptArgs, type AgentRuntimeContractHarness, type AgentRuntimeScriptArgs, type AgentRuntimeScriptStep } from "./agentRuntimeHarness";
import { opaqueRef, type Timestamp } from "./values";

export type AgentDeterministicClock = {
  readonly now: () => Timestamp;
  readonly advance: (ms: number) => void;
};

/** Monotonic clock: every `now()` call advances one millisecond. */
export function createDeterministicClock(start: Timestamp): AgentDeterministicClock {
  let current = start;
  return {
    now: () => {
      const value = current;
      current += 1;
      return value;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

export const AGENT_CONTRACT_FAKE_ADAPTER_KIND = "athena_contract_fake";

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type ThreadState = { threadRef: RuntimeThreadRef; threadKey: string; inputs: Map<string, RuntimeInputRef> };
type InputState = {
  inputRef: RuntimeInputRef;
  threadRef: RuntimeThreadRef;
  turnKey: string;
  prompt: AgentProjectedPrompt;
  history: AgentProjectedHistory;
};
type TurnState = {
  turnRef: RuntimeTurnRef;
  threadRef: RuntimeThreadRef;
  inputRef: RuntimeInputRef;
  turnKey: string;
  status: "running" | "completed" | "failed" | "canceled";
  hooks: AgentRuntimeTurnHooks;
  nextSequence: number;
  events: AgentRuntimeEvent[];
  dispatchResults: AgentToolDispatchResult[];
  settled: Deferred;
};

export type AgentRuntimeContractFakeOptions = {
  readonly clock?: AgentDeterministicClock;
  readonly adapterVersion?: string;
};

export type AgentRuntimeContractFake = AgentRuntimeContractHarness & {
  readonly events: (turnRef: RuntimeTurnRef) => readonly AgentRuntimeEvent[];
  readonly clock: AgentDeterministicClock;
};

export function createAgentRuntimeContractFake(
  options: AgentRuntimeContractFakeOptions = {},
): AgentRuntimeContractFake {
  const clock = options.clock ?? createDeterministicClock(0);
  const adapterVersion = options.adapterVersion ?? "fake.1";
  const threadsByKey = new Map<string, ThreadState>();
  const threadsByRef = new Map<RuntimeThreadRef, ThreadState>();
  const inputs = new Map<RuntimeInputRef, InputState>();
  const turns = new Map<RuntimeTurnRef, TurnState>();
  const scripts = new Map<string, readonly AgentRuntimeScriptStep[]>();
  const projections = new Map<string, { projectionRef: RuntimeProjectionRef; turnRef: RuntimeTurnRef }>();
  const projectionsByRef = new Set<RuntimeProjectionRef>();
  const gateWaiters = new Map<string, Array<() => void>>();
  const releasedGates = new Set<string>();
  const counters = { thread: 0, input: 0, turn: 0, projection: 0 };

  const waitGate = (gate: string) =>
    releasedGates.has(gate)
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const list = gateWaiters.get(gate) ?? [];
          list.push(resolve);
          gateWaiters.set(gate, list);
        });

  const emit = async (turn: TurnState, payload: AgentRuntimeEventPayload) => {
    if (turn.status !== "running" && payload.kind !== "turn_completed" && payload.kind !== "completion_projected" && payload.kind !== "cleanup_completed") {
      return;
    }
    const event = {
      ...payload,
      sequence: turn.nextSequence++,
      turnRef: turn.turnRef,
      at: clock.now(),
    } as AgentRuntimeEvent;
    turn.events.push(event);
    await turn.hooks.onEvent(event);
  };

  const terminalize = async (
    turn: TurnState,
    completion: Omit<Extract<AgentRuntimeEventPayload, { kind: "turn_completed" }>, "kind">,
  ) => {
    if (turn.status !== "running") return;
    turn.status = completion.outcome;
    await emit(turn, { kind: "turn_completed", ...completion });
    turn.settled.resolve();
  };

  const runCall = async (
    turn: TurnState,
    call: { callId: string; toolId: string; args: AgentRuntimeScriptArgs; idempotencyKey?: string },
  ) => {
    await emit(turn, { kind: "tool_call_requested", callId: call.callId, toolId: call.toolId });
    const result = await turn.hooks.dispatchTool({
      callId: call.callId,
      turnRef: turn.turnRef,
      toolId: call.toolId,
      rawArgs: await resolveScriptArgs(call.args),
      idempotencyKey: call.idempotencyKey ?? `${turn.turnKey}:${call.callId}`,
    });
    turn.dispatchResults.push(result);
    await emit(turn, {
      kind: "tool_call_completed",
      callId: call.callId,
      toolId: call.toolId,
      outcomeKind: result.kind === "outcome" ? result.outcome.kind : "protocol_violation",
    });
  };

  const runScript = async (turn: TurnState) => {
    const steps = scripts.get(turn.turnKey) ?? [];
    for (const step of steps) {
      if (turn.status !== "running") return;
      switch (step.kind) {
        case "progress":
          await emit(turn, { kind: "progress", milestone: step.milestone });
          break;
        case "tool_call":
          await runCall(turn, step);
          break;
        case "tool_calls_parallel":
          await Promise.all(step.calls.map((call) => runCall(turn, call)));
          break;
        case "usage": {
          const usage: AgentUsageEvent = {
            providerInvocationRef: step.providerInvocationRef,
            retryIndex: step.retryIndex,
            sequence: step.sequence,
            eventKey: step.eventKey,
            mode: step.mode,
            tokens: step.tokens,
            terminal: step.terminal,
          };
          await emit(turn, { kind: "usage", usage });
          break;
        }
        case "pause":
          await waitGate(step.gate);
          break;
        case "complete":
          await terminalize(turn, { outcome: "completed", narrative: step.narrative });
          return;
        case "fail":
          await terminalize(turn, { outcome: "failed", error: { code: step.code, message: step.message } });
          return;
      }
    }
    await terminalize(turn, {
      outcome: "failed",
      error: { code: "script_ended_without_completion", message: "The scripted model never completed the turn." },
    });
  };

  const adapter: AgentRuntimeAdapter = {
    descriptor: {
      adapterKind: AGENT_CONTRACT_FAKE_ADAPTER_KIND,
      adapterVersion,
      protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    },
    ensureThread: async ({ threadKey }) => {
      const existing = threadsByKey.get(threadKey);
      if (existing) return { threadRef: existing.threadRef, created: false };
      const threadRef = opaqueRef("runtime_thread", `fake-thread-${++counters.thread}`);
      const state: ThreadState = { threadRef, threadKey, inputs: new Map() };
      threadsByKey.set(threadKey, state);
      threadsByRef.set(threadRef, state);
      return { threadRef, created: true };
    },
    saveInput: async ({ threadRef, turnKey, prompt, history }) => {
      const thread = threadsByRef.get(threadRef);
      if (!thread) throw new Error("fake runtime: unknown thread ref");
      const existing = thread.inputs.get(turnKey);
      if (existing) return { inputRef: existing };
      const inputRef = opaqueRef("runtime_input", `fake-input-${++counters.input}`);
      thread.inputs.set(turnKey, inputRef);
      inputs.set(inputRef, { inputRef, threadRef, turnKey, prompt, history });
      return { inputRef };
    },
    startTurn: async (input, hooks) => {
      if (!threadsByRef.has(input.threadRef)) throw new Error("fake runtime: unknown thread ref");
      if (!inputs.has(input.inputRef)) throw new Error("fake runtime: unknown input ref");
      const turnRef = opaqueRef("runtime_turn", `fake-turn-${++counters.turn}`);
      const turn: TurnState = {
        turnRef,
        threadRef: input.threadRef,
        inputRef: input.inputRef,
        turnKey: input.turnKey,
        status: "running",
        hooks,
        nextSequence: 0,
        events: [],
        dispatchResults: [],
        settled: deferred(),
      };
      turns.set(turnRef, turn);
      await emit(turn, { kind: "turn_started" });
      void runScript(turn).catch(() => {
        void terminalize(turn, {
          outcome: "failed",
          error: { code: "fake_runtime_script_error", message: "The scripted turn threw." },
        });
      });
      return { turnRef };
    },
    resumeTurn: async ({ turnRef }, hooks) => {
      const turn = turns.get(turnRef);
      if (!turn) return { resumed: false, state: "unknown" };
      if (turn.status !== "running") return { resumed: false, state: "terminal" };
      turn.hooks = hooks;
      await emit(turn, { kind: "turn_resumed" });
      return { resumed: true, state: "running" };
    },
    cancelTurn: async ({ turnRef, reason }) => {
      const turn = turns.get(turnRef);
      if (!turn || turn.status !== "running") return { accepted: false };
      await terminalize(turn, { outcome: "canceled", reason });
      return { accepted: true };
    },
    projectCompletion: async ({ threadRef, turnRef, idempotencyKey }) => {
      const existing = projections.get(idempotencyKey);
      if (existing) return { kind: "projected", projectionRef: existing.projectionRef, replayed: true };
      const turn = turns.get(turnRef);
      if (!turn) return { kind: "rejected", reason: "turn_unknown" };
      if (turn.threadRef !== threadRef) return { kind: "rejected", reason: "thread_mismatch" };
      if (turn.status === "running") return { kind: "rejected", reason: "turn_not_terminal" };
      const projectionRef = opaqueRef("runtime_projection", `fake-projection-${++counters.projection}`);
      projections.set(idempotencyKey, { projectionRef, turnRef });
      projectionsByRef.add(projectionRef);
      await emit(turn, { kind: "completion_projected", projectionRef });
      return { kind: "projected", projectionRef, replayed: false };
    },
    cleanup: async ({ threadRef, inputRef, turnRef, projectionRef }) => {
      const deleted: string[] = [];
      if (projectionRef && projectionsByRef.delete(projectionRef)) deleted.push(projectionRef);
      if (turnRef) {
        const turn = turns.get(turnRef);
        if (turn) {
          if (turn.status === "running") {
            return { ok: false, retryable: true, error: "turn_still_running" };
          }
          turns.delete(turnRef);
          deleted.push(turnRef);
        }
      }
      if (inputRef && inputs.delete(inputRef)) deleted.push(inputRef);
      if (threadRef) {
        const thread = threadsByRef.get(threadRef);
        if (thread) {
          for (const ref of thread.inputs.values()) {
            if (inputs.delete(ref)) deleted.push(ref);
          }
          threadsByRef.delete(threadRef);
          threadsByKey.delete(thread.threadKey);
          deleted.push(threadRef);
        }
      }
      return { ok: true, deleted };
    },
  };

  return {
    adapter,
    clock,
    scriptTurn: (turnKey, steps) => {
      scripts.set(turnKey, steps);
    },
    release: (gate) => {
      releasedGates.add(gate);
      for (const resolve of gateWaiters.get(gate) ?? []) resolve();
      gateWaiters.delete(gate);
    },
    settle: (turnRef) => {
      const turn = turns.get(turnRef);
      if (!turn) return Promise.reject(new Error("fake runtime: unknown turn ref"));
      return turn.settled.promise;
    },
    dispatchResults: (turnRef) => [...(turns.get(turnRef)?.dispatchResults ?? [])],
    events: (turnRef) => [...(turns.get(turnRef)?.events ?? [])],
  };
}
