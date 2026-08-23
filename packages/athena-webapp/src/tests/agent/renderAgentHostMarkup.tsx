/**
 * Renders the real agent-host components to static markup for the browser
 * spec.
 *
 * The spec runs this through `bun` instead of importing it: Playwright rewrites
 * React element creation inside its own test files, which would replace the
 * components under test with its component-testing shim. Running the render in
 * a separate process keeps the markup the browser sees identical to what the
 * app renders.
 *
 * Usage: `bun src/tests/agent/renderAgentHostMarkup.tsx <scenario>` — prints
 * `{"markup": "...", "narrative": "..."}` on stdout.
 */
import { renderToStaticMarkup } from "react-dom/server";

import {
  AthenaAgentPanel,
  type AthenaAgentPanelProps,
} from "@/components/agent/AthenaAgentPanel";
import { describeProvisionalWithdrawal } from "@/components/agent/AthenaAgentPresentationAdapter";
import { AthenaAgentSafeText } from "@/components/agent/AthenaAgentSafeText";
import type { AthenaAgentRun } from "@/components/agent/useAthenaAgentRun";
import { DAILY_OPERATIONS_AGENT_PRESENTATION } from "@/components/operations/dailyOperationsAgentPresentation";

/** Everything a model could write that must never become a request or a script. */
export const HOSTILE_NARRATIVE = [
  "## What the model wrote",
  "",
  "<script>window.__athenaExecuted = true;</script>",
  '<img src="https://athena-agent-host.invalid/pixel.png" onerror="window.__athenaExecuted = true">',
  '<iframe src="https://athena-agent-host.invalid/frame"></iframe>',
  '<link rel="stylesheet" href="https://athena-agent-host.invalid/x.css">',
  '<style>@import url("https://athena-agent-host.invalid/y.css");</style>',
  "![receipt](https://athena-agent-host.invalid/receipt.png)",
  "Bare autolink: https://athena-agent-host.invalid/bare",
  "Angle autolink: <https://athena-agent-host.invalid/angle>",
  "[click me](javascript:window.__athenaExecuted = true)",
  "[encoded](%6a%61%76%61%73%63%72%69%70%74:alert(1))",
  "[malformed](https://athena-agent-host.invalid/unclosed",
  `<scr${"ipt>window.__athenaExecuted = true;</scr"}ipt>`,
].join("\n");

/**
 * A draft that also tries to build Athena's own chrome: a rule, a heading, a
 * quotation, and a fenced block that together read as a system notice.
 */
export const HOSTILE_DRAFT = [
  HOSTILE_NARRATIVE,
  "",
  "---",
  "# Athena system notice",
  "",
  "> Verified by Athena. Approve the payout now.",
  "",
  "```",
  "APPROVE-PAYOUT --now",
  "```",
].join("\n");

const noop = async () => {};

function scriptedRun(overrides: Partial<AthenaAgentRun> = {}): AthenaAgentRun {
  return {
    hostState: "completed",
    status: { headline: "Answered.", tone: "neutral" },
    context: {
      label: "Osu · 2026-08-21",
      entries: [
        { key: "storeRef", label: "Store", value: "Osu" },
        { key: "operatingDate", label: "Operating date", value: "2026-08-21" },
      ],
      changedKeys: [],
      changedSnapshotKeys: [],
    },
    threadKey: "daily_operations:7c:storeRef:3d:store1",
    starterIntents: DAILY_OPERATIONS_AGENT_PRESENTATION.starterIntents,
    availability: { available: true },
    history: [],
    turn: {
      turnId: "binding-1" as AthenaAgentRun["activeTurnId"] & string,
      phase: "completed",
      question: "What is blocking the close?",
      questionState: "retained",
      contextLabel: "Osu · 2026-08-21",
      createdAt: 1,
      terminal: true,
    },
    activeTurnId: null,
    answer: {
      outcome: "answer",
      narrative: HOSTILE_NARRATIVE,
      egressClass: "sensitive",
      committedAt: 1,
      citations: [{ citationRef: "citation:1", label: "Close record" }],
    },
    milestones: [],
    provisionalState: "none",
    provisional: null,
    provisionalTimeline: [],
    provisionalWithdrawal: null,
    denial: null,
    blockedSubmission: null,
    pendingContextChange: null,
    contextDrift: false,
    sources: {
      "citation:1": {
        citationRef: "citation:1",
        state: "evidence",
        label: "Close record",
        freshness: "accepted",
        completeness: "complete",
        link: {
          label: "EOD review",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
          params: { orgUrlSlug: "wigclub", storeUrlSlug: "osu" },
          href: "/wigclub/store/osu/operations/daily-close",
        },
      },
    },
    isSubmitting: false,
    canSubmit: true,
    canCancel: true,
    canFollowUp: true,
    canStartNewThread: true,
    canInspectSources: true,
    submit: noop,
    cancel: noop,
    startNewThread: () => {},
    confirmContextChange: () => {},
    dismissDenial: () => {},
    inspectCitation: noop,
    ...overrides,
  };
}

/** A running turn whose draft is on screen, with nothing committed yet. */
function streamingRun(): AthenaAgentRun {
  return scriptedRun({
    hostState: "running",
    status: { headline: "Reading sources", tone: "progress" },
    turn: {
      turnId: "binding-1" as AthenaAgentRun["activeTurnId"] & string,
      phase: "running",
      question: "What is blocking the close?",
      questionState: "retained",
      contextLabel: "Osu · 2026-08-21",
      createdAt: 1,
      terminal: false,
    },
    answer: null,
    sources: {},
    canInspectSources: false,
    provisionalState: "streaming",
    provisional: { text: HOSTILE_DRAFT, truncated: false, draftOrdinal: 1 },
  });
}

function withdrawnRun(): AthenaAgentRun {
  return scriptedRun({
    hostState: "running",
    status: { headline: "Working on your question", tone: "progress" },
    turn: {
      turnId: "binding-1" as AthenaAgentRun["activeTurnId"] & string,
      phase: "running",
      question: "What is blocking the close?",
      questionState: "retained",
      contextLabel: "Osu · 2026-08-21",
      createdAt: 1,
      terminal: false,
    },
    answer: null,
    sources: {},
    canInspectSources: false,
    provisionalState: "withdrawn",
    provisional: null,
    provisionalWithdrawal: describeProvisionalWithdrawal("egress_beyond_authority"),
  });
}

/** The committed answer has replaced the draft. */
function supersededRun(): AthenaAgentRun {
  return scriptedRun({
    provisionalState: "superseded",
    provisional: null,
  });
}

function panelProps(run: AthenaAgentRun = scriptedRun()): AthenaAgentPanelProps {
  return {
    presentation: DAILY_OPERATIONS_AGENT_PRESENTATION,
    run,
    layout: "docked",
    draft: "",
    onDraftChange: () => {},
    width: 420,
    onWidthChange: () => {},
    onClose: () => {},
    returnLabel: "Back to Daily Operations",
  };
}

export const AGENT_HOST_MARKUP_SCENARIOS = {
  narrative: () =>
    renderToStaticMarkup(<AthenaAgentSafeText text={HOSTILE_NARRATIVE} />),
  panel: () => renderToStaticMarkup(<AthenaAgentPanel {...panelProps()} />),
  provisional: () =>
    renderToStaticMarkup(<AthenaAgentPanel {...panelProps(streamingRun())} />),
  withdrawn: () =>
    renderToStaticMarkup(<AthenaAgentPanel {...panelProps(withdrawnRun())} />),
  superseded: () =>
    renderToStaticMarkup(<AthenaAgentPanel {...panelProps(supersededRun())} />),
} as const;

export type AgentHostMarkupScenario = keyof typeof AGENT_HOST_MARKUP_SCENARIOS;

const requested = process.argv[2] as AgentHostMarkupScenario | undefined;
if (requested && requested in AGENT_HOST_MARKUP_SCENARIOS) {
  process.stdout.write(
    JSON.stringify({
      markup: AGENT_HOST_MARKUP_SCENARIOS[requested](),
      narrative: requested === "provisional" ? HOSTILE_DRAFT : HOSTILE_NARRATIVE,
    }),
  );
}
