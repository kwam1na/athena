import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

import {
  AthenaAgentPanel,
  AthenaAgentSurface,
} from "./AthenaAgentPanel";
import { defineAthenaAgentPresentation } from "./AthenaAgentPresentationAdapter";
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
        getTurnView: "getTurnView",
        getTurnAnswer: "getTurnAnswer",
        getThreadHistory: "getThreadHistory",
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
  calls: { name: string; args: unknown }[];
  results: Record<string, unknown>;
};

let backend: Backend;

beforeEach(() => {
  backend = {
    history: { kind: "history", threadKey: "t", reauthorizedAt: 1, entries: [] },
    view: undefined,
    answer: undefined,
    calls: [],
    results: {},
  };
  vi.mocked(useQuery).mockImplementation(((name: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (name === "getThreadHistory") return backend.history;
    if (name === "getTurnView") return backend.view;
    if (name === "getTurnAnswer") return backend.answer;
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
}: {
  run: AthenaAgentRun;
  presentation?: typeof storePresentation;
  layout?: "docked" | "fullscreen";
  onClose?: () => void;
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
