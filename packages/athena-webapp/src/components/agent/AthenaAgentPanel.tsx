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
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Id } from "~/convex/_generated/dataModel";

import { AthenaAgentSafeText } from "./AthenaAgentSafeText";
import { WORD_INK_MS, characterCount, revealDuration, revealedProse } from "./streamReveal";
import {
  composeAthenaThreadKey,
  describeAthenaProvisionalCue,
  describeAthenaProvisionalEntry,
  describeAthenaProvisionalNotice,
  describeAthenaProvisionalTimeline,
  describeAthenaProvisionalTimelineEmpty,
  type AthenaAgentContext,
  type AthenaAgentPresentation,
} from "./AthenaAgentPresentationAdapter";
import { Badge } from "../ui/badge";
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
  type AthenaAgentSource,
} from "./useAthenaAgentRun";

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 720;
const DEFAULT_PANEL_WIDTH = 420;
const WIDTH_STEP = 32;

/** Every operable control clears the minimum touch target. */
const TOUCH_TARGET = "min-h-[44px] min-w-[44px]";

/** The draft states that paint text or a line of their own. */
const PROVISIONAL_VISIBLE_STATES: ReadonlySet<AthenaAgentProvisionalState> = new Set([
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
  return node.scrollHeight - node.clientHeight - node.scrollTop > SCROLL_FOLLOW_SLACK;
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
  /** Pace: a streaming text catches up within 180 ms, a settled one within 120 ms. */
  isStreaming: boolean;
  /** A new key is seen to arrive from nothing instead of painting whole. */
  arrives: boolean;
  animate: boolean;
}): { text: string | null; settled: boolean } {
  const { text, key, isStreaming, arrives, animate } = input;
  const visibleRef = useRef<{ key: string; text: string } | null>(null);
  const frameRef = useRef<number | null>(null);
  const [visible, setVisible] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    const stop = () => {
      if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
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
      setVisible((current) => (current && current.key === key && current.text === next ? current : { key, text: next }));
    };
    const current = visibleRef.current && visibleRef.current.key === key ? visibleRef.current.text : null;
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
    const duration = revealDuration(pending, isStreaming);
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
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
  }, [text, key, isStreaming, arrives, animate]);

  if (text === null || key === null) return { text: null, settled: true };
  const shown = visible && visible.key === key ? visible.text : null;
  if (shown === null) return { text: arrives && animate ? "" : text, settled: !(arrives && animate) };
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

function titleCase(value: string) {
  const spaced = value.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function describeQuality(answer: AthenaAgentAnswer): {
  label: string;
  tone: "neutral" | "warning";
} {
  if (answer.outcome === "no_usable_sources") {
    return { label: "No usable sources", tone: "warning" };
  }
  if (answer.limitedEvidence) return { label: "Limited evidence", tone: "warning" };
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
  readonly scrollTop?: number;
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
  scrollTop = 0,
  onScrollTopChange,
}: AthenaAgentPanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const answerHeadingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const citationRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sourceHeadingRef = useRef<HTMLHeadingElement>(null);
  const withdrawnRef = useRef<HTMLDivElement>(null);
  const previousState = useRef<{
    hostState: AthenaAgentRun["hostState"];
    provisionalState: AthenaAgentRun["provisionalState"];
  } | null>(null);
  /**
   * The turn whose focus a withdrawal notice already claimed. Every cause that
   * withdraws a draft also ends the run moments later, and that terminal denial
   * would otherwise be a second move for one outcome. It is keyed by turn — the
   * panel stays mounted across New thread — and it never suppresses the answer
   * heading or the operator's own stop.
   */
  const focusClaimedTurnRef = useRef<AthenaAgentRun["activeTurnId"]>(null);
  const followRef = useRef(true);
  const mountedScrollRef = useRef(false);
  const latestRef = useRef<HTMLButtonElement>(null);
  // The panel's own focus moves (status, answer heading, withdrawn notice,
  // citation, source) land inside the transcript; they are not the operator
  // reading there and must not withdraw the follow. `focus()` dispatches its
  // events synchronously, so a flag around the call is enough.
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
  const [activeCitation, setActiveCitation] = useState<string | null>(null);
  const [draftCue, setDraftCue] = useState<{
    key: string;
    ordinal: number | null;
    text: string;
  } | null>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // Restore the reading position when the layout swaps the panel out. The
  // restored position decides whether the latest is still being followed, or
  // the follow would re-anchor to the bottom and discard it.
  useEffect(() => {
    const node = scrollRef.current;
    if (node && scrollTop > 0) {
      positionAt(node, scrollTop);
      followRef.current = !awayFromLatest(node);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per mount.
  }, []);

  const provisionalState = run.provisionalState;
  const draftOrdinal = run.provisional?.draftOrdinal ?? null;
  const draftText = run.provisional?.text ?? null;
  // The live draft is revealed flush by flush; a new draft is seen to start,
  // and a draft that stopped growing (committing, paused) settles briskly.
  const draftStreaming = provisionalState === "streaming" || provisionalState === "reset";
  const draftReveal = useStreamingText({
    text: draftText,
    key: draftOrdinal === null || !run.activeTurnId ? null : `${run.activeTurnId}:${draftOrdinal}`,
    isStreaming: draftStreaming,
    arrives: draftStreaming,
    animate: !reducedMotion,
  });
  const draftWipe = useWordWipe(!reducedMotion && draftText !== null && (draftStreaming || !draftReveal.settled));
  // The committed answer is seen to land only when it arrives while the panel
  // is already showing this turn run; a panel that mounts onto an answer, or
  // a turn read back from history, paints it whole.
  const answerKey = run.answer && run.activeTurnId ? `${run.activeTurnId}:${run.answer.committedAt}` : null;
  const answerArrivalRef = useRef<{ key: string; live: boolean } | null>(null);
  const runningTurnRef = useRef<string | null>(null);
  if (answerKey !== null && answerArrivalRef.current?.key !== answerKey) {
    answerArrivalRef.current = { key: answerKey, live: runningTurnRef.current === run.activeTurnId };
  }
  if (run.activeTurnId && run.hostState === "running") runningTurnRef.current = run.activeTurnId;
  const answerReveal = useStreamingText({
    text: run.answer?.narrative ?? null,
    key: answerKey,
    // An answer that lands live arrives from nothing at the settled pace; one
    // the panel mounts onto is already settled and paints whole.
    isStreaming: false,
    arrives: answerArrivalRef.current?.live === true,
    animate: !reducedMotion && answerArrivalRef.current?.live === true,
  });
  const answerWipe = useWordWipe(!reducedMotion && !answerReveal.settled);

  /**
   * One coalesced line per draft, from the closed vocabulary — never a token of
   * model text. The key carries the draft it belongs to, so the deltas that
   * follow a cue never repeat it and the next draft's cue is a new node the
   * live region announces.
   */
  useEffect(() => {
    if (
      provisionalState === "reset" ||
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
    if (!visible && latestRef.current !== null && document.activeElement === latestRef.current) {
      promptRef.current?.focus();
    }
    setLatestVisible((current) => (current === visible ? current : visible));
  }, []);

  // Follow the latest on every commit: a revealed draft or answer, a new
  // milestone, a new entry — anything that grows the transcript while the
  // operator is following. The first commit positions without a glide.
  useEffect(() => {
    const node = scrollRef.current;
    if (node && followRef.current) {
      if (mountedScrollRef.current) anchorToBottom(node);
      else positionAt(node, "bottom");
    }
    mountedScrollRef.current = true;
    syncLatest();
  });

  const interruptFollowing = useCallback(() => {
    followRef.current = false;
  }, []);

  const scrollToLatest = useCallback(() => {
    followRef.current = true;
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
      focusOwn(answerHeadingRef.current);
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

  const openSource = useCallback(
    (citationRef: string) => {
      setActiveCitation(citationRef);
      void run.inspectCitation(citationRef);
    },
    [run],
  );

  const closeSource = useCallback(
    (citationRef: string) => {
      setActiveCitation(null);
      focusOwn(citationRefs.current[citationRef]);
    },
    [focusOwn],
  );

  const sourceEntries = useMemo(
    () => Object.values(run.sources),
    [run.sources],
  );

  const answerQuality = run.answer ? describeQuality(run.answer) : null;
  const provisionalNotice = describeAthenaProvisionalNotice();
  const provisionalTimelineCopy = describeAthenaProvisionalTimeline();
  // Finished drafts, rendered only where the live draft itself may show:
  // inside the provisional container while the turn runs, and behind the
  // committed answer once it has superseded them. The hook already empties
  // the list for withdrawn, stalled, and disabled drafts; this guard keeps the
  // panel honest if it is ever fed a run by hand.
  const provisionalEntries = PROVISIONAL_TIMELINE_STATES.has(run.provisionalState)
    ? run.provisionalTimeline
    : [];
  const renderProvisionalEntries = () =>
    provisionalEntries.map((entry, index) => (
      <article
        className="space-y-layout-2xs border-l-2 border-border pl-3"
        data-ordinal={entry.draftOrdinal}
        data-testid="athena-agent-provisional-entry"
        key={entry.draftOrdinal}
      >
        <p className="text-xs font-medium text-muted-foreground">
          {describeAthenaProvisionalEntry(index)}
        </p>
        <AthenaAgentSafeText
          className="text-muted-foreground"
          mode="provisional"
          text={entry.text}
        />
      </article>
    ));

  useEffect(() => {
    if (!activeCitation) return;
    const source = run.sources[activeCitation];
    if (!source || source.state === "loading") return;
    focusOwn(sourceHeadingRef.current);
  }, [activeCitation, run.sources, focusOwn]);

  const canSend = run.canSubmit && run.canFollowUp && draft.trim().length > 0;
  const submit = useCallback(
    async (prompt: string, options: { readonly starterIntentId?: string } = {}) => {
      // A new question takes precedence over the prior reading position.
      followRef.current = true;
      const node = scrollRef.current;
      if (node) anchorToBottom(node);
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

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-layout-sm border-b border-border px-layout-md py-layout-sm">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {presentation.entry.label}
          </p>
          <p className="text-sm text-muted-foreground">
            Read-only answers about what you can already see.
          </p>
        </div>
        <Button
          className={cn(TOUCH_TARGET, "shrink-0 gap-2")}
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
              <span className="sr-only">Close {presentation.entry.label}</span>
            </>
          )}
        </Button>
      </header>

      <section
        aria-label="Authorized context"
        className="space-y-layout-xs border-b border-border px-layout-md py-layout-sm"
        data-testid="athena-agent-context"
      >
        <p className="text-sm font-medium text-foreground">{run.context.label}</p>
        <dl className="flex flex-wrap gap-x-layout-md gap-y-1 text-xs text-muted-foreground">
          {run.context.entries.map((entry) => (
            <div className="flex gap-1" key={entry.key}>
              <dt className="font-medium">{entry.label}:</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
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

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className={cn("min-h-0 flex-1 overflow-y-auto", reducedMotion ? null : "scroll-smooth")}
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
        ref={scrollRef}
      >
        <section
          aria-label="Earlier questions"
          className="space-y-layout-sm px-layout-md py-layout-sm"
          data-testid="athena-agent-history"
        >
          {run.history.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No earlier questions in this conversation.
            </p>
          ) : (
            run.history.map((entry) => (
              <HistoryEntry entry={entry} key={entry.turnId} storeId={run.storeId} />
            ))
          )}
        </section>

        <section
          aria-label="This question"
          className="space-y-layout-sm px-layout-md py-layout-sm"
          data-testid="athena-agent-transcript"
        >
          {run.turn ? (
            <div className="space-y-1">
              <p
                className="text-xs text-muted-foreground"
                data-testid="athena-agent-turn-context"
              >
                {run.turn.contextLabel}
              </p>
              {run.turn.question ? (
                <p className="text-sm font-medium text-foreground">
                  {run.turn.question}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {run.turn.questionState === "retained"
                    ? "This question isn't shown."
                    : "This question is no longer stored."}
                </p>
              )}
            </div>
          ) : (
            <StarterIntents
              intents={run.starterIntents}
              // A tap sends immediately: the curated question needs no editing,
              // and the id opts the turn into its pre-executed read.
              onChoose={(intent) => void submit(intent.prompt, { starterIntentId: intent.id })}
            />
          )}

          <div
            className={cn(
              "rounded-md border border-border bg-surface px-3 py-2 text-sm",
              run.status.tone === "warning"
                ? "text-foreground"
                : "text-muted-foreground",
            )}
            data-testid="athena-agent-status"
            ref={statusRef}
            role="status"
            tabIndex={-1}
          >
            <p className="font-medium text-foreground">{run.status.headline}</p>
            {run.status.detail ? (
              <p className="text-xs text-muted-foreground">
                {run.status.detail}
              </p>
            ) : null}
          </div>

          <div
            aria-live="polite"
            className="space-y-1 text-xs text-muted-foreground"
            data-testid="athena-agent-progress"
          >
            {run.milestones.map((milestone) => (
              <p key={`${milestone.milestone}-${milestone.at}`}>
                {milestone.label}
              </p>
            ))}
          </div>

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
              This answer is for {run.turn?.contextLabel ?? "another context"}.
              Return to it, or confirm the current context, to keep asking.
            </p>
          ) : null}

          {/* The draft sits in the slot the answer article later occupies, so a
              denial, a withdrawal, and a resumed draft always read in that
              order — and the committed answer replaces the draft in place. */}
          {run.provisionalState === "withdrawn" && run.provisionalWithdrawal ? (
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
              className="space-y-layout-xs rounded-md border border-dashed border-border bg-surface px-3 py-2"
              data-state={run.provisionalState}
              data-testid="athena-agent-provisional"
            >
              {provisionalEntries.length > 0 ? (
                <div
                  className="space-y-layout-xs"
                  data-testid="athena-agent-provisional-entries"
                >
                  {renderProvisionalEntries()}
                </div>
              ) : null}
              {run.provisional ? (
                <>
                  <div data-testid="athena-agent-provisional-label">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {provisionalNotice.headline}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {provisionalNotice.detail}
                    </p>
                  </div>
                  <div
                    data-reveal={draftReveal.settled ? "settled" : "revealing"}
                    data-testid="athena-agent-provisional-text"
                  >
                    <AthenaAgentSafeText
                      className="text-muted-foreground"
                      mode="provisional"
                      text={draftReveal.text ?? run.provisional.text}
                      wipe={draftWipe}
                    />
                  </div>
                </>
              ) : null}
              {/* Its own region: the milestone region is server-authored
                  progress, and this one carries at most one cue per draft. */}
              <div
                aria-live="polite"
                className="text-xs text-muted-foreground"
                data-testid="athena-agent-provisional-live"
              >
                {draftCue ? <p key={draftCue.key}>{draftCue.text}</p> : null}
              </div>
            </section>
          ) : null}

          {run.answer ? (
            <article
              className="space-y-layout-sm"
              data-testid="athena-agent-answer"
            >
              <div className="flex flex-wrap items-center gap-layout-xs">
                <h3
                  className="text-sm font-semibold text-foreground"
                  data-testid="athena-agent-answer-heading"
                  ref={answerHeadingRef}
                  tabIndex={-1}
                >
                  Answer
                </h3>
                <Badge
                  data-testid="athena-agent-quality"
                  variant={
                    answerQuality?.tone === "warning" ? "outline" : "secondary"
                  }
                >
                  {answerQuality?.label}
                </Badge>
              </div>
              {run.answer.title ? (
                <p className="text-sm font-medium text-foreground">
                  {run.answer.title}
                </p>
              ) : null}
              <div
                data-reveal={answerReveal.settled ? "settled" : "revealing"}
                data-testid="athena-agent-answer-text"
              >
                <AthenaAgentSafeText
                  text={answerReveal.text ?? run.answer.narrative}
                  wipe={answerWipe}
                />
              </div>
              {run.answer.citations.length > 0 ? (
                <div
                  className="space-y-layout-xs"
                  data-testid="athena-agent-sources"
                >
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Sources
                  </p>
                  <ul className="flex flex-wrap gap-layout-xs">
                    {run.answer.citations.map((citation) => (
                      <li key={citation.citationRef}>
                        <Button
                          className={cn(TOUCH_TARGET)}
                          data-testid={`athena-agent-citation-${citation.citationRef}`}
                          disabled={!run.canInspectSources}
                          onClick={() => openSource(citation.citationRef)}
                          ref={(node) => {
                            citationRefs.current[citation.citationRef] = node;
                          }}
                          size="sm"
                          type="button"
                          variant="utility"
                        >
                          {citation.label ?? citation.namespace ?? "Source"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ) : null}

          {/* Behind the committed answer, the finished drafts stay readable as
              a collapsed block — still labelled unverified, still inert, and
              never part of the answer article or its focus target. */}
          {run.provisionalState === "superseded" && provisionalEntries.length > 0 ? (
            <details
              className="space-y-layout-xs rounded-md border border-dashed border-border bg-surface px-3 py-2"
              data-testid="athena-agent-provisional-timeline"
            >
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {provisionalTimelineCopy.summary}
              </summary>
              <p className="text-xs text-muted-foreground">
                {provisionalTimelineCopy.detail}
              </p>
              <div className="space-y-layout-xs">{renderProvisionalEntries()}</div>
            </details>
          ) : null}

          {/* Source detail sits beside the answer, never inside it: the answer
              body carries no interactive element of any kind. */}
          {sourceEntries.map((source) => (
            <SourceDrawer
              headingRef={
                activeCitation === source.citationRef
                  ? sourceHeadingRef
                  : undefined
              }
              key={source.citationRef}
              onClose={() => closeSource(source.citationRef)}
              source={source}
            />
          ))}
        </section>
      </div>
      {/* Floats over the transcript, above the composer, once the operator has
          scrolled away; a tap restarts the follow. */}
      <button
        aria-hidden={!latestVisible}
        aria-label="Scroll to latest"
        className={cn(
          "absolute bottom-3 left-1/2 z-10 grid -translate-x-1/2 place-items-center rounded-full border border-border bg-background text-foreground shadow-md",
          TOUCH_TARGET,
          "transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
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
          "mx-layout-md mb-layout-xs mt-layout-xs flex flex-col rounded-xl border border-border bg-background",
          "transition-colors focus-within:border-primary-border motion-reduce:transition-none",
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
            // Four lines from `rows`, then it scrolls; no resize handle, so the
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
          rows={4}
          size="sm"
          value={draft}
        />
        {/* Its own row rather than floating over the text, which would leave
            the last line running underneath the button. Context drift disables
            follow-up until the operator returns to the answer's context or
            confirms the current one. */}
        <div className="flex items-center justify-end px-3 pb-2 pt-1">
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
        </div>
        {run.blockedSubmission ? (
          <p
            className="text-xs text-foreground"
            data-testid="athena-agent-blocked"
            role="alert"
          >
            {run.blockedSubmission.headline}
          </p>
        ) : null}
      </form>

      <div
        className="flex flex-wrap items-center gap-layout-sm border-t border-border px-layout-md py-layout-sm"
        data-testid="athena-agent-controls"
      >
        {run.canCancel ? (
          <Button
            className={cn(TOUCH_TARGET)}
            data-testid="athena-agent-cancel"
            onClick={() => void run.cancel()}
            type="button"
            variant="utility"
          >
            Stop
          </Button>
        ) : null}
        <Button
          className={cn(TOUCH_TARGET)}
          data-testid="athena-agent-new-thread"
          disabled={!run.canStartNewThread}
          onClick={run.startNewThread}
          type="button"
          variant="ghost"
        >
          New thread
        </Button>
      </div>
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
      className="fixed inset-y-0 right-0 z-40 flex max-w-[100vw] border-l border-border bg-surface-raised shadow-overlay"
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
        className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="athena-agent-resize"
        onKeyDown={onResizeKeyDown}
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
    <div className="space-y-layout-xs" data-testid="athena-agent-starters">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Try
      </p>
      <ul className="flex flex-col gap-layout-xs">
        {intents.map((intent) => (
          <li key={intent.id}>
            <Button
              className={cn(TOUCH_TARGET, "w-full justify-start text-left")}
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

/**
 * How Athena got to an earlier turn's answer.
 *
 * Lazily mounted and lazily read: a long thread must not open one subscription
 * per turn, so the query starts on the first open and the server applies the
 * answer's own ladder to it. The drafts render exactly as the live pane
 * renders them — inert, labelled, and never part of the answer.
 */
function HistoryNarrativeTrail({
  storeId,
  turnId,
}: {
  storeId: Id<"store">;
  turnId: string;
}) {
  const [opened, setOpened] = useState(false);
  const trail = useAthenaAgentNarrativeTrail({ storeId, turnId, enabled: opened });
  const copy = describeAthenaProvisionalTimeline();
  return (
    <details
      className="space-y-layout-xs rounded-md border border-dashed border-border px-3 py-2"
      data-testid="athena-agent-history-trail"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {copy.summary}
      </summary>
      <p className="text-xs text-muted-foreground">{copy.detail}</p>
      {trail.state === "unavailable" ? (
        <div className="text-xs text-muted-foreground">
          <p>{trail.headline}</p>
          {trail.detail ? <p>{trail.detail}</p> : null}
        </div>
      ) : null}
      {trail.state === "trail" && trail.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{describeAthenaProvisionalTimelineEmpty()}</p>
      ) : null}
      {trail.state === "trail" ? (
        <div className="space-y-layout-xs">
          {trail.entries.map((draft, index) => (
            <article
              className="space-y-layout-2xs border-l-2 border-border pl-3"
              data-ordinal={draft.draftOrdinal}
              data-testid="athena-agent-provisional-entry"
              key={draft.draftOrdinal}
            >
              <p className="text-xs font-medium text-muted-foreground">
                {describeAthenaProvisionalEntry(index)}
              </p>
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
      className="space-y-1 border-b border-border/60 pb-layout-xs last:border-b-0"
      data-testid="athena-agent-history-entry"
    >
      {entry.contextLabel ? (
        <p className="text-[11px] text-muted-foreground">{entry.contextLabel}</p>
      ) : null}
      {entry.question ? (
        <p className="text-sm text-foreground">{entry.question}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {entry.questionState === "retained"
            ? "This question isn't shown."
            : "This question is no longer stored."}
        </p>
      )}
      {entry.answer ? (
        <AthenaAgentSafeText
          className="text-muted-foreground"
          text={entry.answer.narrative}
        />
      ) : null}
      {entry.omittedHeadline ? (
        <p className="text-xs text-muted-foreground">{entry.omittedHeadline}</p>
      ) : null}
      {entry.failureHeadline ? (
        <p className="text-xs text-muted-foreground">{entry.failureHeadline}</p>
      ) : null}
      {/* Only a turn that committed an answer has drafts the operator may
          still read: the trail is released and withdrawn with the answer. */}
      {entry.answer ? (
        <HistoryNarrativeTrail storeId={storeId} turnId={entry.turnId} />
      ) : null}
    </div>
  );
});

function SourceDrawer({
  source,
  onClose,
  headingRef,
}: {
  source: AthenaAgentSource;
  onClose: () => void;
  headingRef?: React.RefObject<HTMLHeadingElement>;
}) {
  return (
    <section
      className="space-y-layout-xs rounded-md border border-border bg-surface px-3 py-2"
      data-testid="athena-agent-source"
    >
      <div className="flex items-start justify-between gap-layout-sm">
        <h4
          className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          ref={headingRef}
          tabIndex={-1}
        >
          {source.label ?? "Source"}
        </h4>
        <Button
          className={cn(TOUCH_TARGET)}
          onClick={onClose}
          size="sm"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only">Close source</span>
        </Button>
      </div>
      {source.state === "loading" ? (
        <p className="text-xs text-muted-foreground">Checking this source…</p>
      ) : null}
      {source.headline ? (
        <p className="text-xs text-foreground">{source.headline}</p>
      ) : null}
      {source.state === "evidence" ? (
        <div className="flex flex-wrap gap-layout-xs text-xs text-muted-foreground">
          {source.freshness ? (
            <Badge variant="secondary">{titleCase(source.freshness)}</Badge>
          ) : null}
          {source.completeness ? (
            <Badge variant="secondary">{titleCase(source.completeness)}</Badge>
          ) : null}
        </div>
      ) : null}
      {source.link ? (
        <a
          className="inline-flex min-h-[44px] items-center text-sm text-primary underline-offset-4 hover:underline"
          href={source.link.href}
        >
          {source.link.label}
        </a>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Surface (entry + panel)
// ---------------------------------------------------------------------------

export type AthenaAgentSurfaceProps = {
  readonly presentation: AthenaAgentPresentation;
  readonly storeId: Id<"store">;
  readonly context: AthenaAgentContext;
  readonly routeParams?: Record<string, string | undefined>;
  readonly returnLabel?: string;
  /** `auto` follows the viewport; the explicit values exist for tests and hosts. */
  readonly layout?: "auto" | AthenaAgentLayout;
  readonly activeTurnId?: Id<"agentTurnBinding"> | null;
  readonly onActiveTurnChange?: (turnId: Id<"agentTurnBinding"> | null) => void;
  readonly className?: string;
};

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

export function AthenaAgentSurface({
  presentation,
  storeId,
  context,
  routeParams,
  returnLabel,
  layout = "auto",
  activeTurnId,
  onActiveTurnChange,
  className,
}: AthenaAgentSurfaceProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const scrollTopRef = useRef(0);
  const entryRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();
  // With no explicit layout the surface follows the profile's declared mount
  // mode, except on mobile where a docked panel has nowhere to dock.
  // `inline_section` renders as a docked panel: the host has no inline mount.
  const resolvedLayout: AthenaAgentLayout =
    layout !== "auto"
      ? layout
      : isMobile || presentation.mountMode === "full_screen_sheet"
        ? "fullscreen"
        : "docked";

  const handleKey = `${TURN_HANDLE_PREFIX}${composeAthenaThreadKey(presentation, context)}`;
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
      onActiveTurnChange?.(turnId);
    },
    [handleKey, onActiveTurnChange],
  );

  const run = useAthenaAgentRun({
    presentation,
    storeId,
    context,
    ...(routeParams ? { routeParams } : {}),
    isActive: open,
    activeTurnId: activeTurnId !== undefined ? activeTurnId : restored.turnId,
    onActiveTurnChange: rememberTurn,
  });

  const close = useCallback(() => {
    setOpen(false);
    entryRef.current?.focus();
    // The full-screen sheet is a modal dialog that restores focus itself when it
    // unmounts, which lands after this call; re-assert the entry afterwards so
    // the operator always returns to the control they opened.
    window.setTimeout(() => entryRef.current?.focus(), 0);
  }, []);

  return (
    <div className={cn("contents", className)} data-testid="athena-agent-surface">
      <Button
        className={cn(TOUCH_TARGET)}
        data-testid="athena-agent-entry"
        onClick={() => setOpen((current) => !current)}
        ref={entryRef}
        type="button"
        variant="utility"
      >
        {presentation.entry.label}
      </Button>
      {open ? (
        <AthenaAgentPanel
          draft={draft}
          layout={resolvedLayout}
          onClose={close}
          onDraftChange={setDraft}
          onScrollTopChange={(next) => {
            scrollTopRef.current = next;
          }}
          onWidthChange={setWidth}
          presentation={presentation}
          run={run}
          scrollTop={scrollTopRef.current}
          {...(returnLabel ? { returnLabel } : {})}
          width={width}
        />
      ) : null}
    </div>
  );
}
