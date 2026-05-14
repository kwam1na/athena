import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POSRegisterOpeningGuard } from "./POSRegisterOpeningGuard";

const useQueryMock = vi.fn();
const getActiveStoreMock = vi.fn();
const useLocalPosEntryContextMock = vi.fn();
const useLocalPosReadinessMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    to,
  }: {
    children?: React.ReactNode;
    className?: string;
    params?: Record<string, string>;
    to: string;
  }) => {
    const href = to
      .replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
      .replace("$storeUrlSlug", params?.storeUrlSlug ?? "");

    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  },
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "wigclub",
  }),
}));

vi.mock("@/components/View", () => ({
  default: ({
    children,
    header,
  }: {
    children?: React.ReactNode;
    header?: React.ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock("@/components/common/FadeIn", () => ({
  FadeIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
  }: {
    leadingContent?: React.ReactNode;
  }) => <div>{leadingContent}</div>,
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("@/lib/pos/infrastructure/local/localPosEntryContext", () => ({
  useLocalPosEntryContext: () => useLocalPosEntryContextMock(),
}));

vi.mock("@/lib/pos/infrastructure/local/localPosReadiness", () => ({
  useLocalPosReadiness: () => useLocalPosReadinessMock(),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
      dailyClose: {
        getDailyCloseSnapshot: "getDailyCloseSnapshot",
      },
      dailyOpening: {
        getDailyOpeningSnapshot: "getDailyOpeningSnapshot",
      },
    },
  },
}));

describe("POSRegisterOpeningGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 9, 12));
    vi.clearAllMocks();
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
      },
      isLoadingStores: false,
    });
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
      storeId: "store-1",
      terminalSeed: null,
      source: "live",
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "ready",
      source: "live",
      storeDayStatus: "started",
    });
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return { status: "ready" };
      }

      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the register when the store day has started", () => {
    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith(
      "getDailyOpeningSnapshot",
      expect.objectContaining({
        operatingDate: "2026-05-09",
        storeId: "store-1",
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      "getDailyCloseSnapshot",
      expect.objectContaining({
        operatingDate: "2026-05-09",
        storeId: "store-1",
      }),
    );
  });

  it("shows a blocked state when the store day has not started", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "ready" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return { status: "ready" };
      }

      return undefined;
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "not_started",
      message:
        "Store day not started. Complete Opening Handoff before starting sales.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Store day not started")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Opening Handoff needs to be completed before sales can begin. Ask a manager to start the store day.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Opening Handoff/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/operations/opening",
    );
  });

  it("directs the operator to EOD Review when the store day is closed", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return { status: "completed" };
      }

      return undefined;
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "closed",
      message:
        "Store day closed. Reopen the end of day review before entering POS.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Store day closed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The end of day review has already closed this operating day. Reopen the day from the end of day review before entering POS.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /EOD Review/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/operations/daily-close",
    );
  });

  it("allows POS when the active close was reopened and Opening Handoff is started", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return {
          existingClose: { lifecycleStatus: "reopened" },
          status: "completed",
        };
      }

      return undefined;
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "ready",
      source: "live",
      storeDayStatus: "reopened",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
    expect(screen.queryByText("Store day closed")).not.toBeInTheDocument();
  });

  it("renders the register from local readiness before the opening snapshot resolves", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyCloseSnapshot") {
        return { status: "ready" };
      }

      return undefined;
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
  });

  it("renders the register from local readiness before the close snapshot resolves", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      return undefined;
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
  });

  it("shows setup-required guidance when local authority is missing", () => {
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "missing_seed",
      message: "POS setup required. Connect this terminal before starting sales.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
    expect(screen.getByText("POS setup required")).toBeInTheDocument();
    expect(
      screen.getByText("POS setup required. Connect this terminal before starting sales."),
    ).toBeInTheDocument();
  });
});
