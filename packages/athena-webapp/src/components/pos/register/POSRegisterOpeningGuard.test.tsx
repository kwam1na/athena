import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POSRegisterOpeningGuard } from "./POSRegisterOpeningGuard";

const useQueryMock = vi.fn();
const getActiveStoreMock = vi.fn();

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

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the register when the store day has started", () => {
    useQueryMock.mockReturnValue({
      status: "started",
    });

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
  });

  it("shows a blocked state when the store day has not started", () => {
    useQueryMock.mockReturnValue({
      status: "ready",
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

  it("waits for the opening snapshot before rendering or redirecting", () => {
    useQueryMock.mockReturnValue(undefined);

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
  });
});
