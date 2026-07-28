import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  InventoryCostOverlayRecentRuns,
  InventoryCostOverlayRunLifecycleControls,
  InventoryCostOverlayWorkspaceContent,
  InventoryCostOverlayView,
  type InventoryCostOverlayRow,
  type InventoryCostOverlayRun,
} from "./InventoryCostOverlayView";

const mockedHooks = vi.hoisted(() => ({
  abandon: vi.fn(),
  apply: vi.fn(),
  blocker: vi.fn(),
  bulkUpdate: vi.fn(),
  create: vi.fn(),
  latest: undefined as unknown,
  navigate: vi.fn(),
  paginated: {
    loadMore: vi.fn(),
    results: [] as unknown[],
    status: "Exhausted",
  },
  prepare: vi.fn(),
  recent: undefined as unknown,
  refreshUndoPreview: vi.fn(),
  reopen: vi.fn(),
  retry: vi.fn(),
  run: undefined as unknown,
  search: {} as Record<string, unknown>,
  state: {} as Record<string, unknown>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  undo: vi.fn(),
  undoPreview: undefined as unknown,
  update: vi.fn(),
  useMutation: vi.fn(),
  usePaginatedQuery: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockedHooks.useMutation(...args),
  usePaginatedQuery: (...args: unknown[]) =>
    mockedHooks.usePaginatedQuery(...args),
  useQuery: (...args: unknown[]) => mockedHooks.useQuery(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockedHooks.navigate,
  useSearch: () => mockedHooks.search,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: () => mockedHooks.state,
}));

vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => vi.fn(),
}));

vi.mock("@/lib/app-messages", () => ({
  useAppActionBlocker: (args: unknown) => mockedHooks.blocker(args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => mockedHooks.toastError(message),
    success: (message: string) => mockedHooks.toastSuccess(message),
  },
}));

const baseRun: InventoryCostOverlayRun = {
  _id: "overlay-run" as InventoryCostOverlayRun["_id"],
  currencyCode: "GHS",
  decisionRevision: 2,
  eligibleRowCount: 2,
  reviewVersionNumber: 7,
  selectedColumn: { kind: "csv", label: "Wholesale cost", ordinal: 1 },
  selectedRowCount: 1,
  status: "ready",
  totalRowCount: 3,
};

const rows: InventoryCostOverlayRow[] = [
  {
    _id: "row-1" as InventoryCostOverlayRow["_id"],
    costOutcome: "valid",
    currentUnitCostMinor: undefined,
    decision: "selected_missing_cost",
    eligibility: "eligible",
    lifecycle: "provisional",
    normalizedCostMinor: 1250,
    productName: "Straight bob",
    rowOrdinal: 0,
    sku: "BOB-12",
    sourceRawValue: "12.50",
    sourceRowKey: "source-1",
  },
  {
    _id: "row-2" as InventoryCostOverlayRow["_id"],
    costOutcome: "invalid_syntax",
    decision: "ineligible",
    eligibility: "ineligible",
    eligibilityReason: "The selected cell is not a supported amount.",
    lifecycle: "trusted",
    productName: "Deep wave",
    rowOrdinal: 1,
    sourceRawValue: "n/a",
    sourceRowKey: "source-2",
  },
];

beforeEach(() => {
  window.scrollTo = vi.fn();
  for (const mock of [
    mockedHooks.abandon,
    mockedHooks.apply,
    mockedHooks.blocker,
    mockedHooks.bulkUpdate,
    mockedHooks.create,
    mockedHooks.navigate,
    mockedHooks.paginated.loadMore,
    mockedHooks.prepare,
    mockedHooks.refreshUndoPreview,
    mockedHooks.reopen,
    mockedHooks.retry,
    mockedHooks.toastError,
    mockedHooks.toastSuccess,
    mockedHooks.undo,
    mockedHooks.update,
    mockedHooks.useMutation,
    mockedHooks.usePaginatedQuery,
    mockedHooks.useQuery,
  ]) {
    mock.mockReset();
  }
  mockedHooks.search = {};
  mockedHooks.state = {
    activeStore: { _id: "store-1" },
    canQueryProtectedData: true,
    hasFullAdminAccess: true,
    isAuthenticated: true,
    isLoadingAccess: false,
  };
  mockedHooks.latest = {
    columns: [
      {
        id: "csv:cost:1",
        label: "Cost",
        normalizedKey: "cost",
        ordinal: 1,
        sampleValues: ["12.50", "n/a"],
        sampleValidity: { invalid: 1, valid: 1 },
        sourcePath: "$[2]",
      },
    ],
    descriptorStatus: "available",
    fileName: "legacy.csv",
    reviewVersionId: "review-1",
    rowCount: 2,
    sourceFormat: "csv",
    sourceProjectionVersion: 1,
    versionNumber: 7,
  };
  mockedHooks.recent = [];
  mockedHooks.run = undefined;
  mockedHooks.undoPreview = undefined;
  mockedHooks.paginated = {
    loadMore: vi.fn(),
    results: rows,
    status: "Exhausted",
  };
  mockedHooks.create.mockResolvedValue({ runId: "run-created" });
  mockedHooks.bulkUpdate.mockResolvedValue({
    status: "completed",
    updatedCount: 2,
  });
  mockedHooks.refreshUndoPreview.mockResolvedValue({ status: "processing" });
  for (const mutation of [
    mockedHooks.update,
    mockedHooks.prepare,
    mockedHooks.apply,
    mockedHooks.undo,
    mockedHooks.retry,
    mockedHooks.reopen,
    mockedHooks.abandon,
  ]) {
    mutation.mockResolvedValue({});
  }
  mockedHooks.useQuery.mockImplementation((_reference, args) => {
    if (args === "skip") return undefined;
    const callIndex = (mockedHooks.useQuery.mock.calls.length - 1) % 4;
    return callIndex === 0
      ? mockedHooks.latest
      : callIndex === 1
        ? mockedHooks.recent
        : callIndex === 2
          ? mockedHooks.run
          : mockedHooks.undoPreview;
  });
  mockedHooks.usePaginatedQuery.mockImplementation(() => mockedHooks.paginated);
  const mutations = [
    mockedHooks.create,
    mockedHooks.update,
    mockedHooks.bulkUpdate,
    mockedHooks.prepare,
    mockedHooks.apply,
    mockedHooks.undo,
    mockedHooks.refreshUndoPreview,
    mockedHooks.retry,
    mockedHooks.reopen,
    mockedHooks.abandon,
  ];
  mockedHooks.useMutation.mockImplementation(
    () =>
      mutations[
        (mockedHooks.useMutation.mock.calls.length - 1) % mutations.length
      ],
  );
});

function renderWorkspace(run: InventoryCostOverlayRun, overlayRows = rows) {
  render(
    <InventoryCostOverlayWorkspaceContent
      isLoadingRows={false}
      isPreparing={false}
      onDecisionChange={vi.fn()}
      onLoadMore={vi.fn()}
      onPrepare={vi.fn()}
      rows={overlayRows}
      run={run}
    />,
  );
}

describe("InventoryCostOverlayWorkspaceContent", () => {
  it("shows durable row evidence and explicit review guidance", () => {
    renderWorkspace(baseRun);

    expect(
      screen.getByRole("heading", { name: "Cost overlay review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Review version 7 · Wholesale cost"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Straight bob")).toHaveLength(2);
    expect(screen.getAllByText("Provisional")).toHaveLength(2);
    expect(screen.getAllByText("Source: 12.50")).toHaveLength(2);
    expect(screen.getAllByText("Source cost not recognized")).toHaveLength(2);
    expect(
      screen.getByText(
        "Missing costs are selected by default. A known Athena cost requires an explicit overwrite decision.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Prepare impact" }),
    ).toBeEnabled();
    expect(screen.getByTestId("cost-overlay-mobile-cards")).toHaveClass(
      "md:hidden",
    );
    expect(screen.getByTestId("cost-overlay-desktop-table")).toHaveClass(
      "hidden",
      "md:block",
    );
  });

  it("shows the sealed financial checkpoint before apply", () => {
    renderWorkspace({
      ...baseRun,
      impactAfterMinor: 18_000,
      impactBeforeMinor: 15_000,
      selectedRowCount: 2,
      status: "prepared",
    });

    expect(screen.getByText("Prepared")).toBeInTheDocument();
    expect(screen.getByText("On-hand value before")).toBeInTheDocument();
    expect(screen.getByText("On-hand value after")).toBeInTheDocument();
    expect(screen.getByText("Valuation change")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Prepare impact" }),
    ).not.toBeInTheDocument();
  });

  it("keeps isolated exceptions visible after apply", () => {
    renderWorkspace({
      ...baseRun,
      applyExceptionCount: 1,
      status: "applied_with_exceptions",
    });

    expect(screen.getByText("Applied with exceptions")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Safe rows were applied. Review the rows Athena skipped.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Exceptions")).toBeInTheDocument();
  });

  it("explains a deterministic source-change abandonment calmly", () => {
    renderWorkspace({
      ...baseRun,
      constructionFailureReason: "construction_prefix_changed",
      status: "abandoned",
    });

    expect(
      screen.getByText(
        "The saved source changed during recovery. Start a new overlay from the current review.",
      ),
    ).toBeInTheDocument();
  });
});

describe("InventoryCostOverlayRecentRuns", () => {
  it("offers resumable and completed runs for direct inspection", () => {
    const onOpenRun = vi.fn();
    render(
      <InventoryCostOverlayRecentRuns
        onOpenRun={onOpenRun}
        runs={[
          baseRun,
          {
            ...baseRun,
            _id: "applied-run" as InventoryCostOverlayRun["_id"],
            status: "applied",
          },
          {
            ...baseRun,
            _id: "abandoned-run" as InventoryCostOverlayRun["_id"],
            constructionFailureReason: "construction_prefix_changed",
            status: "abandoned",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Recent cost overlays" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume run" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Inspect run" })).toHaveLength(
      2,
    );
    expect(
      screen.getByText("Saved source changed during recovery."),
    ).toBeInTheDocument();
  });
});

describe("InventoryCostOverlayRunLifecycleControls", () => {
  it("allows a prepared run to reopen decisions or be abandoned", () => {
    render(
      <InventoryCostOverlayRunLifecycleControls
        bulkDecisionStatus={undefined}
        isAbandoning={false}
        isReopening={false}
        onAbandon={vi.fn()}
        onReopen={vi.fn()}
        status="prepared"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reopen decisions" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Abandon run" })).toBeEnabled();
  });

  it("keeps abandon visible but disabled while bulk decisions finish", () => {
    render(
      <InventoryCostOverlayRunLifecycleControls
        bulkDecisionStatus="processing"
        isAbandoning={false}
        isReopening={false}
        onAbandon={vi.fn()}
        onReopen={vi.fn()}
        status="ready"
      />,
    );

    expect(screen.getByRole("button", { name: "Abandon run" })).toBeDisabled();
    expect(
      screen.getByText(
        "Matching rows are still updating. Wait for the update to finish before abandoning this run.",
      ),
    ).toBeInTheDocument();
  });
});

describe("InventoryCostOverlayView behavior", () => {
  it("gates cost queries until full-admin access resolves", () => {
    mockedHooks.state = {
      activeStore: { _id: "store-1" },
      canQueryProtectedData: false,
      hasFullAdminAccess: false,
      isAuthenticated: true,
      isLoadingAccess: false,
    };

    render(<InventoryCostOverlayView />);

    expect(
      mockedHooks.useQuery.mock.calls.every((call) => call[1] === "skip"),
    ).toBe(true);
    expect(mockedHooks.usePaginatedQuery.mock.calls[0]?.[1]).toBe("skip");
  });

  it("creates from visible source evidence and restores the new run route", async () => {
    const user = userEvent.setup();
    render(<InventoryCostOverlayView />);

    await user.click(screen.getByRole("combobox", { name: "Cost column" }));
    await user.click(screen.getByRole("option", { name: "Cost" }));
    expect(screen.getByText("12.50")).toBeInTheDocument();
    expect(
      screen.getByText("Source values: 1 valid · 1 needs review"),
    ).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    await user.click(
      screen.getByLabelText(
        "I confirm this column represents unit cost in the store currency.",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: /Build cost overlay/ }),
    );

    await waitFor(() => expect(mockedHooks.create).toHaveBeenCalledTimes(1));
    const searchUpdater = mockedHooks.navigate.mock.calls.at(-1)?.[0]?.search;
    expect(searchUpdater({})).toMatchObject({ run: "run-created" });
  });

  it("hydrates an addressed run and sends search, filter, and page depth to the server", () => {
    mockedHooks.search = {
      run: "overlay-run",
      filter: "eligible",
      page: 3,
      q: " bob ",
    };
    mockedHooks.run = baseRun;
    render(<InventoryCostOverlayView />);

    expect(mockedHooks.useQuery.mock.calls[2]?.[1]).toEqual({
      runId: "overlay-run",
      storeId: "store-1",
    });
    expect(mockedHooks.usePaginatedQuery).toHaveBeenCalledWith(
      expect.anything(),
      {
        filter: "eligible",
        search: "bob",
        runId: "overlay-run",
        storeId: "store-1",
      },
      { initialNumItems: 50 },
    );
    expect(
      screen.getByRole("textbox", { name: "Search overlay rows" }),
    ).toHaveValue(" bob ");
  });

  it("does not cast a malformed URL run id into typed run queries", () => {
    mockedHooks.search = { run: "not-a-convex-id" };
    mockedHooks.run = null;

    render(<InventoryCostOverlayView />);

    expect(mockedHooks.useQuery.mock.calls[2]?.[1]).toEqual({
      runId: "not-a-convex-id",
      storeId: "store-1",
    });
    expect(mockedHooks.usePaginatedQuery).toHaveBeenCalledWith(
      expect.anything(),
      "skip",
      { initialNumItems: 50 },
    );
  });

  it("updates the restored page when more server rows are loaded", async () => {
    const user = userEvent.setup();
    mockedHooks.search = { run: "overlay-run", page: 2 };
    mockedHooks.run = baseRun;
    mockedHooks.paginated.results = Array.from({ length: 100 }, (_, index) => ({
      ...rows[0],
      _id: `row-${index}`,
    }));
    mockedHooks.paginated.status = "CanLoadMore";
    render(<InventoryCostOverlayView />);

    await user.click(screen.getByRole("button", { name: "Load more rows" }));

    expect(mockedHooks.paginated.loadMore).toHaveBeenCalledWith(50);
    const searchUpdater = mockedHooks.navigate.mock.calls.at(-1)?.[0]?.search;
    expect(searchUpdater({ run: "overlay-run", page: 2 })).toEqual({
      run: "overlay-run",
      page: 3,
    });
  });

  it("restores deeper URL pages through bounded server loads", async () => {
    mockedHooks.search = { run: "overlay-run", page: 3 };
    mockedHooks.run = baseRun;
    mockedHooks.paginated.results = Array.from({ length: 50 }, (_, index) => ({
      ...rows[0],
      _id: `restored-row-${index}`,
    }));
    mockedHooks.paginated.status = "CanLoadMore";
    const { rerender } = render(<InventoryCostOverlayView />);

    await waitFor(() =>
      expect(mockedHooks.paginated.loadMore).toHaveBeenCalledWith(50),
    );
    mockedHooks.paginated.results = Array.from({ length: 100 }, (_, index) => ({
      ...rows[0],
      _id: `restored-row-${index}`,
    }));
    rerender(<InventoryCostOverlayView />);

    await waitFor(() =>
      expect(mockedHooks.paginated.loadMore).toHaveBeenCalledTimes(2),
    );
  });

  it("clamps huge page input and renders only the visible 50-row slice", async () => {
    mockedHooks.search = { run: "overlay-run", page: 999_999 };
    mockedHooks.run = baseRun;
    mockedHooks.paginated.results = Array.from({ length: 500 }, (_, index) => ({
      ...rows[0],
      _id: `bounded-row-${index}`,
      productName: `Bounded product ${index}`,
      rowOrdinal: index,
    }));
    mockedHooks.paginated.status = "CanLoadMore";
    render(<InventoryCostOverlayView />);

    expect(mockedHooks.paginated.loadMore).not.toHaveBeenCalled();
    expect(screen.queryByText("Bounded product 448")).not.toBeInTheDocument();
    expect(screen.getAllByText("Bounded product 450")).toHaveLength(2);
    expect(screen.getAllByText("Bounded product 499")).toHaveLength(2);
    expect(screen.queryByText("Bounded product 500")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Bounded product /)).toHaveLength(100);
  });

  it("sends matching bulk decisions through one durable server request", async () => {
    const user = userEvent.setup();
    mockedHooks.search = {
      run: "overlay-run",
      filter: "eligible",
      q: "bob",
    };
    mockedHooks.run = baseRun;
    render(<InventoryCostOverlayView />);

    await user.click(screen.getByRole("button", { name: "Clear matching" }));

    await waitFor(() =>
      expect(mockedHooks.bulkUpdate).toHaveBeenCalledWith({
        decision: "not_selected",
        filter: "eligible",
        requestKey: expect.stringMatching(/^inventory-cost-overlay:/),
        runId: "overlay-run",
        search: "bob",
        storeId: "store-1",
      }),
    );
    expect(mockedHooks.update).not.toHaveBeenCalled();
  });

  it("requires acknowledgement and shows the largest sealed SKU changes", async () => {
    const user = userEvent.setup();
    mockedHooks.search = { run: "overlay-run" };
    mockedHooks.run = {
      ...baseRun,
      impactAfterMinor: 18_000,
      impactBeforeMinor: 15_000,
      largestImpacts: [
        {
          afterMinor: 5_000,
          beforeMinor: 2_000,
          deltaMinor: 3_000,
          productName: "Straight bob",
          sku: "BOB-12",
        },
      ],
      manifestDigest: "manifest",
      status: "prepared",
    };
    render(<InventoryCostOverlayView />);

    expect(screen.getByText("Largest SKU-level changes")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply selected costs" });
    expect(apply).toBeDisabled();
    await user.click(
      screen.getByLabelText(
        "I reviewed the sealed row count and valuation impact.",
      ),
    );
    await user.click(apply);
    await waitFor(() =>
      expect(mockedHooks.apply).toHaveBeenCalledWith(
        expect.objectContaining({ expectedManifestDigest: "manifest" }),
      ),
    );
  });

  it("only offers retry for backend-classified interrupted work", async () => {
    const user = userEvent.setup();
    mockedHooks.search = { run: "overlay-run" };
    mockedHooks.run = { ...baseRun, retryableWork: null, status: "preparing" };
    const { rerender } = render(<InventoryCostOverlayView />);
    expect(screen.queryByRole("button", { name: "Resume work" })).toBeNull();

    mockedHooks.run = {
      ...baseRun,
      retryableWork: "preparation",
      status: "preparing",
    };
    rerender(<InventoryCostOverlayView />);
    await user.click(screen.getByRole("button", { name: "Resume work" }));
    expect(mockedHooks.retry).toHaveBeenCalledWith({
      runId: "overlay-run",
      storeId: "store-1",
    });
  });

  it("resumes stale bulk decisions without retaining the bulk request key", async () => {
    const user = userEvent.setup();
    mockedHooks.search = { run: "overlay-run" };
    mockedHooks.run = {
      ...baseRun,
      bulkDecisionStatus: "processing",
      retryableWork: "bulk decision",
      status: "ready",
    };
    render(<InventoryCostOverlayView />);

    expect(
      screen.getByText(/this bulk decision step as interrupted/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume work" }));
    expect(mockedHooks.retry).toHaveBeenCalledWith({
      runId: "overlay-run",
      storeId: "store-1",
    });
  });

  it("reopens or abandons an unconfirmed run", async () => {
    const user = userEvent.setup();
    mockedHooks.search = { run: "overlay-run" };
    mockedHooks.run = {
      ...baseRun,
      manifestDigest: "manifest",
      status: "prepared",
    };
    render(<InventoryCostOverlayView />);

    await user.click(screen.getByRole("button", { name: "Reopen decisions" }));
    expect(mockedHooks.reopen).toHaveBeenCalledWith({
      runId: "overlay-run",
      storeId: "store-1",
    });
    await user.click(screen.getByRole("button", { name: "Abandon run" }));
    expect(mockedHooks.abandon).toHaveBeenCalledWith({
      runId: "overlay-run",
      storeId: "store-1",
    });
  });

  it("summarizes compensable undo scope and requires acknowledgement", async () => {
    const user = userEvent.setup();
    mockedHooks.search = { run: "overlay-run" };
    mockedHooks.run = {
      ...baseRun,
      appliedRowCount: 4,
      status: "applied_with_exceptions",
    };
    mockedHooks.undoPreview = {
      compensableCount: 7,
      generatedAt: 123,
      reasons: [{ count: 2, reason: "current_cost_changed" }],
      restoredCount: 3,
      staleCount: 2,
      status: "ready",
      totalAppliedCount: 12,
    };
    const { rerender } = render(<InventoryCostOverlayView />);

    await waitFor(() =>
      expect(mockedHooks.refreshUndoPreview).toHaveBeenCalledWith({
        requestKey: expect.stringMatching(/^inventory-cost-overlay:/),
        runId: "overlay-run",
        storeId: "store-1",
      }),
    );
    mockedHooks.undoPreview = {
      ...(mockedHooks.undoPreview as Record<string, unknown>),
      status: "processing",
    };
    rerender(<InventoryCostOverlayView />);
    mockedHooks.undoPreview = {
      ...(mockedHooks.undoPreview as Record<string, unknown>),
      status: "ready",
    };
    rerender(<InventoryCostOverlayView />);
    expect(screen.getByText("Compensable")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("Restored")).toBeInTheDocument();
    expect(screen.getByText("Compensable").parentElement).toHaveTextContent(
      "7Compensable",
    );
    expect(screen.getByText("Stale").parentElement).toHaveTextContent("2Stale");
    expect(screen.getByText("Restored").parentElement).toHaveTextContent(
      "3Restored",
    );
    const undo = screen.getByRole("button", { name: "Undo safe rows" });
    expect(undo).toBeDisabled();
    await user.click(
      screen.getByLabelText(
        "I understand normal activity can reduce the compensable scope.",
      ),
    );
    await user.click(undo);
    expect(mockedHooks.undo).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "overlay-run",
        storeId: "store-1",
      }),
    );
  });

  it("normalizes mutation failures without discarding the run", async () => {
    const user = userEvent.setup();
    mockedHooks.search = { run: "overlay-run" };
    mockedHooks.run = baseRun;
    mockedHooks.prepare.mockRejectedValueOnce(new Error("backend detail"));
    render(<InventoryCostOverlayView />);

    await user.click(screen.getByRole("button", { name: "Prepare impact" }));
    await waitFor(() =>
      expect(mockedHooks.toastError).toHaveBeenCalledWith(
        "Cost overlay could not be prepared. Review the current selections and try again.",
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Cost overlay review" }),
    ).toBeInTheDocument();
  });
});
