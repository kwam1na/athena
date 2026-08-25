/**
 * Athena-owned program-runtime contract (plan decision 5).
 *
 * The sandbox implementation behind this contract is replaceable (direct
 * QuickJS today; `@ai-sdk/code-mode` or an external microVM are explicit
 * fallbacks). Everything the program executor consumes — the typed ceilings, the host
 * bridge shape, the facade description, and the typed outcomes — lives here and
 * names nothing sandbox-specific. Athena-owned static validation runs outside
 * the sandbox (`programValidation.ts`); the runtime only moves JSON between a
 * guest program and the host bridge and enforces resource ceilings.
 */
import type { JsonValue } from "../../../shared/agentHarness/manifest";

// ---------------------------------------------------------------------------
// Safety ceilings (initial values; tune from observed use)
// ---------------------------------------------------------------------------

export type AgentProgramRuntimeCeilings = {
  /** Wall-clock budget for one program execution (the turn's 60 s ceiling). */
  readonly maxElapsedMs: number;
  /** Program attempts per run (`budgets.ts` budgets this; carried here so one object rules). */
  readonly maxAttempts: number;
  /** Capability calls per run. */
  readonly maxCapabilityCalls: number;
  /** Capability calls concurrently in flight. */
  readonly maxInFlightCalls: number;
  /** Rows returned per run (`budgets.ts` budgets this through the ledger's `rows` dimension). */
  readonly maxRows: number;
  /** Cumulative sanitized bridge bytes (args + outputs) per run. */
  readonly maxRunBridgeBytes: number;
  /** Encoded sanitized output per capability call, including evidence metadata headroom. */
  readonly maxCallOutputBytes: number;
  /** Encoded arguments per capability call. */
  readonly maxCallArgsBytes: number;
  /** Program source bytes. */
  readonly maxSourceBytes: number;
  /** Encoded program result bytes. */
  readonly maxResultBytes: number;
  /** Sandbox heap ceiling. */
  readonly maxHeapBytes: number;
  /** Sandbox stack ceiling. */
  readonly maxStackBytes: number;
  /** Provider cost units per run (Athena's `calculateUsageCost` units). */
  readonly maxProviderCostUnits: number;
};

export const AGENT_PROGRAM_RUNTIME_CEILINGS: AgentProgramRuntimeCeilings = Object.freeze({
  maxElapsedMs: 60_000,
  // Tuned 2026-08-24 from observed use (the plan marks these as initial
  // values): p90 across driven turns was 4 calls, but the first legitimately
  // deep question (a 30-day census) needed 30 and hit the old 24; and two of
  // three attempts on that turn were spent on static rejections alone. 24
  // sequential reads cost ~7 s of the 60 s window, so 48 still fits.
  maxAttempts: 4,
  maxCapabilityCalls: 48,
  maxInFlightCalls: 4,
  maxRows: 5_000,
  maxRunBridgeBytes: 2 * 1024 * 1024,
  maxCallOutputBytes: 240 * 1024,
  maxCallArgsBytes: 64 * 1024,
  maxSourceBytes: 32 * 1024,
  maxResultBytes: 256 * 1024,
  maxHeapBytes: 64 * 1024 * 1024,
  maxStackBytes: 256 * 1024,
  maxProviderCostUnits: 2_000,
});

// ---------------------------------------------------------------------------
// Facade description and host bridge
// ---------------------------------------------------------------------------

export const AGENT_PROGRAM_FACADE_VERBS = ["get", "list"] as const;
export type AgentProgramFacadeVerb = (typeof AGENT_PROGRAM_FACADE_VERBS)[number];

/** One `athena.<package>.<resource>` node and the read verbs the grant exposes. */
export type AgentProgramFacadeEntry = {
  readonly package: string;
  readonly resource: string;
  readonly verbs: readonly AgentProgramFacadeVerb[];
  /** Public top-level result field names (grant-projected); advisory field checks only, never enforcement. */
  readonly fields?: readonly string[];
};

export type AgentProgramHostCall = {
  readonly package: string;
  readonly resource: string;
  readonly verb: AgentProgramFacadeVerb;
  readonly args: JsonValue;
  /** Zero-based order of this call within the execution. */
  readonly callIndex: number;
  /** Aborted when the execution finalizes for any reason. */
  readonly signal: AbortSignal;
};

/**
 * What the program executor hands the runtime: the facade shape to materialize as `athena.*`
 * and the mediated invocation path. `invoke` must return a JSON value (the
 * capability outcome envelope); a thrown error is a host failure that
 * terminates the attempt without exposing the error to the guest.
 */
export type AgentProgramHostBridge = {
  readonly facade: readonly AgentProgramFacadeEntry[];
  readonly invoke: (call: AgentProgramHostCall) => Promise<JsonValue> | JsonValue;
};

// ---------------------------------------------------------------------------
// Validation issues
// ---------------------------------------------------------------------------

export const AGENT_PROGRAM_VALIDATION_CODES = [
  "source_too_large",
  "syntax_error",
  "import_forbidden",
  "export_forbidden",
  "forbidden_syntax",
  "forbidden_identifier",
  "forbidden_member",
  "forbidden_this",
  "missing_output",
  "multiple_outputs",
  "unreachable_after_output",
  "unsupported_syntax",
  "facade_path_unknown",
  "facade_misuse",
  "facade_args_invalid",
] as const;
export type AgentProgramValidationCode = (typeof AGENT_PROGRAM_VALIDATION_CODES)[number];

export type AgentProgramValidationIssue = {
  readonly code: AgentProgramValidationCode;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
};

export type AgentProgramValidationResult =
  | {
      readonly ok: true;
      /** Executable, type-stripped program wrapped in the Athena entry function. */
      readonly source: string;
      readonly sourceBytes: number;
    }
  | { readonly ok: false; readonly status: "rejected"; readonly issues: readonly AgentProgramValidationIssue[] };

// ---------------------------------------------------------------------------
// Execution outcomes
// ---------------------------------------------------------------------------

export const AGENT_PROGRAM_FAILURE_CODES = [
  "timeout",
  "memory_limit",
  "stack_overflow",
  "call_limit",
  "in_flight_limit",
  "call_args_too_large",
  "call_args_not_serializable",
  "call_output_too_large",
  "bridge_bytes_exceeded",
  "result_too_large",
  "result_not_serializable",
  "detached_call",
  "stalled",
  "runtime_error",
  "host_error",
  "facade_violation",
] as const;
export type AgentProgramFailureCode = (typeof AGENT_PROGRAM_FAILURE_CODES)[number];

export type AgentProgramDiagnostics = {
  readonly elapsedMs: number;
  readonly hostCalls: number;
  readonly maxInFlight: number;
  readonly bridgeArgsBytes: number;
  readonly bridgeOutputBytes: number;
  readonly resultBytes: number;
  readonly sourceBytes: number;
  readonly memoryUsedBytes?: number;
};

export type AgentProgramOutcome =
  | { readonly status: "completed"; readonly output: JsonValue; readonly diagnostics: AgentProgramDiagnostics }
  | { readonly status: "rejected"; readonly issues: readonly AgentProgramValidationIssue[] }
  | {
      readonly status: "failed";
      readonly code: AgentProgramFailureCode;
      readonly message: string;
      readonly diagnostics: AgentProgramDiagnostics;
    }
  | { readonly status: "canceled"; readonly reason: "aborted"; readonly diagnostics: AgentProgramDiagnostics };

export type AgentProgramExecutionInput = {
  /** Program as authored by the model (TypeScript allowed; validated and stripped by Athena). */
  readonly source: string;
  readonly bridge: AgentProgramHostBridge;
  readonly ceilings: AgentProgramRuntimeCeilings;
  readonly signal?: AbortSignal;
};

export type AgentProgramRuntime = {
  readonly kind: string;
  /** Time the engine took to load in this process (0 when already resident). */
  readonly startupMs: number;
  /** Validate (Athena-owned, outside the sandbox), then execute inside it. */
  readonly execute: (input: AgentProgramExecutionInput) => Promise<AgentProgramOutcome>;
  /**
   * Execute without static validation. Adversarial tests only: it proves the
   * sandbox holds on its own. The program executor must never call it.
   */
  readonly executeUnvalidated: (input: AgentProgramExecutionInput) => Promise<AgentProgramOutcome>;
};
