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
  resolveAthenaSourceLink,
  snapshotAthenaContext,
  type AthenaAgentContext,
  type AthenaAgentContextView,
  type AthenaAgentDenial,
  type AthenaAgentPresentation,
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

  // Latest mutation handles for effects, so a re-created binding never re-fires one.
  const resumeRef = useRef(resumeTurn);
  resumeRef.current = resumeTurn;
  const acknowledgeRef = useRef(acknowledgeTurnAnswer);
  acknowledgeRef.current = acknowledgeTurnAnswer;

  const startedHereRef = useRef<TurnId | null>(null);
  const resumedRef = useRef<TurnId | null>(null);
  const acknowledgedTurnRef = useRef<TurnId | null>(null);
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
    const released = answerResult as
      | (AthenaAgentAnswer & { kind: "answer" })
      | { kind: "unavailable" }
      | undefined;
    if (!released || released.kind !== "answer") return null;
    if (suppressedReason) return null;
    // `kind` is the query envelope, not part of the answer the host renders.
    const { kind, ...rest } = released;
    void kind;
    return {
      ...(rest as unknown as AthenaAgentAnswer),
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
      setReceipt(null);
      setSources({});
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
    acknowledgedTurnRef.current = null;
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
