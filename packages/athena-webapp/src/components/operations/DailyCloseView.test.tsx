import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DailyCloseView,
  DailyCloseViewContent,
  type DailyCloseSnapshot,
} from "./DailyCloseView";
import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";

const mockedHooks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedApi = vi.hoisted(() => ({
  completeDailyClose: "completeDailyClose",
  getDailyCloseSnapshot: "getDailyCloseSnapshot",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string>;
    to?: string;
  }) => {
    const path = to
      ? Object.entries(params ?? {}).reduce(
          (currentPath, [key, value]) =>
            currentPath.replace(`$${key}`, String(value)),
          to,
        )
      : "#";
    const searchParams = search ? `?${new URLSearchParams(search)}` : "";

    return (
      <a href={`${path}${searchParams}`} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "osu",
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
      dailyClose: mockedApi,
    },
  },
}));

const baseSummary = {
  cashDeposited: 45000,
  cashExpected: 45000,
  carryForwardCount: 0,
  expenseTotal: 12500,
  registerCount: 2,
  staffCount: 3,
  totalSales: 125500,
  transactionCount: 14,
  varianceTotal: 0,
};

const readySnapshot: DailyCloseSnapshot = {
  blockers: [],
  carryForwardItems: [],
  completedClose: null,
  operatingDate: "2026-05-07",
  readyItems: [
    {
      description: "2 register sessions reconciled.",
      id: "ready-1",
      statusLabel: "Ready",
      title: "Register closeouts complete",
    },
  ],
  reviewItems: [
    {
      description: "Reviewed by manager before close.",
      id: "review-1",
      statusLabel: "Reviewed",
      title: "Small cash variance reviewed",
    },
  ],
  status: "ready",
  summary: baseSummary,
};

const blockedSnapshot: DailyCloseSnapshot = {
  ...readySnapshot,
  blockers: [
    {
      description: "Close Register 1 before completing Daily Close.",
      id: "blocker-1",
      link: {
        href: "/wigclub/store/osu/cash-controls/registers/session-1",
        label: "View drawer",
      },
      statusLabel: "Blocks close",
      title: "Open drawer at Register 1",
    },
  ],
  readyItems: [],
  status: "blocked",
};

function renderContent(
  snapshot: DailyCloseSnapshot | undefined,
  overrides: Partial<
    React.ComponentProps<typeof DailyCloseViewContent>
  > = {},
) {
  return render(
    <DailyCloseViewContent
      currency="GHS"
      hasFullAdminAccess
      isAuthenticated
      isCompleting={false}
      isLoadingAccess={false}
      isLoadingSnapshot={snapshot === undefined}
      onComplete={vi.fn(async () => ok({ closeId: "close-1" }))}
      orgUrlSlug="wigclub"
      snapshot={snapshot}
      storeId={"store-1" as Id<"store">}
      storeUrlSlug="osu"
      {...overrides}
    />,
  );
}

describe("DailyCloseViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
  });

  it("renders a skeleton matching the workspace structure while loading", () => {
    renderContent(undefined);

    expect(screen.getByText("Daily Close")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Loading daily close workspace"),
    ).toBeInTheDocument();
  });

  it("shows blocked items, links to source workflows, and disables completion", () => {
    renderContent(blockedSnapshot);

    expect(screen.getByText("Open drawer at Register 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view drawer/i })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/cash-controls/registers/session-1",
    );
    expect(
      screen.getByRole("button", { name: /complete daily close/i }),
    ).toBeDisabled();
  });

  it("shows ready summary totals and enables completion", () => {
    renderContent(readySnapshot);

    expect(screen.getByText("Ready to close")).toBeInTheDocument();
    expect(screen.getByText("14 transactions")).toBeInTheDocument();
    expect(screen.getByText("Register closeouts complete")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /complete daily close/i }),
    ).toBeEnabled();
  });

  it("keeps review context visible in the ready state", () => {
    renderContent(readySnapshot);

    const reviewSection = screen.getByRole("region", {
      name: /review before close/i,
    });

    expect(
      within(reviewSection).getByText("Small cash variance reviewed"),
    ).toBeInTheDocument();
    expect(within(reviewSection).getByText("Reviewed")).toBeInTheDocument();
  });

  it("includes selected carry-forward items in completion args", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn(async () => ok({ closeId: "close-1" }));
    const snapshot: DailyCloseSnapshot = {
      ...readySnapshot,
      carryForwardItems: [
        {
          description: "Check missing receipt during opening.",
          id: "carry-1",
          statusLabel: "Carry forward",
          title: "Receipt follow-up",
        },
      ],
      status: "carry_forward",
      summary: {
        ...baseSummary,
        carryForwardCount: 1,
      },
    };

    renderContent(snapshot, { onComplete });

    await user.click(
      screen.getByRole("button", { name: /complete daily close/i }),
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        carryForwardWorkItemIds: ["carry-1"],
        notes: "",
        operatingDate: "2026-05-07",
        reviewedItemKeys: ["review-1"],
      });
    });
  });

  it("renders command-result user errors inline with operator-safe copy", async () => {
    const user = userEvent.setup();

    renderContent(readySnapshot, {
      onComplete: vi.fn(async () =>
        userError({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      ),
    });

    await user.click(
      screen.getByRole("button", { name: /complete daily close/i }),
    );

    expect(
      await screen.findByText(
        "Drawer closed. Open the drawer before completing this sale.",
      ),
    ).toBeInTheDocument();
  });

  it("renders completed Daily Close summary after reload", () => {
    renderContent({
      ...readySnapshot,
      completedClose: {
        completedAt: Date.UTC(2026, 4, 7, 23, 15),
        completedByStaffName: "Ama Mensah",
        notes: "Clean close.",
      },
      status: "completed",
    });

    expect(screen.getByText("Daily close completed")).toBeInTheDocument();
    expect(screen.getByText(/Ama Mensah/)).toBeInTheDocument();
    expect(screen.getByText("Clean close.")).toBeInTheDocument();
  });

  it("renders protected access states consistently with operations pages", () => {
    renderContent(readySnapshot, { hasFullAdminAccess: false });

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });
});

describe("DailyCloseView", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
      canQueryProtectedData: true,
      hasFullAdminAccess: true,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
    mockedHooks.useQuery.mockReturnValue(readySnapshot);
    mockedHooks.useMutation.mockReturnValue(vi.fn(async () => ok({})));
  });

  it("queries Daily Close with the active store and route params", () => {
    render(<DailyCloseView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyCloseSnapshot,
      { operatingDate: expect.any(String), storeId: "store-1" },
    );
    expect(screen.getByText("Daily Close")).toBeInTheDocument();
  });
});
