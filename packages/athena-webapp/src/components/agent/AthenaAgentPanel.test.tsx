import {
  act,
  cleanup,
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
import { formatAbsoluteTimestamp } from "@/lib/utils";

import {
  AthenaAgentPanel,
  AthenaAgentShellControl,
  AthenaAgentShellProvider,
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
    history: {
      kind: "history",
      threadKey: "t",
      reauthorizedAt: 1,
      entries: [],
    },
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
      return (
        backend.results[name] ?? { outcome: "unavailable", reason: "not_found" }
      );
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
    <AthenaAgentShellProvider
      presentations={[storePresentation, organizationPresentation]}
      sessionScope="user-1"
    >
      <AthenaAgentSurface
        context={storeContext}
        presentation={storePresentation}
        returnLabel="Back to Daily Operations"
        routeParams={{ orgUrlSlug: "wigclub", storeUrlSlug: "osu" }}
        storeId={STORE_ID}
        {...props}
      />
      <AthenaAgentShellControl />
    </AthenaAgentShellProvider>,
  );
}

function latestPersistedShellTarget() {
  return [...vi.mocked(window.sessionStorage.setItem).mock.calls]
    .reverse()
    .find(([key]) => key.startsWith("athena.agent.shell.active."))?.[1];
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
    const host = screen.getByTestId("athena-agent-launcher-host");
    expect(screen.getByTestId("athena-agent-border-beam")).toHaveClass(
      "athena-agent-themed-beam",
    );
    expect(entry).toHaveAccessibleName("Ask Athena");
    expect(host).toHaveClass(
      "fixed",
      "bottom-layout-md",
      "right-layout-md",
      "rounded-full",
    );
    expect(entry).toHaveClass(
      "bg-surface-raised",
      "text-primary",
      "shadow-surface",
    );
    expect(entry).not.toHaveClass("bg-primary");
    expect(entry).toHaveAttribute("data-expanded", "false");
    expect(screen.queryByTestId("athena-agent-panel")).not.toBeInTheDocument();

    await user.click(entry);

    const panel = screen.getByTestId("athena-agent-panel");
    const header = within(panel).getByTestId("athena-agent-header");
    expect(
      within(header).getByTestId("athena-agent-new-thread"),
    ).toHaveTextContent("New thread");
    expect(
      within(header).getByTestId("athena-agent-close"),
    ).toBeInTheDocument();
    expect(header).not.toHaveTextContent(
      "Read-only answers about what you can already see.",
    );
    expect(
      within(panel).queryByLabelText("Authorized context"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-prompt")).toHaveFocus(),
    );
  });

  it("keeps every control at an operable size", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByTestId("athena-agent-entry"));

    for (const control of screen.getAllByTestId(
      /athena-agent-(entry|submit|cancel|new-thread|close)/,
    )) {
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

  it("keeps the launcher available and collapses the expanded panel", async () => {
    const user = userEvent.setup();
    renderSurface();
    const entry = screen.getByTestId("athena-agent-entry");

    await user.click(entry);

    expect(entry).toBeEnabled();
    expect(entry).toHaveAccessibleName("Close Ask Athena");
    expect(entry).toHaveAttribute("data-expanded", "true");
    expect(screen.getByTestId("athena-agent-border-beam")).not.toHaveAttribute(
      "data-active",
    );
    await user.click(entry);

    expect(screen.queryByTestId("athena-agent-panel")).not.toBeInTheDocument();
    expect(entry).toHaveAccessibleName("Ask Athena");
    expect(entry).toHaveAttribute("data-expanded", "false");
  });

});

describe("the authenticated-shell host", () => {
  function RouteHarness() {
    const [route, setRoute] = useState<"operations" | "reports">("operations");
    return (
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-1"
      >
        <button onClick={() => setRoute("reports")} type="button">
          Reports
        </button>
        <button onClick={() => setRoute("operations")} type="button">
          Operations
        </button>
        <AthenaAgentShellControl />
        {route === "operations" ? (
          <AthenaAgentSurface
            context={storeContext}
            presentation={storePresentation}
            routeParams={{ orgUrlSlug: "wigclub", storeUrlSlug: "osu" }}
            storeId={STORE_ID}
          />
        ) : (
          <div data-testid="reports-route">Reports route</div>
        )}
      </AthenaAgentShellProvider>
    );
  }

  it("keeps the active conversation and local panel state across route content changes", async () => {
    const user = userEvent.setup();
    render(<RouteHarness />);

    await user.click(screen.getByTestId("athena-agent-entry"));
    await user.type(
      screen.getByTestId("athena-agent-prompt"),
      "Keep this draft",
    );
    const handle = screen.getByTestId("athena-agent-resize");
    handle.focus();
    await user.keyboard("{ArrowLeft}");
    const resizedWidth = screen.getByTestId("athena-agent-panel").style.width;

    await user.click(screen.getByRole("button", { name: "Reports" }));

    expect(screen.getByTestId("reports-route")).toBeInTheDocument();
    expect(screen.getByTestId("athena-agent-panel")).toHaveStyle({
      width: resizedWidth,
    });
    expect(screen.getByTestId("athena-agent-prompt")).toHaveValue(
      "Keep this draft",
    );
    await user.click(screen.getByTestId("athena-agent-close"));
    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-entry")).toHaveFocus(),
    );
  });

  it("preserves an intentionally saved transcript top when the panel reopens", async () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(1_000);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(300);
    const user = userEvent.setup();
    render(<RouteHarness />);

    await user.click(screen.getByTestId("athena-agent-entry"));
    const firstScroll = screen.getByTestId("athena-agent-scroll");
    firstScroll.scrollTop = 0;
    fireEvent.pointerDown(firstScroll);
    fireEvent.scroll(firstScroll);
    await user.click(screen.getByTestId("athena-agent-close"));
    await user.click(screen.getByTestId("athena-agent-entry"));

    expect(screen.getByTestId("athena-agent-scroll").scrollTop).toBe(0);
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });

  it("keeps the shell launcher unavailable until a surface establishes context", async () => {
    const user = userEvent.setup();
    const view = render(
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-1"
      >
        <AthenaAgentShellControl />
      </AthenaAgentShellProvider>,
    );

    expect(screen.getByTestId("athena-agent-entry")).toBeDisabled();

    view.rerender(
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-1"
      >
        <AthenaAgentShellControl />
        <AthenaAgentSurface
          context={storeContext}
          presentation={storePresentation}
          storeId={STORE_ID}
        />
      </AthenaAgentShellProvider>,
    );
    await user.click(screen.getByTestId("athena-agent-entry"));
    await user.click(screen.getByTestId("athena-agent-close"));

    expect(screen.getByTestId("athena-agent-entry")).toBeEnabled();
    await user.click(screen.getByTestId("athena-agent-entry"));
    expect(screen.getByTestId("athena-agent-panel")).toBeInTheDocument();
  });

  it("switches the pinned context only when the launcher is invoked on the next surface", async () => {
    const user = userEvent.setup();
    const view = render(
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-1"
      >
        <AthenaAgentShellControl />
        <AthenaAgentSurface
          context={storeContext}
          presentation={storePresentation}
          storeId={STORE_ID}
        />
      </AthenaAgentShellProvider>,
    );

    await user.click(screen.getByTestId("athena-agent-entry"));
    expect(latestPersistedShellTarget()).toContain('"storeName":"Osu"');
    await user.click(screen.getByTestId("athena-agent-close"));

    view.rerender(
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-1"
      >
        <AthenaAgentShellControl />
        <AthenaAgentSurface
          context={{
            storeRef: "store-2",
            storeName: "Airport",
            operatingDate: "2026-08-22",
          }}
          presentation={storePresentation}
          storeId={"store-2" as Id<"store">}
        />
      </AthenaAgentShellProvider>,
    );
    await user.click(screen.getByTestId("athena-agent-entry"));
    expect(latestPersistedShellTarget()).toContain('"storeName":"Airport"');
    expect(latestPersistedShellTarget()).toContain(
      '"operatingDate":"2026-08-22"',
    );
  });

  it("keeps context pinned when route props change until the updated entry is invoked", async () => {
    const user = userEvent.setup();
    function ContextHarness() {
      const [airport, setAirport] = useState(false);
      return (
        <AthenaAgentShellProvider
          presentations={[storePresentation]}
          sessionScope="user-1"
        >
          <button onClick={() => setAirport(true)} type="button">
            Change route context
          </button>
          <AthenaAgentShellControl />
          <AthenaAgentSurface
            context={
              airport
                ? {
                    storeRef: "store-2",
                    storeName: "Airport",
                    operatingDate: "2026-08-22",
                  }
                : storeContext
            }
            presentation={storePresentation}
            storeId={(airport ? "store-2" : STORE_ID) as Id<"store">}
          />
        </AthenaAgentShellProvider>
      );
    }
    render(<ContextHarness />);

    await user.click(screen.getByTestId("athena-agent-entry"));
    const pinnedTarget = latestPersistedShellTarget();
    await user.click(
      screen.getByRole("button", { name: "Change route context" }),
    );
    expect(latestPersistedShellTarget()).toBe(pinnedTarget);
    expect(latestPersistedShellTarget()).toContain('"storeName":"Osu"');

    await user.click(screen.getByTestId("athena-agent-close"));
    await user.click(screen.getByTestId("athena-agent-entry"));
    expect(latestPersistedShellTarget()).toContain('"storeName":"Airport"');
  });

  it("restores the pinned context after reload but leaves the panel closed", async () => {
    const user = userEvent.setup();
    const first = renderSurface();
    await user.click(screen.getByTestId("athena-agent-entry"));

    const shellWrite = vi
      .mocked(window.sessionStorage.setItem)
      .mock.calls.find(([key]) => key === "athena.agent.shell.active.user-1");
    expect(shellWrite?.[1]).toContain("daily_operations");
    first.unmount();

    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) => {
      if (key === "athena.agent.shell.active.user-1") {
        return shellWrite?.[1] ?? null;
      }
      if (key.startsWith("athena.agent.turn.user-1.")) return "binding-88";
      return null;
    });
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
    render(
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-1"
      >
        <AthenaAgentShellControl />
      </AthenaAgentShellProvider>,
    );

    expect(screen.queryByTestId("athena-agent-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("athena-agent-entry")).toBeEnabled();
    await user.click(screen.getByTestId("athena-agent-entry"));
    await waitFor(() =>
      expect(screen.getByTestId("athena-agent-transcript")).toHaveTextContent(
        "Earlier question",
      ),
    );
    expect(
      backend.calls.filter((call) => call.name === "resumeTurn"),
    ).toHaveLength(1);
    expect(
      backend.calls.filter((call) => call.name === "startTurn"),
    ).toHaveLength(0);
  });

  it("does not restore another signed-in user's context", () => {
    const stored = JSON.stringify({
      version: 1,
      profileId: "daily_operations",
      storeId: STORE_ID,
      context: storeContext,
    });
    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) =>
      key === "athena.agent.shell.active.user-1" ? stored : null,
    );

    render(
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-2"
      >
        <AthenaAgentShellControl />
      </AthenaAgentShellProvider>,
    );

    expect(screen.getByTestId("athena-agent-entry")).toBeDisabled();
  });

  it("discards restored context that is missing a required binding", () => {
    const storageKey = "athena.agent.shell.active.user-1";
    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) =>
      key === storageKey
        ? JSON.stringify({
            version: 1,
            profileId: "daily_operations",
            storeId: STORE_ID,
            context: { storeRef: STORE_ID, storeName: "Osu" },
          })
        : null,
    );

    render(
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-1"
      >
        <AthenaAgentShellControl />
      </AthenaAgentShellProvider>,
    );

    expect(screen.getByTestId("athena-agent-entry")).toBeDisabled();
    expect(window.sessionStorage.removeItem).toHaveBeenCalledWith(storageKey);
  });

  it("rejects restored context outside its store scope", () => {
    const storageKey = "athena.agent.shell.active.user-1";
    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) =>
      key === storageKey
        ? JSON.stringify({
            version: 1,
            profileId: "daily_operations",
            storeId: STORE_ID,
            context: {
              ...storeContext,
              storeRef: "store-2",
            },
          })
        : null,
    );

    render(
      <AthenaAgentShellProvider
        presentations={[storePresentation]}
        sessionScope="user-1"
      >
        <AthenaAgentShellControl />
      </AthenaAgentShellProvider>,
    );

    expect(screen.getByTestId("athena-agent-entry")).toBeDisabled();
    expect(window.sessionStorage.removeItem).toHaveBeenCalledWith(storageKey);
  });

  it("persists only the presentation-bound context projection", async () => {
    const user = userEvent.setup();
    renderSurface({
      context: { ...storeContext, unrelatedValue: "do-not-store" },
    });

    await user.click(screen.getByTestId("athena-agent-entry"));

    const persisted = vi
      .mocked(window.sessionStorage.setItem)
      .mock.calls.find(
        ([key]) => key === "athena.agent.shell.active.user-1",
      )?.[1];
    expect(persisted).toContain("operatingDate");
    expect(persisted).not.toContain("unrelatedValue");
    expect(persisted).not.toContain("do-not-store");
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
  it("floats a detached resizable panel without blocking the surface", async () => {
    const user = userEvent.setup();
    renderSurface({ layout: "docked" });
    await user.click(screen.getByTestId("athena-agent-entry"));

    const panel = screen.getByTestId("athena-agent-panel");
    expect(panel).toHaveAttribute("data-layout", "docked");
    expect(panel).toHaveStyle({ width: "420px" });
    expect(panel.getAttribute("role")).toBe("complementary");
    expect(panel.className).toContain("rounded-xl");
    expect(panel.className).toContain("h-[60dvh]");
    expect(panel.className).not.toContain("top-layout-md");
    expect(panel.className).toContain(
      "bottom-[calc(var(--space-md)+3rem+var(--space-sm))]",
    );
    expect(panel.className).toContain("right-layout-md");
    expect(panel.className).not.toContain("inset-y-0");
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

    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });
    const keyboardWidth = Number.parseInt(panel.style.width, 10);
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    fireEvent(handle, pointerEvent("pointerdown", 500));
    fireEvent(handle, pointerEvent("pointermove", 450));
    fireEvent(handle, pointerEvent("pointerup", 450));
    expect(panel).toHaveStyle({ width: `${keyboardWidth + 50}px` });
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

  it("restores the reading position when the layout replaces its scroll node", () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(1_000);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(300);
    const view = render(
      <PanelHarness layout="docked" run={baseRun()} scrollTop={140} />,
    );
    expect(screen.getByTestId("athena-agent-scroll").scrollTop).toBe(140);

    view.rerender(
      <PanelHarness layout="fullscreen" run={baseRun()} scrollTop={140} />,
    );

    expect(screen.getByTestId("athena-agent-scroll").scrollTop).toBe(140);
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
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
    const view = renderSurface({ layout: "docked" });
    await user.click(screen.getByTestId("athena-agent-entry"));
    await user.type(
      screen.getByTestId("athena-agent-prompt"),
      "Half a question",
    );

    view.rerender(
      <AthenaAgentShellProvider
        presentations={[storePresentation, organizationPresentation]}
        sessionScope="user-1"
      >
        <AthenaAgentSurface
          context={storeContext}
          layout="fullscreen"
          presentation={storePresentation}
          returnLabel="Back to Daily Operations"
          routeParams={{ orgUrlSlug: "wigclub", storeUrlSlug: "osu" }}
          storeId={STORE_ID}
        />
        <AthenaAgentShellControl />
      </AthenaAgentShellProvider>,
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
            },
          ],
          turn: {
            turnId: "binding-1" as Id<"agentTurnBinding">,
            phase: "running",
            question: "Current question",
            questionState: "retained",
            contextLabel: "Osu · 2026-08-21",
            createdAt: 2,
            terminal: false,
          },
        })}
      />,
    );

    const order = [
      "athena-agent-history",
      "athena-agent-transcript",
      "athena-agent-composer",
    ].map((id) => screen.getByTestId(id));

    for (let index = 1; index < order.length; index += 1) {
      const relation = (
        order[index - 1] as HTMLElement
      ).compareDocumentPosition(order[index] as HTMLElement);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("keeps suggested prompts exclusive to a genuinely empty conversation", () => {
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
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-history")).toBeInTheDocument();
    expect(
      screen.queryByTestId("athena-agent-starters"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("athena-agent-transcript"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("athena-agent-prompt")).toHaveAttribute(
      "placeholder",
      "Ask a follow-up…",
    );
  });

  it("sizes current and historical user message bubbles to their content", () => {
    render(
      <PanelHarness
        run={baseRun({
          history: [
            {
              turnId: "binding-0",
              createdAt: 1,
              state: "answered",
              question: "Earlier short question",
              questionState: "retained",
            },
          ],
          turn: {
            turnId: "binding-1" as Id<"agentTurnBinding">,
            phase: "completed",
            question: "Current short question",
            questionState: "retained",
            contextLabel: "Osu · 2026-08-21",
            createdAt: 2,
            terminal: true,
          },
        })}
      />,
    );

    expect(
      screen.getByText("Current short question").parentElement,
    ).toHaveClass("ml-auto", "w-fit", "max-w-[85%]");
    expect(
      screen.getByText("Earlier short question").parentElement,
    ).toHaveClass("ml-auto", "w-fit", "max-w-[85%]");
  });

  it("replaces repeated context labels with reserved hover timestamps", () => {
    const earlierAt = 1_710_000_000_000;
    const currentAt = 1_710_000_060_000;
    render(
      <PanelHarness
        run={baseRun({
          history: [
            {
              turnId: "binding-0",
              contextLabel: "Osu · 2026-08-21",
              createdAt: earlierAt,
              state: "answered",
              question: "Earlier short question",
              questionState: "retained",
            },
          ],
          turn: {
            turnId: "binding-1" as Id<"agentTurnBinding">,
            phase: "running",
            question: "Current short question",
            questionState: "retained",
            contextLabel: "Osu · 2026-08-21",
            createdAt: currentAt,
            terminal: false,
          },
        })}
      />,
    );

    expect(screen.queryByText("Osu · 2026-08-21")).not.toBeInTheDocument();
    const timestamps = screen.getAllByTestId("athena-agent-message-timestamp");
    expect(timestamps).toHaveLength(2);
    expect(timestamps[0]).toHaveTextContent(formatAbsoluteTimestamp(earlierAt));
    expect(timestamps[1]).toHaveTextContent(formatAbsoluteTimestamp(currentAt));
    for (const timestamp of timestamps) {
      expect(timestamp).toHaveClass(
        "h-4",
        "opacity-0",
        "group-hover/message:opacity-100",
      );
    }
  });

  it("leaves empty history out of the transcript", () => {
    render(<PanelHarness run={baseRun()} />);

    expect(
      screen.queryByTestId("athena-agent-history"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No earlier questions in this conversation."),
    ).not.toBeInTheDocument();
  });
});

describe("states", () => {
  it("announces server milestones in the live region and shows no model text while running", () => {
    const cancel = vi.fn(async () => {});
    render(
      <PanelHarness
        run={baseRun({
          hostState: "running",
          status: { headline: "Thinking...", tone: "progress" },
          canCancel: true,
          canSubmit: false,
          cancel,
          milestones: [
            { milestone: "checking_sources", label: "Thinking...", at: 1 },
            { milestone: "reading_sources", label: "Thinking...", at: 2 },
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
    expect(live).toHaveTextContent("Thinking...");
    expect(live.querySelector("svg")).toBeNull();
    expect(live.firstElementChild).toHaveClass("athena-agent-thinking");
    expect(screen.queryByTestId("athena-agent-status")).not.toBeInTheDocument();
    const stop = screen.getByTestId("athena-agent-cancel");
    expect(stop).toBeEnabled();
    expect(stop).toHaveAccessibleName("Stop");
    expect(stop).toContainElement(
      screen.getByTestId("athena-agent-cancel-icon"),
    );
    expect(screen.getByTestId("athena-agent-composer")).toContainElement(stop);
    expect(screen.queryByTestId("athena-agent-submit")).not.toBeInTheDocument();
    fireEvent.click(stop);
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      screen.queryByTestId("athena-agent-sources"),
    ).not.toBeInTheDocument();
  });

  it("uses the same text-only activity treatment before the first milestone", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "submitting",
          status: { headline: "Thinking...", tone: "progress" },
          isSubmitting: true,
          canSubmit: false,
        })}
      />,
    );

    const activity = screen.getByTestId("athena-agent-progress");
    expect(activity).toHaveTextContent("Thinking...");
    expect(activity.querySelector("svg")).toBeNull();
    expect(activity.firstElementChild).toHaveClass("athena-agent-thinking");
    expect(screen.queryByTestId("athena-agent-status")).not.toBeInTheDocument();
  });

  it("shows limited evidence as contextual guidance below the answer", () => {
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
          milestones: [
            {
              milestone: "reading_sources",
              label: "Reading sources",
              at: 2,
            },
          ],
          answer: {
            outcome: "answer",
            title: "Store close summary",
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
    expect(answer).not.toHaveTextContent("Store close summary");
    expect(answer).toHaveTextContent("Two lanes are open.");
    expect(
      within(answer).queryByRole("heading", { name: /answer/i }),
    ).toBeNull();
    const quality = screen.getByTestId("athena-agent-quality");
    expect(quality).toHaveTextContent("Limited evidence");
    expect(quality).toHaveTextContent("Some sources were incomplete.");
    expect(quality).not.toHaveClass("border-l-2");
    const answerText = screen.getByTestId("athena-agent-answer-text");
    expect(
      answerText.compareDocumentPosition(quality) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("athena-agent-status")).toHaveClass("sr-only");
    expect(
      screen.queryByTestId("athena-agent-progress"),
    ).not.toBeInTheDocument();
    expect(answer.querySelector("a")).toBeNull();
    expect(answer.textContent).toContain("https://evil.example/x");

    expect(screen.queryByTestId("athena-agent-answer-heading")).toBeNull();
    expect(screen.getByTestId("athena-agent-prompt")).toHaveFocus();
  });

  it("keeps citation sources out of the answer UI", () => {
    const inspectCitation = vi.fn(async () => {});
    render(
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

    expect(
      screen.queryByTestId("athena-agent-sources"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("athena-agent-source")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close record" })).toBeNull();
    expect(screen.queryByRole("link", { name: "EOD review" })).toBeNull();
    expect(inspectCitation).not.toHaveBeenCalled();
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

    expect(screen.queryByTestId("athena-agent-source")).not.toBeInTheDocument();
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

    expect(screen.getByTestId("athena-agent-cancel")).toBeEnabled();
    expect(screen.queryByTestId("athena-agent-submit")).not.toBeInTheDocument();
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

  it("keeps context out of the question bubble and names it in the drift notice", () => {
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

    expect(screen.queryByTestId("athena-agent-turn-context")).toBeNull();
    expect(screen.getByTestId("athena-agent-drift")).toHaveTextContent(
      "Osu · 2026-08-21",
    );
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

  it("labels a clarifying answer as needing the operator, not as complete", () => {
    render(
      <PanelHarness
        run={baseRun({
          hostState: "completed",
          status: { headline: "Answered", tone: "neutral" },
          answer: {
            outcome: "needs_clarification",
            narrative: "Which Wednesday did you mean — this week's or last week's?",
            egressClass: "operational",
            committedAt: 5,
            citations: [],
          },
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-quality")).toHaveTextContent(
      "Needs your answer",
    );
    expect(screen.getByTestId("athena-agent-quality")).not.toHaveTextContent(
      "Complete answer",
    );
  });

  it("keeps focus in the composer when a request starts", async () => {
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
      expect(screen.getByTestId("athena-agent-progress")).toHaveTextContent(
        /./,
      ),
    );
    expect(screen.getByTestId("athena-agent-border-beam")).toHaveAttribute(
      "data-active",
    );
    expect(screen.getByTestId("athena-agent-progress")).not.toHaveFocus();
    expect(screen.getByTestId("athena-agent-prompt")).toHaveFocus();

    await user.click(screen.getByTestId("athena-agent-entry"));
    expect(screen.queryByTestId("athena-agent-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("athena-agent-border-beam")).toHaveAttribute(
      "data-active",
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
    await user.type(
      screen.getByTestId("athena-agent-prompt"),
      "A private draft",
    );
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
    expect(
      backend.calls.filter((call) => call.name === "startTurn"),
    ).toHaveLength(0);
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
        presentation={
          organizationPresentation as unknown as typeof storePresentation
        }
        run={baseRun({
          context: {
            label: "Wigclub · all stores",
            entries: [
              {
                key: "organizationRef",
                label: "Organization",
                value: "Wigclub",
              },
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

    expect(
      screen.queryByLabelText("Authorized context"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Which stores need attention?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Who is on shift?" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("athena-agent-answer")).toHaveTextContent(
      "Three stores need attention.",
    );
    expect(screen.queryByTestId("athena-agent-source")).not.toBeInTheDocument();
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
  const withText = [
    "streaming",
    "reset",
    "paused_at_limit",
    "committing",
  ].includes(provisionalState);
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
      {
        state: "disabled",
        container: false,
        text: false,
        notice: false,
        live: null,
      },
      {
        state: "withdrawn",
        container: false,
        text: false,
        notice: true,
        live: null,
      },
      {
        state: "superseded",
        container: false,
        text: false,
        notice: false,
        live: null,
      },
      {
        state: "committing",
        container: true,
        text: true,
        notice: false,
        live: null,
      },
      {
        state: "reset",
        container: true,
        text: true,
        notice: false,
        live: null,
      },
      {
        state: "paused_at_limit",
        container: true,
        text: true,
        notice: false,
        live: "Draft display limit reached. The rest of the draft isn't shown here.",
      },
      {
        state: "streaming",
        container: true,
        text: true,
        notice: false,
        live: null,
      },
      {
        state: "awaiting_first_text",
        container: true,
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
      {
        state: "none",
        container: false,
        text: false,
        notice: false,
        live: null,
      },
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

  it("renders the model text inertly without a draft disclaimer", async () => {
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
    expect(screen.queryByTestId("athena-agent-provisional-label")).toBeNull();
    expect(region).not.toHaveTextContent("Draft in progress");
    expect(region).not.toHaveTextContent("thinking out loud");
    // The draft is revealed over a few frames; every prefix is inert.
    await waitFor(() =>
      expect(region).toHaveTextContent("https://evil.example/x"),
    );
    expect(region.querySelector("a")).toBeNull();
    expect(region.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
  });

  it("orders the work duration, reasoning, and current activity inside the answer slot", () => {
    render(
      <PanelHarness
        run={draftRun("streaming", {
          denial: {
            code: "spend_ceiling",
            headline: "Athena reached today's limit.",
          },
          contextDrift: true,
          milestones: [
            { milestone: "reading_sources", label: "Reading sources", at: 1 },
          ],
        })}
      />,
    );

    const denial = screen.getByTestId("athena-agent-denial");
    const drift = screen.getByTestId("athena-agent-drift");
    const provisional = screen.getByTestId("athena-agent-provisional");
    const order = [denial, drift, provisional];

    for (let index = 1; index < order.length; index += 1) {
      const relation = (
        order[index - 1] as HTMLElement
      ).compareDocumentPosition(order[index] as HTMLElement);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    const duration = screen.getByTestId("athena-agent-draft-duration");
    const activity = screen.getByTestId("athena-agent-progress");
    const reasoning = screen.getByTestId("athena-agent-provisional-text");
    expect(provisional).toContainElement(activity);
    expect(
      duration.compareDocumentPosition(reasoning) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      reasoning.compareDocumentPosition(activity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("adds no label across rapid resets and never moves focus", () => {
    const announced: string[] = [];
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    screen.getByTestId("athena-agent-new-thread").focus();
    const anchor = document.activeElement;

    for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
      const draft = {
        text: `Draft ${ordinal}`,
        truncated: false,
        draftOrdinal: ordinal,
      };
      rerender(
        <PanelHarness run={draftRun("reset", { provisional: draft })} />,
      );
      announced.push(
        screen.getByTestId("athena-agent-provisional-live").textContent ?? "",
      );
      rerender(
        <PanelHarness run={draftRun("streaming", { provisional: draft })} />,
      );
      announced.push(
        screen.getByTestId("athena-agent-provisional-live").textContent ?? "",
      );
    }

    expect(announced.every((line) => line === "")).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });

  it("distinguishes a paused draft from a stalled one", () => {
    const { rerender } = render(
      <PanelHarness run={draftRun("paused_at_limit")} />,
    );

    expect(
      screen.getByTestId("athena-agent-provisional-text"),
    ).toHaveTextContent("Two lanes are still open.");
    expect(
      screen.getByTestId("athena-agent-provisional-live"),
    ).toHaveTextContent("Draft display limit reached.");

    rerender(<PanelHarness run={draftRun("stalled")} />);

    expect(screen.queryByTestId("athena-agent-provisional-text")).toBeNull();
    expect(
      screen.getByTestId("athena-agent-provisional-live"),
    ).toHaveTextContent(
      "Draft paused. You can stop this request or start a new thread.",
    );
    expect(screen.getByTestId("athena-agent-cancel")).toBeEnabled();
    expect(screen.getByTestId("athena-agent-new-thread")).toBeEnabled();
  });

  it("swaps the draft for the committed answer, even when they disagree", async () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);

    await waitFor(() =>
      expect(
        screen.getByTestId("athena-agent-provisional-text"),
      ).toHaveTextContent("Two lanes are still open."),
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
      expect(screen.getByTestId("athena-agent-answer")).toHaveTextContent(
        "Only one lane is open.",
      ),
    );
  });

  it("says only what happened to the draft when it is withdrawn", () => {
    render(<PanelHarness run={draftRun("withdrawn")} />);

    const notice = screen.getByTestId("athena-agent-provisional-withdrawn");
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent("Draft withdrawn.");
    expect(notice).toHaveTextContent(
      "This draft went beyond what you can read here.",
    );
    expect(notice.textContent).not.toMatch(/answer/i);
    expect(screen.queryByTestId("athena-agent-provisional-text")).toBeNull();
  });

  it("renders exactly today's host for a buffered profile", () => {
    const buffered = render(<PanelHarness run={draftRun("disabled")} />);
    const bufferedMarkup = screen.getByTestId(
      "athena-agent-transcript",
    ).innerHTML;
    buffered.unmount();

    render(<PanelHarness run={draftRun("none")} />);

    expect(screen.getByTestId("athena-agent-transcript").innerHTML).toBe(
      bufferedMarkup,
    );
  });

  const sized = (scroll: HTMLElement) => {
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 400,
    });
  };
  const latest = () => screen.getByTestId("athena-agent-latest");

  it("follows the growing draft until the operator scrolls the transcript themselves", async () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    const scroll = screen.getByTestId("athena-agent-scroll");
    sized(scroll);

    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "More and more text",
            truncated: false,
            draftOrdinal: 1,
          },
        })}
      />,
    );
    await waitFor(() => expect(scroll.scrollTop).toBe(300));
    // At the latest: the floating control stays out of the way and out of the tab order.
    expect(latest()).toHaveAttribute("data-visible", "false");
    expect(latest()).toHaveAttribute("aria-hidden", "true");
    expect(latest()).toHaveAttribute("tabindex", "-1");

    // The operator scrolls up: following stops, and the control appears.
    fireEvent.wheel(scroll);
    scroll.scrollTop = 40;
    fireEvent.scroll(scroll);
    expect(latest()).toHaveAttribute("data-visible", "true");
    expect(latest()).toHaveAttribute("aria-hidden", "false");
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "Even more text",
            truncated: false,
            draftOrdinal: 1,
          },
        })}
      />,
    );
    // A replaced draft paints at once; the follow stays off while scrolled up.
    await waitFor(() =>
      expect(
        screen.getByTestId("athena-agent-provisional-text"),
      ).toHaveTextContent("Even more text"),
    );
    expect(scroll.scrollTop).toBe(40);

    // A draft that ends does not take the reading position back either.
    rerender(<PanelHarness run={draftRun("stalled")} />);
    expect(scroll.scrollTop).toBe(40);

    // The control brings the operator back and the follow resumes.
    fireEvent.click(latest());
    expect(scroll.scrollTop).toBe(300);
    fireEvent.scroll(scroll);
    expect(latest()).toHaveAttribute("data-visible", "false");
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "A later draft",
            truncated: false,
            draftOrdinal: 2,
          },
        })}
      />,
    );
    scroll.scrollTop = 200;
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "A later draft, longer",
            truncated: false,
            draftOrdinal: 2,
          },
        })}
      />,
    );
    await waitFor(() => expect(scroll.scrollTop).toBe(300));
  });

  it("hands focus to the composer when the latest control hides while it is focused", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    const scroll = screen.getByTestId("athena-agent-scroll");
    sized(scroll);
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "More and more text",
            truncated: false,
            draftOrdinal: 1,
          },
        })}
      />,
    );
    fireEvent.wheel(scroll);
    scroll.scrollTop = 40;
    fireEvent.scroll(scroll);
    expect(latest()).toHaveAttribute("data-visible", "true");
    latest().focus();
    expect(latest()).toHaveFocus();

    // The operator scrolls back to the bottom themselves: the control hides,
    // and focus must not stay on an aria-hidden, untabbable element.
    scroll.scrollTop = 300;
    fireEvent.scroll(scroll);
    expect(latest()).toHaveAttribute("data-visible", "false");
    expect(latest()).toHaveAttribute("aria-hidden", "true");
    expect(latest()).not.toHaveFocus();
    expect(screen.getByTestId("athena-agent-prompt")).toHaveFocus();
  });

  it("keeps following through the panel's own focus moves", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    const scroll = screen.getByTestId("athena-agent-scroll");
    sized(scroll);
    // Stop: the status line takes focus, inside the transcript.
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          hostState: "cancellation_requested",
          status: { headline: "Stopping…", tone: "progress" },
        })}
      />,
    );
    expect(screen.getByTestId("athena-agent-progress")).toHaveFocus();
    scroll.scrollTop = 120;
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          hostState: "cancellation_requested",
          status: { headline: "Stopping…", tone: "progress" },
          provisional: {
            text: "A last flush lands",
            truncated: false,
            draftOrdinal: 1,
          },
        })}
      />,
    );
    // Still following: the panel moved focus, not the operator.
    expect(scroll.scrollTop).toBe(300);
  });

  it("keeps following through the commit without moving focus to the answer heading", async () => {
    const { rerender } = render(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "Checking the lanes.",
            truncated: false,
            draftOrdinal: 1,
          },
        })}
      />,
    );
    const scroll = screen.getByTestId("athena-agent-scroll");
    sized(scroll);
    await waitFor(() => expect(scroll.scrollTop).toBe(300));
    const answered = draftRun("superseded", {
      hostState: "completed",
      status: { headline: "Answer ready", tone: "neutral" },
      canCancel: false,
      canSubmit: true,
      answer: {
        outcome: "answer",
        narrative: "Two lanes are open, and one card payment landed. ".repeat(
          6,
        ),
        egressClass: "operational",
        limitedEvidence: false,
        committedAt: 5,
        citations: [],
      },
    });
    rerender(<PanelHarness run={answered} />);
    expect(screen.queryByTestId("athena-agent-answer-heading")).toBeNull();
    expect(screen.getByTestId("athena-agent-prompt")).toHaveFocus();
    // The answer keeps arriving while the composer retains focus; the follow holds.
    scroll.scrollTop = 150;
    rerender(
      <PanelHarness run={{ ...answered, milestones: answered.milestones }} />,
    );
    await waitFor(() => expect(scroll.scrollTop).toBe(300));
    expect(latest()).toHaveAttribute("data-visible", "false");
  });

  it("is handed back when keyboard focus travels into the transcript", () => {
    const { rerender } = render(
      <PanelHarness
        run={draftRun("streaming", {
          history: [
            {
              turnId: "binding-0",
              createdAt: 1,
              state: "answered",
              question: "Earlier question",
              questionState: "retained",
              answer: {
                outcome: "answer",
                narrative: "Earlier answer.",
                egressClass: "operational",
                committedAt: 2,
                citations: [],
              },
            },
          ],
        })}
      />,
    );
    const scroll = screen.getByTestId("athena-agent-scroll");
    sized(scroll);
    const inside = scroll.querySelector("summary") as HTMLElement | null;
    expect(inside).not.toBeNull();
    scroll.scrollTop = 120;
    fireEvent.scroll(scroll);
    fireEvent.focus(inside!);
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "Text keeps arriving",
            truncated: false,
            draftOrdinal: 1,
          },
        })}
      />,
    );
    // Reading there by keyboard: the follow leaves the position alone.
    expect(scroll.scrollTop).toBe(120);
  });

  it("is handed back by a pointer, a touch, or a navigation key, never by the smooth scroll itself", () => {
    for (const interrupt of [
      (scroll: HTMLElement) => fireEvent.pointerDown(scroll),
      (scroll: HTMLElement) => fireEvent.touchMove(scroll),
      (scroll: HTMLElement) => fireEvent.keyDown(scroll, { key: "PageUp" }),
    ]) {
      const { rerender, unmount } = render(
        <PanelHarness run={draftRun("streaming")} />,
      );
      const scroll = screen.getByTestId("athena-agent-scroll");
      sized(scroll);
      // A smooth scroll in flight is away from the bottom: that alone changes nothing.
      scroll.scrollTop = 200;
      fireEvent.scroll(scroll);
      rerender(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: {
              text: "Still following",
              truncated: false,
              draftOrdinal: 1,
            },
          })}
        />,
      );
      expect(scroll.scrollTop).toBe(300);
      expect(latest()).toHaveAttribute("data-visible", "false");

      interrupt(scroll);
      scroll.scrollTop = 200;
      fireEvent.scroll(scroll);
      rerender(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: {
              text: "Still following, no longer",
              truncated: false,
              draftOrdinal: 1,
            },
          })}
        />,
      );
      expect(scroll.scrollTop).toBe(200);
      expect(latest()).toHaveAttribute("data-visible", "true");
      unmount();
    }
  });

  it("keeps a newly sent question at the top while its response fits in view", async () => {
    const submit = vi.fn(async () => {});
    const { rerender } = render(
      <PanelHarness run={draftRun("streaming", { submit })} />,
    );
    const scroll = screen.getByTestId("athena-agent-scroll");
    sized(scroll);
    fireEvent.wheel(scroll);
    scroll.scrollTop = 40;
    fireEvent.scroll(scroll);

    rerender(
      <PanelHarness
        run={draftRun("superseded", {
          submit,
          hostState: "completed",
          status: { headline: "Answer ready", tone: "neutral" },
          canCancel: false,
          canSubmit: true,
          answer: {
            outcome: "answer",
            narrative: "Two lanes are open.",
            egressClass: "operational",
            limitedEvidence: false,
            committedAt: 5,
            citations: [],
          },
        })}
      />,
    );
    // The operator had scrolled away: the answer does not take the position back.
    expect(scroll.scrollTop).toBe(40);

    fireEvent.change(screen.getByTestId("athena-agent-prompt"), {
      target: { value: "And card?" },
    });
    fireEvent.submit(screen.getByTestId("athena-agent-composer"));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("And card?"));
    // Submission waits for the new turn instead of moving the old transcript.
    expect(scroll.scrollTop).toBe(40);

    const rect = (top: number) =>
      ({
        bottom: top + 20,
        height: 20,
        left: 0,
        right: 100,
        top,
        width: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === scroll) return rect(100);
        if (this.dataset.testid === "athena-agent-current-question")
          return rect(questionContentTop - scroll.scrollTop);
        return rect(0);
      });
    const scrollTo = vi.fn(
      (options: ScrollToOptions) => (scroll.scrollTop = options.top ?? 0),
    );
    Object.defineProperty(scroll, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    const nextTurn = {
      ...RUNNING_TURN,
      turnId: "binding-2" as Id<"agentTurnBinding">,
      question: "And card?",
      createdAt: 8,
    };
    const optimisticTurn = {
      ...nextTurn,
      turnId: RUNNING_TURN.turnId,
    };
    let questionContentTop = 260;
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          // The submitted question paints before the backend assigns its new
          // binding. The visible bubble is the alignment signal.
          activeTurnId: RUNNING_TURN.turnId,
          submit,
          turn: optimisticTurn,
        })}
      />,
    );
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 160 });
    expect(scroll.scrollTop).toBe(160);
    expect(screen.getByTestId("athena-agent-transcript")).toHaveClass(
      "min-h-[calc(100%+var(--space-md))]",
    );

    // Browser scroll anchoring can shift the content while the smooth scroll
    // is in flight, even if the backend emits no new view. Correct that final
    // geometry when the movement settles.
    questionContentTop += 48;
    fireEvent(scroll, new Event("scrollend"));
    expect(scroll.scrollTop).toBe(208);

    // A milestone is a transcript commit, but the current turn still fits in
    // the viewport. It must not replace the deliberate question-top position
    // with the bottom of the entire conversation.
    // The backend projection can also move the just-finished turn into history
    // on this commit. Preserve the bubble's visual top, not merely the first
    // numeric scroll target.
    questionContentTop += 48;
    rerender(
      <PanelHarness
        run={draftRun("streaming", {
          activeTurnId: nextTurn.turnId,
          submit,
          turn: nextTurn,
          milestones: [
            {
              milestone: "reading_sources",
              label: "Reading sources",
              at: 9,
            },
          ],
        })}
      />,
    );
    expect(scroll.scrollTop).toBe(256);

    // The committed answer also leaves the operator at the start of this turn.
    rerender(
      <PanelHarness
        run={draftRun("superseded", {
          submit,
          hostState: "completed",
          status: { headline: "Answer ready", tone: "neutral" },
          activeTurnId: nextTurn.turnId,
          canCancel: false,
          canSubmit: true,
          turn: { ...nextTurn, phase: "completed", terminal: true },
          answer: {
            outcome: "answer",
            narrative: "Two lanes are open, and one card payment landed.",
            egressClass: "operational",
            limitedEvidence: false,
            committedAt: 9,
            citations: [],
          },
        })}
      />,
    );
    expect(scroll.scrollTop).toBe(256);
    bounds.mockRestore();
  });

  it("glides only while the model responds, except under reduced motion", () => {
    const { rerender, unmount } = render(
      <PanelHarness run={draftRun("streaming")} />,
    );
    expect(screen.getByTestId("athena-agent-scroll")).toHaveClass(
      "scroll-smooth",
    );

    rerender(
      <PanelHarness
        run={draftRun("superseded", {
          hostState: "completed",
          canCancel: false,
          answer: {
            outcome: "answer",
            narrative: "The answer is ready.",
            egressClass: "operational",
            committedAt: 9,
            citations: [],
          },
        })}
      />,
    );
    expect(screen.getByTestId("athena-agent-scroll")).not.toHaveClass(
      "scroll-smooth",
    );
    unmount();

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
    render(<PanelHarness run={draftRun("streaming")} />);
    expect(screen.getByTestId("athena-agent-scroll")).not.toHaveClass(
      "scroll-smooth",
    );
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

  it("drops draft animation and the reset label under reduced motion", () => {
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
    expect(
      screen.getByTestId("athena-agent-provisional-live"),
    ).toBeEmptyDOMElement();
  });
});

describe("focus while a draft is withdrawn", () => {
  /** Focus lands somewhere neutral, as it does after a submission. */
  function anchorFocusOutsideComposer() {
    const activity = screen.getByTestId("athena-agent-progress");
    activity.focus();
    return activity;
  }

  it("moves focus to the notice once for a mid-run withdrawal", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    expect(
      screen.getByTestId("athena-agent-provisional-withdrawn"),
    ).toHaveFocus();

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
    expect(
      screen.getByTestId("athena-agent-provisional-withdrawn"),
    ).toHaveAttribute("role", "alert");
  });

  it("lets the existing terminal move win when both land together", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();
    screen.getByTestId("athena-agent-new-thread").focus();

    rerender(
      <PanelHarness
        run={draftRun("withdrawn", {
          hostState: "terminal_denied",
          status: {
            headline: "This answer is no longer available to you.",
            tone: "warning",
          },
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
    expect(screen.getByTestId("athena-agent-progress")).toHaveFocus();

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
    expect(
      screen.getByTestId("athena-agent-provisional-withdrawn"),
    ).toHaveFocus();

    rerender(
      <PanelHarness
        run={draftRun("withdrawn", {
          hostState: "terminal_denied",
          status: { headline: "Stopped.", tone: "neutral" },
          canCancel: false,
        })}
      />,
    );

    expect(
      screen.getByTestId("athena-agent-provisional-withdrawn"),
    ).toHaveFocus();
  });

  it("does not move to the answer heading, but still moves to a later denial", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    expect(
      screen.getByTestId("athena-agent-provisional-withdrawn"),
    ).toHaveFocus();

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
    expect(screen.queryByTestId("athena-agent-answer-heading")).toBeNull();

    rerender(
      <PanelHarness
        run={draftRun("none", {
          hostState: "terminal_denied",
          status: {
            headline: "This answer is no longer available to you.",
            tone: "warning",
          },
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

    expect(screen.getByTestId("athena-agent-progress")).toHaveFocus();
  });

  it("moves no focus when a panel mounts into an already-withdrawn running turn", () => {
    render(<PanelHarness run={draftRun("withdrawn")} />);

    // The mount focuses the composer, as it always has; the notice does not
    // take a focus move it never observed happening.
    expect(screen.getByTestId("athena-agent-prompt")).toHaveFocus();
    expect(
      screen.getByTestId("athena-agent-provisional-withdrawn"),
    ).toBeInTheDocument();
  });

  it("moves no focus to the status for the next turn after a withdrawn one", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    anchorFocusOutsideComposer();

    rerender(<PanelHarness run={draftRun("withdrawn")} />);
    expect(
      screen.getByTestId("athena-agent-provisional-withdrawn"),
    ).toHaveFocus();

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

    expect(screen.getByTestId("athena-agent-progress")).not.toHaveFocus();
    expect(screen.getByTestId("athena-agent-new-thread")).toHaveFocus();
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
          provisionalWithdrawal:
            describeProvisionalWithdrawal("membership_revoked"),
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();
    expect(
      screen.getByTestId("athena-agent-provisional-withdrawn"),
    ).toHaveTextContent("This draft is no longer available to you.");
  });

  it("never moves focus for streaming, reset, pause, or stall", () => {
    const { rerender } = render(<PanelHarness run={draftRun("streaming")} />);
    const anchor = screen.getByTestId("athena-agent-new-thread");
    anchor.focus();

    for (const state of [
      "reset",
      "paused_at_limit",
      "streaming",
      "stalled",
    ] as const) {
      rerender(<PanelHarness run={draftRun(state)} />);
      expect(document.activeElement, `provisionalState ${state}`).toBe(anchor);
    }
  });
});

describe("the draft is profile-neutral", () => {
  it("streams a second profile through the same components", async () => {
    render(
      <PanelHarness
        presentation={
          organizationPresentation as unknown as typeof storePresentation
        }
        run={draftRun("streaming", {
          context: {
            label: "Wigclub · all stores",
            entries: [
              {
                key: "organizationRef",
                label: "Organization",
                value: "Wigclub",
              },
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

    expect(screen.queryByTestId("athena-agent-provisional-label")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByTestId("athena-agent-provisional-text"),
      ).toHaveTextContent("Three stores need attention"),
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
            {
              milestone: "composing_answer",
              label: "Composing the answer",
              at: 2,
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("athena-agent-progress")).toHaveTextContent(
      "Composing the answer",
    );
    expect(screen.queryByTestId("athena-agent-provisional")).toBeNull();
    expect(
      screen.queryByTestId("athena-agent-provisional-withdrawn"),
    ).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("shows no notice when a turn ends before any draft was released", () => {
    const { rerender } = render(
      <PanelHarness run={draftRun("awaiting_first_text")} />,
    );
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

    expect(
      screen.queryByTestId("athena-agent-provisional-withdrawn"),
    ).toBeNull();
    expect(screen.queryByTestId("athena-agent-provisional")).toBeNull();
    // The turn's own terminal move still happens; the draft adds nothing.
    expect(screen.getByTestId("athena-agent-status")).toHaveFocus();
  });
});

describe("the provisional timeline", () => {
  const earlier = [
    {
      text: "First I'll read the registers.",
      truncated: false,
      draftOrdinal: 0,
    },
    {
      text: "## Approved\n\nNow the log: https://evil.example/x",
      truncated: false,
      draftOrdinal: 1,
    },
  ];

  it("renders finished drafts above the live one, oldest first and inert", async () => {
    render(
      <PanelHarness
        run={draftRun("streaming", {
          provisional: {
            text: "Summing up.",
            truncated: false,
            draftOrdinal: 2,
          },
          provisionalTimeline: earlier,
        })}
      />,
    );

    const region = screen.getByTestId("athena-agent-provisional");
    const entries = within(region).getAllByTestId(
      "athena-agent-provisional-entry",
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).not.toHaveTextContent("Earlier draft 1");
    expect(entries[0]).not.toHaveClass("border-l", "pl-3");
    expect(entries[0]).toHaveTextContent("First I'll read the registers.");
    expect(entries[1]).not.toHaveTextContent("Earlier draft 2");
    expect(entries[1]).not.toHaveClass("border-l", "pl-3");
    expect(entries[1]).toHaveTextContent("Now the log: https://evil.example/x");
    expect(entries[1]?.querySelector("a")).toBeNull();
    expect(entries[1]?.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    // The live draft follows the entries inside the same labelled container.
    const order = Array.from(region.querySelectorAll("[data-testid]")).map(
      (node) => node.getAttribute("data-testid"),
    );
    expect(order.indexOf("athena-agent-provisional-entry")).toBeLessThan(
      order.indexOf("athena-agent-provisional-text"),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("athena-agent-provisional-text"),
      ).toHaveTextContent("Summing up."),
    );
    // The entries never enter the live region.
    expect(
      screen.getByTestId("athena-agent-provisional-live"),
    ).not.toHaveTextContent("registers");
  });

  it("counts live work, then freezes the duration and collapses the committed trail", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      vi.setSystemTime(10_000);
      const turn = { ...RUNNING_TURN, createdAt: 5_000 };
      const { rerender } = render(
        <PanelHarness
          run={draftRun("awaiting_first_text", {
            turn,
            activeTurnId: turn.turnId,
          })}
        />,
      );

      const working = screen.getByTestId("athena-agent-provisional");
      expect(working).toHaveTextContent("Working for 5s");
      expect(working).not.toHaveClass("border-b", "border-y", "border-t");
      expect(
        within(working).getByTestId("athena-agent-working-header"),
      ).toHaveClass("border-b");
      expect(
        within(working).queryByTestId("athena-agent-draft-toggle-icon"),
      ).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(working).toHaveTextContent("Working for 7s");

      rerender(
        <PanelHarness
          run={draftRun("superseded", {
            hostState: "completed",
            status: { headline: "Answer ready", tone: "neutral" },
            canCancel: false,
            canSubmit: true,
            turn: { ...turn, phase: "completed", terminal: true },
            provisionalTimeline: earlier,
            answer: {
              outcome: "answer",
              narrative: "Only one lane is open.",
              egressClass: "operational",
              committedAt: 13_000,
              citations: [],
            },
          })}
        />,
      );

      const completed = screen.getByTestId("athena-agent-provisional-timeline");
      expect(completed).not.toHaveAttribute("open");
      expect(completed).toHaveTextContent("Worked for 8s");
      expect(completed).toHaveClass("border-b");
      expect(completed).not.toHaveClass("border-y", "border-t");
      expect(screen.getByTestId("athena-agent-answer")).not.toHaveClass(
        "border-t",
      );
      expect(
        within(completed).getByTestId("athena-agent-draft-toggle-icon"),
      ).toBeVisible();
      const duration = within(completed).getByTestId(
        "athena-agent-draft-duration",
      );
      const chevron = within(completed).getByTestId(
        "athena-agent-draft-toggle-icon",
      );
      expect(chevron).not.toHaveClass("ml-auto");
      expect(
        duration.compareDocumentPosition(chevron) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("places the collapsed draft trail before the committed answer", () => {
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
    expect(timeline).toHaveTextContent("Worked for 0s");
    expect(timeline).not.toHaveTextContent("How Athena got here");
    expect(timeline).not.toHaveTextContent("Not verified");
    expect(
      within(timeline).getAllByTestId("athena-agent-provisional-entry"),
    ).toHaveLength(2);
    expect(timeline.querySelector("a")).toBeNull();
    // The draft trail establishes the path before the checked answer lands.
    const transcript = screen.getByTestId("athena-agent-transcript");
    const order = Array.from(transcript.querySelectorAll("[data-testid]")).map(
      (node) => node.getAttribute("data-testid"),
    );
    expect(order.indexOf("athena-agent-provisional-timeline")).toBeLessThan(
      order.indexOf("athena-agent-answer"),
    );
  });

  it("shows no timeline for a withdrawn, stalled, or disabled draft", () => {
    for (const state of ["withdrawn", "stalled", "disabled"] as const) {
      const view = render(
        <PanelHarness
          run={draftRun(state, { provisionalTimeline: earlier })}
        />,
      );
      expect(screen.queryByTestId("athena-agent-provisional-entry")).toBeNull();
      expect(
        screen.queryByTestId("athena-agent-provisional-timeline"),
      ).toBeNull();
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
    const withoutAnswer = {
      ...answered,
      turnId: "binding-failed" as typeof answered.turnId,
      answer: undefined,
      failureHeadline: "Stopped.",
    };
    render(
      <PanelHarness run={baseRun({ history: [answered, withoutAnswer] })} />,
    );

    const entries = screen.getAllByTestId("athena-agent-history-entry");
    expect(entries).toHaveLength(2);
    const trail = within(entries[0]).getByTestId("athena-agent-history-trail");
    const answer = within(entries[0]).getByText(
      "The automation log is behind.",
    );
    expect(trail).toBeTruthy();
    expect(trail).toHaveClass("border-b");
    expect(trail).not.toHaveClass("border-y", "border-t");
    expect(
      trail.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(entries[1]).queryByTestId("athena-agent-history-trail"),
    ).toBeNull();
  });

  it("reads the trail only once opened, and renders the fetched drafts inertly", async () => {
    const user = userEvent.setup();
    backend.trail = {
      kind: "trail",
      committedAt: 200,
      entries: [
        { draftOrdinal: 0, text: "Checking the registers.", truncated: false },
        {
          draftOrdinal: 1,
          text: "<script>window.__athenaExecuted = true;</script> Now the log.",
          truncated: false,
        },
      ],
    };
    render(<PanelHarness run={baseRun({ history: [answered] })} />);

    const block = screen.getByTestId("athena-agent-history-trail");
    // Closed: nothing is fetched and nothing is rendered.
    expect(
      within(block).queryAllByTestId("athena-agent-provisional-entry"),
    ).toHaveLength(0);
    expect(screen.queryByText("Checking the registers.")).toBeNull();

    await user.click(within(block).getByLabelText(/^Show answer drafts/));

    await waitFor(() =>
      expect(
        within(block).queryAllByTestId("athena-agent-provisional-entry"),
      ).toHaveLength(2),
    );
    const drafts = within(block).getAllByTestId(
      "athena-agent-provisional-entry",
    );
    expect(within(drafts[0]).queryByText("Earlier draft 1")).toBeNull();
    expect(drafts[0]).not.toHaveClass("border-l", "pl-3");
    expect(within(drafts[1]).queryByText("Earlier draft 2")).toBeNull();
    expect(drafts[0].textContent).toContain("Checking the registers.");
    // The model's text is rendered inertly: no script, no link, no control.
    expect(block.querySelector("script")).toBeNull();
    expect(block.querySelector("a")).toBeNull();
    expect(block.querySelector("button")).toBeNull();
    expect(
      (window as unknown as { __athenaExecuted?: boolean }).__athenaExecuted,
    ).toBeUndefined();
  });

  it("says so when a committed turn kept no drafts", async () => {
    const user = userEvent.setup();
    backend.trail = { kind: "trail", committedAt: 200, entries: [] };
    render(<PanelHarness run={baseRun({ history: [answered] })} />);

    const block = screen.getByTestId("athena-agent-history-trail");
    await user.click(within(block).getByLabelText(/^Show answer drafts/));

    await waitFor(() =>
      expect(
        within(block).getByText("No drafts were kept for this question."),
      ).toBeTruthy(),
    );
    expect(
      within(block).queryAllByTestId("athena-agent-provisional-entry"),
    ).toHaveLength(0);
  });

  it("shows the closed-vocabulary line when the server refuses an earlier turn's trail", async () => {
    const user = userEvent.setup();
    backend.trail = { kind: "unavailable", reason: "membership_revoked" };
    render(<PanelHarness run={baseRun({ history: [answered] })} />);

    const block = screen.getByTestId("athena-agent-history-trail");
    await user.click(within(block).getByLabelText(/^Show answer drafts/));

    await waitFor(() =>
      expect(
        within(block).getByText("This answer is no longer available to you."),
      ).toBeTruthy(),
    );
    expect(
      within(block).queryAllByTestId("athena-agent-provisional-entry"),
    ).toHaveLength(0);
  });
});

describe("composer", () => {
  const prompt = () =>
    screen.getByTestId("athena-agent-prompt") as HTMLTextAreaElement;
  const send = () => screen.getByTestId("athena-agent-submit");

  it("keeps a deliberate inset above the bottom of the panel", () => {
    render(<PanelHarness run={baseRun()} />);

    expect(screen.getByTestId("athena-agent-composer")).toHaveClass(
      "mb-layout-sm",
    );
  });

  it("sends on Enter, keeps Shift+Enter as a newline, and stays disabled while empty", async () => {
    const submit = vi.fn(async () => {});
    render(<PanelHarness run={baseRun({ submit })} />);
    expect(send()).toBeDisabled();
    expect(send()).toHaveAccessibleName("Ask");

    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(prompt(), { target: { value: "Which lanes are open?" } });
    expect(send()).toBeEnabled();
    const shiftEnter = fireEvent.keyDown(prompt(), {
      key: "Enter",
      shiftKey: true,
    });
    // Not prevented: the browser inserts the newline.
    expect(shiftEnter).toBe(true);
    expect(submit).not.toHaveBeenCalled();

    const enter = fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(enter).toBe(false);
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("Which lanes are open?"),
    );
    await waitFor(() => expect(prompt()).toHaveValue(""));
  });

  it("a starter-intent tap sends immediately with its id (starter-intents plan U3)", async () => {
    const submit = vi.fn(async () => {});
    render(<PanelHarness run={baseRun({ submit })} />);
    fireEvent.click(screen.getByRole("button", { name: "What is holding up the close?" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("What is blocking the end-of-day close?", { starterIntentId: "close_readiness" }),
    );
  });

  it("does not send mid-composition or while a follow-up is blocked", () => {
    const submit = vi.fn(async () => {});
    const { rerender } = render(<PanelHarness run={baseRun({ submit })} />);
    fireEvent.change(prompt(), { target: { value: "どの" } });
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      isComposing: true,
    } as KeyboardEventInit);
    prompt().dispatchEvent(composing);
    expect(submit).not.toHaveBeenCalled();

    rerender(<PanelHarness run={baseRun({ submit, canFollowUp: false })} />);
    expect(send()).toBeDisabled();
    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("asks for a follow-up once the thread has an answer", () => {
    const { rerender } = render(<PanelHarness run={baseRun()} />);
    expect(prompt()).toHaveAttribute("placeholder", "Ask about this context");
    rerender(
      <PanelHarness
        run={baseRun({
          answer: {
            outcome: "answer",
            narrative: "Two lanes are open.",
            egressClass: "operational",
            limitedEvidence: false,
            committedAt: 5,
            citations: [],
          },
        })}
      />,
    );
    expect(prompt()).toHaveAttribute("placeholder", "Ask a follow-up…");
  });
});

describe("stream reveal of the live draft", () => {
  const long = (chars: number) =>
    "Checking the registers one by one, lane by lane. "
      .repeat(Math.ceil(chars / 50))
      .slice(0, chars);
  const fakeFrames = () =>
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
        "Date",
      ],
    });
  const paintedText = () =>
    screen.getByTestId("athena-agent-provisional-text").textContent ?? "";
  const wipedWords = () =>
    screen
      .getByTestId("athena-agent-provisional-text")
      .querySelectorAll(".athena-agent-wipe-word");
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
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: first, truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      // A draft that is streaming is seen to start.
      expect(paintedText().length).toBeLessThan(first.length);
      frames(15);
      expect(paintedText()).toBe(first);

      const grown = long(400);
      rerender(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: grown, truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
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
      expect(
        screen.getByTestId("athena-agent-provisional-text"),
      ).toHaveAttribute("data-reveal", "settled");
      // Words keep arriving with the ink wipe for as long as the draft streams.
      expect(wipedWords().length).toBeGreaterThan(0);
      frames(60);
      expect(wipedWords().length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the ink wipe for one fade after the draft stops, then drops the word spans without moving a word", () => {
    fakeFrames();
    try {
      const { rerender } = render(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: long(40), truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      frames(15);
      rerender(
        <PanelHarness
          run={draftRun("committing", {
            provisional: { text: long(120), truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      frames(9);
      expect(paintedText()).toBe(long(120));
      // Settled, but the last words are still fading in (760 ms).
      expect(wipedWords().length).toBeGreaterThan(0);
      frames(40);
      expect(wipedWords().length).toBeGreaterThan(0);
      frames(12);
      expect(wipedWords()).toHaveLength(0);
      expect(paintedText()).toBe(long(120));
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts from the visible prefix, never from the start, when the next flush lands mid-reveal", () => {
    fakeFrames();
    try {
      const { rerender } = render(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: long(40), truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      frames(15);
      rerender(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: long(300), truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      frames(4);
      const midway = paintedText().length;
      expect(midway).toBeGreaterThan(40);
      expect(midway).toBeLessThan(300);
      rerender(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: long(600), truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      expect(paintedText().length).toBeGreaterThanOrEqual(midway);
      expect(
        screen.getByTestId("athena-agent-provisional-text"),
      ).toHaveAttribute("data-reveal", "revealing");
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
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: long(40), truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      frames(15);
      rerender(
        <PanelHarness
          run={draftRun("reset", {
            provisional: { text: long(90), truncated: false, draftOrdinal: 2 },
          })}
        />,
      );
      expect(paintedText().length).toBeLessThan(90);
      frames(15);
      expect(paintedText()).toBe(long(90));
      // The model stopped narrating: the tail settles at the faster pace (≤ 120 ms).
      rerender(
        <PanelHarness
          run={draftRun("committing", {
            provisional: { text: long(500), truncated: false, draftOrdinal: 2 },
          })}
        />,
      );
      frames(9);
      expect(paintedText()).toBe(long(500));
      expect(
        screen.getByTestId("athena-agent-provisional-text"),
      ).toHaveAttribute("data-reveal", "settled");
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
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: long(40), truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      expect(paintedText()).toBe(long(40));
      expect(wipedWords()).toHaveLength(0);
      rerender(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: { text: long(400), truncated: false, draftOrdinal: 1 },
          })}
        />,
      );
      expect(paintedText()).toBe(long(400));
      expect(wipedWords()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stream reveal of the committed answer", () => {
  const fakeFrames = () =>
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
        "Date",
      ],
    });
  const answerText =
    "Open lanes: two [citation:v1.1.1.abc] and the automation log is behind. ".repeat(
      8,
    );
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
  const paintedAnswer = () =>
    screen.getByTestId("athena-agent-answer-text").textContent ?? "";
  const wipedWords = () =>
    screen
      .getByTestId("athena-agent-answer-text")
      .querySelectorAll(".athena-agent-wipe-word");
  const frames = (count: number) => {
    for (let frame = 0; frame < count; frame += 1) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
  };

  it("reveals an answer that lands while the turn is on screen without replaying the live ink wipe", () => {
    fakeFrames();
    try {
      const { rerender } = render(
        <PanelHarness
          run={draftRun("streaming", {
            provisional: {
              text: "Checking the lanes.",
              truncated: false,
              draftOrdinal: 1,
            },
          })}
        />,
      );
      frames(15);
      rerender(<PanelHarness run={answered()} />);
      const lengths: number[] = [paintedAnswer().length];
      expect(lengths[0]).toBeLessThan(answerText.length);
      for (let frame = 0; frame < 10; frame += 1) {
        frames(1);
        const painted = paintedAnswer();
        lengths.push(painted.length);
        expect((painted.match(/\[/g) ?? []).length).toBe(
          (painted.match(/\]/g) ?? []).length,
        );
        // The model has stopped running, so the committed answer does not
        // replay the live narration wipe.
        expect(wipedWords()).toHaveLength(0);
      }
      for (let index = 1; index < lengths.length; index += 1) {
        expect(lengths[index]).toBeGreaterThanOrEqual(lengths[index - 1]!);
      }
      expect(new Set(lengths).size).toBeGreaterThan(3);
      // A settled answer lands within 120 ms, rendered exactly as a mount would render it.
      expect(screen.getByTestId("athena-agent-answer-text")).toHaveAttribute(
        "data-reveal",
        "settled",
      );
      const settled = paintedAnswer();
      expect(wipedWords()).toHaveLength(0);
      frames(50);
      expect(wipedWords()).toHaveLength(0);
      expect(paintedAnswer()).toBe(settled);
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
      expect(screen.getByTestId("athena-agent-answer-text")).toHaveAttribute(
        "data-reveal",
        "settled",
      );
      expect(wipedWords()).toHaveLength(0);
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
        <PanelHarness
          run={draftRun("streaming", {
            provisional: {
              text: "Checking the lanes.",
              truncated: false,
              draftOrdinal: 1,
            },
          })}
        />,
      );
      rerender(<PanelHarness run={answered()} />);
      expect(paintedAnswer()).toBe(answerText);
      expect(wipedWords()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
