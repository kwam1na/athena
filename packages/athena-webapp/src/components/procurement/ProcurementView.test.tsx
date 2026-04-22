import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";
import {
  ProcurementView,
  ProcurementViewContent,
} from "./ProcurementView";

const mockedHooks = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useGetActiveStore: vi.fn(),
  usePermissions: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: mockedHooks.useConvexAuth,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: mockedHooks.useGetActiveStore,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: mockedHooks.usePermissions,
}));

const baseProps: React.ComponentProps<typeof ProcurementViewContent> = {
  activeVendorCount: 3,
  hasActiveStore: true,
  hasFullAdminAccess: true,
  isLoadingPermissions: false,
  isLoadingProcurement: false,
  purchaseOrders: [
    {
      _id: "po-1" as Id<"purchaseOrder">,
      expectedAt: 1_712_345_678_900,
      lineItemCount: 2,
      poNumber: "PO-001",
      status: "ordered" as const,
      totalUnits: 8,
    },
  ],
  recommendations: [
    {
      _id: "sku-1" as Id<"productSku">,
      guidance: "No active inbound replenishment is covering this SKU right now.",
      inventoryCount: 0,
      pendingPurchaseOrderCount: 0,
      pendingPurchaseOrderQuantity: 0,
      pendingPurchaseOrders: [],
      productName: "Closure Wig",
      quantityAvailable: 0,
      sku: "CW-18",
      status: "reorder_now" as const,
      suggestedOrderQuantity: 6,
    },
    {
      _id: "sku-2" as Id<"productSku">,
      guidance:
        "Active inbound purchase orders should cover this SKU once the remaining units are received.",
      inventoryCount: 1,
      nextExpectedAt: 1_712_345_678_900,
      pendingPurchaseOrderCount: 1,
      pendingPurchaseOrderQuantity: 6,
      pendingPurchaseOrders: [
        {
          expectedAt: 1_712_345_678_900,
          pendingQuantity: 6,
          poNumber: "PO-001",
          purchaseOrderId: "po-1" as Id<"purchaseOrder">,
          status: "ordered" as const,
        },
      ],
      productName: "Frontal Wig",
      quantityAvailable: 1,
      sku: "FW-20",
      status: "awaiting_receipt" as const,
      suggestedOrderQuantity: 0,
    },
    {
      _id: "sku-3" as Id<"productSku">,
      guidance:
        "On-hand units are still healthy, but most sellable stock is already committed.",
      inventoryCount: 7,
      pendingPurchaseOrderCount: 0,
      pendingPurchaseOrderQuantity: 0,
      pendingPurchaseOrders: [],
      productName: "Silk Press Kit",
      quantityAvailable: 1,
      sku: "SP-01",
      status: "availability_constrained" as const,
      suggestedOrderQuantity: 0,
    },
  ],
};

describe("ProcurementViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedHooks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mockedHooks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1" as Id<"store"> },
    });
    mockedHooks.usePermissions.mockReturnValue({
      canAccessOperations: () => true,
      isLoading: false,
    });
    mockedHooks.useQuery.mockReset();
  });

  it("renders the denied state for users without procurement access", () => {
    render(
      <ProcurementViewContent
        {...baseProps}
        hasFullAdminAccess={false}
      />
    );

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("filters recommendation rows by the selected procurement view", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    expect(screen.getByText("Closure Wig")).toBeInTheDocument();
    expect(screen.getByText("Frontal Wig")).toBeInTheDocument();
    expect(screen.getByText("Silk Press Kit")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reorder now/i }));

    expect(screen.getByText("Closure Wig")).toBeInTheDocument();
    expect(screen.queryByText("Frontal Wig")).not.toBeInTheDocument();
    expect(screen.queryByText("Silk Press Kit")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /inbound cover/i }));

    expect(screen.queryByText("Closure Wig")).not.toBeInTheDocument();
    expect(screen.getByText("Frontal Wig")).toBeInTheDocument();
  });

  it("renders active purchase-order context beside the recommendation summary", () => {
    render(<ProcurementViewContent {...baseProps} />);

    expect(screen.getByText("PO-001")).toBeInTheDocument();
    expect(screen.getByText("Active vendors")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Open procurement flow")).toBeInTheDocument();
  });

  it("calls out when additional active purchase orders are hidden from the sidebar summary", () => {
    render(
      <ProcurementViewContent
        {...baseProps}
        purchaseOrders={[
          ...baseProps.purchaseOrders,
          ...Array.from({ length: 6 }, (_, index) => ({
            _id: `po-${index + 2}` as Id<"purchaseOrder">,
            lineItemCount: 1,
            poNumber: `PO-00${index + 2}`,
            status: "approved" as const,
            totalUnits: index + 2,
          })),
        ]}
      />
    );

    expect(
      screen.getByText(/showing 6 of 7 active purchase orders/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/review the purchase-order workspace to inspect the remaining 1/i)
    ).toBeInTheDocument();
  });

  it("skips protected procurement queries while Convex auth is still loading", () => {
    mockedHooks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });
    mockedHooks.useQuery.mockReturnValue(undefined);

    render(<ProcurementView />);

    expect(screen.getByText("Loading procurement workspace...")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
      "skip",
    ]);
  });

  it("renders a sign-in fallback instead of subscribing when Convex auth is missing", () => {
    mockedHooks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mockedHooks.useQuery.mockReturnValue(undefined);

    render(<ProcurementView />);

    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(
      screen.getByText(/your athena session needs to reconnect before procurement planning can load protected stock operations data/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in again/i })).toHaveAttribute(
      "href",
      "/login"
    );
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
      "skip",
    ]);
  });

  it("subscribes to protected procurement queries once auth and permissions are ready", () => {
    mockedHooks.useQuery
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    render(<ProcurementView />);

    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      { storeId: "store-1" },
      { storeId: "store-1" },
      { status: "active", storeId: "store-1" },
    ]);
  });
});
