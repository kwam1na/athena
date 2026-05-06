import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";
import { ProcurementView, ProcurementViewContent } from "./ProcurementView";

const mockedHooks = vi.hoisted(() => ({
  advancePurchaseOrderToOrdered: vi.fn(),
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
  plannedPurchaseOrderCount: 2,
  plannedPurchaseOrderQuantity: 7,
  plannedPurchaseOrders: [
    {
      pendingQuantity: 4,
      poNumber: "PO-PLANNED",
      purchaseOrderId: "po-draft" as Id<"purchaseOrder">,
      status: "draft" as const,
      vendorName: "Main Vendor",
    },
    {
      pendingQuantity: 3,
      poNumber: "PO-BACKUP",
      purchaseOrderId: "po-backup" as Id<"purchaseOrder">,
      status: "draft" as const,
      vendorName: "Backup Vendor",
    },
  ],
  productName: "Frontal Wig",
  quantityAvailable: 1,
  sku: "FW-20",
  status: "planned" as const,
  suggestedOrderQuantity: 0,
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

const mixedPurchaseOrderRecommendation = {
  ...inboundRecommendation,
  _id: "sku-mixed" as Id<"productSku">,
  guidance: "Ordered purchase-order work is covering this SKU.",
  inboundPurchaseOrderCount: 1,
  inboundPurchaseOrderQuantity: 5,
  inboundPurchaseOrders: [
    {
      pendingQuantity: 5,
      poNumber: "PO-ORDERED",
      purchaseOrderId: "po-ordered" as Id<"purchaseOrder">,
      status: "ordered" as const,
      vendorName: "Tech Guys",
    },
  ],
  pendingPurchaseOrderCount: 1,
  pendingPurchaseOrderQuantity: 5,
  pendingPurchaseOrders: [
    {
      pendingQuantity: 5,
      poNumber: "PO-ORDERED",
      purchaseOrderId: "po-ordered" as Id<"purchaseOrder">,
      status: "ordered" as const,
      vendorName: "Tech Guys",
    },
  ],
  plannedPurchaseOrderCount: 1,
  plannedPurchaseOrderQuantity: 15,
  plannedPurchaseOrders: [
    {
      pendingQuantity: 15,
      poNumber: "PO-DRAFT-2",
      purchaseOrderId: "po-draft-2" as Id<"purchaseOrder">,
      status: "draft" as const,
      vendorName: "Camera G",
    },
  ],
  productName: "Camera",
  sku: "CAM-01",
  status: "inbound" as const,
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

const resolvedWithInboundRecommendation = {
  ...inboundRecommendation,
  _id: "sku-resolved" as Id<"productSku">,
  guidance: "Current stock pressure is cleared for this SKU.",
  inboundPurchaseOrderQuantity: 1,
  inventoryCount: 5,
  pendingPurchaseOrderQuantity: 1,
  productName: "Logitech Mouse",
  quantityAvailable: 5,
  sku: "LM-01",
  status: "resolved" as const,
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
  mockedHooks.advancePurchaseOrderToOrdered.mockResolvedValue({
    data: { _id: "po-draft" },
    kind: "ok",
  });
  mockedHooks.useMutation.mockImplementation(() => {
    const mutations = [
      mockedHooks.createVendor,
      mockedHooks.createPurchaseOrder,
      mockedHooks.updatePurchaseOrderStatus,
      mockedHooks.advancePurchaseOrderToOrdered,
    ];
    const mutation = mutations[mutationCallIndex % mutations.length];

    mutationCallIndex += 1;

    return mutation;
  });
}

async function chooseDraftVendor(
  user: { click: (element: Element) => Promise<void> },
  productName: string,
  vendorName: string,
) {
  await user.click(screen.getByLabelText(`Vendor for ${productName}`));
  await user.click(await screen.findByRole("option", { name: vendorName }));
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

  it("uses plain zero-state copy for the visible stock count", () => {
    render(
      <ProcurementViewContent
        {...baseProps}
        purchaseOrders={[]}
        recommendations={[]}
      />,
    );

    expect(screen.getByText("No action needed")).toBeInTheDocument();
    expect(screen.queryByText("No need action")).not.toBeInTheDocument();
    expect(screen.queryByText("0 need action")).not.toBeInTheDocument();
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
    expect(screen.getByText("1 planned stock item")).toBeInTheDocument();
    expect(
      within(screen.getByText("Frontal Wig").closest("article")!).getByText(
        "2 purchase orders · 2 vendors",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Frontal Wig").closest("article")!).getByText(
        "PO-PLANNED",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Main Vendor")).toHaveClass("capitalize");
    expect(screen.getByText("PO-BACKUP")).toHaveClass(
      "text-xs",
      "text-muted-foreground",
    );
    expect(screen.getByText("Backup Vendor")).toBeInTheDocument();
    expect(
      within(screen.getByText("Frontal Wig").closest("article")!).getByText(
        "Planned",
      ),
    ).toHaveClass("bg-muted/50", "text-muted-foreground");
    expect(
      screen.getByText("Next action: order this purchase order."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Frontal Wig").closest("article")!).getAllByRole(
        "button",
        { name: /mark ordered/i },
      ),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /no draft needed/i }),
    ).not.toBeInTheDocument();
    const openPurchaseOrdersSection = screen
      .getByText("Open purchase orders")
      .closest("section")!;
    const draftSection = screen
      .getByText("Vendor-backed purchase order draft")
      .closest("section")!;
    expect(
      openPurchaseOrdersSection.compareDocumentPosition(draftSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText("Vendor-backed purchase order draft"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Closure Wig")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /inbound/i }));

    expect(screen.getByText("Silk Press Kit")).toBeInTheDocument();
    expect(screen.getByText("Lace Adhesive")).toBeInTheDocument();
    expect(
      within(screen.getByText("Silk Press Kit").closest("article")!).getByText(
        "Inbound",
      ),
    ).toHaveClass("text-success");

    await user.click(screen.getByRole("tab", { name: /exceptions/i }));

    expect(screen.getByText("Lace Adhesive")).toBeInTheDocument();
    expect(screen.queryByText("Silk Press Kit")).not.toBeInTheDocument();
  });

  it("marks planned purchase orders ordered through the streamlined command", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    await user.click(screen.getByRole("tab", { name: /planned/i }));
    await user.click(
      within(screen.getByText("Frontal Wig").closest("article")!).getAllByRole(
        "button",
        { name: /mark ordered/i },
      )[0],
    );

    expect(mockedHooks.advancePurchaseOrderToOrdered).toHaveBeenCalledWith({
      purchaseOrderId: "po-draft",
    });
    expect(mockedHooks.updatePurchaseOrderStatus).not.toHaveBeenCalled();
    expect(mockedHooks.toastSuccess).toHaveBeenCalledWith(
      "PO-PLANNED marked ordered",
    );
  });

  it("keeps mixed planned and inbound purchase orders actionable in both modes", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <ProcurementViewContent
        {...baseProps}
        recommendations={[mixedPurchaseOrderRecommendation]}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /planned/i }));

    const plannedRow = screen.getByText("Camera").closest("article")!;
    expect(within(plannedRow).getByText("Planned + inbound")).toHaveClass(
      "bg-muted/50",
      "text-foreground",
    );
    expect(
      within(plannedRow).getByText(
        "Next action: order the remaining purchase order. 5 units already inbound.",
      ),
    ).toBeInTheDocument();
    expect(within(plannedRow).getByText("PO-DRAFT-2")).toBeInTheDocument();
    expect(within(plannedRow).getByText("PO-ORDERED")).toBeInTheDocument();

    await user.click(
      within(plannedRow).getByRole("button", { name: /mark ordered/i }),
    );

    expect(mockedHooks.advancePurchaseOrderToOrdered).toHaveBeenCalledWith({
      purchaseOrderId: "po-draft-2",
    });

    await user.click(screen.getByRole("tab", { name: /inbound/i }));

    expect(screen.getByText("Camera")).toBeInTheDocument();
  });

  it("communicates handled rows with inbound cover as handled pressure", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <ProcurementViewContent
        {...baseProps}
        recommendations={[resolvedWithInboundRecommendation]}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /inbound/i }));

    expect(screen.getByText("Logitech Mouse")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /handled/i }));

    const resolvedRow = screen.getByText("Logitech Mouse").closest("article")!;
    expect(within(resolvedRow).getByText("Handled")).toBeInTheDocument();
    expect(
      within(resolvedRow).getByText(
        "Stock pressure is handled. 1 unit still inbound.",
      ),
    ).toBeInTheDocument();
    expect(resolvedRow).toHaveTextContent(/0\s*planned,\s*1\s*inbound/i);
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

    expect(
      screen.getByRole("button", { name: /create draft purchase orders/i }),
    ).toBeDisabled();

    await chooseDraftVendor(user, "Closure Wig", "Main Vendor");
    await user.click(
      screen.getByRole("button", { name: /create draft purchase orders/i }),
    );

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
    expect(screen.getByLabelText("Vendor for Closure Wig")).toHaveTextContent(
      "New Vendor",
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
    await chooseDraftVendor(user, "Closure Wig", "Main Vendor");
    await chooseDraftVendor(user, "Lace Adhesive", "Backup Vendor");
    await user.click(
      screen.getByRole("button", { name: /create draft purchase orders/i }),
    );

    const draftPanel = screen
      .getByText("Vendor-backed purchase order draft")
      .closest("section")!;

    expect(mockedHooks.createPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(
      within(draftPanel).queryByText("Closure Wig"),
    ).not.toBeInTheDocument();
    expect(within(draftPanel).getByText("Lace Adhesive")).toBeInTheDocument();
  });

  it("renders purchase-order lifecycle actions on the owning stock row", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    expect(
      within(
        screen.getByText("Open purchase orders").closest("section")!,
      ).getByText("PO-DRAFT"),
    ).toHaveClass("text-sm", "text-foreground/80");
    expect(screen.getByText("1 line · 4 units")).toBeInTheDocument();
    expect(
      within(screen.getByText("Active vendors").parentElement!).getByText("2"),
    ).toBeInTheDocument();
    expect(screen.getByText("Open purchase orders")).toBeInTheDocument();
    expect(
      screen
        .getByText("Open purchase orders")
        .closest("section")!
        .querySelector("button"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /planned/i }));
    await user.click(
      within(screen.getByText("Frontal Wig").closest("article")!).getAllByRole(
        "button",
        { name: /mark ordered/i },
      )[0],
    );

    expect(mockedHooks.advancePurchaseOrderToOrdered).toHaveBeenCalledWith({
      purchaseOrderId: "po-draft",
    });
    expect(mockedHooks.updatePurchaseOrderStatus).not.toHaveBeenCalled();
  });

  it("opens receiving from ordered purchase orders", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<ProcurementViewContent {...baseProps} />);

    await user.click(screen.getByRole("tab", { name: /inbound/i }));
    const silkPressRow = screen.getByText("Silk Press Kit").closest("article")!;
    await user.click(
      within(silkPressRow).getByRole("button", { name: /receive/i }),
    );

    expect(screen.getByText("Receiving form for po-1")).toBeInTheDocument();
    expect(
      within(silkPressRow).getByRole("button", { name: /receiving/i }),
    ).toBeDisabled();
    expect(
      within(silkPressRow).getByText("PO-001").closest(".rounded-md"),
    ).toHaveClass(
      "border-action-workflow-border",
      "bg-action-workflow-soft/40",
    );
    const receivingSection = screen
      .getByText("Receiving form for po-1")
      .closest("section")!;
    const openPurchaseOrdersSection = screen
      .getByText("Open purchase orders")
      .closest("section")!;
    expect(
      receivingSection.compareDocumentPosition(openPurchaseOrdersSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mockedHooks.useQuery).toHaveBeenLastCalledWith(expect.anything(), {
      purchaseOrderId: "po-1",
    });
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
      screen.getByText(/use the stock list to review the remaining 2/i),
    ).toBeInTheDocument();
  });

  it("keeps the workspace empty while procurement data loads", () => {
    const { container } = render(
      <ProcurementViewContent {...baseProps} isLoadingProcurement />,
    );

    expect(
      screen.queryByRole("status", {
        name: /loading procurement workspace/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Loading procurement workspace..."),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("skips protected procurement queries while auth is still loading", () => {
    mockedHooks.useAuth.mockReturnValue({
      isLoading: true,
      user: undefined,
    });
    mockedHooks.useQuery.mockReturnValue(undefined);

    render(<ProcurementView />);

    expect(
      screen.queryByRole("status", {
        name: /loading procurement workspace/i,
      }),
    ).not.toBeInTheDocument();
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
