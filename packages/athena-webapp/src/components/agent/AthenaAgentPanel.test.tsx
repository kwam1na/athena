import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

import {
  AthenaAgentPanel,
  AthenaAgentSurface,
} from "./AthenaAgentPanel";
import {
  defineAthenaAgentPresentation,
  describeProvisionalWithdrawal,
} from "./AthenaAgentPresentationAdapter";
import type { AthenaAgentRun } from "./useAthenaAgentRun";

vi.mock("~/convex/_generated/api", () => ({
  api: {
    agentHarness: {
      turns: {
        startTurn: "startTurn",
        cancelTurn: "cancelTurn",
        resumeTurn: "resumeTurn",
        acknowledgeTurnAnswer: "acknowledgeTurnAnswer",
        inspectCitationEvidence: "inspectCitationEvidence",
        acknowledgeProvisionalView: "acknowledgeProvisionalView",
        getTurnView: "getTurnView",
        getTurnAnswer: "getTurnAnswer",
        getThreadHistory: "getThreadHistory",
        previewTurnNarrative: "previewTurnNarrative",
        getTurnNarrativeTrail: "getTurnNarrativeTrail",
      },
    },
  },
}));

const storePresentation = defineAthenaAgentPresentation({
  contractVersion: 1,
  profileId: "daily_operations",
  contextBinding: {
    scopeKind: "store",
    keys: ["storeRef", "operatingDate"],
    snapshotKeys: ["operatingDate"],
  },
  contextLabel: (context) =>
    `${context.storeName ?? context.storeRef ?? "This store"} · ${context.operatingDate ?? ""}`.trim(),
  entry: { label: "Ask Athena", location: "operations.dailyOperations.header" },
  mountMode: "docked_panel",
  starterIntents: [
    {
      id: "close_readiness",
      label: "What is holding up the close?",
      prompt: "What is blocking the end-of-day close?",
      requiresPackages: ["operations"],
    },
  ],
  resolveSourceDestination: (sourceRef) =>
    sourceRef.kind === "close_record"
      ? {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
          label: "EOD review",
        }
      : null,
  threadKeyPolicy: {
    parts: ["profileId", "storeRef"],
    onContextChange: "confirm_before_next_turn",
    activeTurnPolicy: "block_second_submission",
  },
});

/** A second, non-isomorphic profile: organization scope, different everything. */
const organizationPresentation = defineAthenaAgentPresentation({
  contractVersion: 1,
  profileId: "organization_overview",
  contextBinding: {
    scopeKind: "organization",
    keys: ["organizationRef"],
  },
  contextLabel: (context) =>
    `${context.organizationName ?? context.organizationRef ?? "Organization"} · all stores`,
  entry: { label: "Fleet questions", location: "organization.overview.header" },
  mountMode: "full_screen_sheet",
  starterIntents: [
    {
      id: "fleet_health",
      label: "Which stores need attention?",
      prompt: "Which stores need attention today?",
      requiresPackages: ["fleet"],
    },
    {
      id: "team_directory",
      label: "Who is on shift?",
      prompt: "Who is on shift across the fleet?",
      requiresPackages: ["directory"],
    },
  ],
  resolveSourceDestination: (sourceRef) =>
    sourceRef.kind === "store_health"
      ? {
          kind: "internal_route",
          route: "/$orgUrlSlug/stores",
          label: "Store directory",
        }
      : null,
  threadKeyPolicy: {
    parts: ["profileId", "organizationRef"],
    onContextChange: "detach_and_offer_new_thread",
    activeTurnPolicy: "block_second_submission",
  },
});

const STORE_ID = "store-1" as Id<"store">;
const storeContext = {
  storeRef: "store-1",
  storeName: "Osu",
  operatingDate: "2026-08-21",
};

type Backend = {
  history: unknown;
  view: unknown;
  answer: unknown;
  trail: unknown;
  calls: { name: string; args: unknown }[];
  results: Record<string, unknown>;
};

let backend: Backend;

beforeEach(() => {
  backend = {
    history: { kind: "history", threadKey: "t", reauthorizedAt: 1, entries: [] },
    view: undefined,
    answer: undefined,
    trail: undefined,
    calls: [],
    results: {},
  };
  vi.mocked(useQuery).mockImplementation(((name: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (name === "getThreadHistory") return backend.history;
    if (name === "getTurnView") return backend.view;
    if (name === "getTurnAnswer") return backend.answer;
    if (name === "getTurnNarrativeTrail") return backend.trail;
    return undefined;
  }) as unknown as typeof useQuery);
  vi.mocked(useMutation).mockImplementation(((name: string) =>
    vi.fn(async (args: unknown) => {
      backend.calls.push({ name, args });
      return backend.results[name] ?? { outcome: "unavailable", reason: "not_found" };
    })) as unknown as typeof useMutation);
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

function renderSurface(props: Record<string, unknown> = {}) {
  return render(
    <AthenaAgentSurface
      context={storeContext}
      presentation={storePresentation}
      returnLabel="Back to Daily Operations"
      routeParams={{ orgUrlSlug: "wigclub", storeUrlSlug: "osu" }}
      storeId={STORE_ID}
      {...props}
    />,
  );
}

function baseRun(overrides: Partial<AthenaAgentRun> = {}): AthenaAgentRun {
  return {
    hostState: "idle",
    storeId: STORE_ID,
    status: { headline: "Ask about this store day.", tone: "neutral" },
    context: {
      label: "Osu · 2026-08-21",
      entries: [
        { key: "storeRef", label: "Store", value: "Osu" },
        { key: "operatingDate", label: "Operating date", value: "2026-08-21" },
      ],
      changedKeys: [],
      changedSnapshotKeys: [],
    },
    threadKey: "daily_operations:7c:storeRef:3d:store-1",
    starterIntents: storePresentation.starterIntents,
    availability: { available: true },
    history: [],
    turn: null,
    activeTurnId: null,
    answer: null,
    milestones: [],
    provisionalState: "none",
    provisional: null,
    provisionalTimeline: [],
    provisionalWithdrawal: null,
    denial: null,
    blockedSubmission: null,
    pendingContextChange: null,
    contextDrift: false,
    sources: {},
    isSubmitting: false,
    canSubmit: true,
    canCancel: false,
    canFollowUp: true,
    canStartNewThread: true,
    canInspectSources: false,
    submit: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    startNewThread: vi.fn(),
    confirmContextChange: vi.fn(),
    dismissDenial: vi.fn(),
    inspectCitation: vi.fn(async () => {}),
    ...overrides,
  };
}

function PanelHarness({
  run,
  presentation = storePresentation,
  layout = "docked",
  onClose = () => {},
  scrollTop,
}: {
  run: AthenaAgentRun;
  presentation?: typeof storePresentation;
  layout?: "docked" | "fullscreen";
  onClose?: () => void;
  scrollTop?: number;
}) {
  const [draft, setDraft] = useState("");
  const [width, setWidth] = useState(420);
  return (
    <AthenaAgentPanel
      draft={draft}
      layout={layout}
      onClose={onClose}
      onDraftChange={setDraft}
      onWidthChange={setWidth}
      presentation={presentation}
      returnLabel="Back to Daily Operations"
      run={run}
      scrollTop={scrollTop}
      width={width}
    />
  );
}

describe("the Ask Athena entry", () => {
  it("is closed by default and opens onto the authorized context with the prompt focused", async () => {
    const user = userEvent.setup();
    renderSurface();

    const entry = screen.getByTestId("athena-agent-entry");
    expect(entry).toHaveTextContent("Ask Athena");
    expect(screen.queryByTestId("athena-agent-panel")).not.toBeInTheDocument();

    await user.click(entry);

    const panel = screen.getByTestId("athena-agent-panel");
    expect(within(panel).getByTestId("athena-agent-context")).toHaveTextContent(
      "Osu",
    );
    expect(within(panel).getByTestId("athena-agent-context")).toHaveTextContent(
      "2026-08-21",
    );
    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-prompt")).toHaveFocus(),
    );
  });

  it("keeps every control at an operable size", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByTestId("athena-agent-entry"));

    for (const control of screen.getAllByTestId(/athena-agent-(entry|submit|cancel|new-thread|close)/)) {
      expect(control.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it("restores focus to the entry when the panel closes", async () => {
    const user = userEvent.setup();
    renderSurface();
    const entry = screen.getByTestId("athena-agent-entry");

    await user.click(entry);
    await user.click(screen.getByTestId("athena-agent-close"));

    await waitFor(() => expect(entry).toHaveFocus());
    expect(screen.queryByTestId("athena-agent-panel")).not.toBeInTheDocument();
  });
});

describe("full-screen focus and motion", () => {
  it("returns focus to the entry when the full-screen sheet closes", async () => {
    const user = userEvent.setup();
    renderSurface({ layout: "fullscreen" });
    const entry = screen.getByTestId("athena-agent-entry");

    await user.click(entry);
    await screen.findByTestId("athena-agent-panel");
    // The sheet is a modal dialog: Radix takes pointer events off the rest of
    // the document, so the close is dispatched directly.
    fireEvent.click(screen.getByTestId("athena-agent-close"));

    await waitFor(() => expect(entry).toHaveFocus());
    expect(screen.queryByTestId("athena-agent-panel")).not.toBeInTheDocument();
  });

  it("suppresses the sheet animation under reduced motion", async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const user = userEvent.setup();
    renderSurface({ layout: "fullscreen" });

    await user.click(screen.getByTestId("athena-agent-entry"));

    const panel = await screen.findByTestId("athena-agent-panel");
    expect(panel).toHaveAttribute("data-motion", "reduced");
    expect(panel.className).toContain("animate-none");
    expect(screen.getByTestId("athena-agent-status")).toBeInTheDocument();
  });
});

describe("layout", () => {
  it("docks a resizable panel that leaves the surface usable", async () => {
    const user = userEvent.setup();
    renderSurface({ layout: "docked" });
    await user.click(screen.getByTestId("athena-agent-entry"));

    const panel = screen.getByTestId("athena-agent-panel");
    expect(panel).toHaveAttribute("data-layout", "docked");
    expect(panel).toHaveStyle({ width: "420px" });
    expect(panel.getAttribute("role")).toBe("complementary");
    expect(document.querySelector("[data-athena-agent-scrim]")).toBeNull();

    const handle = screen.getByTestId("athena-agent-resize");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    handle.focus();
    await user.keyboard("{ArrowLeft}");

    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-panel")).not.toHaveStyle({
        width: "420px",
      }),
    );
  });

  it("uses a full-screen sheet with an explicit return action on narrow viewports", async () => {
    const user = userEvent.setup();
    renderSurface({ layout: "fullscreen" });
    await user.click(screen.getByTestId("athena-agent-entry"));

    const panel = await screen.findByTestId("athena-agent-panel");
    expect(panel).toHaveAttribute("data-layout", "fullscreen");
    expect(screen.getByTestId("athena-agent-close")).toHaveTextContent(
      "Back to Daily Operations",
    );
  });

  it("seeds the layout from the profile's mount mode when none is given", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSurface();
    await user.click(screen.getByTestId("athena-agent-entry"));
    // storePresentation declares mountMode "docked_panel".
    expect(screen.getByTestId("athena-agent-panel")).toHaveAttribute(
      "data-layout",
      "docked",
    );
    unmount();

    // organizationPresentation declares mountMode "full_screen_sheet".
    renderSurface({
      context: { organizationRef: "org-1", organizationName: "Wigclub" },
      presentation: organizationPresentation,
    });
    await user.click(screen.getByTestId("athena-agent-entry"));
    expect(await screen.findByTestId("athena-agent-panel")).toHaveAttribute(
      "data-layout",
      "fullscreen",
    );
  });

  it("keeps the prompt draft when the layout changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderSurface({ layout: "docked" });
    await user.click(screen.getByTestId("athena-agent-entry"));
    await user.type(screen.getByTestId("athena-agent-prompt"), "Half a question");

    rerender(
      <AthenaAgentSurface
        context={storeContext}
        layout="fullscreen"
        presentation={storePresentation}
        returnLabel="Back to Daily Operations"
        routeParams={{ orgUrlSlug: "wigclub", storeUrlSlug: "osu" }}
        storeId={STORE_ID}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-prompt")).toHaveValue(
        "Half a question",
      ),
    );
  });

  it("scrolls in exactly one place", () => {
    render(<PanelHarness run={baseRun()} />);

    const panel = screen.getByTestId("athena-agent-panel");
    const scrollers = Array.from(panel.querySelectorAll("*")).filter((node) =>
      /overflow-y-auto|overflow-auto/.test(node.className.toString()),
    );

    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]).toBe(screen.getByTestId("athena-agent-scroll"));
  });

  it("orders context, history, transcript, composer, and controls", () => {
    render(<PanelHarness run={baseRun()} />);

    const order = [
      "athena-agent-context",
      "athena-agent-history",
      "athena-agent-transcript",
      "athena-agent-composer",
      "athena-agent-controls",
    ].map((id) => screen.getByTestId(id));

    for (let index = 1; index < order.length; index += 1) {
      const relation = (order[index - 1] as HTMLElement).compareDocumentPosition(
        order[index] as HTMLElement,
      );
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("states", () => {
  it("announces server milestones in the live region and shows no model text while running", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "running",
          status: { headline: "Reading sources", tone: "progress" },
          canCancel: true,
          canSubmit: false,
          milestones: [
            { milestone: "checking_sources", label: "Checking the requested sources", at: 1 },
            { milestone: "reading_sources", label: "Reading sources", at: 2 },
          ],
          turn: {
            turnId: "binding-1" as Id<"agentTurnBinding">,
            phase: "running",
            question: "What is blocking the close?",
            questionState: "retained",
            contextLabel: "Osu · 2026-08-21",
            createdAt: 1,
            terminal: false,
          },
        })}
      />,
    );

    const live = screen.getByTestId("athena-agent-progress");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Reading sources");
    expect(screen.getByTestId("athena-agent-cancel")).toBeEnabled();
    expect(screen.getByTestId("athena-agent-submit")).toBeDisabled();
    expect(screen.queryByTestId("athena-agent-sources")).not.toBeInTheDocument();
  });

  it("shows a completed answer with its quality before any source drawer", async () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "partial",
          status: {
            headline: "Answered with limited evidence.",
            detail: "Some sources were incomplete.",
            tone: "warning",
          },
          canInspectSources: true,
          answer: {
            outcome: "answer",
            narrative: "Two lanes are open. Visit https://evil.example/x",
            egressClass: "sensitive",
            limitedEvidence: true,
            committedAt: 5,
            citations: [{ citationRef: "citation:1", label: "Close record" }],
          },
        })}
      />,
    );

    const answer = screen.getByTestId("athena-agent-answer");
    expect(
      within(answer).getByRole("heading", { name: /answer/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("athena-agent-quality")).toHaveTextContent(
      "Limited evidence",
    );
    expect(answer.querySelector("a")).toBeNull();
    expect(answer.textContent).toContain("https://evil.example/x");

    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-answer-heading")).toHaveFocus(),
    );
  });

  it("opens a source only through its server-minted destination", async () => {
    const user = userEvent.setup();
    const inspectCitation = vi.fn(async () => {});
    const { rerender } = render(
      <PanelHarness
        run={baseRun({
          hostState: "completed",
          canInspectSources: true,
          inspectCitation,
          answer: {
            outcome: "answer",
            narrative: "Answer.",
            egressClass: "operational",
            committedAt: 5,
            citations: [{ citationRef: "citation:1", label: "Close record" }],
          },
        })}
      />,
    );

    await user.click(screen.getByTestId("athena-agent-citation-citation:1"));
    expect(inspectCitation).toHaveBeenCalledWith("citation:1");

    rerender(
      <PanelHarness
        run={baseRun({
          hostState: "completed",
          canInspectSources: true,
          inspectCitation,
          answer: {
            outcome: "answer",
            narrative: "Answer.",
            egressClass: "operational",
            committedAt: 5,
            citations: [{ citationRef: "citation:1", label: "Close record" }],
          },
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
        })}
      />,
    );

    const drawer = screen.getByTestId("athena-agent-source");
    expect(within(drawer).getByRole("link", { name: /EOD review/ })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close",
    );
    expect(drawer).toHaveTextContent("Accepted");
    expect(drawer).toHaveTextContent("Complete");
  });

  it("says a source is gone without disturbing the answer", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "completed",
          canInspectSources: true,
          answer: {
            outcome: "answer",
            narrative: "Answer stands.",
            egressClass: "operational",
            committedAt: 5,
            citations: [{ citationRef: "citation:1" }],
          },
          sources: {
            "citation:1": {
              citationRef: "citation:1",
              state: "unauthorized",
              headline: "This source is no longer available to you.",
            },
          },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-source")).toHaveTextContent(
      "This source is no longer available to you.",
    );
    expect(screen.getByTestId("athena-agent-answer")).toHaveTextContent(
      "Answer stands.",
    );
  });

  it("keeps a terminal denial closed and offers only a new question", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "terminal_denied",
          status: {
            headline: "This answer is no longer available to you.",
            tone: "warning",
          },
          canCancel: false,
          answer: null,
        })}
      />,
    );

    const status = screen.getByTestId("athena-agent-status");
    expect(status).toHaveTextContent(
      "This answer is no longer available to you.",
    );
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("athena-agent-cancel")).not.toBeInTheDocument();
    expect(screen.getByTestId("athena-agent-new-thread")).toBeEnabled();
  });

  it("blocks a second submission and says so without queueing it", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "running",
          canSubmit: false,
          canCancel: true,
          blockedSubmission: {
            reason: "turn_active",
            headline: "Athena is still working on your last question.",
          },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-submit")).toBeDisabled();
    expect(screen.getByTestId("athena-agent-blocked")).toHaveTextContent(
      "Athena is still working on your last question.",
    );
  });

  it("asks for confirmation after the operating day changes", async () => {
    const user = userEvent.setup();
    const confirmContextChange = vi.fn();
    render(
      <PanelHarness
        run={baseRun({
          canSubmit: false,
          confirmContextChange,
          pendingContextChange: {
            keys: ["operatingDate"],
            label: "Osu · 2026-08-22",
          },
        })}
      />,
    );

    const notice = screen.getByTestId("athena-agent-context-change");
    expect(notice).toHaveTextContent("Osu · 2026-08-22");
    await user.click(within(notice).getByRole("button"));

    expect(confirmContextChange).toHaveBeenCalled();
  });

  it("labels an answer with its own context when the surface has moved on", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "completed",
          contextDrift: true,
          canFollowUp: false,
          turn: {
            turnId: "binding-1" as Id<"agentTurnBinding">,
            phase: "completed",
            question: "What is blocking the close?",
            questionState: "retained",
            contextLabel: "Osu · 2026-08-21",
            createdAt: 1,
            terminal: true,
          },
          answer: {
            outcome: "answer",
            narrative: "Answer.",
            egressClass: "operational",
            committedAt: 5,
            citations: [],
          },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-turn-context")).toHaveTextContent(
      "Osu · 2026-08-21",
    );
    expect(screen.getByTestId("athena-agent-drift")).toBeInTheDocument();
    expect(screen.getByTestId("athena-agent-submit")).toBeDisabled();
  });

  it("explains erased content instead of replaying it", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "expired_content",
          status: {
            headline: "The question is no longer stored.",
            detail: "Ask it again to get a fresh answer.",
            tone: "warning",
          },
          turn: {
            turnId: "binding-1" as Id<"agentTurnBinding">,
            phase: "failed",
            questionState: "expired",
            contextLabel: "Osu · 2026-08-21",
            createdAt: 1,
            terminal: true,
          },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-transcript")).toHaveTextContent(
      "This question is no longer stored.",
    );
    expect(screen.getByTestId("athena-agent-status")).toHaveTextContent(
      "The question is no longer stored.",
    );
  });

  it("renders the reauthorized history projection and names what was withheld", () => {
    render(
      <PanelHarness
        run={baseRun({
          history: [
            {
              turnId: "binding-0",
              createdAt: 1,
              state: "answered",
              question: "Earlier question",
              questionState: "retained",
              answer: {
                outcome: "answer",
                narrative: "Earlier answer",
                egressClass: "operational",
                committedAt: 2,
                citations: [],
              },
            },
            {
              turnId: "binding-x",
              createdAt: 0,
              state: "unauthorized",
              questionState: "deleted",
              omittedHeadline: "This answer is no longer available to you.",
            },
          ],
        })}
      />,
    );

    const history = screen.getByTestId("athena-agent-history");
    expect(history).toHaveTextContent("Earlier question");
    expect(history).toHaveTextContent(
      "This answer is no longer available to you.",
    );
  });
});

describe("accessibility", () => {
  it("drops animation while keeping the state cue under reduced motion", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(
      <PanelHarness
        run={baseRun({
          hostState: "running",
          status: { headline: "Reading sources", tone: "progress" },
          milestones: [
            { milestone: "reading_sources", label: "Reading sources", at: 1 },
          ],
        })}
      />,
    );

    const panel = screen.getByTestId("athena-agent-panel");
    expect(panel).toHaveAttribute("data-motion", "reduced");
    expect(panel.className).not.toMatch(/animate-/);
    expect(screen.getByTestId("athena-agent-progress")).toHaveTextContent(
      "Reading sources",
    );
  });

  it("labels quality and cancellation without relying on colour", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "cancellation_requested",
          status: { headline: "Stopping…", tone: "progress" },
          canCancel: true,
          answer: {
            outcome: "no_usable_sources",
            narrative: "Nothing could be read.",
            egressClass: "operational",
            committedAt: 5,
            citations: [],
          },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-quality")).toHaveTextContent(
      "No usable sources",
    );
    expect(screen.getByTestId("athena-agent-status")).toHaveTextContent(
      "Stopping…",
    );
  });

  it("moves focus to the status when a request starts", async () => {
    const user = userEvent.setup();
    backend.results.startTurn = {
      outcome: "started",
      bindingId: "binding-1",
      runId: "run-1",
      threadKey: "thread",
    };
    renderSurface();
    await user.click(screen.getByTestId("athena-agent-entry"));
    await user.type(screen.getByTestId("athena-agent-prompt"), "A question");
    await act(async () => {
      await user.click(screen.getByTestId("athena-agent-submit"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-status")).toHaveFocus(),
    );
  });
});

describe("reconnecting across navigation", () => {
  it("remembers only the active turn for this thread, never the draft", async () => {
    const user = userEvent.setup();
    backend.results.startTurn = {
      outcome: "started",
      bindingId: "binding-77",
      runId: "run-1",
      threadKey: "thread",
    };
    renderSurface();
    await user.click(screen.getByTestId("athena-agent-entry"));
    await user.type(screen.getByTestId("athena-agent-prompt"), "A private draft");
    await act(async () => {
      await user.click(screen.getByTestId("athena-agent-submit"));
    });

    const writes = vi.mocked(window.sessionStorage.setItem).mock.calls;
    const turnWrite = writes.find(([, value]) => value === "binding-77");
    expect(turnWrite?.[0]).toContain("daily_operations");
    for (const [, value] of writes) {
      expect(value).not.toContain("A private draft");
    }
  });

  it("rejoins the remembered turn on mount instead of starting a new one", async () => {
    const user = userEvent.setup();
    vi.mocked(window.sessionStorage.getItem).mockReturnValue("binding-88");
    backend.view = {
      kind: "view",
      bindingId: "binding-88",
      runId: "run-1",
      profileId: "daily_operations",
      threadKey: "thread",
      createdAt: 1,
      updatedAt: 2,
      phase: "running",
      step: "running",
      milestones: [{ milestone: "reading_sources", at: 3 }],
      question: "Earlier question",
      context: storeContext,
      promptState: "retained",
      answer: { available: false, suppressed: false },
      canCancel: true,
    };
    backend.results.resumeTurn = {
      outcome: "continue",
      step: "running",
      runStatus: "running",
    };
    renderSurface();

    await user.click(screen.getByTestId("athena-agent-entry"));

    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-transcript")).toHaveTextContent(
        "Earlier question",
      ),
    );
    expect(backend.calls.filter((call) => call.name === "startTurn")).toHaveLength(0);
    expect(
      backend.calls.filter((call) => call.name === "resumeTurn"),
    ).toHaveLength(1);
    expect(screen.getByTestId("athena-agent-prompt")).toHaveValue("");
  });
});

describe("profile neutrality", () => {
  it("renders a different profile through the same host with no host changes", () => {
    render(
      <PanelHarness
        presentation={organizationPresentation as unknown as typeof storePresentation}
        run={baseRun({
          context: {
            label: "Wigclub · all stores",
            entries: [
              { key: "organizationRef", label: "Organization", value: "Wigclub" },
            ],
            changedKeys: [],
            changedSnapshotKeys: [],
          },
          starterIntents: organizationPresentation.starterIntents,
          canInspectSources: true,
          answer: {
            outcome: "answer",
            narrative: "Three stores need attention.",
            egressClass: "operational",
            committedAt: 5,
            citations: [{ citationRef: "citation:9", label: "Store health" }],
          },
          sources: {
            "citation:9": {
              citationRef: "citation:9",
              state: "evidence",
              label: "Store health",
              link: {
                label: "Store directory",
                to: "/$orgUrlSlug/stores",
                params: { orgUrlSlug: "wigclub" },
                href: "/wigclub/stores",
              },
            },
          },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-context")).toHaveTextContent(
      "Organization",
    );
    expect(screen.getByTestId("athena-agent-context")).toHaveTextContent(
      "Wigclub · all stores",
    );
    expect(
      screen.getByRole("button", { name: "Which stores need attention?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Who is on shift?" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("athena-agent-source")).getByRole("link"),
    ).toHaveAttribute("href", "/wigclub/stores");
  });
});

// ---------------------------------------------------------------------------
// Provisional narrative
// ---------------------------------------------------------------------------

const RUNNING_TURN = {
  turnId: "binding-1" as Id<"agentTurnBinding">,
  phase: "running" as const,
  question: "What is blocking the close?",
  questionState: "retained" as const,
  contextLabel: "Osu · 2026-08-21",
  createdAt: 1,
  terminal: false,
};

function draftRun(
  provisionalState: AthenaAgentRun["provisionalState"],
  overrides: Partial<AthenaAgentRun> = {},
): AthenaAgentRun {
  const withText = ["streaming", "reset", "paused_at_limit", "committing"].includes(
    provisionalState,
  );
  return baseRun({
    hostState: "running",
    status: { headline: "Reading sources", tone: "progress" },
    canCancel: true,
    canSubmit: false,
    turn: RUNNING_TURN,
    activeTurnId: RUNNING_TURN.turnId,
    provisionalState,
    provisional: withText
      ? {
          text: "Two lanes are still open.",
          truncated: provisionalState === "paused_at_limit",
          draftOrdinal: 1,
        }
      : null,
    provisionalWithdrawal:
      provisionalState === "withdrawn"
        ? describeProvisionalWithdrawal("egress_beyond_authority")
        : null,
    ...overrides,
  });
}

describe("the provisional draft region", () => {
  it("renders a fixture for every provisional state", () => {
    const expectations: {
      state: AthenaAgentRun["provisionalState"];
      container: boolean;
      text: boolean;
      notice: boolean;
      live: string | null;
    }[] = [
      { state: "disabled", container: false, text: false, notice: false, live: null },
      { state: "withdrawn", container: false, text: false, notice: true, live: null },
      { state: "superseded", container: false, text: false, notice: false, live: null },
      { state: "committing", container: true, text: true, notice: false, live: null },
      {
        state: "reset",
        container: true,
        text: true,
        notice: false,
        live: "Moved on to the next step. The earlier draft stays in the timeline.",
      },
      {
        state: "paused_at_limit",
        container: true,
        text: true,
        notice: false,
        live: "Draft display limit reached. The rest of the draft isn't shown here.",
      },
      { state: "streaming", container: true, text: true, notice: false, live: null },
      {
        state: "awaiting_first_text",
        container: false,
        text: false,
        notice: false,
        live: null,
      },
      {
        state: "stalled",
        container: true,
        text: false,
        notice: false,
        live: "Draft paused. You can stop this request or start a new thread.",
      },
      { state: "none", container: false, text: false, notice: false, live: null },
    ];

    for (const expectation of expectations) {
      const view = render(<PanelHarness run={draftRun(expectation.state)} />);
      const label = `provisionalState ${expectation.state}`;

      expect(
        screen.queryByTestId("athena-agent-provisional") !== null,
        `${label}: container`,
      ).toBe(expectation.container);
      expect(
        screen.queryByTestId("athena-agent-provisional-text") !== null,
        `${label}: text`,
      ).toBe(expectation.text);
      expect(
        screen.queryByTestId("athena-agent-provisional-withdrawn") !== null,
        `${label}: notice`,
      ).toBe(expectation.notice);
      const live = screen.queryByTestId("athena-agent-provisional-live");
      expect(live?.textContent ?? "", `${label}: live line`).toBe(
        expectation.live ?? "",
      );
      // The only defined effect of aria-busy is to defer updates in a busy
      // subtree, which would swallow exactly these announcements.
      expect(
        view.baseElement.querySelector("[aria-busy]"),
        `${label}: aria-busy`,
      ).toBeNull();

      view.unmount();
    }
  });

  it("labels the draft as unverified and renders the model text inertly", async () => {
    render(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "## Approved\n\nWire the payout: https://evil.example/x",
            truncated: false,
            draftOrdinal: 1,
          },
        })}
      />,
    );

    const region = screen.getByTestId("athena-agent-provisional");
    expect(region).toHaveTextContent("Draft in progress. Not verified.");
    expect(region).toHaveTextContent("Don't act on this text.");
    expect(region).toHaveTextContent("The checked answer replaces it and may differ.");
    // The draft is revealed over a few frames; every prefix is inert.
    await waitFor(() => expect(region).toHaveTextContent("https://evil.example/x"));
    expect(region.querySelector("a")).toBeNull();
    expect(region.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
  });

  it("mounts after the denial and drift blocks, before the answer slot", () => {
    render(
      <PanelHarness
        run={draftRun("streaming", {
          denial: { code: "spend_ceiling", headline: "Athena reached today's limit." },
          contextDrift: true,
        })}
      />,
    );

    const order = [
      "athena-agent-status",
      "athena-agent-progress",
      "athena-agent-denial",
      "athena-agent-drift",
      "athena-agent-provisional",
    ].map((id) => screen.getByTestId(id));

    for (let index = 1; index < order.length; index += 1) {
      const relation = (order[index - 1] as HTMLElement).compareDocumentPosition(
        order[index] as HTMLElement,
      );
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("keeps its live region separate from the milestone region and free of model text", () => {
    render(
      <PanelHarness
        run={draftRun("paused_at_limit", {
          milestones: [
            { milestone: "reading_sources", label: "Reading sources", at: 1 },
          ],
        })}
      />,
    );

    const milestones = screen.getByTestId("athena-agent-progress");
    const draftLive = screen.getByTestId("athena-agent-provisional-live");

    expect(draftLive).toHaveAttribute("aria-live", "polite");
    expect(milestones).toHaveAttribute("aria-live", "polite");
    expect(milestones.contains(draftLive)).toBe(false);
    expect(draftLive.textContent).not.toContain("Two lanes");
    expect(milestones.textContent).not.toContain("Two lanes");
  });

  it("announces at most once per draft across five rapid resets and never moves focus", () => {
    const announced: string[] = [];
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    screen.getByTestId("athena-agent-new-thread").focus();
    const anchor = document.activeElement;

    for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
      const draft = { text: `Draft ${ordinal}`, truncated: false, draftOrdinal: ordinal };
      rerender(<PanelHarness run={draftRun("reset", { provisional: draft })} />);
      announced.push(
        screen.getByTestId("athena-agent-provisional-live").textContent ?? "",
      );
      rerender(<PanelHarness run={draftRun("streaming", { provisional: draft })} />);
      announced.push(
        screen.getByTestId("athena-agent-provisional-live").textContent ?? "",
      );
    }

    // One live node per draft: the cue survives the draft it belongs to and is
    // never repeated by the deltas that follow it.
    expect(announced.every((line) => line === "Moved on to the next step. The earlier draft stays in the timeline.")).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });

  it("distinguishes a paused draft from a stalled one", () => {
    const { rerender } = render(<PanelHarness run={draftRun("paused_at_limit")} />);

    expect(screen.getByTestId("athena-agent-provisional-text")).toHaveTextContent(
      "Two lanes are still open.",
    );
    expect(screen.getByTestId("athena-agent-provisional-live")).toHaveTextContent(
      "Draft display limit reached.",
    );

    rerender(<PanelHarness run={draftRun("stalled")} />);

    expect(screen.queryByTestId("athena-agent-provisional-text")).toBeNull();
    expect(screen.getByTestId("athena-agent-provisional-live")).toHaveTextContent(
      "Draft paused. You can stop this request or start a new thread.",
    );
    expect(screen.getByTestId("athena-agent-cancel")).toBeEnabled();
    expect(screen.getByTestId("athena-agent-new-thread")).toBeEnabled();
  });

  it("swaps the draft for the committed answer, even when they disagree", async () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);

    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-provisional-text")).toHaveTextContent(
        "Two lanes are still open.",
      ),
    );

    rerender(
      <PanelHarness
        run={draftRun("superseded", {
          hostState: "completed",
          canCancel: false,
          provisional: null,
          answer: {
            outcome: "answer",
            narrative: "Only one lane is open.",
            egressClass: "operational",
            committedAt: 5,
            citations: [],
          },
        })}
      />,
    );

    expect(screen.queryByTestId("athena-agent-provisional")).toBeNull();
    // The answer lands over a few frames; what is on screen is always a prefix.
    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-answer")).toHaveTextContent("Only one lane is open."),
    );
  });

  it("says only what happened to the draft when it is withdrawn", () => {
    render(<PanelHarness run={draftRun("withdrawn")} />);

    const notice = screen.getByTestId("athena-agent-provisional-withdrawn");
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent("Draft withdrawn.");
    expect(notice).toHaveTextContent("This draft went beyond what you can read here.");
    expect(notice.textContent).not.toMatch(/answer/i);
    expect(screen.queryByTestId("athena-agent-provisional-text")).toBeNull();
  });

  it("renders exactly today's host for a buffered profile", () => {
    const buffered = render(<PanelHarness run={draftRun("disabled")} />);
    const bufferedMarkup = screen.getByTestId("athena-agent-transcript").innerHTML;
    buffered.unmount();

    render(<PanelHarness run={draftRun("none")} />);

    expect(screen.getByTestId("athena-agent-transcript").innerHTML).toBe(
      bufferedMarkup,
    );
  });

  it("follows the growing draft only while the operator is at the bottom", async () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    const scroll = screen.getByTestId("athena-agent-scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 400 });

    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: { text: "More and more text", truncated: false, draftOrdinal: 1 },
        })}
      />,
    );
    await waitFor(() => expect(scroll.scrollTop).toBe(300));

    // The operator scrolls up: following stops.
    scroll.scrollTop = 40;
    fireEvent.scroll(scroll);
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: { text: "Even more text", truncated: false, draftOrdinal: 1 },
        })}
      />,
    );
    // A replaced draft paints at once; the follow stays off while scrolled up.
    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-provisional-text")).toHaveTextContent("Even more text"),
    );
    expect(scroll.scrollTop).toBe(40);

    // A terminal draft state re-anchors.
    rerender(<PanelHarness run={draftRun("stalled")} />);
    expect(scroll.scrollTop).toBe(300);
  });

  it("keeps a reading position restored on remount while the draft keeps growing", () => {
    // The restored position is read back before the first delta lands, so the
    // metrics have to be in place for the mount itself.
    const heights = ["scrollHeight", "clientHeight"].map((name) => ({
      name,
      original: Object.getOwnPropertyDescriptor(Element.prototype, name),
    }));
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(Element.prototype, "clientHeight", {
      configurable: true,
      get: () => 100,
    });
    try {
      const { rerender } = render(
        <PanelHarness run={draftRun("streaming")} scrollTop={40} />,
      );
      const scroll = screen.getByTestId("athena-agent-scroll");
      expect(scroll.scrollTop).toBe(40);

      rerender(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: {
              text: "Two lanes are still open, and more text arrives.",
              truncated: false,
              draftOrdinal: 1,
            },
          })}
          scrollTop={40}
        />,
      );

      expect(scroll.scrollTop).toBe(40);
    } finally {
      for (const { name, original } of heights) {
        if (original) Object.defineProperty(Element.prototype, name, original);
        else Reflect.deleteProperty(Element.prototype, name);
      }
    }
  });

  it("keeps the draft out of storage and the URL", () => {
    const before = window.location.href;
    render(<PanelHarness run={draftRun("streaming")} />);

    const writes = vi.mocked(window.sessionStorage.setItem).mock.calls;
    for (const [, value] of writes) {
      expect(value).not.toContain("Two lanes");
    }
    expect(window.location.href).toBe(before);
  });

  it("drops draft animation under reduced motion while keeping the cue", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<PanelHarness run={draftRun("reset")} />);

    const panel = screen.getByTestId("athena-agent-panel");
    expect(panel).toHaveAttribute("data-motion", "reduced");
    expect(
      screen.getByTestId("athena-agent-provisional").className,
    ).not.toMatch(/animate-/);
    expect(screen.getByTestId("athena-agent-provisional-live")).toHaveTextContent(
      "Moved on to the next step.",
    );
  });
});

describe("focus while a draft is withdrawn", () => {
  /** Focus lands somewhere neutral, as it does after a submission. */
  function anchorFocusOutsideComposer() {
    const status = screen.getByTestId("athena-agent-status");
    status.focus();
    return status;
  }

  it("moves focus to the notice once for a mid-run withdrawal", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    expect(screen.getByTestId("athena-agent-provisional-withdrawn")).toHaveFocus();

    // A later render of the same level-based state does not steal focus again.
    screen.getByTestId("athena-agent-new-thread").focus();
    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    expect(screen.getByTestId("athena-agent-new-thread")).toHaveFocus();
  });

  it("leaves the composer alone when the operator is typing a follow-up", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    const prompt = screen.getByTestId("athena-agent-prompt");
    prompt.focus();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);

    expect(prompt).toHaveFocus();
    // The notice still announces without holding focus.
    expect(screen.getByTestId("athena-agent-provisional-withdrawn")).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("lets the existing terminal move win when both land together", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();
    screen.getByTestId("athena-agent-new-thread").focus();

    rerender(
      <PanelHarness
        run={draftRun("withdrawn", {
          hostState: "terminal_denied",
          status: { headline: "This answer is no longer available to you.", tone: "warning" },
          canCancel: false,
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();
  });

  it("keeps the operator's Stop focus when the withdrawal lands a render later", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    screen.getByTestId("athena-agent-new-thread").focus();

    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          hostState: "cancellation_requested",
          status: { headline: "Stopping…", tone: "progress" },
        })}
      />,
    );
    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();

    screen.getByTestId("athena-agent-new-thread").focus();
    rerender(
      <PanelHarness
        run={draftRun("withdrawn", {
          hostState: "cancellation_requested",
          status: { headline: "Stopping…", tone: "progress" },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-new-thread")).toHaveFocus();
  });

  it("moves focus once when the run terminates moments after the withdrawal", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    expect(screen.getByTestId("athena-agent-provisional-withdrawn")).toHaveFocus();

    rerender(
      <PanelHarness
        run={draftRun("withdrawn", {
          hostState: "terminal_denied",
          status: { headline: "Stopped.", tone: "neutral" },
          canCancel: false,
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-provisional-withdrawn")).toHaveFocus();
  });

  it("still moves to the answer heading, and then to a later denial, after a withdrawal", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    expect(screen.getByTestId("athena-agent-provisional-withdrawn")).toHaveFocus();

    rerender(
      <PanelHarness
        run={draftRun("superseded", {
          hostState: "completed",
          canCancel: false,
          provisionalWithdrawal: null,
          answer: {
            outcome: "answer",
            narrative: "The checked answer.",
            egressClass: "operational",
            committedAt: 5,
            citations: [],
          },
        })}
      />,
    );
    expect(screen.getByTestId("athena-agent-answer-heading")).toHaveFocus();

    rerender(
      <PanelHarness
        run={draftRun("none", {
          hostState: "terminal_denied",
          status: { headline: "This answer is no longer available to you.", tone: "warning" },
          canCancel: false,
          provisionalWithdrawal: null,
        })}
      />,
    );
    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();
  });

  it("still moves focus when the operator stops a withdrawn turn", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    screen.getByTestId("athena-agent-new-thread").focus();

    rerender(
      <PanelHarness
        run={draftRun("withdrawn", {
          hostState: "cancellation_requested",
          status: { headline: "Stopping…", tone: "progress" },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();
  });

  it("moves no focus when a panel mounts into an already-withdrawn running turn", () => {
    render(<PanelHarness run={draftRun("withdrawn")} />);

    // The mount focuses the composer, as it always has; the notice does not
    // take a focus move it never observed happening.
    expect(screen.getByTestId("athena-agent-prompt")).toHaveFocus();
    expect(screen.getByTestId("athena-agent-provisional-withdrawn")).toBeInTheDocument();
  });

  it("still moves focus for the next turn after a withdrawn one", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    expect(screen.getByTestId("athena-agent-provisional-withdrawn")).toHaveFocus();

    screen.getByTestId("athena-agent-new-thread").focus();
    rerender(
      <PanelHarness
        run={draftRun("none", {
          hostState: "submitting",
          status: { headline: "Starting your request…", tone: "progress" },
          provisionalWithdrawal: null,
          activeTurnId: "binding-2" as Id<"agentTurnBinding">,
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();
  });

  it("shares one focus move with the terminal denial when the view drops after a release", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    screen.getByTestId("athena-agent-new-thread").focus();

    rerender(
      <PanelHarness
        run={draftRun("withdrawn", {
          hostState: "terminal_denied",
          status: {
            headline: "This conversation is no longer available to you.",
            tone: "warning",
          },
          canCancel: false,
          provisionalWithdrawal: describeProvisionalWithdrawal("membership_revoked"),
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();
    expect(screen.getByTestId("athena-agent-provisional-withdrawn")).toHaveTextContent(
      "This draft is no longer available to you.",
    );
  });

  it("never moves focus for streaming, reset, pause, or stall", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    const anchor = screen.getByTestId("athena-agent-new-thread");
    anchor.focus();

    for (const state of ["reset", "paused_at_limit", "streaming", "stalled"] as const) {
      rerender(<PanelHarness run={draftRun(state)} />);
      expect(document.activeElement, `provisionalState ${state}`).toBe(anchor);
    }
  });
});

describe("the draft is profile-neutral", () => {
  it("streams a second profile through the same components", async () => {
    render(
      <PanelHarness
        presentation={organizationPresentation as unknown as typeof storePresentation}
        run={draftRun("streaming", {
          context: {
            label: "Wigclub · all stores",
            entries: [
              { key: "organizationRef", label: "Organization", value: "Wigclub" },
            ],
            changedKeys: [],
            changedSnapshotKeys: [],
          },
          starterIntents: organizationPresentation.starterIntents,
          provisional: {
            text: "Three stores need attention",
            truncated: false,
            draftOrdinal: 1,
          },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-provisional")).toHaveTextContent(
      "Draft in progress. Not verified.",
    );
    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-provisional-text")).toHaveTextContent(
        "Three stores need attention",
      ),
    );
  });

  it("shows milestones only, and moves no focus, for a buffered profile", () => {
    const { rerender } = render(
      <PanelHarness
        run={draftRun("disabled", {
          milestones: [
            { milestone: "reading_sources", label: "Reading sources", at: 1 },
          ],
        })}
      />,
    );
    const anchor = screen.getByTestId("athena-agent-new-thread");
    anchor.focus();

    rerender(
      <PanelHarness
        run={draftRun("disabled", {
          milestones: [
            { milestone: "reading_sources", label: "Reading sources", at: 1 },
            { milestone: "composing_answer", label: "Composing the answer", at: 2 },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-progress")).toHaveTextContent(
      "Composing the answer",
    );
    expect(screen.queryByTestId("athena-agent-provisional")).toBeNull();
    expect(screen.queryByTestId("athena-agent-provisional-withdrawn")).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("shows no notice when a turn ends before any draft was released", () => {
    const { rerender } = render(<PanelHarness run={draftRun("awaiting_first_text")} />);
    screen.getByTestId("athena-agent-new-thread").focus();

    rerender(
      <PanelHarness
        run={draftRun("none", {
          hostState: "terminal_denied",
          status: { headline: "Stopped.", tone: "neutral" },
          canCancel: false,
        })}
      />,
    );

    expect(screen.queryByTestId("athena-agent-provisional-withdrawn")).toBeNull();
    expect(screen.queryByTestId("athena-agent-provisional")).toBeNull();
    // The turn's own terminal move still happens; the draft adds nothing.
    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();
  });
});

describe("the provisional timeline", () => {
  const earlier = [
    { text: "First I'll read the registers.", truncated: false, draftOrdinal: 0 },
    { text: "## Approved\n\nNow the log: https://evil.example/x", truncated: false, draftOrdinal: 1 },
  ];

  it("renders finished drafts above the live one, oldest first, labelled and inert", async () => {
    render(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: { text: "Summing up.", truncated: false, draftOrdinal: 2 },
          provisionalTimeline: earlier,
        })}
      />,
    );

    const region = screen.getByTestId("athena-agent-provisional");
    const entries = within(region).getAllByTestId("athena-agent-provisional-entry");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Earlier draft 1");
    expect(entries[0]).toHaveTextContent("First I'll read the registers.");
    expect(entries[1]).toHaveTextContent("Earlier draft 2");
    expect(entries[1]).toHaveTextContent("Now the log: https://evil.example/x");
    expect(entries[1]?.querySelector("a")).toBeNull();
    expect(entries[1]?.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    // The live draft follows the entries inside the same labelled container.
    const order = Array.from(region.querySelectorAll("[data-testid]")).map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(order.indexOf("athena-agent-provisional-entry")).toBeLessThan(
      order.indexOf("athena-agent-provisional-text"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-provisional-text")).toHaveTextContent("Summing up."),
    );
    // The entries never enter the live region.
    expect(screen.getByTestId("athena-agent-provisional-live")).not.toHaveTextContent("registers");
  });

  it("keeps the timeline behind the committed answer as a collapsed, unverified block", () => {
    render(
      <PanelHarness
        run={draftRun("superseded", {
          hostState: "completed",
          status: { headline: "Answer ready", tone: "neutral" },
          canCancel: false,
          canSubmit: true,
          provisionalTimeline: earlier,
          answer: {
            outcome: "answer",
            narrative: "Only one lane is open.",
            egressClass: "operational",
            limitedEvidence: false,
            committedAt: 5,
            citations: [],
          },
        })}
      />,
    );

    expect(screen.queryByTestId("athena-agent-provisional")).toBeNull();
    const timeline = screen.getByTestId("athena-agent-provisional-timeline");
    expect(timeline.tagName).toBe("DETAILS");
    expect(timeline).not.toHaveAttribute("open");
    expect(timeline).toHaveTextContent("How Athena got here");
    expect(timeline).toHaveTextContent("Not verified");
    expect(within(timeline).getAllByTestId("athena-agent-provisional-entry")).toHaveLength(2);
    expect(timeline.querySelector("a")).toBeNull();
    // The answer stays first; the timeline sits after it.
    const transcript = screen.getByTestId("athena-agent-transcript");
    const order = Array.from(transcript.querySelectorAll("[data-testid]")).map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(order.indexOf("athena-agent-answer")).toBeLessThan(
      order.indexOf("athena-agent-provisional-timeline"),
    );
  });

  it("shows no timeline for a withdrawn, stalled, or disabled draft", () => {
    for (const state of ["withdrawn", "stalled", "disabled"] as const) {
      const view = render(
        <PanelHarness run={draftRun(state, { provisionalTimeline: earlier })} />,
      );
      expect(screen.queryByTestId("athena-agent-provisional-entry")).toBeNull();
      expect(screen.queryByTestId("athena-agent-provisional-timeline")).toBeNull();
      view.unmount();
    }
  });
});

describe("an earlier turn's draft trail", () => {
  const answered = {
    turnId: "binding-earlier" as AthenaAgentRun["history"][number]["turnId"],
    createdAt: 10,
    state: "answered",
    question: "What is blocking the close?",
    questionState: "retained" as const,
    answer: {
      outcome: "answer" as const,
      narrative: "The automation log is behind.",
      egressClass: "operational",
      committedAt: 200,
      citations: [],
    },
  };

  it("offers the collapsed block only for a history entry whose answer is committed", () => {
    const withoutAnswer = { ...answered, turnId: "binding-failed" as typeof answered.turnId, answer: undefined, failureHeadline: "Stopped." };
    render(<PanelHarness run={baseRun({ history: [answered, withoutAnswer] })} />);

    const entries = screen.getAllByTestId("athena-agent-history-entry");
    expect(entries).toHaveLength(2);
    expect(within(entries[0]).getByTestId("athena-agent-history-trail")).toBeTruthy();
    expect(within(entries[1]).queryByTestId("athena-agent-history-trail")).toBeNull();
  });

  it("reads the trail only once opened, and renders the fetched drafts inertly", async () => {
    const user = userEvent.setup();
    backend.trail = {
      kind: "trail",
      committedAt: 200,
      entries: [
        { draftOrdinal: 0, text: "Checking the registers.", truncated: false },
        { draftOrdinal: 1, text: "<script>window.__athenaExecuted = true;</script> Now the log.", truncated: false },
      ],
    };
    render(<PanelHarness run={baseRun({ history: [answered] })} />);

    const block = screen.getByTestId("athena-agent-history-trail");
    // Closed: nothing is fetched and nothing is rendered.
    expect(within(block).queryAllByTestId("athena-agent-provisional-entry")).toHaveLength(0);
    expect(screen.queryByText("Checking the registers.")).toBeNull();

    await user.click(within(block).getByText("How Athena got here"));

    await waitFor(() => expect(within(block).queryAllByTestId("athena-agent-provisional-entry")).toHaveLength(2));
    const drafts = within(block).getAllByTestId("athena-agent-provisional-entry");
    expect(within(drafts[0]).getByText("Earlier draft 1")).toBeTruthy();
    expect(within(drafts[1]).getByText("Earlier draft 2")).toBeTruthy();
    expect(drafts[0].textContent).toContain("Checking the registers.");
    // The model's text is rendered inertly: no script, no link, no control.
    expect(block.querySelector("script")).toBeNull();
    expect(block.querySelector("a")).toBeNull();
    expect(block.querySelector("button")).toBeNull();
    expect((window as unknown as { __athenaExecuted?: boolean }).__athenaExecuted).toBeUndefined();
  });

  it("says so when a committed turn kept no drafts", async () => {
    const user = userEvent.setup();
    backend.trail = { kind: "trail", committedAt: 200, entries: [] };
    render(<PanelHarness run={baseRun({ history: [answered] })} />);

    const block = screen.getByTestId("athena-agent-history-trail");
    await user.click(within(block).getByText("How Athena got here"));

    await waitFor(() => expect(within(block).getByText("No drafts were kept for this turn.")).toBeTruthy());
    expect(within(block).queryAllByTestId("athena-agent-provisional-entry")).toHaveLength(0);
  });

  it("shows the closed-vocabulary line when the server refuses an earlier turn's trail", async () => {
    const user = userEvent.setup();
    backend.trail = { kind: "unavailable", reason: "membership_revoked" };
    render(<PanelHarness run={baseRun({ history: [answered] })} />);

    const block = screen.getByTestId("athena-agent-history-trail");
    await user.click(within(block).getByText("How Athena got here"));

    await waitFor(() => expect(within(block).getByText("This answer is no longer available to you.")).toBeTruthy());
    expect(within(block).queryAllByTestId("athena-agent-provisional-entry")).toHaveLength(0);
  });
});

describe("stream reveal of the live draft", () => {
  const long = (chars: number) => "Checking the registers one by one, lane by lane. ".repeat(Math.ceil(chars / 50)).slice(0, chars);
  const fakeFrames = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
  const paintedText = () => screen.getByTestId("athena-agent-provisional-text").textContent ?? "";
  const frames = (count: number) => {
    for (let frame = 0; frame < count; frame += 1) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
  };

  it("reveals a streaming draft from nothing, then each flush's tail over a brief linear catch-up", () => {
    fakeFrames();
    try {
      const first = long(40);
      const { rerender } = render(
        <PanelHarness run={draftRun("streaming", { provisional: { text: first, truncated: false, draftOrdinal: 1 } })} />,
      );
      // A draft that is streaming is seen to start.
      expect(paintedText().length).toBeLessThan(first.length);
      frames(15);
      expect(paintedText()).toBe(first);

      const grown = long(400);
      rerender(<PanelHarness run={draftRun("streaming", { provisional: { text: grown, truncated: false, draftOrdinal: 1 } })} />);
      const lengths: number[] = [paintedText().length];
      expect(lengths[0]).toBeGreaterThanOrEqual(first.length);
      expect(lengths[0]).toBeLessThan(grown.length);
      for (let frame = 0; frame < 14; frame += 1) {
        frames(1);
        lengths.push(paintedText().length);
      }
      for (let index = 1; index < lengths.length; index += 1) {
        expect(lengths[index]).toBeGreaterThanOrEqual(lengths[index - 1]!);
      }
      expect(new Set(lengths).size).toBeGreaterThan(3);
      // 360 pending characters cap at the 180 ms streaming catch-up.
      expect(paintedText()).toBe(grown);
      expect(screen.getByTestId("athena-agent-provisional-text")).toHaveAttribute("data-reveal", "settled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts from the visible prefix, never from the start, when the next flush lands mid-reveal", () => {
    fakeFrames();
    try {
      const { rerender } = render(
        <PanelHarness run={draftRun("streaming", { provisional: { text: long(40), truncated: false, draftOrdinal: 1 } })} />,
      );
      frames(15);
      rerender(<PanelHarness run={draftRun("streaming", { provisional: { text: long(300), truncated: false, draftOrdinal: 1 } })} />);
      frames(4);
      const midway = paintedText().length;
      expect(midway).toBeGreaterThan(40);
      expect(midway).toBeLessThan(300);
      rerender(<PanelHarness run={draftRun("streaming", { provisional: { text: long(600), truncated: false, draftOrdinal: 1 } })} />);
      expect(paintedText().length).toBeGreaterThanOrEqual(midway);
      expect(screen.getByTestId("athena-agent-provisional-text")).toHaveAttribute("data-reveal", "revealing");
      frames(15);
      expect(paintedText()).toBe(long(600));
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a new draft from nothing and settles a committing draft briskly", () => {
    fakeFrames();
    try {
      const { rerender } = render(
        <PanelHarness run={draftRun("streaming", { provisional: { text: long(40), truncated: false, draftOrdinal: 1 } })} />,
      );
      frames(15);
      rerender(<PanelHarness run={draftRun("reset", { provisional: { text: long(90), truncated: false, draftOrdinal: 2 } })} />);
      expect(paintedText().length).toBeLessThan(90);
      frames(15);
      expect(paintedText()).toBe(long(90));
      // The model stopped narrating: the tail settles at the faster pace (≤ 120 ms).
      rerender(<PanelHarness run={draftRun("committing", { provisional: { text: long(500), truncated: false, draftOrdinal: 2 } })} />);
      frames(9);
      expect(paintedText()).toBe(long(500));
      expect(screen.getByTestId("athena-agent-provisional-text")).toHaveAttribute("data-reveal", "settled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows everything at once under reduced motion", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    fakeFrames();
    try {
      const { rerender } = render(
        <PanelHarness run={draftRun("streaming", { provisional: { text: long(40), truncated: false, draftOrdinal: 1 } })} />,
      );
      expect(paintedText()).toBe(long(40));
      rerender(<PanelHarness run={draftRun("streaming", { provisional: { text: long(400), truncated: false, draftOrdinal: 1 } })} />);
      expect(paintedText()).toBe(long(400));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stream reveal of the committed answer", () => {
  const fakeFrames = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
  const answerText = "Open lanes: two [citation:v1.1.1.abc] and the automation log is behind. ".repeat(8);
  const answered = (overrides: Partial<AthenaAgentRun> = {}) =>
    draftRun("superseded", {
      hostState: "completed",
      status: { headline: "Answer ready", tone: "neutral" },
      canCancel: false,
      canSubmit: true,
      answer: {
        outcome: "answer",
        narrative: answerText,
        egressClass: "operational",
        limitedEvidence: false,
        committedAt: 5,
        citations: [],
      },
      ...overrides,
    });
  const paintedAnswer = () => screen.getByTestId("athena-agent-answer-text").textContent ?? "";
  const frames = (count: number) => {
    for (let frame = 0; frame < count; frame += 1) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
  };

  it("reveals an answer that lands while the turn is on screen, never splitting a citation key", () => {
    fakeFrames();
    try {
      const { rerender } = render(
        <PanelHarness run={draftRun("streaming", { provisional: { text: "Checking the lanes.", truncated: false, draftOrdinal: 1 } })} />,
      );
      frames(15);
      rerender(<PanelHarness run={answered()} />);
      const lengths: number[] = [paintedAnswer().length];
      expect(lengths[0]).toBeLessThan(answerText.length);
      for (let frame = 0; frame < 10; frame += 1) {
        frames(1);
        const painted = paintedAnswer();
        lengths.push(painted.length);
        expect((painted.match(/\[/g) ?? []).length).toBe((painted.match(/\]/g) ?? []).length);
      }
      for (let index = 1; index < lengths.length; index += 1) {
        expect(lengths[index]).toBeGreaterThanOrEqual(lengths[index - 1]!);
      }
      expect(new Set(lengths).size).toBeGreaterThan(3);
      // A settled answer lands within 120 ms, rendered exactly as a mount would render it.
      expect(screen.getByTestId("athena-agent-answer-text")).toHaveAttribute("data-reveal", "settled");
      const settled = paintedAnswer();
      cleanup();
      render(<PanelHarness run={answered()} />);
      expect(paintedAnswer()).toBe(settled);
      expect(lengths[0]).toBeLessThan(settled.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("paints an answer it mounts onto in full — a reload never replays it", () => {
    fakeFrames();
    try {
      render(<PanelHarness run={answered()} />);
      expect(paintedAnswer()).toBe(answerText);
      expect(screen.getByTestId("athena-agent-answer-text")).toHaveAttribute("data-reveal", "settled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("paints a live answer in full under reduced motion", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    fakeFrames();
    try {
      const { rerender } = render(
        <PanelHarness run={draftRun("streaming", { provisional: { text: "Checking the lanes.", truncated: false, draftOrdinal: 1 } })} />,
      );
      rerender(<PanelHarness run={answered()} />);
      expect(paintedAnswer()).toBe(answerText);
    } finally {
      vi.useRealTimers();
    }
  });
});
