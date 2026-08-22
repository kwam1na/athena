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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Id } from "~/convex/_generated/dataModel";

import { AthenaAgentSafeText } from "./AthenaAgentSafeText";
import {
  composeAthenaThreadKey,
  type AthenaAgentContext,
  type AthenaAgentPresentation,
} from "./AthenaAgentPresentationAdapter";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import {
  useAthenaAgentRun,
  type AthenaAgentAnswer,
  type AthenaAgentHistoryEntry,
  type AthenaAgentRun,
  type AthenaAgentSource,
} from "./useAthenaAgentRun";

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 720;
const DEFAULT_PANEL_WIDTH = 420;
const WIDTH_STEP = 32;

/** Every operable control clears the minimum touch target. */
const TOUCH_TARGET = "min-h-[44px] min-w-[44px]";

export type AthenaAgentLayout = "docked" | "fullscreen";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
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
  const previousState = useRef<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<string | null>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // Restore the reading position when the layout swaps the panel out.
  useEffect(() => {
    const node = scrollRef.current;
    if (node && scrollTop > 0) node.scrollTop = scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per mount.
  }, []);

  // Deliberate focus moves: start, stop, completion, and terminal states.
  useEffect(() => {
    const previous = previousState.current;
    previousState.current = run.hostState;
    if (previous === run.hostState) return;
    if (
      run.hostState === "submitting" ||
      run.hostState === "cancellation_requested" ||
      run.hostState === "terminal_denied" ||
      run.hostState === "expired_content"
    ) {
      statusRef.current?.focus();
      return;
    }
    if (
      run.hostState === "completed" ||
      run.hostState === "partial" ||
      run.hostState === "no_usable_sources"
    ) {
      answerHeadingRef.current?.focus();
    }
  }, [run.hostState]);

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
      citationRefs.current[citationRef]?.focus();
    },
    [],
  );

  const sourceEntries = useMemo(
    () => Object.values(run.sources),
    [run.sources],
  );

  useEffect(() => {
    if (!activeCitation) return;
    const source = run.sources[activeCitation];
    if (!source || source.state === "loading") return;
    sourceHeadingRef.current?.focus();
  }, [activeCitation, run.sources]);

  const submit = useCallback(
    async (prompt: string) => {
      await run.submit(prompt);
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

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="athena-agent-scroll"
        onScroll={(event) =>
          onScrollTopChange?.((event.target as HTMLDivElement).scrollTop)
        }
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
              <HistoryEntry entry={entry} key={entry.turnId} />
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
              onChoose={(prompt) => onDraftChange(prompt)}
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
                    describeQuality(run.answer).tone === "warning"
                      ? "outline"
                      : "secondary"
                  }
                >
                  {describeQuality(run.answer).label}
                </Badge>
              </div>
              {run.answer.title ? (
                <p className="text-sm font-medium text-foreground">
                  {run.answer.title}
                </p>
              ) : null}
              <AthenaAgentSafeText text={run.answer.narrative} />
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

      <form
        className="space-y-layout-xs border-t border-border px-layout-md py-layout-sm"
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
          data-testid="athena-agent-prompt"
          id="athena-agent-prompt"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (run.canSubmit && run.canFollowUp) void submit(draft);
            }
          }}
          placeholder="Ask about this context"
          ref={promptRef}
          size="sm"
          value={draft}
        />
        {/* Context drift disables follow-up until the operator returns to the
            answer's context or confirms the current one. */}
        <div className="flex items-center justify-between gap-layout-sm">
          <p className="text-xs text-muted-foreground">
            Athena answers from sources you are allowed to read.
          </p>
          <Button
            className={cn(TOUCH_TARGET)}
            data-testid="athena-agent-submit"
            disabled={!run.canSubmit || !run.canFollowUp}
            type="submit"
          >
            {run.isSubmitting ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : null}
            Ask
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
  onChoose: (prompt: string) => void;
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
              onClick={() => onChoose(intent.prompt)}
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

function HistoryEntry({ entry }: { entry: AthenaAgentHistoryEntry }) {
  return (
    <div className="space-y-1 border-b border-border/60 pb-layout-xs last:border-b-0">
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
    </div>
  );
}

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
  const resolvedLayout: AthenaAgentLayout =
    layout === "auto" ? (isMobile ? "fullscreen" : "docked") : layout;

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
