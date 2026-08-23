/**
 * Normalized run state for the reusable Athena agent host.
 *
 * The hook owns submission, one-active-turn-per-thread, reconnection,
 * cancellation, release-versus-receipt, revocation, thread-key and
 * context-change policy, and evidence lookups. It consumes only Athena's turn
 * contract (`api.agentHarness.turns.*`) and the profile's presentation adapter:
 * no runtime-native types, no surface-specific branching, and no model-authored
 * text is ever treated as state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { runCommand } from "@/lib/errors/runCommand";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { ok } from "~/shared/commandResult";
import type { AgentHostState } from "~/shared/agentHarness/profile";

import {
  composeAthenaThreadKey,
  describeAthenaContext,
  describeAthenaDenial,
  describeAthenaFailure,
  describeAthenaMilestone,
  describeAthenaUnavailable,
  describeProvisionalWithdrawal,
  resolveAthenaSourceLink,
  snapshotAthenaContext,
  type AthenaAgentContext,
  type AthenaAgentContextView,
  type AthenaAgentDenial,
  type AthenaAgentPresentation,
  type AthenaAgentProvisionalWithdrawal,
  type AthenaAgentSourceLink,
} from "./AthenaAgentPresentationAdapter";

type TurnId = Id<"agentTurnBinding">;

export type AthenaAgentStatusTone = "neutral" | "progress" | "warning";

export type AthenaAgentStatus = {
  readonly headline: string;
  readonly detail?: string;
  readonly tone: AthenaAgentStatusTone;
};

export type AthenaAgentMilestone = {
  readonly milestone: string;
  readonly label: string;
  readonly at: number;
};

export type AthenaAgentCitation = {
  readonly citationRef: string;
  readonly label?: string;
  readonly namespace?: string;
};

export type AthenaAgentAnswer = {
  readonly outcome: "answer" | "no_usable_sources";
  readonly title?: string;
  readonly summary?: string;
  readonly narrative: string;
  readonly egressClass: string;
  readonly confidence?: number;
  readonly limitedEvidence?: boolean;
  readonly committedAt: number;
  readonly viewedAt?: number;
  readonly citations: readonly AthenaAgentCitation[];
};

export type AthenaAgentTurn = {
  readonly turnId: TurnId;
  readonly phase: "queued" | "running" | "completed" | "failed" | "canceled";
  readonly question?: string;
  readonly questionState: "retained" | "expired" | "deleted";
  readonly contextLabel: string;
  readonly createdAt: number;
  readonly terminal: boolean;
};

export type AthenaAgentHistoryEntry = {
  readonly turnId: string;
  readonly createdAt: number;
  readonly state: string;
  readonly question?: string;
  readonly questionState: "retained" | "expired" | "deleted";
  readonly contextLabel?: string;
  readonly answer?: AthenaAgentAnswer;
  readonly omittedHeadline?: string;
  readonly failureHeadline?: string;
};

export type AthenaAgentSourceState =
  | "idle"
  | "loading"
  | "evidence"
  | "unauthorized"
  | "missing"
  | "error";

export type AthenaAgentSource = {
  readonly citationRef: string;
  readonly state: AthenaAgentSourceState;
  readonly headline?: string;
  readonly label?: string;
  readonly link?: AthenaAgentSourceLink | null;
  readonly freshness?: string;
  readonly completeness?: string;
  readonly capturedAt?: number;
  readonly observedAt?: number;
};

/**
 * How the provisional narrative reads right now. This is a client-derived
 * presentation field, deliberately separate from the server-declared
 * `AgentHostState`: the committed answer is still the only released artifact,
 * and nothing here is allowed to widen that closed union.
 */
export type AthenaAgentProvisionalState =
  | "disabled"
  | "withdrawn"
  | "superseded"
  | "committing"
  | "reset"
  | "paused_at_limit"
  | "streaming"
  | "awaiting_first_text"
  | "stalled"
  | "none";

/** The draft the host paints. Present only while there is text to show. */
export type AthenaAgentProvisionalDraft = {
  readonly text: string;
  readonly truncated: boolean;
  readonly draftOrdinal: number;
};

/** The preview contract, mirrored: only `streaming` ever carries text. */
type NarrativePreview =
  | { readonly state: "not_found" }
  | { readonly state: "withdrawn"; readonly reason: string; readonly released: boolean }
  | {
      readonly state: "disabled" | "awaiting_first_text" | "stalled" | "superseded";
      readonly released: boolean;
    }
  | {
      readonly state: "streaming";
      readonly released: true;
      readonly text: string;
      readonly truncated: boolean;
      readonly draftOrdinal: number;
      readonly updatedAt: number;
      readonly expiresAt: number;
      readonly ttlMs: number;
    };

export type AthenaAgentProvisionalInput = {
  /** The preview's verdict: live, or the latched terminal one for this turn. */
  readonly preview: NarrativePreview | null;
  readonly viewPhase: AthenaAgentTurn["phase"] | null;
  /** `provisionalReleasedAt` on the turn view: text was readable at least once. */
  readonly viewReleased: boolean;
  /** The newest `finalizing` milestone, which the commit reports before it runs. */
  readonly finalizingAt: number | null;
  /** The draft ordinal the client has already painted, if any. */
  readonly lastRenderedOrdinal: number | null;
  /** The row outlived the `ttlMs` the server returned with it. */
  readonly rowExpired: boolean;
};

/**
 * The provisional precedence, first match wins.
 *
 * Two rules carry most of the safety: a draft withdraws only after a release
 * was observed on either query and only while no commit has been observed (so a
 * post-commit suppression stays on the answer surface's own denial and a
 * successful commit never flickers through a withdrawal), and a `completed`
 * turn is `superseded` — the committed answer replaces the draft rather than
 * the draft resolving into it.
 */
export function deriveAthenaProvisionalState(
  input: AthenaAgentProvisionalInput,
): AthenaAgentProvisionalState {
  const preview = input.preview;
  const row = preview?.state === "streaming" ? preview : null;
  const released =
    input.viewReleased ||
    (preview !== null && preview.state !== "not_found" && preview.released);
  const committed = input.viewPhase === "completed";
  const runTerminalUncommitted =
    input.viewPhase === "canceled" || input.viewPhase === "failed";

  if (preview?.state === "disabled") return "disabled";
  if (
    released &&
    !committed &&
    (preview?.state === "withdrawn" || runTerminalUncommitted)
  ) {
    return "withdrawn";
  }
  if (preview?.state === "superseded" || committed) return "superseded";
  if (
    row &&
    !input.rowExpired &&
    input.finalizingAt !== null &&
    input.finalizingAt >= row.updatedAt
  ) {
    return "committing";
  }
  if (
    row &&
    !input.rowExpired &&
    input.lastRenderedOrdinal !== null &&
    row.draftOrdinal > input.lastRenderedOrdinal
  ) {
    return "reset";
  }
  if (row?.truncated && !input.rowExpired) return "paused_at_limit";
  if (row && !input.rowExpired) return "streaming";
  if (input.viewPhase === "running" && !released && !row) {
    return "awaiting_first_text";
  }
  if (
    input.viewPhase === "running" &&
    released &&
    (preview?.state === "stalled" || (row !== null && input.rowExpired))
  ) {
    return "stalled";
  }
  return "none";
}

/** The states that paint draft text. Everything else clears it. */
const PROVISIONAL_TEXT_STATES: ReadonlySet<AthenaAgentProvisionalState> = new Set([
  "streaming",
  "paused_at_limit",
  "committing",
  "reset",
]);

export type AthenaAgentBlockedSubmission = {
  readonly reason: "turn_active" | "context_change" | "unavailable";
  readonly headline: string;
};

export type AthenaAgentAvailability = {
  readonly available: boolean;
  readonly headline?: string;
  readonly detail?: string;
};

export type AthenaAgentRunOptions = {
  readonly presentation: AthenaAgentPresentation;
  readonly storeId: Id<"store">;
  readonly context: AthenaAgentContext;
  readonly routeParams?: Record<string, string | undefined>;
  /** The host is open. Nothing is queried while it is closed. */
  readonly isActive?: boolean;
  /** Reconnect handle carried in authorized view state across navigation. */
  readonly activeTurnId?: TurnId | null;
  readonly onActiveTurnChange?: (turnId: TurnId | null) => void;
  readonly historyLimit?: number;
  readonly createTurnKey?: () => string;
};

export type AthenaAgentRun = {
  readonly hostState: AgentHostState;
  readonly status: AthenaAgentStatus;
  readonly context: AthenaAgentContextView;
  readonly threadKey: string;
  readonly starterIntents: AthenaAgentPresentation["starterIntents"];
  readonly availability: AthenaAgentAvailability;
  readonly history: readonly AthenaAgentHistoryEntry[];
  readonly turn: AthenaAgentTurn | null;
  readonly activeTurnId: TurnId | null;
  readonly answer: AthenaAgentAnswer | null;
  readonly milestones: readonly AthenaAgentMilestone[];
  readonly provisionalState: AthenaAgentProvisionalState;
  readonly provisional: AthenaAgentProvisionalDraft | null;
  readonly provisionalWithdrawal: AthenaAgentProvisionalWithdrawal | null;
  readonly denial: AthenaAgentDenial | null;
  readonly blockedSubmission: AthenaAgentBlockedSubmission | null;
  readonly pendingContextChange: { readonly keys: readonly string[]; readonly label: string } | null;
  readonly contextDrift: boolean;
  readonly sources: Readonly<Record<string, AthenaAgentSource>>;
  readonly isSubmitting: boolean;
  readonly canSubmit: boolean;
  readonly canCancel: boolean;
  readonly canFollowUp: boolean;
  readonly canStartNewThread: boolean;
  readonly canInspectSources: boolean;
  readonly submit: (prompt: string) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly startNewThread: () => void;
  readonly confirmContextChange: () => void;
  readonly dismissDenial: () => void;
  readonly inspectCitation: (citationRef: string) => Promise<void>;
};

const TERMINAL_PHASES = new Set(["completed", "failed", "canceled"]);

function defaultTurnKey() {
  const random = Math.random().toString(36).slice(2, 10);
  return `t${Date.now().toString(36)}${random}`;
}

function newThreadToken() {
  return Math.random().toString(36).slice(2, 10);
}

type TurnView = {
  kind: "view";
  bindingId: TurnId;
  phase: "queued" | "running" | "completed" | "failed" | "canceled";
  milestones: { milestone: string; at: number }[];
  provisionalReleasedAt?: number;
  question?: string;
  context?: Record<string, string>;
  promptState: "retained" | "expired" | "deleted";
  answer: {
    available: boolean;
    outcome?: "answer" | "no_usable_sources";
    suppressed: boolean;
    viewedAt?: number;
  };
  error?: { code: string; retryable: boolean; headline: string };
  canCancel: boolean;
  createdAt: number;
};

type Unavailable = { kind: "unavailable"; reason: string };

function asView(value: unknown): TurnView | null {
  return value && typeof value === "object" && (value as TurnView).kind === "view"
    ? (value as TurnView)
    : null;
}

function asPreview(value: unknown): NarrativePreview | null {
  return value && typeof value === "object" && typeof (value as NarrativePreview).state === "string"
    ? (value as NarrativePreview)
    : null;
}

function asUnavailable(value: unknown): Unavailable | null {
  return value &&
    typeof value === "object" &&
    (value as Unavailable).kind === "unavailable"
    ? (value as Unavailable)
    : null;
}

export function useAthenaAgentRun(options: AthenaAgentRunOptions): AthenaAgentRun {
  const {
    presentation,
    storeId,
    context,
    routeParams = {},
    isActive = true,
    activeTurnId: providedTurnId,
    onActiveTurnChange,
    historyLimit = 12,
    createTurnKey = defaultTurnKey,
  } = options;

  const [threadToken, setThreadToken] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<TurnId | null>(providedTurnId ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [denial, setDenial] = useState<AthenaAgentDenial | null>(null);
  const [blockedSubmission, setBlockedSubmission] =
    useState<AthenaAgentBlockedSubmission | null>(null);
  const [acknowledgedContext, setAcknowledgedContext] = useState(() =>
    snapshotAthenaContext(presentation, context),
  );
  const [receipt, setReceipt] = useState<
    { turnId: TurnId; viewedAt?: number; suppressedReason?: string } | null
  >(null);
  const [sources, setSources] = useState<Record<string, AthenaAgentSource>>({});
  // The preview's durable verdict, kept per turn exactly as the answer receipt
  // is: the subscription ends at that verdict, and `useQuery(…, "skip")` drops
  // its last value, so without this the notice would vanish as it appeared.
  const [previewVerdict, setPreviewVerdict] = useState<{
    turnId: TurnId;
    state: "withdrawn" | "superseded";
    reason?: string;
    released: boolean;
  } | null>(null);
  // The draft ordinal already on screen. It is state, not a ref, because the
  // reset cue is the render in which the row's ordinal is ahead of it.
  const [renderedOrdinal, setRenderedOrdinal] = useState<{
    turnId: TurnId;
    ordinal: number;
  } | null>(null);
  // The one client-side timer this host owns: a row that outlives the `ttlMs`
  // the server returned with it is dropped without waiting for new data.
  const [expiredRowKey, setExpiredRowKey] = useState<string | null>(null);

  const baseThreadKey = composeAthenaThreadKey(presentation, context);
  const threadKey = useMemo(
    () => composeAthenaThreadKey(presentation, context, threadToken ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- context is a plain value bag; the composed base key is its identity.
    [presentation, baseThreadKey, threadToken],
  );

  const startTurn = useMutation(api.agentHarness.turns.startTurn);
  const cancelTurn = useMutation(api.agentHarness.turns.cancelTurn);
  const resumeTurn = useMutation(api.agentHarness.turns.resumeTurn);
  const acknowledgeTurnAnswer = useMutation(
    api.agentHarness.turns.acknowledgeTurnAnswer,
  );
  const inspectCitationEvidence = useMutation(
    api.agentHarness.turns.inspectCitationEvidence,
  );
  const acknowledgeProvisionalView = useMutation(
    api.agentHarness.turns.acknowledgeProvisionalView,
  );

  const historyResult = useQuery(
    api.agentHarness.turns.getThreadHistory,
    isActive
      ? {
          storeId,
          profileId: presentation.profileId,
          threadKey,
          limit: historyLimit,
        }
      : "skip",
  );
  const viewResult = useQuery(
    api.agentHarness.turns.getTurnView,
    isActive && turnId ? { storeId, bindingId: turnId } : "skip",
  );

  const view = asView(viewResult);
  const viewUnavailable = asUnavailable(viewResult);
  const historyUnavailable = asUnavailable(historyResult);

  const releaseReady =
    view !== null &&
    view.phase === "completed" &&
    view.answer.available &&
    !view.answer.suppressed;
  const answerResult = useQuery(
    api.agentHarness.turns.getTurnAnswer,
    isActive && turnId && releaseReady ? { storeId, bindingId: turnId } : "skip",
  );

  // The preview is read while the panel is open and the turn is running, and
  // also while the turn view has gone `unavailable`: the view drops first on
  // disablement or membership loss, and the preview has to outlive it to
  // deliver `released` and the withdrawal. It is dropped once a durable verdict
  // for this turn is latched or the run reaches a terminal phase.
  const latchedVerdict =
    previewVerdict && previewVerdict.turnId === turnId ? previewVerdict : null;
  const previewResult = useQuery(
    api.agentHarness.turns.previewTurnNarrative,
    isActive &&
      turnId &&
      latchedVerdict === null &&
      (view?.phase === "running" || viewUnavailable !== null)
      ? { storeId, bindingId: turnId }
      : "skip",
  );
  const livePreview = asPreview(previewResult);

  // `not_found` is the pre-ownership arm: it is neither latched nor a reason to
  // stop reading, because a mid-turn epoch advance or egress downgrade has no
  // other source of `withdrawn`.
  useEffect(() => {
    if (!turnId || !livePreview) return;
    if (livePreview.state !== "withdrawn" && livePreview.state !== "superseded") {
      return;
    }
    const next = {
      turnId,
      state: livePreview.state,
      ...(livePreview.state === "withdrawn" ? { reason: livePreview.reason } : {}),
      released: livePreview.released,
    };
    setPreviewVerdict((current) =>
      current &&
      current.turnId === next.turnId &&
      current.state === next.state &&
      current.reason === next.reason &&
      current.released === next.released
        ? current
        : next,
    );
  }, [livePreview, turnId]);

  const preview: NarrativePreview | null = latchedVerdict
    ? latchedVerdict.state === "withdrawn"
      ? {
          state: "withdrawn",
          reason: latchedVerdict.reason ?? "suppressed",
          released: latchedVerdict.released,
        }
      : { state: "superseded", released: latchedVerdict.released }
    : livePreview;

  const row = preview?.state === "streaming" ? preview : null;
  // The row's identity for the deadline timer: any new server data re-arms it.
  const rowKey = row
    ? `${turnId ?? ""}:${row.draftOrdinal}:${row.updatedAt}:${row.expiresAt}`
    : null;
  const rowTtlMs = row?.ttlMs ?? 0;
  useEffect(() => {
    if (rowKey === null) return;
    const timer = window.setTimeout(
      () => setExpiredRowKey(rowKey),
      Math.max(0, rowTtlMs),
    );
    return () => window.clearTimeout(timer);
  }, [rowKey, rowTtlMs]);
  const rowExpired = rowKey !== null && expiredRowKey === rowKey;

  // Latest mutation handles for effects, so a re-created binding never re-fires one.
  const resumeRef = useRef(resumeTurn);
  resumeRef.current = resumeTurn;
  const acknowledgeRef = useRef(acknowledgeTurnAnswer);
  acknowledgeRef.current = acknowledgeTurnAnswer;
  const acknowledgeProvisionalRef = useRef(acknowledgeProvisionalView);
  acknowledgeProvisionalRef.current = acknowledgeProvisionalView;

  const startedHereRef = useRef<TurnId | null>(null);
  const resumedRef = useRef<TurnId | null>(null);
  const acknowledgedTurnRef = useRef<TurnId | null>(null);
  const acknowledgedProvisionalTurnRef = useRef<TurnId | null>(null);
  const providedTurnRef = useRef<TurnId | null>(providedTurnId ?? null);
  const threadBaseRef = useRef(baseThreadKey);
  const notifiedTurnRef = useRef<TurnId | null>(providedTurnId ?? null);

  // A changed reconnect handle (navigation, reload) adopts that turn.
  useEffect(() => {
    const next = providedTurnId ?? null;
    if (next === providedTurnRef.current) return;
    providedTurnRef.current = next;
    setTurnId(next);
  }, [providedTurnId]);

  // A different context key composes a different thread: the old thread detaches.
  useEffect(() => {
    if (threadBaseRef.current === baseThreadKey) return;
    threadBaseRef.current = baseThreadKey;
    setThreadToken(null);
    setTurnId(null);
    setDenial(null);
    setBlockedSubmission(null);
    setCancelRequested(false);
    setReceipt(null);
    setSources({});
    setPreviewVerdict(null);
    setRenderedOrdinal(null);
    setExpiredRowKey(null);
    acknowledgedProvisionalTurnRef.current = null;
    setAcknowledgedContext(snapshotAthenaContext(presentation, context));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the composed base key is the context identity.
  }, [baseThreadKey]);

  useEffect(() => {
    if (notifiedTurnRef.current === turnId) return;
    notifiedTurnRef.current = turnId;
    onActiveTurnChange?.(turnId);
  }, [turnId, onActiveTurnChange]);

  // Reconnect: repair a turn this session did not start. Never starts a new one.
  useEffect(() => {
    if (!isActive || !turnId) return;
    if (startedHereRef.current === turnId) return;
    if (resumedRef.current === turnId) return;
    resumedRef.current = turnId;
    void resumeRef.current({ storeId, bindingId: turnId });
  }, [isActive, turnId, storeId]);

  // Release is what the operator can read; the receipt is recorded separately.
  useEffect(() => {
    if (!turnId) return;
    const released = answerResult as { kind?: string } | undefined;
    if (!released || released.kind !== "answer") return;
    if (acknowledgedTurnRef.current === turnId) return;
    acknowledgedTurnRef.current = turnId;
    const currentTurnId = turnId;
    void (async () => {
      const outcome = await runCommand(async () =>
        ok(await acknowledgeRef.current({ storeId, bindingId: currentTurnId })),
      );
      if (outcome.kind !== "ok") return;
      const data = outcome.data as
        | { kind: "acknowledged"; operatorViewedAt: number }
        | { kind: "suppressed"; reason: string }
        | { kind: "unavailable"; reason: string };
      if (data.kind === "acknowledged") {
        setReceipt({ turnId: currentTurnId, viewedAt: data.operatorViewedAt });
        return;
      }
      setReceipt({ turnId: currentTurnId, suppressedReason: data.reason });
    })();
  }, [answerResult, turnId, storeId]);

  const contextView = describeAthenaContext(
    presentation,
    context,
    acknowledgedContext,
  );
  const pendingContextChange = useMemo(
    () =>
      contextView.changedSnapshotKeys.length > 0
        ? { keys: contextView.changedSnapshotKeys, label: contextView.label }
        : null,
    [contextView.changedSnapshotKeys, contextView.label],
  );

  const turnContext = view?.context;
  const contextDrift = turnContext
    ? presentation.contextBinding.keys.some(
        (key) => (turnContext[key] ?? "") !== (context[key] ?? ""),
      )
    : false;

  const suppressedReason =
    receipt && receipt.turnId === turnId ? receipt.suppressedReason : undefined;
  const receiptViewedAt =
    receipt && receipt.turnId === turnId ? receipt.viewedAt : undefined;

  const answer: AthenaAgentAnswer | null = useMemo(() => {
    const released = answerResult;
    if (!released || released.kind !== "answer") return null;
    if (suppressedReason) return null;
    // `kind` is the query envelope, not part of the answer the host renders.
    const { kind, ...rest } = released;
    void kind;
    return {
      ...rest,
      ...(receiptViewedAt !== undefined ? { viewedAt: receiptViewedAt } : {}),
    };
  }, [answerResult, suppressedReason, receiptViewedAt]);

  const milestones: AthenaAgentMilestone[] = useMemo(() => {
    if (!view) return [];
    return view.milestones.flatMap((entry) => {
      const label = describeAthenaMilestone(entry.milestone);
      return label
        ? [{ milestone: entry.milestone, label, at: entry.at }]
        : [];
    });
  }, [view]);

  // `finalizing` fires after the cheap denials and before the commit, and the
  // milestone array only grows, so the comparison is level-based: a panel that
  // mounts after the milestone still reads `committing`, and a resumed draft's
  // flush moves `updatedAt` past it to return to `streaming`.
  const finalizingAt = useMemo(() => {
    if (!view) return null;
    let newest: number | null = null;
    for (const entry of view.milestones) {
      if (entry.milestone !== "finalizing") continue;
      if (newest === null || entry.at > newest) newest = entry.at;
    }
    return newest;
  }, [view]);

  const provisionalState = deriveAthenaProvisionalState({
    preview,
    viewPhase: view?.phase ?? null,
    viewReleased: view?.provisionalReleasedAt !== undefined,
    finalizingAt,
    lastRenderedOrdinal:
      renderedOrdinal && renderedOrdinal.turnId === turnId
        ? renderedOrdinal.ordinal
        : null,
    rowExpired,
  });

  const provisional: AthenaAgentProvisionalDraft | null = useMemo(
    () =>
      row && PROVISIONAL_TEXT_STATES.has(provisionalState)
        ? {
            text: row.text,
            truncated: row.truncated,
            draftOrdinal: row.draftOrdinal,
          }
        : null,
    [provisionalState, row],
  );

  const provisionalWithdrawal: AthenaAgentProvisionalWithdrawal | null =
    provisionalState === "withdrawn"
      ? describeProvisionalWithdrawal(
          preview?.state === "withdrawn"
            ? preview.reason
            : view?.phase === "canceled"
              ? "run_canceled"
              : "run_failed",
        )
      : null;

  // Record the painted ordinal after the render that painted it, so the first
  // row of a mount or a reconnect is never mistaken for a restart and a genuine
  // restart lasts exactly one render.
  useEffect(() => {
    if (!turnId || !row) return;
    setRenderedOrdinal((current) =>
      current && current.turnId === turnId && current.ordinal >= row.draftOrdinal
        ? current
        : { turnId, ordinal: row.draftOrdinal },
    );
  }, [row, turnId]);

  // Confirmed receipt of provisional text: best effort, once per turn, on the
  // first paint of non-empty draft text. It is deliberately weaker than the
  // answer receipt and never feeds a host state.
  useEffect(() => {
    if (!turnId) return;
    if (acknowledgedProvisionalTurnRef.current === turnId) return;
    if (!provisional || provisional.text.trim().length === 0) return;
    acknowledgedProvisionalTurnRef.current = turnId;
    const currentTurnId = turnId;
    void runCommand(async () =>
      ok(
        await acknowledgeProvisionalRef.current({
          storeId,
          bindingId: currentTurnId,
        }),
      ),
    );
  }, [provisional, storeId, turnId]);

  const terminal = view ? TERMINAL_PHASES.has(view.phase) : false;
  const turnActive = Boolean(turnId) && !terminal && !viewUnavailable;

  const availability: AthenaAgentAvailability = useMemo(() => {
    const blocking = historyUnavailable ?? viewUnavailable;
    if (!blocking) return { available: true };
    const described = describeAthenaUnavailable(blocking.reason, "conversation");
    if (described.state === "profile_unavailable" || described.state === "authority_lost") {
      return {
        available: false,
        headline: described.headline,
        ...(described.detail ? { detail: described.detail } : {}),
      };
    }
    return { available: true };
  }, [historyUnavailable, viewUnavailable]);

  const turn: AthenaAgentTurn | null = view
    ? {
        turnId: view.bindingId,
        phase: view.phase,
        ...(view.question !== undefined ? { question: view.question } : {}),
        questionState: view.promptState,
        contextLabel: view.context
          ? presentation.contextLabel(view.context)
          : contextView.label,
        createdAt: view.createdAt,
        terminal,
      }
    : null;

  const { hostState, status } = useMemo<{
    hostState: AgentHostState;
    status: AthenaAgentStatus;
  }>(() => {
    const blocking = historyUnavailable ?? viewUnavailable;
    if (blocking) {
      const described = describeAthenaUnavailable(blocking.reason, "answer");
      return {
        hostState: "terminal_denied",
        status: {
          headline: described.headline,
          ...(described.detail ? { detail: described.detail } : {}),
          tone: "warning",
        },
      };
    }
    if (suppressedReason) {
      const described = describeAthenaUnavailable(suppressedReason, "answer");
      return {
        hostState: "terminal_denied",
        status: { headline: described.headline, tone: "warning" },
      };
    }
    if (
      isSubmitting ||
      (turnId && view?.phase === "queued") ||
      // A turn this session just started, still waiting for its first view: the
      // request is starting, not reconnecting.
      (turnId && !view && startedHereRef.current === turnId)
    ) {
      return {
        hostState: "submitting",
        status: { headline: "Starting your request…", tone: "progress" },
      };
    }
    if (turnId && !view) {
      return {
        hostState: "reconnecting",
        status: {
          headline: "Reconnecting…",
          detail: "Your question is still with Athena.",
          tone: "progress",
        },
      };
    }
    if (view && cancelRequested && !terminal) {
      return {
        hostState: "cancellation_requested",
        status: {
          headline: "Stopping…",
          detail: "Anything already gathered stays provisional.",
          tone: "progress",
        },
      };
    }
    if (!view) {
      return {
        hostState: "idle",
        status: {
          headline: "Ask about this store day.",
          detail: "Athena reads only what you can already see.",
          tone: "neutral",
        },
      };
    }
    if (view.phase === "queued") {
      return {
        hostState: "submitting",
        status: { headline: "Starting your request…", tone: "progress" },
      };
    }
    if (view.phase === "running") {
      const latest = milestones[milestones.length - 1];
      return {
        hostState: "running",
        status: {
          headline: latest?.label ?? "Working on your question",
          tone: "progress",
        },
      };
    }
    if (view.phase === "canceled") {
      return {
        hostState: "terminal_denied",
        status: { headline: "Stopped.", tone: "neutral" },
      };
    }
    if (view.promptState !== "retained" && !answer) {
      const failure = view.error
        ? describeAthenaFailure(view.error.code)
        : {
            headline: "The question is no longer stored.",
            detail: "Ask it again to get a fresh answer.",
          };
      return {
        hostState: "expired_content",
        status: {
          headline: failure.headline,
          ...(failure.detail ? { detail: failure.detail } : {}),
          tone: "warning",
        },
      };
    }
    if (view.phase === "failed") {
      const failure = describeAthenaFailure(view.error?.code ?? "unknown");
      return {
        hostState: "terminal_denied",
        status: {
          headline: failure.headline,
          ...(failure.detail ? { detail: failure.detail } : {}),
          tone: "warning",
        },
      };
    }
    if (view.answer.suppressed) {
      return {
        hostState: "terminal_denied",
        status: {
          headline: "This answer is no longer available to you.",
          tone: "warning",
        },
      };
    }
    if (!answer) {
      return {
        hostState: "running",
        status: { headline: "Finishing up", tone: "progress" },
      };
    }
    if (answer.outcome === "no_usable_sources") {
      return {
        hostState: "no_usable_sources",
        status: {
          headline: "No sources could be read for this question.",
          detail: "Nothing here is a guess.",
          tone: "warning",
        },
      };
    }
    if (answer.limitedEvidence) {
      return {
        hostState: "partial",
        status: {
          headline: "Answered with limited evidence.",
          detail: "Some sources were incomplete.",
          tone: "warning",
        },
      };
    }
    return {
      hostState: "completed",
      status: { headline: "Answered.", tone: "neutral" },
    };
  }, [
    answer,
    cancelRequested,
    historyUnavailable,
    isSubmitting,
    milestones,
    suppressedReason,
    terminal,
    turnId,
    view,
    viewUnavailable,
  ]);

  const history: AthenaAgentHistoryEntry[] = useMemo(() => {
    const result = historyResult as
      | {
          kind: "history";
          entries: {
            bindingId: string;
            createdAt: number;
            state: string;
            questionState: "retained" | "expired" | "deleted";
            question?: string;
            context?: Record<string, string>;
            answer?: AthenaAgentAnswer;
            omittedReason?: string;
            error?: { code: string; retryable: boolean };
          }[];
        }
      | undefined;
    if (!result || result.kind !== "history") return [];
    return result.entries.map((entry) => ({
      turnId: entry.bindingId,
      createdAt: entry.createdAt,
      state: entry.state,
      ...(entry.question !== undefined ? { question: entry.question } : {}),
      questionState: entry.questionState,
      ...(entry.context
        ? { contextLabel: presentation.contextLabel(entry.context) }
        : {}),
      ...(entry.answer ? { answer: entry.answer } : {}),
      ...(entry.omittedReason
        ? {
            omittedHeadline: describeAthenaUnavailable(entry.omittedReason)
              .headline,
          }
        : {}),
      ...(entry.error
        ? { failureHeadline: describeAthenaFailure(entry.error.code).headline }
        : {}),
    }));
  }, [historyResult, presentation]);

  const canSubmit =
    availability.available &&
    !isSubmitting &&
    !turnActive &&
    !(cancelRequested && !terminal) &&
    pendingContextChange === null;

  const submit = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      setBlockedSubmission(null);
      if (trimmed.length === 0) {
        setDenial(describeAthenaDenial("prompt_empty"));
        return;
      }
      if (!availability.available) {
        setBlockedSubmission({
          reason: "unavailable",
          headline:
            availability.headline ??
            "Ask Athena isn't available for this store right now.",
        });
        return;
      }
      if (pendingContextChange) {
        setBlockedSubmission({
          reason: "context_change",
          headline: "Confirm the operating day before asking again.",
        });
        return;
      }
      if (isSubmitting || turnActive) {
        setBlockedSubmission({
          reason: "turn_active",
          headline: "Athena is still working on your last question.",
        });
        return;
      }
      setDenial(null);
      setIsSubmitting(true);
      const outcome = await runCommand(async () =>
        ok(
          await startTurn({
            storeId,
            profileId: presentation.profileId,
            threadKey,
            turnIdempotencyKey: createTurnKey(),
            prompt: trimmed,
            context: snapshotAthenaContext(presentation, context),
          }),
        ),
      );
      setIsSubmitting(false);
      if (outcome.kind !== "ok") {
        setDenial(describeAthenaDenial("unexpected_error"));
        return;
      }
      const result = outcome.data as
        | { outcome: "started" | "resumed"; bindingId: TurnId }
        | { outcome: "denied"; code: string };
      if (result.outcome === "denied") {
        setDenial(describeAthenaDenial(result.code));
        return;
      }
      startedHereRef.current = result.bindingId;
      acknowledgedTurnRef.current = null;
      acknowledgedProvisionalTurnRef.current = null;
      setReceipt(null);
      setSources({});
      setPreviewVerdict(null);
      setRenderedOrdinal(null);
      setExpiredRowKey(null);
      setCancelRequested(false);
      setTurnId(result.bindingId);
    },
    [
      availability.available,
      availability.headline,
      context,
      createTurnKey,
      isSubmitting,
      pendingContextChange,
      presentation,
      startTurn,
      storeId,
      threadKey,
      turnActive,
    ],
  );

  const cancel = useCallback(async () => {
    if (!turnId) return;
    setCancelRequested(true);
    const outcome = await runCommand(async () =>
      ok(await cancelTurn({ storeId, bindingId: turnId })),
    );
    if (outcome.kind !== "ok") setCancelRequested(false);
  }, [cancelTurn, storeId, turnId]);

  const startNewThread = useCallback(() => {
    setThreadToken(newThreadToken());
    setTurnId(null);
    setDenial(null);
    setBlockedSubmission(null);
    setCancelRequested(false);
    setReceipt(null);
    setSources({});
    setPreviewVerdict(null);
    setRenderedOrdinal(null);
    setExpiredRowKey(null);
    acknowledgedTurnRef.current = null;
    acknowledgedProvisionalTurnRef.current = null;
  }, []);

  const confirmContextChange = useCallback(() => {
    setAcknowledgedContext(snapshotAthenaContext(presentation, context));
    setBlockedSubmission(null);
  }, [context, presentation]);

  const dismissDenial = useCallback(() => setDenial(null), []);

  const inspectCitation = useCallback(
    async (citationRef: string) => {
      if (!turnId) return;
      setSources((current) => ({
        ...current,
        [citationRef]: { citationRef, state: "loading" },
      }));
      const outcome = await runCommand(async () =>
        ok(
          await inspectCitationEvidence({
            storeId,
            bindingId: turnId,
            citationRef,
          }),
        ),
      );
      if (outcome.kind !== "ok") {
        setSources((current) => ({
          ...current,
          [citationRef]: {
            citationRef,
            state: "error",
            headline: "Athena couldn't open this source.",
          },
        }));
        return;
      }
      const evidence = outcome.data as
        | {
            kind: "evidence";
            state: string;
            citation: {
              sourceRef: { ref: string; kind?: string; label?: string };
              freshness?: string;
              completeness?: string;
              capturedAt?: number;
              observedAt?: number;
            };
          }
        | { kind: "not_found" }
        | { kind: "unauthorized"; reason: string };
      if (evidence.kind === "unauthorized") {
        setSources((current) => ({
          ...current,
          [citationRef]: {
            citationRef,
            state: "unauthorized",
            headline: describeAthenaUnavailable(evidence.reason, "source")
              .headline,
          },
        }));
        return;
      }
      if (evidence.kind === "not_found") {
        setSources((current) => ({
          ...current,
          [citationRef]: {
            citationRef,
            state: "missing",
            headline: "Athena can't find this source.",
          },
        }));
        return;
      }
      const link = resolveAthenaSourceLink(
        presentation,
        evidence.citation.sourceRef,
        routeParams,
      );
      setSources((current) => ({
        ...current,
        [citationRef]: {
          citationRef,
          state: "evidence",
          ...(evidence.citation.sourceRef.label
            ? { label: evidence.citation.sourceRef.label }
            : {}),
          link,
          ...(evidence.citation.freshness
            ? { freshness: evidence.citation.freshness }
            : {}),
          ...(evidence.citation.completeness
            ? { completeness: evidence.citation.completeness }
            : {}),
          ...(evidence.citation.capturedAt !== undefined
            ? { capturedAt: evidence.citation.capturedAt }
            : {}),
          ...(evidence.citation.observedAt !== undefined
            ? { observedAt: evidence.citation.observedAt }
            : {}),
        },
      }));
    },
    [inspectCitationEvidence, presentation, routeParams, storeId, turnId],
  );

  return {
    hostState,
    status,
    context: contextView,
    threadKey,
    starterIntents: presentation.starterIntents,
    availability,
    history,
    turn,
    activeTurnId: turnId,
    answer,
    milestones,
    provisionalState,
    provisional,
    provisionalWithdrawal,
    denial,
    blockedSubmission,
    pendingContextChange,
    contextDrift,
    sources,
    isSubmitting,
    canSubmit,
    canCancel: Boolean(turnId) && !terminal && !viewUnavailable,
    canFollowUp: canSubmit && !contextDrift,
    canStartNewThread: !isSubmitting,
    canInspectSources: answer !== null,
    submit,
    cancel,
    startNewThread,
    confirmContextChange,
    dismissDenial,
    inspectCitation,
  };
}
