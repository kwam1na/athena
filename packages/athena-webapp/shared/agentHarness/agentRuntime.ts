/**
 * Athena-owned `AgentRuntimeAdapter` contract (browser-safe, runtime-neutral).
 *
 * Convex Agent (or any future runtime) owns thread/message mechanics, model
 * turns, streaming, and tool-loop progression, but only behind this contract:
 * opaque thread/input/turn/projection references, Athena-normalized
 * lifecycle/progress/tool/usage/cancellation/completion-projection/cleanup
 * events, Athena-projected history as the only input, and bidirectional tool
 * dispatch with Athena-owned tool definitions and validators.
 *
 * Two kernel-owned pieces live here because they ARE the protocol:
 * - the tool-dispatch ledger binds every idempotency key to an immutable
 *   fingerprint (adapter version + turn + tool + canonical args hash + call
 *   id); exact replay returns the recorded outcome, any mismatch is a typed
 *   protocol violation that invokes no handler and returns no prior result;
 * - the usage reconciler fixes one delta-or-cumulative mode per
 *   provider-invocation/retry stream, dedupes and orders updates, settles
 *   charging exactly once (terminal total or conservative estimate), and
 *   keeps late usage as evidence that can never lower settled spend.
 *
 * Nothing here names a native component client, provider message/tool/usage
 * type, session object, or runtime database record; the adapter converts at
 * its edge and never owns capability, admission, executor, or spend policy.
 */
import { computeContentDigest } from "./execution";
import {
  AGENT_HARNESS_PROTOCOL_VERSION,
  isNonEmptyString,
  isNonNegativeInteger,
  isOneOf,
  isOpaqueRef,
  isPlainObject,
  versionedExtensionRequired,
  type AgentContractIssue,
  type AgentEgressClass,
  type OpaqueRef,
  type Timestamp,
} from "./values";

export const AGENT_RUNTIME_PROTOCOL_VERSION = "athena.agent-runtime.v2" as const;

export type RuntimeThreadRef = OpaqueRef<"runtime_thread">;
export type RuntimeInputRef = OpaqueRef<"runtime_input">;
export type RuntimeTurnRef = OpaqueRef<"runtime_turn">;
export type RuntimeProjectionRef = OpaqueRef<"runtime_projection">;

export type AgentRuntimeAdapterDescriptor = {
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly protocolVersion: typeof AGENT_RUNTIME_PROTOCOL_VERSION;
};

// ---------------------------------------------------------------------------
// Canonical JSON and hashing (shared by fingerprints and result hashes)
// ---------------------------------------------------------------------------

/** Recursively sort object keys and drop `undefined` so hashing is order-free. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function hashCanonical(value: unknown): string {
  return computeContentDigest(canonicalize(value));
}

// ---------------------------------------------------------------------------
// Athena-projected inputs and outputs
// ---------------------------------------------------------------------------

export type AgentProjectedMessage = {
  readonly role: "operator" | "assistant";
  readonly content: string;
  readonly egressClass: AgentEgressClass;
  readonly artifactRef?: string;
};

/** History is always Athena-authored: reauthorized, minimized, digest-bound. */
export type AgentProjectedHistory = {
  readonly messages: readonly AgentProjectedMessage[];
  readonly projectionDigest: string;
  readonly reauthorizedAt: Timestamp;
};

export type AgentProjectedPrompt = {
  readonly text: string;
  readonly egressClass: AgentEgressClass;
  readonly promptHash: string;
  readonly untrustedDataLabel: string;
};

export type AgentProjectedArtifact = {
  readonly artifactRef: string;
  readonly narrative: string;
  readonly egressClass: AgentEgressClass;
  readonly citations: readonly { readonly citationKey: string; readonly label: string }[];
  readonly committedAt: Timestamp;
};

export type AgentModelSelection = {
  readonly providerId: string;
  readonly modelId: string;
  readonly region: string;
};

export type AgentTurnLimits = {
  readonly maxToolCalls: number;
  readonly maxElapsedMs: number;
  readonly maxOutputTokens?: number;
};

// ---------------------------------------------------------------------------
// Tool definitions, handlers, and invocation protocol
// ---------------------------------------------------------------------------

export type AgentToolInputValidation<Args> =
  | { readonly ok: true; readonly args: Args }
  | { readonly ok: false; readonly issues: readonly { readonly path: string; readonly message: string }[] };

export type AgentToolDefinition<Args = unknown, Result = unknown> = {
  readonly toolId: string;
  readonly description: string;
  /** Validates AND canonicalizes: the returned args are what gets hashed and handled. */
  readonly validateInput: (raw: unknown) => AgentToolInputValidation<Args>;
  readonly resultDescription?: string;
  /** Phantom result type for downstream typing; never set at runtime. */
  readonly __result?: Result;
};

export type AgentToolHandlerOutcome<Result> =
  | { readonly kind: "success"; readonly result: Result }
  | {
      readonly kind: "failure";
      readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean };
    }
  | { readonly kind: "denied"; readonly denial: { readonly code: string; readonly message: string } }
  | { readonly kind: "canceled"; readonly reason: string };

export type AgentToolHandlerContext = {
  readonly turnRef: RuntimeTurnRef;
  readonly callId: string;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
};

export type AgentToolHandler<Args, Result> = (
  args: Args,
  context: AgentToolHandlerContext,
) => Promise<AgentToolHandlerOutcome<Result>>;

export type AgentToolRegistration<Args = unknown, Result = unknown> = {
  readonly definition: AgentToolDefinition<Args, Result>;
  readonly handler: AgentToolHandler<Args, Result>;
};

/** Type-erased registration: any concrete registration is assignable to it. */
export type AgentAnyToolRegistration = {
  readonly definition: AgentToolDefinition<unknown, unknown>;
  readonly handler: AgentToolHandler<never, unknown>;
};

/** What an adapter hands the kernel: raw runtime args, normalized identity. */
export type AgentToolInvocationRequest = {
  readonly callId: string;
  readonly turnRef: RuntimeTurnRef;
  readonly toolId: string;
  readonly rawArgs: unknown;
  readonly idempotencyKey: string;
};

export type AgentToolFingerprintInput = {
  readonly adapterVersion: string;
  readonly turnRef: RuntimeTurnRef;
  readonly toolId: string;
  readonly argsHash: string;
  readonly callId: string;
};

export const AGENT_TOOL_FINGERPRINT_FIELDS = [
  "adapterVersion",
  "turnRef",
  "toolId",
  "argsHash",
  "callId",
] as const;
export type AgentToolFingerprintField = (typeof AGENT_TOOL_FINGERPRINT_FIELDS)[number];

export function computeToolFingerprint(input: AgentToolFingerprintInput): string {
  return hashCanonical({
    protocolVersion: AGENT_HARNESS_PROTOCOL_VERSION,
    runtimeProtocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    adapterVersion: input.adapterVersion,
    turnRef: input.turnRef,
    toolId: input.toolId,
    argsHash: input.argsHash,
    callId: input.callId,
  });
}

export const AGENT_TOOL_PROTOCOL_VIOLATION_CODES = [
  "turn_unknown",
  "turn_terminal",
  "unknown_tool",
  "invalid_arguments",
  "fingerprint_mismatch",
  "call_id_reused_across_turns",
  "call_id_conflict",
] as const;
export type AgentToolProtocolViolationCode = (typeof AGENT_TOOL_PROTOCOL_VIOLATION_CODES)[number];

export type AgentToolDispatchResult<Result = unknown> =
  | {
      readonly kind: "outcome";
      readonly callId: string;
      readonly toolId: string;
      readonly idempotencyKey: string;
      readonly fingerprint: string;
      readonly argsHash: string;
      readonly outcome: AgentToolHandlerOutcome<Result>;
      readonly resultHash?: string;
      readonly replayed: boolean;
    }
  | {
      readonly kind: "protocol_violation";
      readonly callId: string;
      readonly toolId: string;
      readonly idempotencyKey: string;
      readonly code: AgentToolProtocolViolationCode;
      readonly message: string;
      readonly mismatch?: readonly AgentToolFingerprintField[];
      readonly issues?: readonly { readonly path: string; readonly message: string }[];
    };

export type AgentToolDispatcher = (
  request: AgentToolInvocationRequest,
) => Promise<AgentToolDispatchResult>;

// ---------------------------------------------------------------------------
// Tool dispatch ledger (kernel-owned)
// ---------------------------------------------------------------------------

export type AgentToolLedgerEntry = {
  readonly idempotencyKey: string;
  readonly callId: string;
  readonly turnRef: RuntimeTurnRef;
  readonly toolId: string;
  readonly argsHash: string;
  readonly fingerprint: string;
  readonly adapterVersion: string;
  readonly status: "in_flight" | "settled";
  readonly outcome?: AgentToolHandlerOutcome<unknown>;
  readonly resultHash?: string;
  /** A handler result that arrived after the call was terminalized: evidence only. */
  readonly lateOutcome?: AgentToolHandlerOutcome<unknown>;
};

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type MutableEntry = {
  idempotencyKey: string;
  callId: string;
  turnRef: RuntimeTurnRef;
  toolId: string;
  argsHash: string;
  fingerprint: string;
  adapterVersion: string;
  status: "in_flight" | "settled";
  outcome?: AgentToolHandlerOutcome<unknown>;
  resultHash?: string;
  lateOutcome?: AgentToolHandlerOutcome<unknown>;
  pending?: Deferred<AgentToolHandlerOutcome<unknown>>;
  abort?: AbortController;
};

export type AgentToolDispatchLedger = {
  readonly beginTurn: (turnRef: RuntimeTurnRef) => void;
  /** Cancels every in-flight call of the turn and refuses further dispatch. */
  readonly terminalizeTurn: (turnRef: RuntimeTurnRef, reason: string) => readonly string[];
  readonly dispatch: AgentToolDispatcher;
  readonly inFlight: (turnRef: RuntimeTurnRef) => readonly AgentToolLedgerEntry[];
  readonly entries: () => readonly AgentToolLedgerEntry[];
};

export type AgentToolDispatchLedgerOptions = {
  readonly adapterVersion: string;
  readonly tools: readonly AgentAnyToolRegistration[];
  /** Previously recorded entries (e.g. loaded from durable state) for replay checks. */
  readonly restoreEntries?: readonly AgentToolLedgerEntry[];
};

function snapshotEntry(entry: MutableEntry): AgentToolLedgerEntry {
  return {
    idempotencyKey: entry.idempotencyKey,
    callId: entry.callId,
    turnRef: entry.turnRef,
    toolId: entry.toolId,
    argsHash: entry.argsHash,
    fingerprint: entry.fingerprint,
    adapterVersion: entry.adapterVersion,
    status: entry.status,
    ...(entry.outcome ? { outcome: entry.outcome } : {}),
    ...(entry.resultHash ? { resultHash: entry.resultHash } : {}),
    ...(entry.lateOutcome ? { lateOutcome: entry.lateOutcome } : {}),
  };
}

export function createAgentToolDispatchLedger(
  options: AgentToolDispatchLedgerOptions,
): AgentToolDispatchLedger {
  const tools = new Map<string, AgentAnyToolRegistration>();
  for (const tool of options.tools) tools.set(tool.definition.toolId, tool);
  const byKey = new Map<string, MutableEntry>();
  const callOwners = new Map<string, { turnRef: RuntimeTurnRef; idempotencyKey: string }>();
  const turns = new Map<RuntimeTurnRef, { terminal: boolean }>();
  const order: MutableEntry[] = [];

  for (const restored of options.restoreEntries ?? []) {
    const entry: MutableEntry = { ...restored };
    byKey.set(entry.idempotencyKey, entry);
    callOwners.set(entry.callId, { turnRef: entry.turnRef, idempotencyKey: entry.idempotencyKey });
    order.push(entry);
  }

  const settle = (entry: MutableEntry, outcome: AgentToolHandlerOutcome<unknown>) => {
    if (entry.status === "settled") {
      entry.lateOutcome = outcome;
      return;
    }
    entry.status = "settled";
    entry.outcome = outcome;
    if (outcome.kind === "success") entry.resultHash = hashCanonical(outcome.result);
    entry.pending?.resolve(outcome);
    entry.pending = undefined;
  };

  const violation = (
    request: AgentToolInvocationRequest,
    code: AgentToolProtocolViolationCode,
    message: string,
    extra: { mismatch?: readonly AgentToolFingerprintField[]; issues?: readonly { path: string; message: string }[] } = {},
  ): AgentToolDispatchResult => ({
    kind: "protocol_violation",
    callId: request.callId,
    toolId: request.toolId,
    idempotencyKey: request.idempotencyKey,
    code,
    message,
    ...(extra.mismatch ? { mismatch: extra.mismatch } : {}),
    ...(extra.issues ? { issues: extra.issues } : {}),
  });

  const outcomeResult = (entry: MutableEntry, replayed: boolean): AgentToolDispatchResult => ({
    kind: "outcome",
    callId: entry.callId,
    toolId: entry.toolId,
    idempotencyKey: entry.idempotencyKey,
    fingerprint: entry.fingerprint,
    argsHash: entry.argsHash,
    outcome: entry.outcome as AgentToolHandlerOutcome<unknown>,
    ...(entry.resultHash ? { resultHash: entry.resultHash } : {}),
    replayed,
  });

  const dispatch: AgentToolDispatcher = async (request) => {
    const turn = turns.get(request.turnRef);
    if (!turn) return violation(request, "turn_unknown", "The turn has not been bound to the kernel.");
    if (turn.terminal) return violation(request, "turn_terminal", "The turn is terminal; no further dispatch.");

    const tool = tools.get(request.toolId);
    if (!tool) return violation(request, "unknown_tool", `Tool "${request.toolId}" is not in the Athena catalog.`);

    const validation = tool.definition.validateInput(request.rawArgs);
    if (!validation.ok) {
      return violation(request, "invalid_arguments", "Arguments failed Athena validation.", { issues: validation.issues });
    }
    const canonicalArgs = canonicalize(validation.args);
    const argsHash = hashCanonical(canonicalArgs);
    const fingerprint = computeToolFingerprint({
      adapterVersion: options.adapterVersion,
      turnRef: request.turnRef,
      toolId: request.toolId,
      argsHash,
      callId: request.callId,
    });

    const existing = byKey.get(request.idempotencyKey);
    if (existing) {
      const mismatch = AGENT_TOOL_FINGERPRINT_FIELDS.filter((field) => {
        switch (field) {
          case "adapterVersion":
            return existing.adapterVersion !== options.adapterVersion;
          case "turnRef":
            return existing.turnRef !== request.turnRef;
          case "toolId":
            return existing.toolId !== request.toolId;
          case "argsHash":
            return existing.argsHash !== argsHash;
          case "callId":
            return existing.callId !== request.callId;
        }
      });
      if (mismatch.length > 0 || existing.fingerprint !== fingerprint) {
        return violation(request, "fingerprint_mismatch", "Idempotency key is bound to a different request fingerprint.", {
          mismatch: mismatch.length > 0 ? mismatch : [...AGENT_TOOL_FINGERPRINT_FIELDS],
        });
      }
      if (existing.status === "settled") return outcomeResult(existing, true);
      await existing.pending?.promise;
      return outcomeResult(existing, true);
    }

    const owner = callOwners.get(request.callId);
    if (owner && owner.turnRef !== request.turnRef) {
      return violation(request, "call_id_reused_across_turns", `Call id "${request.callId}" belongs to another turn.`);
    }
    if (owner && owner.idempotencyKey !== request.idempotencyKey) {
      return violation(request, "call_id_conflict", `Call id "${request.callId}" is already bound to another idempotency key.`);
    }

    const abort = new AbortController();
    const entry: MutableEntry = {
      idempotencyKey: request.idempotencyKey,
      callId: request.callId,
      turnRef: request.turnRef,
      toolId: request.toolId,
      argsHash,
      fingerprint,
      adapterVersion: options.adapterVersion,
      status: "in_flight",
      pending: deferred<AgentToolHandlerOutcome<unknown>>(),
      abort,
    };
    byKey.set(entry.idempotencyKey, entry);
    callOwners.set(entry.callId, { turnRef: entry.turnRef, idempotencyKey: entry.idempotencyKey });
    order.push(entry);
    const pending = entry.pending!.promise;

    void Promise.resolve()
      .then(() =>
        tool.handler(canonicalArgs as never, {
          turnRef: request.turnRef,
          callId: request.callId,
          idempotencyKey: request.idempotencyKey,
          signal: abort.signal,
        }),
      )
      .then(
        (outcome) => settle(entry, outcome),
        () =>
          settle(entry, {
            kind: "failure",
            error: { code: "handler_threw", message: "Tool handler threw an error.", retryable: false },
          }),
      );

    await pending;
    return outcomeResult(entry, false);
  };

  return {
    beginTurn: (turnRef) => {
      if (!turns.has(turnRef)) turns.set(turnRef, { terminal: false });
    },
    terminalizeTurn: (turnRef, reason) => {
      const turn = turns.get(turnRef) ?? { terminal: false };
      turns.set(turnRef, { ...turn, terminal: true });
      const canceled: string[] = [];
      for (const entry of order) {
        if (entry.turnRef !== turnRef || entry.status !== "in_flight") continue;
        entry.abort?.abort();
        settle(entry, { kind: "canceled", reason });
        canceled.push(entry.callId);
      }
      return canceled;
    },
    dispatch,
    inFlight: (turnRef) =>
      order.filter((entry) => entry.turnRef === turnRef && entry.status === "in_flight").map(snapshotEntry),
    entries: () => order.map(snapshotEntry),
  };
}

// ---------------------------------------------------------------------------
// Normalized usage (kernel-owned reconciliation; Athena owns cost)
// ---------------------------------------------------------------------------

export const AGENT_TOKEN_CATEGORIES = ["input", "output", "cachedInput", "reasoning"] as const;
export type AgentTokenCategory = (typeof AGENT_TOKEN_CATEGORIES)[number];
export type AgentTokenCounts = Record<AgentTokenCategory, number>;

export const AGENT_USAGE_MODES = ["delta", "cumulative"] as const;
export type AgentUsageMode = (typeof AGENT_USAGE_MODES)[number];

export type AgentUsageEvent = {
  readonly providerInvocationRef: string;
  readonly retryIndex: number;
  readonly sequence: number;
  readonly eventKey: string;
  readonly mode: AgentUsageMode;
  readonly tokens: Partial<AgentTokenCounts>;
  readonly terminal: boolean;
};

export const AGENT_USAGE_DISPOSITIONS = [
  "accepted",
  "accepted_out_of_order",
  "duplicate",
  "rejected_mode_change",
  "rejected_invalid",
  "late_evidence_only",
] as const;
export type AgentUsageDisposition = (typeof AGENT_USAGE_DISPOSITIONS)[number];

export const AGENT_USAGE_SETTLEMENT_REASONS = ["terminal_total", "timeout", "cancel", "missing_final"] as const;
export type AgentUsageSettlementReason = (typeof AGENT_USAGE_SETTLEMENT_REASONS)[number];

export type AgentUsageStreamState = {
  readonly streamKey: string;
  readonly providerInvocationRef: string;
  readonly retryIndex: number;
  readonly mode: AgentUsageMode | null;
  readonly tokens: AgentTokenCounts;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly terminalSeen: boolean;
  readonly settled: boolean;
  readonly settledBy?: AgentUsageSettlementReason;
  readonly conservative: boolean;
};

export type AgentUsageStreamSettlement = {
  /** True when this call performed the settlement; false when already settled. */
  readonly settled: boolean;
  readonly settledBy: AgentUsageSettlementReason;
  readonly conservative: boolean;
  readonly tokens: AgentTokenCounts;
};

export type AgentUsageSettlement = {
  readonly tokens: AgentTokenCounts;
  readonly streams: readonly (AgentUsageStreamState & { readonly settledBy: AgentUsageSettlementReason })[];
  readonly lateEventCount: number;
};

export type AgentUsageReconciler = {
  readonly record: (event: AgentUsageEvent) => { readonly disposition: AgentUsageDisposition; readonly streamKey: string };
  readonly settleStream: (
    streamKey: string,
    options: { readonly reason: AgentUsageSettlementReason; readonly estimate?: Partial<AgentTokenCounts> },
  ) => AgentUsageStreamSettlement;
  /** Settle every open stream; the estimate applies to the latest open stream only. Closes the reconciler. */
  readonly settleAll: (reason: AgentUsageSettlementReason, estimate?: Partial<AgentTokenCounts>) => AgentUsageSettlement;
  /** Spend settled so far (open streams are not yet charged). */
  readonly settled: () => AgentUsageSettlement;
  readonly streams: () => readonly AgentUsageStreamState[];
  readonly lateEvents: () => readonly AgentUsageEvent[];
};

export function zeroTokens(): AgentTokenCounts {
  return { input: 0, output: 0, cachedInput: 0, reasoning: 0 };
}

export function usageStreamKey(event: Pick<AgentUsageEvent, "providerInvocationRef" | "retryIndex">): string {
  return `${event.providerInvocationRef}#${event.retryIndex}`;
}

export function validateUsageEvent(event: unknown): event is AgentUsageEvent {
  if (!isPlainObject(event)) return false;
  if (!isNonEmptyString(event.providerInvocationRef) || !isNonEmptyString(event.eventKey)) return false;
  if (!isNonNegativeInteger(event.retryIndex) || !isNonNegativeInteger(event.sequence)) return false;
  if (!isOneOf(AGENT_USAGE_MODES, event.mode) || typeof event.terminal !== "boolean") return false;
  if (!isPlainObject(event.tokens)) return false;
  for (const [category, count] of Object.entries(event.tokens)) {
    if (!isOneOf(AGENT_TOKEN_CATEGORIES, category)) return false;
    if (count !== undefined && !isNonNegativeInteger(count)) return false;
  }
  return true;
}

type MutableStream = {
  streamKey: string;
  providerInvocationRef: string;
  retryIndex: number;
  mode: AgentUsageMode | null;
  tokens: AgentTokenCounts;
  seenKeys: Set<string>;
  lastSequence: number;
  acceptedCount: number;
  rejectedCount: number;
  terminalSeen: boolean;
  settled: boolean;
  settledBy?: AgentUsageSettlementReason;
  conservative: boolean;
  createdOrder: number;
};

function maxTokens(a: AgentTokenCounts, b: Partial<AgentTokenCounts>): AgentTokenCounts {
  const out = { ...a };
  for (const category of AGENT_TOKEN_CATEGORIES) {
    out[category] = Math.max(a[category], b[category] ?? 0);
  }
  return out;
}

function addTokens(a: AgentTokenCounts, b: Partial<AgentTokenCounts>): AgentTokenCounts {
  const out = { ...a };
  for (const category of AGENT_TOKEN_CATEGORIES) {
    out[category] = a[category] + (b[category] ?? 0);
  }
  return out;
}

export function createUsageReconciler(): AgentUsageReconciler {
  const streams = new Map<string, MutableStream>();
  const late: AgentUsageEvent[] = [];
  let closed = false;
  let createdCounter = 0;

  const snapshot = (stream: MutableStream): AgentUsageStreamState => ({
    streamKey: stream.streamKey,
    providerInvocationRef: stream.providerInvocationRef,
    retryIndex: stream.retryIndex,
    mode: stream.mode,
    tokens: { ...stream.tokens },
    acceptedCount: stream.acceptedCount,
    rejectedCount: stream.rejectedCount,
    terminalSeen: stream.terminalSeen,
    settled: stream.settled,
    ...(stream.settledBy ? { settledBy: stream.settledBy } : {}),
    conservative: stream.conservative,
  });

  const ensureStream = (key: string, providerInvocationRef: string, retryIndex: number): MutableStream => {
    let stream = streams.get(key);
    if (!stream) {
      stream = {
        streamKey: key,
        providerInvocationRef,
        retryIndex,
        mode: null,
        tokens: zeroTokens(),
        seenKeys: new Set(),
        lastSequence: -1,
        acceptedCount: 0,
        rejectedCount: 0,
        terminalSeen: false,
        settled: false,
        conservative: false,
        createdOrder: createdCounter++,
      };
      streams.set(key, stream);
    }
    return stream;
  };

  const settleOne = (
    stream: MutableStream,
    reason: AgentUsageSettlementReason,
    estimate?: Partial<AgentTokenCounts>,
  ): AgentUsageStreamSettlement => {
    if (stream.settled) {
      return {
        settled: false,
        settledBy: stream.settledBy ?? reason,
        conservative: stream.conservative,
        tokens: { ...stream.tokens },
      };
    }
    if (estimate) stream.tokens = maxTokens(stream.tokens, estimate);
    stream.settled = true;
    stream.settledBy = reason;
    stream.conservative = reason !== "terminal_total" || !stream.terminalSeen;
    return { settled: true, settledBy: reason, conservative: stream.conservative, tokens: { ...stream.tokens } };
  };

  const settlement = (): AgentUsageSettlement => {
    const settledStreams = [...streams.values()]
      .filter((stream) => stream.settled)
      .sort((a, b) => a.createdOrder - b.createdOrder);
    let tokens = zeroTokens();
    for (const stream of settledStreams) tokens = addTokens(tokens, stream.tokens);
    return {
      tokens,
      streams: settledStreams.map((stream) => ({
        ...snapshot(stream),
        settledBy: stream.settledBy as AgentUsageSettlementReason,
      })),
      lateEventCount: late.length,
    };
  };

  return {
    record: (event) => {
      const raw: unknown = event;
      if (!validateUsageEvent(raw)) {
        const partial = isPlainObject(raw) ? raw : {};
        return {
          disposition: "rejected_invalid",
          streamKey: usageStreamKey({
            providerInvocationRef: String(partial.providerInvocationRef ?? ""),
            retryIndex: Number(partial.retryIndex ?? 0),
          }),
        };
      }
      const streamKey = usageStreamKey(event);
      const existing = streams.get(streamKey);
      if (closed || existing?.settled) {
        late.push(event);
        return { disposition: "late_evidence_only", streamKey };
      }
      const stream = ensureStream(streamKey, event.providerInvocationRef, event.retryIndex);
      if (stream.seenKeys.has(event.eventKey)) return { disposition: "duplicate", streamKey };
      if (stream.mode !== null && stream.mode !== event.mode) {
        stream.rejectedCount += 1;
        return { disposition: "rejected_mode_change", streamKey };
      }
      stream.mode = event.mode;
      stream.seenKeys.add(event.eventKey);
      stream.acceptedCount += 1;
      const outOfOrder = event.sequence < stream.lastSequence;
      stream.lastSequence = Math.max(stream.lastSequence, event.sequence);
      if (event.terminal) stream.terminalSeen = true;
      if (event.mode === "delta") {
        stream.tokens = addTokens(stream.tokens, event.tokens);
      } else {
        stream.tokens = maxTokens(stream.tokens, event.tokens);
      }
      return { disposition: outOfOrder ? "accepted_out_of_order" : "accepted", streamKey };
    },
    settleStream: (streamKey, options) => {
      const stream = streams.get(streamKey);
      if (!stream) {
        const [providerInvocationRef = streamKey, retry = "0"] = streamKey.split("#");
        return settleOne(ensureStream(streamKey, providerInvocationRef, Number(retry)), options.reason, options.estimate);
      }
      return settleOne(stream, options.reason, options.estimate);
    },
    settleAll: (reason, estimate) => {
      const open = [...streams.values()]
        .filter((stream) => !stream.settled)
        .sort((a, b) => a.createdOrder - b.createdOrder);
      open.forEach((stream, index) => {
        settleOne(stream, reason, index === open.length - 1 ? estimate : undefined);
      });
      closed = true;
      return settlement();
    },
    settled: settlement,
    streams: () => [...streams.values()].sort((a, b) => a.createdOrder - b.createdOrder).map(snapshot),
    lateEvents: () => [...late],
  };
}

export type AgentUsageRateCard = {
  /** Cost units per million tokens, per category. */
  readonly perMillion: AgentTokenCounts;
};

/** Athena-owned cost: integer cost units, rounded up so spend is never understated. */
export function calculateUsageCost(tokens: AgentTokenCounts, rateCard: AgentUsageRateCard): number {
  let micro = 0;
  for (const category of AGENT_TOKEN_CATEGORIES) {
    micro += tokens[category] * rateCard.perMillion[category];
  }
  return Math.ceil(micro / 1_000_000);
}

// ---------------------------------------------------------------------------
// Normalized runtime events
// ---------------------------------------------------------------------------

/** Server-authored, non-sensitive milestones; the only progress the browser may see. */
export const AGENT_PROGRESS_MILESTONES = [
  "reconnecting",
  "checking_sources",
  "reading_sources",
  "composing_answer",
  "finalizing",
] as const;
export type AgentProgressMilestone = (typeof AGENT_PROGRESS_MILESTONES)[number];

export const AGENT_RUNTIME_EVENT_KINDS = [
  "turn_started",
  "turn_resumed",
  "progress",
  "narrative_delta",
  "tool_call_requested",
  "tool_call_completed",
  "usage",
  "turn_completed",
  "completion_projected",
  "cleanup_completed",
] as const;
export type AgentRuntimeEventKind = (typeof AGENT_RUNTIME_EVENT_KINDS)[number];

export const AGENT_TURN_OUTCOMES = ["completed", "failed", "canceled"] as const;
export type AgentTurnOutcome = (typeof AGENT_TURN_OUTCOMES)[number];

export type AgentToolCallOutcomeKind = AgentToolHandlerOutcome<unknown>["kind"] | "protocol_violation";

type EventBase = {
  readonly sequence: number;
  readonly turnRef: RuntimeTurnRef;
  readonly at: Timestamp;
};

export type AgentRuntimeEvent = EventBase &
  (
    | { readonly kind: "turn_started" }
    | { readonly kind: "turn_resumed" }
    | { readonly kind: "progress"; readonly milestone: AgentProgressMilestone }
    | {
        /**
         * One coalesced slice of the model's in-progress narrative. It is the
         * assistant thinking out loud, not the answer forming: a host may
         * surface it as explicitly provisional text, and the committed
         * artifact `completeRun` mints stays the only released answer.
         *
         * There is no stream identifier and no per-delta index — the
         * envelope's `turnRef` identifies the turn and its `sequence` orders
         * the deltas; `draftOrdinal` identifies the draft, and advances
         * whenever the model starts over (a tool step, or a resumed attempt).
         */
        readonly kind: "narrative_delta";
        readonly draftOrdinal: number;
        readonly text: string;
      }
    | { readonly kind: "tool_call_requested"; readonly callId: string; readonly toolId: string }
    | {
        readonly kind: "tool_call_completed";
        readonly callId: string;
        readonly toolId: string;
        readonly outcomeKind: AgentToolCallOutcomeKind;
      }
    | { readonly kind: "usage"; readonly usage: AgentUsageEvent }
    | {
        readonly kind: "turn_completed";
        readonly outcome: AgentTurnOutcome;
        /**
         * The model's final narrative for the turn, buffered server-side until
         * `completeRun`. It is exposed in-process as ordered `narrative_delta`
         * events that a host may surface as provisional text; the committed
         * artifact remains the only released answer, and it is an independent
         * string from anything streamed here.
         */
        readonly narrative?: string;
        readonly error?: { readonly code: string; readonly message: string };
        readonly reason?: string;
      }
    | { readonly kind: "completion_projected"; readonly projectionRef: RuntimeProjectionRef }
    | { readonly kind: "cleanup_completed"; readonly deleted: readonly string[] }
  );

/** An event minus the envelope the adapter stamps (sequence, turnRef, at); distributive over kinds. */
export type AgentRuntimeEventPayload = AgentRuntimeEvent extends infer E
  ? E extends AgentRuntimeEvent
    ? Omit<E, "sequence" | "turnRef" | "at">
    : never
  : never;

export type AgentRuntimeEventValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

export function validateRuntimeEvent(event: AgentRuntimeEvent): AgentRuntimeEventValidation {
  const issues: AgentContractIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const raw: Record<string, unknown> = isPlainObject(event) ? event : {};
  if (!isPlainObject(event)) {
    add("event_invalid", "$", "Runtime events are plain objects.");
    return { ok: false, issues };
  }
  if (!isOneOf(AGENT_RUNTIME_EVENT_KINDS, raw.kind)) {
    issues.push(versionedExtensionRequired("runtimeEvent.kind", String(raw.kind), "kind"));
    return { ok: false, issues };
  }
  if (!isNonNegativeInteger(raw.sequence)) add("event_invalid", "sequence", "Sequence is a non-negative integer.");
  if (!isOpaqueRef(raw.turnRef, "runtime_turn")) add("event_invalid", "turnRef", "Events carry an opaque turn ref.");
  if (typeof raw.at !== "number") add("event_invalid", "at", "Events carry a timestamp.");
  switch (raw.kind) {
    case "progress":
      if (!isOneOf(AGENT_PROGRESS_MILESTONES, raw.milestone)) {
        issues.push(versionedExtensionRequired("progress.milestone", String(raw.milestone), "milestone"));
      }
      break;
    case "narrative_delta":
      if (!isNonNegativeInteger(raw.draftOrdinal)) {
        add("event_invalid", "draftOrdinal", "Narrative deltas carry a non-negative integer draft ordinal.");
      }
      if (!isNonEmptyString(raw.text)) {
        add("event_invalid", "text", "Narrative deltas carry non-empty text.");
      }
      break;
    case "tool_call_requested":
    case "tool_call_completed":
      if (!isNonEmptyString(raw.callId) || !isNonEmptyString(raw.toolId)) {
        add("event_invalid", "callId", "Tool events carry callId and toolId.");
      }
      break;
    case "usage":
      if (!validateUsageEvent(raw.usage)) add("event_invalid", "usage", "Usage must be a normalized usage event.");
      break;
    case "turn_completed":
      if (!isOneOf(AGENT_TURN_OUTCOMES, raw.outcome)) {
        issues.push(versionedExtensionRequired("turn.outcome", String(raw.outcome), "outcome"));
      }
      break;
    case "completion_projected":
      if (!isOpaqueRef(raw.projectionRef, "runtime_projection")) {
        add("event_invalid", "projectionRef", "Projection events carry an opaque projection ref.");
      }
      break;
    default:
      break;
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export type AgentRuntimeEventSink = (event: AgentRuntimeEvent) => void | Promise<void>;

export type AgentRuntimeTurnHooks = {
  readonly onEvent: AgentRuntimeEventSink;
  readonly dispatchTool: AgentToolDispatcher;
};

// ---------------------------------------------------------------------------
// The adapter contract
// ---------------------------------------------------------------------------

export type AgentRuntimeCleanupOutcome =
  | { readonly ok: true; readonly deleted: readonly string[] }
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

export type AgentRuntimeProjectionOutcome =
  | { readonly kind: "projected"; readonly projectionRef: RuntimeProjectionRef; readonly replayed: boolean }
  | { readonly kind: "rejected"; readonly reason: "turn_unknown" | "turn_not_terminal" | "thread_mismatch" };

export type AgentRuntimeAdapter = {
  readonly descriptor: AgentRuntimeAdapterDescriptor;

  /** Bind (or create) the opaque runtime thread for an Athena thread key. */
  readonly ensureThread: (input: {
    readonly threadKey: string;
    readonly contextBindingRef: OpaqueRef<"context_binding">;
    readonly correlation: { readonly operatorRef: string; readonly profileId: string };
  }) => Promise<{ readonly threadRef: RuntimeThreadRef; readonly created: boolean }>;

  /** Persist the Athena-projected prompt and history as the turn's only input. */
  readonly saveInput: (input: {
    readonly threadRef: RuntimeThreadRef;
    readonly turnKey: string;
    readonly prompt: AgentProjectedPrompt;
    readonly history: AgentProjectedHistory;
  }) => Promise<{ readonly inputRef: RuntimeInputRef }>;

  readonly startTurn: (
    input: {
      readonly threadRef: RuntimeThreadRef;
      readonly inputRef: RuntimeInputRef;
      readonly turnKey: string;
      readonly tools: readonly AgentToolDefinition[];
      readonly model: AgentModelSelection;
      readonly limits: AgentTurnLimits;
    },
    hooks: AgentRuntimeTurnHooks,
  ) => Promise<{ readonly turnRef: RuntimeTurnRef }>;

  readonly resumeTurn: (
    input: { readonly turnRef: RuntimeTurnRef },
    hooks: AgentRuntimeTurnHooks,
  ) => Promise<{ readonly resumed: boolean; readonly state: "running" | "terminal" | "unknown" }>;

  readonly cancelTurn: (input: {
    readonly turnRef: RuntimeTurnRef;
    readonly reason: string;
  }) => Promise<{ readonly accepted: boolean }>;

  /** Project a committed, currently authorized artifact into runtime history (idempotent). */
  readonly projectCompletion: (input: {
    readonly threadRef: RuntimeThreadRef;
    readonly turnRef: RuntimeTurnRef;
    readonly artifact: AgentProjectedArtifact;
    readonly idempotencyKey: string;
  }) => Promise<AgentRuntimeProjectionOutcome>;

  /** Retention/lifecycle cleanup of runtime payloads; idempotent and retryable. */
  readonly cleanup: (input: {
    readonly threadRef?: RuntimeThreadRef;
    readonly inputRef?: RuntimeInputRef;
    readonly turnRef?: RuntimeTurnRef;
    readonly projectionRef?: RuntimeProjectionRef;
    readonly reason: string;
  }) => Promise<AgentRuntimeCleanupOutcome>;
};
