import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExpenseReportsView } from "./ExpenseReportsView";

const getActiveStoreMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("../../View", () => ({
  default: ({
    children,
  }: {
    children?: React.ReactNode;
    header?: React.ReactNode;
  }) => <div>{children}</div>,
}));

vi.mock("../../common/FadeIn", () => ({
  FadeIn: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock("../../common/PageHeader", () => ({
  NavigateBackButton: () => <button aria-label="Go back" type="button" />,
}));

vi.mock("../../base/table/data-table", () => ({
  GenericDataTable: ({
    data,
  }: {
    data: Array<{
      transactionNumber: string;
    }>;
  }) => (
    <div>
      {data.map((row) => (
        <span key={row.transactionNumber}>{row.transactionNumber}</span>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

describe("ExpenseReportsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
  });

  it("renders expense reports in the workspace frame with back navigation", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "expense-1",
        transactionNumber: "EXP-123456",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: Date.now(),
        notes: null,
      },
    ]);

    render(<ExpenseReportsView />);

    expect(
      screen.getByRole("heading", { name: "Expense Reports" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Point of sale")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
    expect(screen.getByText("EXP-123456")).toBeInTheDocument();
  });
});
