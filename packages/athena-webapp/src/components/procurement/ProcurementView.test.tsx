import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";
import { ProcurementView, ProcurementViewContent } from "./ProcurementView";

const mockedHooks = vi.hoisted(() => ({
  createPurchaseOrder: vi.fn(),
  createVendor: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  updatePurchaseOrderStatus: vi.fn(),
  useAuth: vi.fn(),
  useGetActiveStore: vi.fn(),
  useMutation: vi.fn(),
  usePermissions: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockedHooks.toastError,
    success: mockedHooks.toastSuccess,
  },
}));

vi.mock("./ReceivingView", () => ({
  ReceivingView: ({ purchaseOrderId }: { purchaseOrderId: string }) => (
    <div>Receiving form for {purchaseOrderId}</div>
  ),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockedHooks.useAuth,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: mockedHooks.useGetActiveStore,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: mockedHooks.usePermissions,
}));

const exposedRecommendation = {
  _id: "sku-1" as Id<"productSku">,
  guidance: "No planned or inbound replenishment covers this SKU.",
  inboundPurchaseOrderCount: 0,
  inboundPurchaseOrderQuantity: 0,
  inboundPurchaseOrders: [],
  inventoryCount: 0,
  isException: false,
  needsAction: true,
  pendingPurchaseOrderCount: 0,
  pendingPurchaseOrderQuantity: 0,
  pendingPurchaseOrders: [],
  plannedPurchaseOrderCount: 0,
  plannedPurchaseOrderQuantity: 0,
  plannedPurchaseOrders: [],
  productName: "Closure Wig",
  quantityAvailable: 0,
  sku: "CW-18",
  status: "exposed" as const,
  suggestedOrderQuantity: 6,
};

const plannedRecommendation = {
  _id: "sku-2" as Id<"productSku">,
  guidance: "Draft purchase-order work exists but is not inbound cover yet.",
  inboundPurchaseOrderCount: 0,
  inboundPurchaseOrderQuantity: 0,
  inboundPurchaseOrders: [],
  inventoryCount: 1,
  isException: false,
  needsAction: false,
  pendingPurchaseOrderCount: 0,
  pendingPurchaseOrderQuantity: 0,
  pendingPurchaseOrders: [],
  plannedPurchaseOrderCount: 1,
  plannedPurchaseOrderQuantity: 4,
  plannedPurchaseOrders: [
    {
      pendingQuantity: 4,
      poNumber: "PO-PLANNED",
      purchaseOrderId: "po-draft" as Id<"purchaseOrder">,
      status: "draft" as const,
    },
  ],
  productName: "Frontal Wig",
  quantityAvailable: 1,
  sku: "FW-20",
  status: "planned" as const,
  suggestedOrderQuantity: 4,
};

const inboundRecommendation = {
  _id: "sku-3" as Id<"productSku">,
  guidance: "Ordered purchase-order work is covering this SKU.",
  inboundPurchaseOrderCount: 1,
  inboundPurchaseOrderQuantity: 6,
  inboundPurchaseOrders: [
    {
      expectedAt: 1_712_345_678_900,
      pendingQuantity: 6,
      poNumber: "PO-001",
      purchaseOrderId: "po-1" as Id<"purchaseOrder">,
      status: "ordered" as const,
    },
  ],
  inventoryCount: 1,
  isException: false,
  needsAction: false,
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
  plannedPurchaseOrderCount: 0,
  plannedPurchaseOrderQuantity: 0,
  plannedPurchaseOrders: [],
  productName: "Silk Press Kit",
  quantityAvailable: 1,
  sku: "SP-01",
  status: "inbound" as const,
  suggestedOrderQuantity: 0,
};

const exceptionRecommendation = {
  ...exposedRecommendation,
  _id: "sku-4" as Id<"productSku">,
  guidance: "Inbound cover is late and still has remaining quantity open.",
  isException: true,
  productName: "Lace Adhesive",
  sku: "LA-01",
  status: "late_inbound" as const,
  suggestedOrderQuantity: 3,
};

const baseProps: React.ComponentProps<typeof ProcurementViewContent> = {
  hasActiveStore: true,
  hasFullAdminAccess: true,
  isLoadingPermissions: false,
  isLoadingProcurement: false,
  purchaseOrders: [
    {
      _id: "po-draft" as Id<"purchaseOrder">,
      lineItemCount: 1,
      poNumber: "PO-DRAFT",
      status: "draft" as const,
      totalUnits: 4,
    },
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
    exposedRecommendation,
    plannedRecommendation,
    inboundRecommendation,
    exceptionRecommendation,
  ],
  storeId: "store-1" as Id<"store">,
  vendors: [
    { _id: "vendor-1" as Id<"vendor">, name: "Main Vendor" },
    { _id: "vendor-2" as Id<"vendor">, name: "Backup Vendor" },
  ],
};

function installMutationMocks() {
  let mutationCallIndex = 0;

  mockedHooks.createVendor.mockResolvedValue({
    data: { _id: "vendor-new", name: "New Vendor" },
    kind: "ok",
  });
  mockedHooks.createPurchaseOrder.mockResolvedValue({
    data: { _id: "po-new" },
    kind: "ok",
  });
  mockedHooks.updatePurchaseOrderStatus.mockResolvedValue({
    data: { _id: "po-draft" },
    kind: "ok",
  });
  mockedHooks.useMutation.mockImplementation(() => {
    const mutations = [
      mockedHooks.createVendor,
      mockedHooks.createPurchaseOrder,
      mockedHooks.updatePurchaseOrderStatus,
    ];
    const mutation = mutations[mutationCallIndex % mutations.length];

    mutationCallIndex += 1;

    return mutation;
  });
}

describe("ProcurementViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedHooks.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "auth-user-1" },
    });
    mockedHooks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1" as Id<"store"> },
    });
    mockedHooks.usePermissions.mockReturnValue({
      canAccessOperations: () => true,
      isLoading: false,
    });
    mockedHooks.useQuery.mockImplementation((_, args) =>
      args === "skip"
        ? undefined
        : {
            _id: "po-1",
            lineItems: [
              {
                _id: "line-1",
                orderedQuantity: 8,
                productSkuId: "sku-3",
                receivedQuantity: 0,
              },
            ],
            poNumber: "PO-001",
          },
    );
    installMutationMocks();
  });

  it("renders the denied state for users without procurement access", () => {
    render(
      <ProcurementViewContent {...baseProps} hasFullAdminAccess={false} />,
    );

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("defaults to needs-action rows and supports the daily operating modes", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    expect(screen.getByText("Closure Wig")).toBeInTheDocument();
    expect(screen.getByText("Lace Adhesive")).toBeInTheDocument();
    expect(screen.queryByText("Frontal Wig")).not.toBeInTheDocument();
    expect(screen.queryByText("Silk Press Kit")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /planned/i }));

    expect(screen.getByText("Frontal Wig")).toBeInTheDocument();
    expect(screen.queryByText("Closure Wig")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /inbound/i }));

    expect(screen.getByText("Silk Press Kit")).toBeInTheDocument();
    expect(screen.getByText("Lace Adhesive")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /exceptions/i }));

    expect(screen.getByText("Lace Adhesive")).toBeInTheDocument();
    expect(screen.queryByText("Silk Press Kit")).not.toBeInTheDocument();
  });

  it("requires vendors before creating grouped draft purchase orders", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    await user.click(
      within(screen.getByText("Closure Wig").closest("article")!).getByRole(
        "button",
        { name: /add to draft/i },
      ),
    );

    expect(screen.getByRole("button", { name: /create draft POs/i })).toBeDisabled();

    await user.selectOptions(
      screen.getByLabelText("Vendor for Closure Wig"),
      "vendor-1",
    );
    await user.click(screen.getByRole("button", { name: /create draft POs/i }));

    expect(mockedHooks.createPurchaseOrder).toHaveBeenCalledWith({
      lineItems: [
        {
          description: "Closure Wig (CW-18)",
          orderedQuantity: 6,
          productSkuId: "sku-1",
          unitCost: 0,
        },
      ],
      storeId: "store-1",
      vendorId: "vendor-1",
    });
  });

  it("quick-adds a vendor and assigns it to the first draft line missing one", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    await user.click(
      within(screen.getByText("Closure Wig").closest("article")!).getByRole(
        "button",
        { name: /add to draft/i },
      ),
    );
    await user.type(screen.getByLabelText("Vendor name"), "New Vendor");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(mockedHooks.createVendor).toHaveBeenCalledWith({
      name: "New Vendor",
      storeId: "store-1",
    });
    expect(screen.getByLabelText("Vendor for Closure Wig")).toHaveValue(
      "vendor-new",
    );
  });

  it("removes successfully created vendor groups from the draft when a later group fails", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    mockedHooks.createPurchaseOrder
      .mockResolvedValueOnce({
        data: { _id: "po-new-1" },
        kind: "ok",
      })
      .mockResolvedValueOnce({
        error: {
          code: "validation_failed",
          message: "Vendor not found for this store.",
        },
        kind: "user_error",
      });

    render(<ProcurementViewContent {...baseProps} />);

    await user.click(
      within(screen.getByText("Closure Wig").closest("article")!).getByRole(
        "button",
        { name: /add to draft/i },
      ),
    );
    await user.click(
      within(screen.getByText("Lace Adhesive").closest("article")!).getByRole(
        "button",
        { name: /add to draft/i },
      ),
    );
    await user.selectOptions(
      screen.getByLabelText("Vendor for Closure Wig"),
      "vendor-1",
    );
    await user.selectOptions(
      screen.getByLabelText("Vendor for Lace Adhesive"),
      "vendor-2",
    );
    await user.click(screen.getByRole("button", { name: /create draft POs/i }));

    const draftPanel = screen
      .getByText("Vendor-backed PO draft")
      .closest("section")!;

    expect(mockedHooks.createPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(within(draftPanel).queryByText("Closure Wig")).not.toBeInTheDocument();
    expect(within(draftPanel).getByText("Lace Adhesive")).toBeInTheDocument();
  });

  it("renders active purchase-order lifecycle actions beside the summary", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    expect(screen.getByText("PO-DRAFT")).toBeInTheDocument();
    expect(
      within(screen.getByText("Active vendors").parentElement!).getByText("2"),
    ).toBeInTheDocument();
    expect(screen.getByText("Open procurement flow")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(mockedHooks.updatePurchaseOrderStatus).toHaveBeenCalledWith({
      nextStatus: "submitted",
      purchaseOrderId: "po-draft",
    });
  });

  it("opens receiving from ordered purchase orders", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /receive/i }));

    expect(screen.getByText("Receiving form for po-1")).toBeInTheDocument();
    expect(mockedHooks.useQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      { purchaseOrderId: "po-1" },
    );
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
      />,
    );

    expect(
      screen.getByText(/showing 6 of 8 active purchase orders/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /review the purchase-order workspace to inspect the remaining 2/i,
      ),
    ).toBeInTheDocument();
  });

  it("skips protected procurement queries while auth is still loading", () => {
    mockedHooks.useAuth.mockReturnValue({
      isLoading: true,
      user: undefined,
    });
    mockedHooks.useQuery.mockReturnValue(undefined);

    render(<ProcurementView />);

    expect(
      screen.getByText("Loading procurement workspace..."),
    ).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
      "skip",
    ]);
  });

  it("renders a sign-in fallback instead of subscribing when auth is missing", () => {
    mockedHooks.useAuth.mockReturnValue({
      isLoading: false,
      user: null,
    });
    mockedHooks.useQuery.mockReturnValue(undefined);

    render(<ProcurementView />);

    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(
      screen.getByText(
        /your athena session needs to reconnect before procurement planning can load protected stock operations data/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /sign in again/i }),
    ).toHaveAttribute("href", "/login");
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
      "skip",
    ]);
  });
});
