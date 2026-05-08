import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POSSessionsView } from "./POSSessionsView";

const useParamsMock = vi.fn();
const useProtectedAdminPageStateMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    search?: unknown;
    to?: string;
  }) => (
    <a href={to ?? "#"}>
      {children}
    </a>
  ),
  useParams: () => useParamsMock(),
  useSearch: () => ({ o: "%2Fwigclub%2Fstore%2Fwigclub%2Fpos" }),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: () => useProtectedAdminPageStateMock(),
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

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => vi.fn(),
}));

vi.mock("@/components/base/table/data-table", () => ({
  GenericDataTable: ({
    columns,
    data,
  }: {
    columns: Array<{
      cell?: (args: { row: { original: unknown } }) => React.ReactNode;
    }>;
    data: Array<{ _id: string }>;
  }) => (
    <div>
      {data.map((row) => (
        <div data-testid={`session-row-${row._id}`} key={row._id}>
          {columns.map((column, index) => (
            <div key={index}>
              {column.cell?.({ row: { original: row } }) ?? null}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/states/no-permission/NoPermissionView", () => ({
  NoPermissionView: () => <div>No permission</div>,
}));

vi.mock("@/components/states/signed-out/ProtectedAdminSignInView", () => ({
  ProtectedAdminSignInView: ({ description }: { description: string }) => (
    <div>
      <h1>Sign in required</h1>
      <p>{description}</p>
    </div>
  ),
}));

describe("POSSessionsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useParamsMock.mockReturnValue({
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
    });
    useProtectedAdminPageStateMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
      canQueryProtectedData: true,
      hasFullAdminAccess: true,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
  });

  it("shows a layout skeleton and skips protected query args while access loads", () => {
    useProtectedAdminPageStateMock.mockReturnValue({
      activeStore: null,
      canQueryProtectedData: false,
      hasFullAdminAccess: false,
      isAuthenticated: false,
      isLoadingAccess: true,
    });

    render(<POSSessionsView />);

    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  it("renders the signed-out protected state", () => {
    useProtectedAdminPageStateMock.mockReturnValue({
      activeStore: null,
      canQueryProtectedData: false,
      hasFullAdminAccess: false,
      isAuthenticated: false,
      isLoadingAccess: false,
    });

    render(<POSSessionsView />);

    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your Athena session needs to reconnect before POS sessions can load protected operations data",
      ),
    ).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  it("renders the no-permission protected state", () => {
    useProtectedAdminPageStateMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
      canQueryProtectedData: false,
      hasFullAdminAccess: false,
      isAuthenticated: true,
      isLoadingAccess: false,
    });

    render(<POSSessionsView />);

    expect(screen.getByText("No permission")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  it("renders the empty operations state", () => {
    useQueryMock.mockReturnValue({ sessions: [] });

    render(<POSSessionsView />);

    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
    expect(screen.getByText("No active POS sessions")).toBeInTheDocument();
    expect(screen.getByText("0 sessions")).toBeInTheDocument();
  });

  it("renders active and held session rows with operational details", () => {
    useQueryMock.mockReturnValue({
      rows: [
        {
          sessionId: "session-1",
          activeHolds: {
            holdCount: 2,
            totalQuantity: 3,
            details: [
              { productName: "Body Wave", quantity: 2 },
              { sku: "SKU-2", quantity: 1 },
            ],
          },
          cart: {
            totalQuantity: 3,
            total: 12_500,
          },
          customer: {
            name: "Ama Serwa",
          },
          expiresAt: Date.now() + 60_000,
          operator: {
            name: "Ada L.",
          },
          register: {
            registerNumber: "2",
          },
          sessionNumber: "SES-001",
          status: "active",
          terminal: {
            displayName: "Front terminal",
          },
          workflowTrace: {
            traceId: "pos_session:ses-001",
          },
        },
        {
          sessionId: "session-2",
          activeHolds: {
            holdCount: 0,
            totalQuantity: 0,
            details: [],
          },
          cart: {
            totalQuantity: 0,
            total: 0,
          },
          expiresAt: null,
          status: "held",
        },
      ],
    });

    render(<POSSessionsView />);

    expect(screen.getByText("Active session operations")).toBeInTheDocument();
    expect(screen.getByText("SES-001")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Held").length).toBeGreaterThan(0);
    expect(screen.getByText("Ada L.")).toBeInTheDocument();
    expect(screen.getByText("Front terminal / Register 2")).toBeInTheDocument();
    expect(screen.getByText("Ama Serwa")).toBeInTheDocument();
    expect(screen.getByText("3 items")).toBeInTheDocument();
    expect(screen.getAllByText("GH₵125").length).toBeGreaterThan(0);
    expect(screen.getByText("2 holds")).toBeInTheDocument();
    expect(screen.getByText("3 reserved: Body Wave, SKU-2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workflow trace" })).toBeInTheDocument();
    expect(screen.getByText("Walk-in customer")).toBeInTheDocument();
    expect(screen.getByText("Operator not recorded")).toBeInTheDocument();
    expect(screen.getByText("Terminal not recorded")).toBeInTheDocument();
  });

  it("omits row action controls from the sessions table", () => {
    useQueryMock.mockReturnValue({
      sessions: [
        {
          sessionId: "session-1",
          cartItemCount: 1,
          sessionNumber: "SES-001",
          status: "active",
          total: 1000,
        },
        {
          _id: "session-2",
          cartItemCount: 1,
          sessionNumber: "SES-002",
          status: "held",
          total: 2000,
        },
      ],
    });

    render(<POSSessionsView />);

    expect(screen.getByText("SES-001")).toBeInTheDocument();
    expect(screen.queryByText("Action")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /expire pos session/i,
      }),
    ).not.toBeInTheDocument();
  });
});
