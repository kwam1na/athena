/**
 * The reusable Athena agent host.
 *
 * One implementation serves every profile: the surface supplies a presentation
 * adapter (entry label, authorized context, starter intents, source
 * destinations, thread-key policy) and the host owns everything else —
 * submission, state transitions, cancellation, completion quality, evidence
 * display, responsive layout, and accessibility. There is no surface-specific
 * branching here, and the model-authored narrative is rendered only through the
 * inert text pipeline.
 */
import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  Plus,
  Square,
  X,
} from "lucide-react";
import { BorderBeam } from "border-beam";

import { cn, formatAbsoluteTimestamp } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Id } from "~/convex/_generated/dataModel";

import { AthenaAgentSafeText } from "./AthenaAgentSafeText";
import {
  WORD_INK_MS,
  characterCount,
  revealDuration,
  revealedProse,
  type RevealMode,
} from "./streamReveal";
import {
  composeAthenaThreadKey,
  describeAthenaProvisionalCue,
  describeAthenaProvisionalTimelineEmpty,
  snapshotAthenaContext,
  type AthenaAgentContext,
  type AthenaAgentPresentation,
} from "./AthenaAgentPresentationAdapter";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import {
  useAthenaAgentNarrativeTrail,
  useAthenaAgentRun,
  type AthenaAgentAnswer,
  type AthenaAgentHistoryEntry,
  PROVISIONAL_TIMELINE_STATES,
  type AthenaAgentProvisionalState,
  type AthenaAgentRun,
} from "./useAthenaAgentRun";

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 720;
const DEFAULT_PANEL_WIDTH = 420;
const WIDTH_STEP = 32;

/** Every operable control clears the minimum touch target. */
const TOUCH_TARGET = "min-h-[44px] min-w-[44px]";

/** Running draft states that keep the elapsed-work section visible. */
const PROVISIONAL_VISIBLE_STATES: ReadonlySet<AthenaAgentProvisionalState> =
  new Set([
    "awaiting_first_text",
    "streaming",
    "reset",
    "paused_at_limit",
    "committing",
    "stalled",
  ]);

/** Close enough to the bottom to count as reading the latest. */
const SCROLL_FOLLOW_SLACK = 24;

/**
 * Scroll following, after the chat panel in kwamina-fyi. The transcript keeps
 * the latest text in view as it arrives, a question or the floating button
 * starts the follow, and direct interaction with the transcript — a wheel, a
 * pointer, a touch, a navigation key — hands the reading position back until
 * the operator asks for the latest again. The container scrolls smoothly, so
 * the follow is withdrawn by intent, never by position: a smooth scroll in
 * flight is away from the bottom for a few frames and must not cancel itself.
 */
function anchorToBottom(node: HTMLDivElement) {
  node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
}

/** Position without a glide: a mount or a restored position is not a movement. */
function positionAt(node: HTMLDivElement, top: number | "bottom") {
  const previous = node.style.scrollBehavior;
  node.style.scrollBehavior = "auto";
  if (top === "bottom") anchorToBottom(node);
  else node.scrollTop = top;
  node.style.scrollBehavior = previous;
}

function awayFromLatest(node: HTMLDivElement) {
  return (
    node.scrollHeight - node.clientHeight - node.scrollTop > SCROLL_FOLLOW_SLACK
  );
}

/** Keys that scroll the transcript from wherever focus is inside it. */
const SCROLL_INTERRUPT_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

export type AthenaAgentLayout = "docked" | "fullscreen";

/**
 * Stream reveal for model prose, after the chat panel in kwamina-fyi: the
 * painted text is a prefix of the buffer, and every update runs one brief
 * linear reveal from the prefix already on screen to the new length, so a
 * flush extends the reveal from where it is and the text never sits far
 * behind the buffer. A key change is a new text (a new draft, a new turn):
 * while streaming it starts from nothing and is seen to arrive; a finished
 * text the panel mounts onto is painted whole. Reduced motion, and a text
 * that is not an extension of what is visible, paint at once.
 */
function useStreamingText(input: {
  text: string | null;
  key: string | null;
  /** Draft flushes, draft tails, and atomic final answers have distinct pacing. */
  revealMode: RevealMode;
  /** A new key is seen to arrive from nothing instead of painting whole. */
  arrives: boolean;
  animate: boolean;
}): { text: string | null; settled: boolean } {
  const { text, key, revealMode, arrives, animate } = input;
  const visibleRef = useRef<{ key: string; text: string } | null>(null);
  const frameRef = useRef<number | null>(null);
  const [visible, setVisible] = useState<{ key: string; text: string } | null>(
    null,
  );

  useEffect(() => {
    const stop = () => {
      if (
        frameRef.current !== null &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
    };
    stop();
    if (text === null || key === null) {
      visibleRef.current = null;
      setVisible((current) => (current === null ? current : null));
      return;
    }
    const paint = (next: string) => {
      visibleRef.current = { key, text: next };
      setVisible((current) =>
        current && current.key === key && current.text === next
          ? current
          : { key, text: next },
      );
    };
    const current =
      visibleRef.current && visibleRef.current.key === key
        ? visibleRef.current.text
        : null;
    // A new key that arrives live starts from nothing; a new key the panel
    // mounts onto (an answer after a reload, a turn read back) is painted whole.
    const from = current ?? (arrives && animate ? "" : text);
    const revealImmediately = !animate || !text.startsWith(from);
    if (revealImmediately) {
      paint(text);
      return;
    }
    const visibleLength = characterCount(from);
    const targetLength = characterCount(text);
    const pending = targetLength - visibleLength;
    if (pending <= 0) {
      paint(text);
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      paint(text);
      return;
    }
    paint(revealedProse(text, visibleLength));
    const duration = revealDuration(pending, revealMode);
    const now = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const startedAt = now();
    const tick = () => {
      frameRef.current = null;
      const elapsed = now() - startedAt;
      const progress = Math.min(1, elapsed / duration);
      const count = visibleLength + pending * progress;
      if (progress >= 1) {
        paint(text);
        return;
      }
      paint(revealedProse(text, count));
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return stop;
  }, [text, key, revealMode, arrives, animate]);

  if (text === null || key === null) return { text: null, settled: true };
  const shown = visible && visible.key === key ? visible.text : null;
  if (shown === null)
    return {
      text: arrives && animate ? "" : text,
      settled: !(arrives && animate),
    };
  return { text: shown, settled: shown === text };
}

/**
 * Whether the words of a text should arrive with the ink wipe. The wipe is on
 * while the text is still streaming or being revealed, and is held for one
 * more fade once it settles so the last words to arrive finish fading before
 * their spans are dropped; the spans are keyed by position, so dropping them
 * afterwards moves nothing.
 */
function useWordWipe(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (active) {
      setHeld(true);
      return;
    }
    if (!held) return;
    const timer = setTimeout(() => setHeld(false), WORD_INK_MS);
    return () => clearTimeout(timer);
  }, [active, held]);
  return active || held;
}

function usePrefersReducedMotion() {
  // Read on the first render: a reveal or a word wipe must never start on a
  // frame that runs before the preference is known.
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

function formatTurnDuration(startedAt: number, endedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

/** An isolated clock: its one-second ticks must not rerender or re-scroll the transcript. */
function WorkingDuration({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <span
      className="font-numeric text-sm tabular-nums text-muted-foreground"
      data-testid="athena-agent-draft-duration"
    >
      Working for {formatTurnDuration(startedAt, now)}
    </span>
  );
}

function WorkedDuration({
  startedAt,
  committedAt,
}: {
  startedAt: number;
  committedAt: number;
}) {
  return (
    <span
      className="font-numeric text-sm tabular-nums text-muted-foreground"
      data-testid="athena-agent-draft-duration"
    >
      Worked for {formatTurnDuration(startedAt, committedAt)}
    </span>
  );
}

function describeQuality(answer: AthenaAgentAnswer): {
  label: string;
  tone: "neutral" | "warning";
} {
  if (answer.outcome === "no_usable_sources") {
    return { label: "No usable sources", tone: "warning" };
  }
  if (answer.outcome === "needs_clarification") {
    return { label: "Needs your answer", tone: "warning" };
  }
  if (answer.limitedEvidence)
    return { label: "Limited evidence", tone: "warning" };
  return { label: "Complete answer", tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export type AthenaAgentPanelProps = {
  readonly presentation: AthenaAgentPresentation;
  readonly run: AthenaAgentRun;
  readonly layout: AthenaAgentLayout;
  readonly draft: string;
  readonly onDraftChange: (draft: string) => void;
  readonly width: number;
  readonly onWidthChange: (width: number) => void;
  readonly onClose: () => void;
  readonly returnLabel?: string;
  readonly scrollTop?: number | null;
  readonly onScrollTopChange?: (scrollTop: number) => void;
};

export function AthenaAgentPanel({
  presentation,
  run,
  layout,
  draft,
  onDraftChange,
  width,
  onWidthChange,
  onClose,
  returnLabel,
  scrollTop = null,
  onScrollTopChange,
}: AthenaAgentPanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTopRef = useRef<number | null>(scrollTop);
  const currentQuestionRef = useRef<HTMLDivElement>(null);
  const currentTranscriptRef = useRef<HTMLElement>(null);
  const withdrawnRef = useRef<HTMLDivElement>(null);
  const previousState = useRef<{
    hostState: AthenaAgentRun["hostState"];
    provisionalState: AthenaAgentRun["provisionalState"];
  } | null>(null);
  /**
   * The turn whose focus a withdrawal notice already claimed. Every cause that
   * withdraws a draft also ends the run moments later, and that terminal denial
   * would otherwise be a second move for one outcome. It is keyed by turn — the
   * panel stays mounted across New thread — and it never suppresses the
   * operator's own stop or a later denial after completion.
   */
  const focusClaimedTurnRef = useRef<AthenaAgentRun["activeTurnId"]>(null);
  const followRef = useRef(true);
  const pendingQuestionAlignmentRef = useRef<{ prompt: string } | undefined>(
    undefined,
  );
  // Teardown for a question-top smooth scroll still settling; owned by the
  // settle itself (or the operator interrupting), never by effect re-runs.
  const activeQuestionSettleRef = useRef<(() => void) | null>(null);
  useEffect(() => () => activeQuestionSettleRef.current?.(), []);
  const [questionTopActive, setQuestionTopActive] = useState(false);
  const mountedScrollRef = useRef(false);
  const latestRef = useRef<HTMLButtonElement>(null);
  // The panel's own focus moves (status and withdrawn notice) land inside the
  // transcript; they are not the operator reading there and must not withdraw
  // the follow. `focus()` dispatches its events synchronously, so a flag around
  // the call is enough.
  const ownFocusRef = useRef(false);
  const focusOwn = useCallback((node: HTMLElement | null | undefined) => {
    if (!node) return;
    ownFocusRef.current = true;
    try {
      node.focus();
    } finally {
      ownFocusRef.current = false;
    }
  }, []);
  const [latestVisible, setLatestVisible] = useState(false);
  const [draftCue, setDraftCue] = useState<{
    key: string;
    ordinal: number | null;
    text: string;
  } | null>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  useEffect(() => {
    savedScrollTopRef.current = scrollTop;
  }, [scrollTop]);
  // Restore every physical scroll container the panel installs. A detached
  // panel reopening and a docked/full-screen layout swap both replace this DOM
  // node, and zero is a legitimate saved reading position rather than an
  // "uncaptured" sentinel.
  const setScrollNode = useCallback((node: HTMLDivElement | null) => {
    if (scrollRef.current === node) return;
    // A layout swap replaces the scroll container: a settle still gliding the
    // old node must not hold the follow suppressed on the new one.
    activeQuestionSettleRef.current?.();
    scrollRef.current = node;
    if (!node) return;
    mountedScrollRef.current = false;
    const savedScrollTop = savedScrollTopRef.current;
    if (savedScrollTop !== null) {
      positionAt(node, savedScrollTop);
      followRef.current = !awayFromLatest(node);
    }
  }, []);

  const provisionalState = run.provisionalState;
  const draftOrdinal = run.provisional?.draftOrdinal ?? null;
  const draftText = run.provisional?.text ?? null;
  // The live draft is revealed flush by flush; a new draft is seen to start,
  // and a draft that stopped growing (committing, paused) settles briskly.
  const draftStreaming =
    provisionalState === "streaming" || provisionalState === "reset";
  const draftReveal = useStreamingText({
    text: draftText,
    key:
      draftOrdinal === null || !run.activeTurnId
        ? null
        : `${run.activeTurnId}:${draftOrdinal}`,
    revealMode: draftStreaming ? "streaming" : "settling",
    arrives: draftStreaming,
    animate: !reducedMotion,
  });
  const draftWipe = useWordWipe(
    !reducedMotion &&
      run.hostState === "running" &&
      draftText !== null &&
      (draftStreaming || !draftReveal.settled),
  );
  // The committed answer is seen to land only when it arrives while the panel
  // is already showing this turn run; a panel that mounts onto an answer, or
  // a turn read back from history, paints it whole.
  const answerKey =
    run.answer && run.activeTurnId
      ? `${run.activeTurnId}:${run.answer.committedAt}`
      : null;
  const answerArrivalRef = useRef<{ key: string; live: boolean } | null>(null);
  const runningTurnRef = useRef<string | null>(null);
  if (answerKey !== null && answerArrivalRef.current?.key !== answerKey) {
    answerArrivalRef.current = {
      key: answerKey,
      live: runningTurnRef.current === run.activeTurnId,
    };
  }
  if (run.activeTurnId && run.hostState === "running")
    runningTurnRef.current = run.activeTurnId;
  const answerReveal = useStreamingText({
    text: run.answer?.narrative ?? null,
    key: answerKey,
    // An answer that lands live arrives from nothing at the answer pace; one
    // the panel mounts onto is already settled and paints whole.
    revealMode: "answer",
    arrives: answerArrivalRef.current?.live === true,
    animate: !reducedMotion && answerArrivalRef.current?.live === true,
  });
  const answerWipe = useWordWipe(
    !reducedMotion &&
      answerArrivalRef.current?.live === true &&
      !answerReveal.settled,
  );
  const followContentKey = [
    run.activeTurnId ?? "none",
    run.history.length,
    run.milestones.length,
    provisionalState,
    draftOrdinal ?? "none",
    draftText?.length ?? 0,
    answerKey ?? "none",
    answerReveal.text?.length ?? 0,
  ].join(":");

  /**
   * One coalesced line per draft, from the closed vocabulary — never a token of
   * model text. The key carries the draft it belongs to, so the deltas that
   * follow a cue never repeat it and the next draft's cue is a new node the
   * live region announces.
   */
  useEffect(() => {
    if (
      provisionalState === "paused_at_limit" ||
      provisionalState === "stalled"
    ) {
      const key = `${provisionalState}:${draftOrdinal ?? "none"}`;
      setDraftCue((current) =>
        current && current.key === key
          ? current
          : {
              key,
              ordinal: draftOrdinal,
              text: describeAthenaProvisionalCue(provisionalState),
            },
      );
      return;
    }
    if (provisionalState === "reset") {
      setDraftCue((current) => (current === null ? current : null));
      return;
    }
    if (provisionalState === "streaming" || provisionalState === "committing") {
      // A cue raised for this draft stands while it keeps writing; one raised
      // for a draft that has gone (a stall that recovered) does not.
      setDraftCue((current) =>
        current === null || current.ordinal === draftOrdinal ? current : null,
      );
      return;
    }
    setDraftCue((current) => (current === null ? current : null));
  }, [provisionalState, draftOrdinal]);

  /** The floating control shows once the operator has left the latest behind. */
  const syncLatest = useCallback(() => {
    const node = scrollRef.current;
    const visible = node !== null && !followRef.current && awayFromLatest(node);
    // A control that hides while it holds focus hands focus to the composer,
    // never leaving it on something aria-hidden and out of the tab order.
    if (
      !visible &&
      latestRef.current !== null &&
      document.activeElement === latestRef.current
    ) {
      promptRef.current?.focus();
    }
    setLatestVisible((current) => (current === visible ? current : visible));
  }, []);

  // Drop the question-top hold once the current turn itself needs more than a
  // viewport. At that point the normal live-response follow takes over.
  useEffect(() => {
    if (!questionTopActive) return;
    const node = scrollRef.current;
    const currentTranscript = currentTranscriptRef.current;
    const question = currentQuestionRef.current;
    const lastCurrentContent = currentTranscript?.lastElementChild;
    if (!node || !question || !currentTranscript || !lastCurrentContent) {
      setQuestionTopActive(false);
      return;
    }
    const currentContentHeight =
      lastCurrentContent.getBoundingClientRect().bottom -
      question.getBoundingClientRect().top;
    if (currentContentHeight > node.clientHeight) {
      setQuestionTopActive(false);
    }
  }, [followContentKey, questionTopActive]);

  // Follow the latest on every commit: a revealed draft or answer, a new
  // milestone, a new entry — anything that grows the transcript while the
  // operator is following. The first commit positions without a glide.
  useEffect(() => {
    const node = scrollRef.current;
    const currentTranscript = currentTranscriptRef.current;
    const question = currentQuestionRef.current;
    const lastCurrentContent = currentTranscript?.lastElementChild;
    const currentContentHeight =
      question !== null && lastCurrentContent != null
        ? lastCurrentContent.getBoundingClientRect().bottom -
          question.getBoundingClientRect().top
        : 0;
    const holdsQuestionTop =
      questionTopActive &&
      node !== null &&
      question !== null &&
      currentTranscript !== null &&
      currentContentHeight <= node.clientHeight;
    if (
      node &&
      question &&
      holdsQuestionTop &&
      pendingQuestionAlignmentRef.current === undefined
    ) {
      const delta =
        question.getBoundingClientRect().top - node.getBoundingClientRect().top;
      if (Math.abs(delta) > 1) {
        positionAt(node, Math.max(0, node.scrollTop + delta));
      }
    }
    if (
      node &&
      followRef.current &&
      !holdsQuestionTop &&
      pendingQuestionAlignmentRef.current === undefined
    ) {
      if (mountedScrollRef.current) anchorToBottom(node);
      else positionAt(node, "bottom");
    }
    mountedScrollRef.current = true;
    syncLatest();
  });

  // A submitted question gets one deliberate opening position as soon as its
  // optimistic bubble appears. Later commits resume latest-content following
  // only after this turn grows beyond the viewport.
  useEffect(() => {
    const pendingQuestion = pendingQuestionAlignmentRef.current;
    if (
      pendingQuestion === undefined ||
      run.turn?.question !== pendingQuestion.prompt ||
      (run.hostState !== "submitting" && run.hostState !== "running")
    ) {
      return;
    }
    // Render the temporary runway first. Without it, a short current turn at
    // the end of a long thread cannot physically reach the scrollport's top.
    if (!questionTopActive) {
      setQuestionTopActive(true);
      return;
    }
    // A settle already in flight owns the pending alignment; re-running the
    // effect must not restart the scroll or tear the settle's listeners down.
    if (activeQuestionSettleRef.current !== null) return;
    const node = scrollRef.current;
    const question = currentQuestionRef.current;
    if (!node || !question) return;
    const top = Math.max(
      0,
      node.scrollTop +
        question.getBoundingClientRect().top -
        node.getBoundingClientRect().top,
    );
    if (reducedMotion) {
      positionAt(node, top);
      pendingQuestionAlignmentRef.current = undefined;
    } else {
      let correctionTimer: number | null = null;
      const settleQuestionTop = () => {
        activeQuestionSettleRef.current = null;
        // Only now is the alignment done: while the smooth scroll is in
        // flight the pending marker keeps the follow effect's instant
        // corrections suppressed.
        pendingQuestionAlignmentRef.current = undefined;
        node.removeEventListener("scrollend", settleQuestionTop);
        if (correctionTimer !== null) window.clearTimeout(correctionTimer);
        const delta =
          question.getBoundingClientRect().top -
          node.getBoundingClientRect().top;
        if (Math.abs(delta) > 1) {
          positionAt(node, Math.max(0, node.scrollTop + delta));
        }
      };
      activeQuestionSettleRef.current = () => {
        activeQuestionSettleRef.current = null;
        pendingQuestionAlignmentRef.current = undefined;
        node.removeEventListener("scrollend", settleQuestionTop);
        if (correctionTimer !== null) window.clearTimeout(correctionTimer);
      };
      node.addEventListener("scrollend", settleQuestionTop, { once: true });
      // `scrollend` is the primary signal. The fallback covers engines that
      // expose smooth scrolling without dispatching that event.
      correctionTimer = window.setTimeout(settleQuestionTop, 900);
      node.scrollTo({ top, behavior: "smooth" });
    }
    followRef.current = true;
    syncLatest();
  }, [
    followContentKey,
    questionTopActive,
    reducedMotion,
    run.activeTurnId,
    run.hostState,
    run.turn?.question,
    syncLatest,
  ]);

  const interruptFollowing = useCallback(() => {
    followRef.current = false;
    setQuestionTopActive(false);
    // The operator taking the scroll wins over an in-flight question-top glide.
    activeQuestionSettleRef.current?.();
  }, []);

  const scrollToLatest = useCallback(() => {
    followRef.current = true;
    setQuestionTopActive(false);
    activeQuestionSettleRef.current?.();
    const node = scrollRef.current;
    if (node) anchorToBottom(node);
    syncLatest();
    promptRef.current?.focus();
  }, [syncLatest]);

  /**
   * Every deliberate focus move the host makes, in one effect keyed on both the
   * host state and the draft state. The terminal host transition is evaluated
   * first and returns; only then can a mid-run withdrawal claim focus, and only
   * while the run is still running and the operator is not typing.
   */
  useEffect(() => {
    const previous = previousState.current;
    previousState.current = {
      hostState: run.hostState,
      provisionalState: run.provisionalState,
    };
    if (run.hostState === "submitting" || run.hostState === "idle") {
      // `activeTurnId` lags the next turn's start, so the latch is released by
      // the host state rather than by the turn it was keyed to.
      focusClaimedTurnRef.current = null;
    }
    // Sending a question moves nothing: the operator stays in the composer,
    // and the status region announces the start on its own.
    if (
      run.hostState === "cancellation_requested" ||
      run.hostState === "terminal_denied" ||
      run.hostState === "expired_content"
    ) {
      if (previous && previous.hostState === run.hostState) return;
      if (
        run.hostState === "terminal_denied" &&
        focusClaimedTurnRef.current !== null &&
        focusClaimedTurnRef.current === run.activeTurnId
      ) {
        return;
      }
      focusOwn(statusRef.current);
      focusClaimedTurnRef.current = null;
      return;
    }
    if (
      run.hostState === "completed" ||
      run.hostState === "partial" ||
      run.hostState === "no_usable_sources"
    ) {
      if (previous && previous.hostState === run.hostState) return;
      // A completed answer is announced by the status live region and followed
      // into view. It does not take focus from the composer or wherever the
      // operator is reading.
      focusClaimedTurnRef.current = null;
      return;
    }
    if (
      run.provisionalState !== "withdrawn" ||
      // A null previous value is a mount, never an edge: a panel that opens on
      // an already-withdrawn turn announces the notice and moves nothing.
      previous === null ||
      previous.provisionalState === "withdrawn" ||
      run.hostState !== "running"
    ) {
      return;
    }
    // The composer stays editable mid-stream; a follow-up being typed must not
    // lose keystrokes. The alert still announces.
    if (
      promptRef.current !== null &&
      document.activeElement === promptRef.current
    ) {
      return;
    }
    focusOwn(withdrawnRef.current);
    focusClaimedTurnRef.current = run.activeTurnId;
  }, [run.hostState, run.provisionalState, run.activeTurnId, focusOwn]);

  const answerQuality = run.answer ? describeQuality(run.answer) : null;
  const isHistoryResumeState =
    run.hostState === "idle" && run.turn === null && run.history.length > 0;
  const activityOwnsStatus = !run.answer && run.status.tone === "progress";
  // Finished drafts, rendered only where the live draft itself may show:
  // inside the provisional container while the turn runs, and behind the
  // committed answer once it has superseded them. The hook already empties
  // the list for withdrawn, stalled, and disabled drafts; this guard keeps the
  // panel honest if it is ever fed a run by hand.
  const provisionalEntries = PROVISIONAL_TIMELINE_STATES.has(
    run.provisionalState,
  )
    ? run.provisionalTimeline
    : [];
  const renderProvisionalEntries = () =>
    provisionalEntries.map((entry) => (
      <article
        data-ordinal={entry.draftOrdinal}
        data-testid="athena-agent-provisional-entry"
        key={entry.draftOrdinal}
      >
        <AthenaAgentSafeText
          className="text-muted-foreground"
          mode="provisional"
          text={entry.text}
        />
      </article>
    ));
  const latestActivityLabel =
    run.milestones[run.milestones.length - 1]?.label ??
    (activityOwnsStatus ? run.status.headline : null);
  const activityProgress =
    !run.answer && latestActivityLabel ? (
      <div
        aria-live="polite"
        className="text-sm text-muted-foreground"
        data-testid="athena-agent-progress"
        ref={activityOwnsStatus ? statusRef : undefined}
        tabIndex={-1}
      >
        <p className="athena-agent-thinking relative w-fit">
          <span>{latestActivityLabel}</span>
          <span
            aria-hidden="true"
            className="athena-agent-thinking-wipe absolute inset-0"
          >
            {latestActivityLabel}
          </span>
        </p>
      </div>
    ) : null;

  const canSend = run.canSubmit && run.canFollowUp && draft.trim().length > 0;
  const submit = useCallback(
    async (prompt: string, options: { readonly starterIntentId?: string } = {}) => {
      // Wait for the new turn bubble before moving the transcript. Moving the
      // old transcript here would put the wrong question at the viewport edge.
      activeQuestionSettleRef.current?.();
      pendingQuestionAlignmentRef.current = { prompt };
      setQuestionTopActive(false);
      followRef.current = true;
      // Focus stays in the composer: a send from the button would otherwise
      // leave it on a control that disables as the draft clears.
      promptRef.current?.focus();
      // The options arg rides only on taps so typed sends keep their arity
      // (free-form turns byte-identical, panel included).
      await (options.starterIntentId ? run.submit(prompt, options) : run.submit(prompt));
      onDraftChange("");
    },
    [onDraftChange, run],
  );

  const onResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onWidthChange(Math.min(MAX_PANEL_WIDTH, width + WIDTH_STEP));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onWidthChange(Math.max(MIN_PANEL_WIDTH, width - WIDTH_STEP));
      }
      if (event.key === "Home") {
        event.preventDefault();
        onWidthChange(MAX_PANEL_WIDTH);
      }
      if (event.key === "End") {
        event.preventDefault();
        onWidthChange(MIN_PANEL_WIDTH);
      }
    },
    [onWidthChange, width],
  );
  const resizeGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      resizeGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );
  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = resizeGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const nextWidth = gesture.startWidth + gesture.startX - event.clientX;
      onWidthChange(
        Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, nextWidth)),
      );
    },
    [onWidthChange],
  );
  const finishResizeGesture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (resizeGestureRef.current?.pointerId !== event.pointerId) return;
      resizeGestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const body = (
    <div className="flex h-full min-h-0 flex-col bg-surface-raised/95">
      <header
        className="flex items-center justify-between gap-layout-sm border-b border-border/50 bg-surface-raised/85 px-layout-md py-layout-xs backdrop-blur-xl supports-[backdrop-filter]:bg-surface-raised/75"
        data-testid="athena-agent-header"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
            {presentation.entry.label}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            className={cn(
              TOUCH_TARGET,
              "shrink-0 gap-1.5 rounded-full px-3 text-xs text-muted-foreground",
            )}
            data-testid="athena-agent-new-thread"
            disabled={!run.canStartNewThread}
            onClick={run.startNewThread}
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New thread
          </Button>
          <Button
            className={cn(
              TOUCH_TARGET,
              "shrink-0 gap-2 rounded-full px-3 text-muted-foreground",
            )}
            data-testid="athena-agent-close"
            onClick={onClose}
            type="button"
            variant="ghost"
          >
            {layout === "fullscreen" ? (
              <>
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                {returnLabel ?? "Back"}
              </>
            ) : (
              <>
                <X aria-hidden="true" className="h-4 w-4" />
                <span className="sr-only">
                  Close {presentation.entry.label}
                </span>
              </>
            )}
          </Button>
        </div>
      </header>

      {run.pendingContextChange || !run.availability.available ? (
        <section
          aria-label="Context notice"
          className="space-y-layout-xs border-b border-border/60 px-layout-md py-layout-xs"
        >
          {run.pendingContextChange ? (
            <div
              className="flex flex-wrap items-center gap-layout-sm rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground"
              data-testid="athena-agent-context-change"
            >
              <span>
                The context moved to {run.pendingContextChange.label}. Confirm
                before asking again.
              </span>
              <Button
                className={cn(TOUCH_TARGET)}
                onClick={run.confirmContextChange}
                size="sm"
                type="button"
                variant="utility"
              >
                Use this context
              </Button>
            </div>
          ) : null}
          {!run.availability.available ? (
            <p className="text-xs text-muted-foreground">
              {run.availability.headline}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            !reducedMotion && run.hostState === "running"
              ? "scroll-smooth"
              : null,
          )}
          data-testid="athena-agent-scroll"
          // Keyboard travel into the transcript (a citation, a trail summary)
          // is the operator reading there; the follow must not pull it away.
          onFocusCapture={() => {
            if (!ownFocusRef.current) interruptFollowing();
          }}
          onKeyDown={(event) => {
            if (SCROLL_INTERRUPT_KEYS.has(event.key)) interruptFollowing();
          }}
          onPointerDown={interruptFollowing}
          onScroll={(event) => {
            onScrollTopChange?.(event.currentTarget.scrollTop);
            syncLatest();
          }}
          onTouchMove={interruptFollowing}
          onWheel={interruptFollowing}
          ref={setScrollNode}
        >
          {run.history.length > 0 ? (
            <section
              aria-label="Earlier questions"
              className="space-y-layout-md px-layout-md pb-layout-sm pt-layout-md"
              data-testid="athena-agent-history"
            >
              {run.history.map((entry) => (
                <HistoryEntry
                  entry={entry}
                  key={entry.turnId}
                  storeId={run.storeId}
                />
              ))}
            </section>
          ) : null}

          {!isHistoryResumeState ? (
            <section
              aria-label="This question"
              className={cn(
                "space-y-layout-md px-layout-md py-layout-md",
                questionTopActive ? "min-h-[calc(100%+var(--space-md))]" : null,
              )}
              data-testid="athena-agent-transcript"
              ref={currentTranscriptRef}
            >
              {run.turn ? (
                <UserMessage
                  current
                  data-testid="athena-agent-current-question"
                  messageRef={currentQuestionRef}
                  question={run.turn.question}
                  questionState={run.turn.questionState}
                  sentAt={run.turn.createdAt}
                />
              ) : (
                <StarterIntents
                  intents={run.starterIntents}
                  // A tap sends immediately: the curated question needs no
                  // editing, and the id opts the turn into its pre-executed read.
                  onChoose={(intent) =>
                    void submit(intent.prompt, { starterIntentId: intent.id })
                  }
                />
              )}

              {!activityOwnsStatus ? (
                <div
                  className={
                    run.answer
                      ? "sr-only"
                      : cn(
                          "text-sm",
                          run.status.tone === "warning"
                            ? "rounded-md border border-border/70 bg-surface px-3 py-2 text-foreground"
                            : "py-0.5 text-muted-foreground",
                        )
                  }
                  data-testid="athena-agent-status"
                  ref={statusRef}
                  role="status"
                  tabIndex={-1}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium text-foreground">
                      {run.status.headline}
                    </p>
                    {run.status.detail ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        {run.status.detail}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!PROVISIONAL_VISIBLE_STATES.has(run.provisionalState)
                ? activityProgress
                : null}

              {run.denial ? (
                <div
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  data-testid="athena-agent-denial"
                  role="alert"
                >
                  <p className="font-medium text-foreground">
                    {run.denial.headline}
                  </p>
                  {run.denial.detail ? (
                    <p className="text-xs text-muted-foreground">
                      {run.denial.detail}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {run.contextDrift ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="athena-agent-drift"
                >
                  This answer is for{" "}
                  {run.turn?.contextLabel ?? "another context"}. Return to it,
                  or confirm the current context, to keep asking.
                </p>
              ) : null}

              {/* The draft sits in the slot the answer article later occupies, so a
              denial, a withdrawal, and a resumed draft always read in that
              order — and the committed answer replaces the draft in place. */}
              {run.provisionalState === "withdrawn" &&
              run.provisionalWithdrawal ? (
                <div
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  data-testid="athena-agent-provisional-withdrawn"
                  ref={withdrawnRef}
                  role="alert"
                  tabIndex={-1}
                >
                  <p className="font-medium text-foreground">
                    {run.provisionalWithdrawal.headline}
                  </p>
                  {run.provisionalWithdrawal.detail ? (
                    <p className="text-xs text-muted-foreground">
                      {run.provisionalWithdrawal.detail}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {PROVISIONAL_VISIBLE_STATES.has(run.provisionalState) ? (
                <section
                  aria-label="Provisional draft"
                  className="space-y-layout-sm py-layout-xs"
                  data-state={run.provisionalState}
                  data-testid="athena-agent-provisional"
                >
                  {run.turn ? (
                    <div
                      className="flex min-h-[44px] items-center gap-2 border-b border-border/50"
                      data-testid="athena-agent-working-header"
                    >
                      <WorkingDuration
                        key={run.turn.turnId}
                        startedAt={run.turn.createdAt}
                      />
                    </div>
                  ) : null}
                  {provisionalEntries.length > 0 ? (
                    <div
                      className="space-y-layout-sm pb-layout-xs"
                      data-testid="athena-agent-provisional-entries"
                    >
                      {renderProvisionalEntries()}
                    </div>
                  ) : null}
                  {run.provisional ? (
                    <div
                      data-reveal={
                        draftReveal.settled ? "settled" : "revealing"
                      }
                      data-testid="athena-agent-provisional-text"
                    >
                      <AthenaAgentSafeText
                        className="text-muted-foreground"
                        mode="provisional"
                        text={draftReveal.text ?? run.provisional.text}
                        wipe={draftWipe}
                      />
                    </div>
                  ) : null}
                  {/* Its own region: the milestone region is server-authored
                  progress, and this one carries at most one cue per draft. */}
                  <div
                    aria-live="polite"
                    className="text-xs text-muted-foreground"
                    data-testid="athena-agent-provisional-live"
                  >
                    {draftCue ? (
                      <p key={draftCue.key}>{draftCue.text}</p>
                    ) : null}
                  </div>
                  {activityProgress}
                </section>
              ) : null}

              {/* Saved drafts sit between the question and checked answer. The
              compact disclosure keeps them available without competing with
              the answer's hierarchy. */}
              {run.provisionalState === "superseded" &&
              provisionalEntries.length > 0 ? (
                <details
                  className="group space-y-layout-sm border-b border-border/50 py-layout-xs"
                  data-testid="athena-agent-provisional-timeline"
                >
                  <summary
                    aria-label={
                      run.turn && run.answer
                        ? `Show answer drafts. Worked for ${formatTurnDuration(run.turn.createdAt, run.answer.committedAt)}`
                        : "Show answer drafts"
                    }
                    className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none [&::-webkit-details-marker]:hidden"
                  >
                    {run.turn && run.answer ? (
                      <WorkedDuration
                        committedAt={run.answer.committedAt}
                        startedAt={run.turn.createdAt}
                      />
                    ) : null}
                    <ChevronRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
                      data-testid="athena-agent-draft-toggle-icon"
                    />
                  </summary>
                  <div className="space-y-layout-sm pb-layout-xs">
                    {renderProvisionalEntries()}
                  </div>
                </details>
              ) : null}

              {run.answer ? (
                <article
                  className="space-y-layout-md pt-layout-md"
                  data-testid="athena-agent-answer"
                >
                  <div
                    data-reveal={answerReveal.settled ? "settled" : "revealing"}
                    data-testid="athena-agent-answer-text"
                  >
                    <AthenaAgentSafeText
                      text={answerReveal.text ?? run.answer.narrative}
                      wipe={answerWipe}
                    />
                  </div>
                  {answerQuality?.tone === "warning" ? (
                    <div
                      className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"
                      data-testid="athena-agent-quality"
                    >
                      <CircleAlert
                        aria-hidden="true"
                        className="mt-[0.2rem] h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                      />
                      <p>
                        <span className="font-medium text-foreground/80">
                          {answerQuality.label}.
                        </span>{" "}
                        {run.status.detail}
                      </p>
                    </div>
                  ) : null}
                </article>
              ) : null}
            </section>
          ) : null}
        </div>
        {/* Floats over the transcript, above the composer, once the operator has
          scrolled away; a tap restarts the follow. */}
        <button
          aria-hidden={!latestVisible}
          aria-label="Scroll to latest"
          className={cn(
            "absolute bottom-3 left-1/2 z-10 grid -translate-x-1/2 place-items-center rounded-full border border-border/70 bg-surface/90 text-foreground shadow-surface backdrop-blur",
            TOUCH_TARGET,
            "transition-[opacity,transform] duration-150 ease-out active:scale-95 motion-reduce:transition-none",
            "hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            latestVisible
              ? "opacity-100"
              : "pointer-events-none translate-y-1.5 scale-95 opacity-0",
          )}
          data-testid="athena-agent-latest"
          data-visible={latestVisible ? "true" : "false"}
          onClick={scrollToLatest}
          ref={latestRef}
          tabIndex={latestVisible ? 0 : -1}
          type="button"
        >
          <ArrowDown aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {/* The composer, after the chat panel in kwamina-fyi: one bordered shell
          holding the field and its button rather than a field beside one.
          Focus lands on the shell, so the field draws no second box inside
          it, and no rule sits above it — the shell's own border already
          separates it from the transcript. */}
      <form
        className={cn(
          "mx-layout-md mb-layout-sm mt-layout-xs flex flex-col rounded-lg border border-border/80 bg-background shadow-sm",
          "transition-[border-color,box-shadow] focus-within:border-primary-border focus-within:ring-2 focus-within:ring-ring/20 motion-reduce:transition-none",
        )}
        data-testid="athena-agent-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        <label className="sr-only" htmlFor="athena-agent-prompt">
          Ask a question about this context
        </label>
        <Textarea
          className={cn(
            // Three lines from `rows`, then it scrolls; no resize handle, so the
            // field cannot be dragged out past the panel it lives in.
            "min-h-0 resize-none rounded-none border-0 bg-transparent px-3 pb-0 pt-2.5 leading-6 shadow-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
          data-testid="athena-agent-prompt"
          id="athena-agent-prompt"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            // Enter sends; Shift+Enter is a newline, as in every chat the
            // operator already uses. Cmd/Ctrl+Enter still sends.
            if (event.shiftKey) return;
            event.preventDefault();
            if (canSend) void submit(draft);
          }}
          placeholder={
            run.answer || run.history.length > 0
              ? "Ask a follow-up…"
              : "Ask about this context"
          }
          ref={promptRef}
          rows={3}
          size="sm"
          value={draft}
        />
        {/* Its own row rather than floating over the text, which would leave
            the last line running underneath the button. Context drift disables
            follow-up until the operator returns to the answer's context or
            confirms the current one. */}
        <div className="flex items-center justify-end px-3 pb-2 pt-1">
          {run.canCancel ? (
            <Button
              aria-label="Stop"
              className={cn(TOUCH_TARGET, "shrink-0 rounded-full")}
              data-testid="athena-agent-cancel"
              onClick={() => void run.cancel()}
              size="icon"
              type="button"
            >
              <Square
                aria-hidden="true"
                className="h-3.5 w-3.5 fill-current"
                data-testid="athena-agent-cancel-icon"
              />
            </Button>
          ) : (
            <Button
              aria-label="Ask"
              className={cn(TOUCH_TARGET, "shrink-0 rounded-full")}
              data-testid="athena-agent-submit"
              disabled={!canSend}
              size="icon"
              type="submit"
            >
              {run.isSubmitting ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp aria-hidden="true" className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
        {run.blockedSubmission ? (
          <p
            className="px-3 pb-2 text-xs text-foreground"
            data-testid="athena-agent-blocked"
            role="alert"
          >
            {run.blockedSubmission.headline}
          </p>
        ) : null}
      </form>

    </div>
  );

  if (layout === "fullscreen") {
    return (
      <Dialog onOpenChange={(next) => (next ? undefined : onClose())} open>
        <DialogContent
          className={cn(
            "h-[100dvh] w-screen max-w-none gap-0 rounded-none border-0 p-0",
            // Reduced motion removes the sheet's entrance, never its state cues.
            "motion-reduce:!animate-none",
            reducedMotion ? "!animate-none" : null,
          )}
          data-layout="fullscreen"
          data-motion={reducedMotion ? "reduced" : "standard"}
          data-testid="athena-agent-panel"
        >
          <DialogTitle className="sr-only">
            {presentation.entry.label}
          </DialogTitle>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <aside
      aria-label={presentation.entry.label}
      className="athena-agent-detached-panel fixed bottom-[calc(var(--space-md)+3rem+var(--space-sm))] right-layout-md z-40 isolate flex h-[60dvh] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border/70 bg-surface-raised/95 shadow-overlay backdrop-blur-xl supports-[backdrop-filter]:bg-surface-raised/85"
      data-layout="docked"
      data-motion={reducedMotion ? "reduced" : "standard"}
      data-testid="athena-agent-panel"
      role="complementary"
      style={{ width: `${width}px` }}
    >
      <div
        aria-label="Resize the Athena panel"
        aria-orientation="vertical"
        aria-valuemax={MAX_PANEL_WIDTH}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuenow={width}
        className="w-1 shrink-0 touch-none cursor-col-resize bg-transparent transition-colors hover:bg-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        data-testid="athena-agent-resize"
        onKeyDown={onResizeKeyDown}
        onPointerCancel={finishResizeGesture}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={finishResizeGesture}
        role="separator"
        tabIndex={0}
      />
      <div className="min-w-0 flex-1">{body}</div>
    </aside>
  );
}

function StarterIntents({
  intents,
  onChoose,
}: {
  intents: AthenaAgentPresentation["starterIntents"];
  onChoose: (intent: AthenaAgentPresentation["starterIntents"][number]) => void;
}) {
  if (intents.length === 0) return null;
  return (
    <div className="space-y-layout-sm" data-testid="athena-agent-starters">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Try
      </p>
      <ul className="flex flex-col gap-layout-xs">
        {intents.map((intent) => (
          <li key={intent.id}>
            <Button
              className={cn(
                TOUCH_TARGET,
                "w-full justify-start rounded-lg text-left",
              )}
              onClick={() => onChoose(intent)}
              type="button"
              variant="utility"
            >
              {intent.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserMessage({
  current = false,
  "data-testid": testId,
  messageRef,
  question,
  questionState,
  sentAt,
}: {
  current?: boolean;
  readonly "data-testid"?: string;
  messageRef?: React.Ref<HTMLDivElement>;
  question: string | null | undefined;
  questionState: "retained" | "expired" | "deleted";
  sentAt: number;
}) {
  const timestamp = formatAbsoluteTimestamp(sentAt);
  return (
    <div
      className="group/message ml-auto w-fit max-w-[85%]"
      data-testid={testId}
      ref={messageRef}
    >
      <p
        className={cn(
          "rounded-lg px-3 py-2.5 text-sm",
          current ? "bg-primary-soft/45" : "bg-primary-soft/30",
          question ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {question ??
          (questionState === "retained"
            ? "This question isn't shown."
            : "This question is no longer stored.")}
      </p>
      <time
        className="pointer-events-none block h-4 select-none text-right text-[10px] leading-4 text-muted-foreground/70 opacity-0 transition-opacity duration-fast group-hover/message:opacity-100 motion-reduce:transition-none"
        data-testid="athena-agent-message-timestamp"
        dateTime={new Date(sentAt).toISOString()}
      >
        {timestamp}
      </time>
    </div>
  );
}

/**
 * How Athena got to an earlier turn's answer.
 *
 * Lazily mounted and lazily read: a long thread must not open one subscription
 * per turn, so the query starts on the first open and the server applies the
 * answer's own ladder to it. The drafts render exactly as the live pane
 * renders them — inert and never part of the answer.
 */
function HistoryNarrativeTrail({
  storeId,
  turnId,
  startedAt,
  committedAt,
}: {
  storeId: Id<"store">;
  turnId: string;
  startedAt: number;
  committedAt: number;
}) {
  const [opened, setOpened] = useState(false);
  const trail = useAthenaAgentNarrativeTrail({
    storeId,
    turnId,
    enabled: opened,
  });
  return (
    <details
      className="group space-y-layout-sm border-b border-border/50 py-layout-xs"
      data-testid="athena-agent-history-trail"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary
        aria-label={`Show answer drafts. Worked for ${formatTurnDuration(startedAt, committedAt)}`}
        className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none [&::-webkit-details-marker]:hidden"
      >
        <WorkedDuration committedAt={committedAt} startedAt={startedAt} />
        <ChevronRight
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          data-testid="athena-agent-draft-toggle-icon"
        />
      </summary>
      {trail.state === "unavailable" ? (
        <div className="text-xs text-muted-foreground">
          <p>{trail.headline}</p>
          {trail.detail ? <p>{trail.detail}</p> : null}
        </div>
      ) : null}
      {trail.state === "trail" && trail.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {describeAthenaProvisionalTimelineEmpty()}
        </p>
      ) : null}
      {trail.state === "trail" ? (
        <div className="space-y-layout-sm pb-layout-xs">
          {trail.entries.map((draft) => (
            <article
              data-ordinal={draft.draftOrdinal}
              data-testid="athena-agent-provisional-entry"
              key={draft.draftOrdinal}
            >
              <AthenaAgentSafeText
                className="text-muted-foreground"
                mode="provisional"
                text={draft.text}
              />
            </article>
          ))}
        </div>
      ) : null}
    </details>
  );
}

// Memoised: past answers must not re-parse on every frame of a live reveal.
const HistoryEntry = memo(function HistoryEntry({
  entry,
  storeId,
}: {
  entry: AthenaAgentHistoryEntry;
  storeId: Id<"store">;
}) {
  return (
    <div
      className="space-y-layout-sm border-b border-border/50 pb-layout-md last:border-b-0"
      data-testid="athena-agent-history-entry"
    >
      <UserMessage
        question={entry.question}
        questionState={entry.questionState}
        sentAt={entry.createdAt}
      />
      {/* The draft trail follows its question, before the checked answer. */}
      {entry.answer ? (
        <HistoryNarrativeTrail
          committedAt={entry.answer.committedAt}
          startedAt={entry.createdAt}
          storeId={storeId}
          turnId={entry.turnId}
        />
      ) : null}
      {entry.answer ? (
        <AthenaAgentSafeText
          className="text-foreground/85"
          text={entry.answer.narrative}
        />
      ) : null}
      {entry.omittedHeadline ? (
        <p className="text-xs text-muted-foreground">{entry.omittedHeadline}</p>
      ) : null}
      {entry.failureHeadline ? (
        <p className="text-xs text-muted-foreground">{entry.failureHeadline}</p>
      ) : null}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Authenticated-shell host and contextual entries
// ---------------------------------------------------------------------------

export type AthenaAgentSurfaceProps = {
  readonly presentation: AthenaAgentPresentation;
  readonly storeId: Id<"store">;
  readonly context: AthenaAgentContext;
  readonly routeParams?: Record<string, string | undefined>;
  readonly returnLabel?: string;
  /** `auto` follows the viewport; the explicit values exist for tests and hosts. */
  readonly layout?: "auto" | AthenaAgentLayout;
  readonly className?: string;
};

type AthenaAgentShellTarget = {
  readonly presentation: AthenaAgentPresentation;
  readonly storeId: Id<"store">;
  readonly context: AthenaAgentContext;
  readonly routeParams?: Record<string, string | undefined>;
  readonly returnLabel?: string;
  readonly layout?: "auto" | AthenaAgentLayout;
};

type StoredAthenaAgentShellTarget = Omit<
  AthenaAgentShellTarget,
  "presentation" | "layout"
> & {
  readonly version: 1;
  readonly profileId: string;
};

type AthenaAgentShellValue = {
  readonly target: AthenaAgentShellTarget | null;
  readonly surfaceTarget: AthenaAgentShellTarget | null;
  readonly open: boolean;
  readonly responding: boolean;
  readonly activate: (
    target: AthenaAgentShellTarget,
    trigger: HTMLButtonElement | null,
  ) => void;
  readonly toggle: (trigger: HTMLButtonElement | null) => void;
  readonly registerSurfaceTarget: (
    target: AthenaAgentShellTarget,
  ) => () => void;
  readonly setShellControl: (control: HTMLButtonElement | null) => void;
};

const AthenaAgentShellContext = createContext<AthenaAgentShellValue | null>(
  null,
);

const SHELL_TARGET_PREFIX = "athena.agent.shell.active.";

function scopedStorageKey(prefix: string, sessionScope: string) {
  return `${prefix}${encodeURIComponent(sessionScope)}`;
}

function serializeShellTarget(
  target: AthenaAgentShellTarget,
): StoredAthenaAgentShellTarget {
  return {
    version: 1,
    profileId: target.presentation.profileId,
    storeId: target.storeId,
    context: snapshotAthenaContext(target.presentation, target.context),
    ...(target.routeParams ? { routeParams: target.routeParams } : {}),
    ...(target.returnLabel ? { returnLabel: target.returnLabel } : {}),
  };
}

function writeShellTarget(storageKey: string, target: AthenaAgentShellTarget) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(
      storageKey,
      JSON.stringify(serializeShellTarget(target)),
    );
  } catch {
    // A tab with storage disabled keeps continuity until the shell unmounts.
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function removeShellTarget(storageKey: string) {
  try {
    window.sessionStorage?.removeItem(storageKey);
  } catch {
    // Storage-disabled tabs already have nothing durable to discard.
  }
}

function readShellTarget(
  presentations: readonly AthenaAgentPresentation[],
  storageKey: string,
): AthenaAgentShellTarget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage?.getItem(storageKey);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredAthenaAgentShellTarget>;
    const presentation = presentations.find(
      (candidate) => candidate.profileId === stored.profileId,
    );
    if (
      stored.version !== 1 ||
      !presentation ||
      typeof stored.storeId !== "string" ||
      !isStringRecord(stored.context) ||
      !presentation.contextBinding.keys.every(
        (key) =>
          typeof stored.context?.[key] === "string" &&
          stored.context[key].length > 0,
      ) ||
      (presentation.contextBinding.scopeKind === "store" &&
        stored.context.storeRef !== stored.storeId) ||
      (stored.routeParams !== undefined &&
        !isStringRecord(stored.routeParams)) ||
      (stored.returnLabel !== undefined &&
        typeof stored.returnLabel !== "string")
    ) {
      removeShellTarget(storageKey);
      return null;
    }
    return {
      presentation,
      storeId: stored.storeId as Id<"store">,
      context: stored.context as AthenaAgentContext,
      ...(stored.routeParams ? { routeParams: stored.routeParams } : {}),
      ...(stored.returnLabel ? { returnLabel: stored.returnLabel } : {}),
    };
  } catch {
    removeShellTarget(storageKey);
    return null;
  }
}

function shellTargetIdentity(target: AthenaAgentShellTarget) {
  return JSON.stringify(serializeShellTarget(target));
}

function shellThreadIdentity(target: AthenaAgentShellTarget) {
  return `${target.presentation.profileId}:${composeAthenaThreadKey(
    target.presentation,
    target.context,
  )}`;
}

/**
 * The reconnect handle lives in per-tab view state so a reload or a trip to
 * another page rejoins the same turn. Only the turn reference is stored — never
 * the prompt, and never anything the server has erased.
 */
const TURN_HANDLE_PREFIX = "athena.agent.turn.";

function readTurnHandle(key: string): Id<"agentTurnBinding"> | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage?.getItem(key);
    return value ? (value as Id<"agentTurnBinding">) : null;
  } catch {
    return null;
  }
}

function writeTurnHandle(key: string, turnId: Id<"agentTurnBinding"> | null) {
  if (typeof window === "undefined") return;
  try {
    if (turnId) window.sessionStorage?.setItem(key, turnId);
    else window.sessionStorage?.removeItem(key);
  } catch {
    // A tab with storage disabled simply loses the reconnect handle.
  }
}

function AthenaAgentShellPanel({
  target,
  open,
  responding,
  sessionScope,
  draft,
  onDraftChange,
  width,
  onWidthChange,
  scrollTop,
  onScrollTopChange,
  onRespondingChange,
  onClose,
}: {
  target: AthenaAgentShellTarget;
  open: boolean;
  responding: boolean;
  sessionScope: string;
  draft: string;
  onDraftChange: (draft: string) => void;
  width: number;
  onWidthChange: (width: number) => void;
  scrollTop: number | null;
  onScrollTopChange: (scrollTop: number) => void;
  onRespondingChange: (responding: boolean) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const resolvedLayout: AthenaAgentLayout =
    target.layout && target.layout !== "auto"
      ? target.layout
      : isMobile || target.presentation.mountMode === "full_screen_sheet"
        ? "fullscreen"
        : "docked";
  const handleKey = `${TURN_HANDLE_PREFIX}${encodeURIComponent(
    sessionScope,
  )}.${composeAthenaThreadKey(target.presentation, target.context)}`;
  const [restored, setRestored] = useState(() => ({
    key: handleKey,
    turnId: readTurnHandle(handleKey),
  }));

  useEffect(() => {
    if (restored.key === handleKey) return;
    setRestored({ key: handleKey, turnId: readTurnHandle(handleKey) });
  }, [handleKey, restored.key]);

  const rememberTurn = useCallback(
    (turnId: Id<"agentTurnBinding"> | null) => {
      writeTurnHandle(handleKey, turnId);
    },
    [handleKey],
  );

  const run = useAthenaAgentRun({
    presentation: target.presentation,
    storeId: target.storeId,
    context: target.context,
    ...(target.routeParams ? { routeParams: target.routeParams } : {}),
    isActive: open || responding,
    activeTurnId: restored.turnId,
    onActiveTurnChange: rememberTurn,
  });

  const harnessResponding = isAthenaAgentResponding(run.hostState);
  useEffect(() => {
    onRespondingChange(harnessResponding);
  }, [harnessResponding, onRespondingChange]);

  if (!open) return null;

  return (
    <AthenaAgentPanel
      draft={draft}
      layout={resolvedLayout}
      onClose={onClose}
      onDraftChange={onDraftChange}
      onScrollTopChange={onScrollTopChange}
      onWidthChange={onWidthChange}
      presentation={target.presentation}
      run={run}
      scrollTop={scrollTop}
      {...(target.returnLabel ? { returnLabel: target.returnLabel } : {})}
      width={width}
    />
  );
}

function isAthenaAgentResponding(
  hostState: AthenaAgentRun["hostState"],
) {
  return (
    hostState === "submitting" ||
    hostState === "reconnecting" ||
    hostState === "running" ||
    hostState === "cancellation_requested"
  );
}

export function AthenaAgentShellProvider({
  children,
  presentations,
  sessionScope,
}: {
  children: ReactNode;
  presentations: readonly AthenaAgentPresentation[];
  sessionScope: string;
}) {
  const shellStorageKey = scopedStorageKey(SHELL_TARGET_PREFIX, sessionScope);
  const [target, setTarget] = useState<AthenaAgentShellTarget | null>(() =>
    readShellTarget(presentations, shellStorageKey),
  );
  // Reload restores the conversation handle and context, but never covers the
  // current workspace until the operator explicitly reopens it.
  const [open, setOpen] = useState(false);
  const [responding, setResponding] = useState(false);
  const [surfaceTarget, setSurfaceTarget] =
    useState<AthenaAgentShellTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const scrollTopRef = useRef<number | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shellControlRef = useRef<HTMLButtonElement | null>(null);

  const activate = useCallback(
    (next: AthenaAgentShellTarget, trigger: HTMLButtonElement | null) => {
      const sameTarget =
        target !== null &&
        shellTargetIdentity(target) === shellTargetIdentity(next);
      const sameThread =
        target !== null &&
        shellThreadIdentity(target) === shellThreadIdentity(next);
      lastTriggerRef.current = trigger;
      writeShellTarget(shellStorageKey, next);
      setTarget(next);
      if (!sameThread) {
        setDraft("");
        setResponding(false);
        scrollTopRef.current = null;
      }
      setOpen((current) => (sameTarget ? !current : true));
    },
    [shellStorageKey, target],
  );

  const toggle = useCallback(
    (trigger: HTMLButtonElement | null) => {
      if (!target) return;
      lastTriggerRef.current = trigger;
      setOpen((current) => !current);
    },
    [target],
  );

  const close = useCallback(() => {
    setOpen(false);
    const returnTarget = lastTriggerRef.current?.isConnected
      ? lastTriggerRef.current
      : shellControlRef.current;
    window.setTimeout(() => returnTarget?.focus(), 0);
  }, []);

  const registerSurfaceTarget = useCallback(
    (next: AthenaAgentShellTarget) => {
      setSurfaceTarget(next);
      return () => {
        setSurfaceTarget((current) => (current === next ? null : current));
      };
    },
    [],
  );

  const syncResponding = useCallback(
    (harnessResponding: boolean) => {
      setResponding((current) =>
        harnessResponding ? open || current : false,
      );
    },
    [open],
  );

  const value = useMemo<AthenaAgentShellValue>(
    () => ({
      target,
      surfaceTarget,
      open,
      responding,
      activate,
      toggle,
      registerSurfaceTarget,
      setShellControl: (control) => {
        shellControlRef.current = control;
      },
    }),
    [
      activate,
      open,
      registerSurfaceTarget,
      responding,
      surfaceTarget,
      target,
      toggle,
    ],
  );

  return (
    <AthenaAgentShellContext.Provider value={value}>
      {children}
      {target ? (
        <AthenaAgentShellPanel
          draft={draft}
          key={shellThreadIdentity(target)}
          onClose={close}
          onDraftChange={setDraft}
          onRespondingChange={syncResponding}
          onScrollTopChange={(next) => {
            scrollTopRef.current = next;
          }}
          onWidthChange={setWidth}
          open={open}
          responding={responding}
          scrollTop={scrollTopRef.current}
          sessionScope={sessionScope}
          target={target}
          width={width}
        />
      ) : null}
    </AthenaAgentShellContext.Provider>
  );
}

export function AthenaAgentShellControl({ className }: { className?: string }) {
  const shell = useContext(AthenaAgentShellContext);
  const reducedMotion = usePrefersReducedMotion();
  const availableTarget = shell?.surfaceTarget ?? shell?.target ?? null;
  const ref = useCallback(
    (control: HTMLButtonElement | null) => shell?.setShellControl(control),
    [shell],
  );
  return (
    <div
      className={cn(
        "fixed bottom-layout-md right-layout-md z-50 rounded-full",
        className,
      )}
      data-testid="athena-agent-launcher-host"
    >
      <BorderBeam
        active={(shell?.responding ?? false) && !reducedMotion}
        borderRadius={999}
        className="athena-agent-themed-beam rounded-full [--beam-bloom-opacity:1.5] [--beam-inner-opacity:1.5] [--beam-stroke-opacity:2.5]"
        colorVariant="colorful"
        data-testid="athena-agent-border-beam"
        duration={2.8}
        size="sm"
        staticColors
        strength={0.8}
        theme="auto"
      >
        <Button
          aria-label={shell?.open ? "Close Ask Athena" : "Ask Athena"}
          aria-expanded={shell?.open ?? false}
          className={cn(
            TOUCH_TARGET,
            "h-12 w-12 rounded-full border-border/70 bg-surface-raised text-primary shadow-surface",
            "hover:border-border hover:bg-surface-raised hover:text-primary hover:shadow-overlay",
            "transition-[transform,opacity,box-shadow] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 motion-reduce:transform-none motion-reduce:transition-none",
          )}
          data-expanded={shell?.open ?? false}
          data-testid="athena-agent-entry"
          disabled={!availableTarget}
          onClick={(event) => {
            if (shell?.open) {
              shell.toggle(event.currentTarget);
              return;
            }
            if (shell?.surfaceTarget) {
              shell.activate(shell.surfaceTarget, event.currentTarget);
              return;
            }
            shell?.toggle(event.currentTarget);
          }}
          ref={ref}
          size="icon"
          type="button"
          variant="utility"
        >
          <Bot aria-hidden="true" className="h-5 w-5" />
        </Button>
      </BorderBeam>
    </div>
  );
}

function AthenaAgentSurfaceEntry({
  presentation,
  storeId,
  context,
  routeParams,
  returnLabel,
  layout = "auto",
  className,
}: AthenaAgentSurfaceProps) {
  const shell = useContext(AthenaAgentShellContext);
  const nextTarget: AthenaAgentShellTarget = {
    presentation,
    storeId,
    context,
    ...(routeParams ? { routeParams } : {}),
    ...(returnLabel ? { returnLabel } : {}),
    layout,
  };
  const targetRef = useRef(nextTarget);
  if (shellTargetIdentity(targetRef.current) !== shellTargetIdentity(nextTarget)) {
    targetRef.current = nextTarget;
  }
  const target = targetRef.current;

  const registerSurfaceTarget = shell?.registerSurfaceTarget;
  useEffect(() => {
    if (!registerSurfaceTarget) return;
    return registerSurfaceTarget(target);
  }, [registerSurfaceTarget, target]);

  return (
    <div
      className={cn("contents", className)}
      data-testid="athena-agent-surface"
    />
  );
}

export function AthenaAgentSurface(props: AthenaAgentSurfaceProps) {
  return <AthenaAgentSurfaceEntry {...props} />;
}
