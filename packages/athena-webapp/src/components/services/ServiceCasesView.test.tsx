import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceCasesViewContent } from "./ServiceCasesView";

const baseProps = {
  catalogItems: [
    {
      _id: "catalog-1",
      name: "Closure Repair",
      serviceMode: "repair" as const,
    },
  ],
  customerResults: [
    {
      _id: "customer-1",
      fullName: "Ama Mensah",
    },
  ],
  hasFullAdminAccess: true,
  isLoadingPermissions: false,
  isSaving: false,
  onAddLineItem: vi.fn().mockResolvedValue(undefined),
  onCreateCase: vi.fn().mockResolvedValue(undefined),
  onRecordInventoryUsage: vi.fn().mockResolvedValue(undefined),
  onRecordPayment: vi.fn().mockResolvedValue(undefined),
  onUpdateStatus: vi.fn().mockResolvedValue(undefined),
  searchQuery: "",
  selectedCaseDetails: {
    _id: "case-1",
    balanceDueAmount: 150,
    lineItems: [],
    paymentAllocations: [],
    paymentStatus: "partially_paid",
    pendingApprovals: [{ _id: "approval-1" }],
    status: "in_progress",
  },
  selectedCaseId: "case-1",
  serviceCases: [
    {
      _id: "case-1",
      balanceDueAmount: 150,
      customerName: "Ama Mensah",
      paymentStatus: "partially_paid",
      pendingApprovalCount: 1,
      serviceCatalogName: "Closure Repair",
      staffName: "Adjoa Tetteh",
      status: "in_progress",
    },
  ],
  setSearchQuery: vi.fn(),
  setSelectedCaseId: vi.fn(),
  staffOptions: [
    {
      _id: "staff-1",
      fullName: "Adjoa Tetteh",
      roles: ["technician"],
    },
  ],
};

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: RegExp
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("ServiceCasesViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
  });

  it("validates required walk-in case fields before creating", async () => {
    const user = userEvent.setup();
    const onCreateCase = vi.fn().mockResolvedValue(undefined);

    render(<ServiceCasesViewContent {...baseProps} onCreateCase={onCreateCase} />);

    await user.click(screen.getByRole("button", { name: /create service case/i }));

    expect(onCreateCase).not.toHaveBeenCalled();
    expect(screen.getByText("Select a customer.")).toBeInTheDocument();
    expect(screen.getByText("Provide a service title.")).toBeInTheDocument();
    expect(screen.getByText("Select a staff member.")).toBeInTheDocument();
  });

  it("creates walk-in service cases from selected customers and catalog items", async () => {
    const user = userEvent.setup();
    const onCreateCase = vi.fn().mockResolvedValue(undefined);

    render(<ServiceCasesViewContent {...baseProps} onCreateCase={onCreateCase} />);

    await user.click(screen.getByRole("button", { name: /use customer/i }));
    await user.type(screen.getByLabelText(/service title/i), "Closure Repair");
    await chooseSelectOption(user, /service mode/i, /^repair$/i);
    await chooseSelectOption(user, /service catalog/i, /closure repair/i);
    await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);
    await user.type(screen.getByLabelText(/quoted amount/i), "450");
    await user.click(screen.getByRole("button", { name: /create service case/i }));

    await waitFor(() => expect(onCreateCase).toHaveBeenCalledTimes(1));
    expect(onCreateCase.mock.calls[0][0]).toMatchObject({
      assignedStaffProfileId: "staff-1",
      customerProfileId: "customer-1",
      quotedAmount: 450,
      serviceCatalogId: "catalog-1",
      serviceMode: "repair",
      title: "Closure Repair",
    });
  });

  it("renders case details and dispatches payment, inventory, line-item, and status actions", async () => {
    const user = userEvent.setup();
    const onAddLineItem = vi.fn().mockResolvedValue(undefined);
    const onRecordInventoryUsage = vi.fn().mockResolvedValue(undefined);
    const onRecordPayment = vi.fn().mockResolvedValue(undefined);
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);

    render(
      <ServiceCasesViewContent
        {...baseProps}
        onAddLineItem={onAddLineItem}
        onRecordInventoryUsage={onRecordInventoryUsage}
        onRecordPayment={onRecordPayment}
        onUpdateStatus={onUpdateStatus}
      />,
    );

    expect(screen.getByText("1 pending approval")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/payment amount/i), "75");
    await chooseSelectOption(user, /payment method/i, /^card$/i);
    await user.click(screen.getByRole("button", { name: /record payment/i }));
    expect(onRecordPayment).toHaveBeenCalledWith({
      amount: 75,
      method: "card",
      serviceCaseId: "case-1",
    });

    await user.type(screen.getByLabelText(/line item description/i), "Repair labour");
    await user.type(screen.getByLabelText(/line item quantity/i), "1");
    await user.type(screen.getByLabelText(/line item unit price/i), "150");
    await user.click(screen.getByRole("button", { name: /add line item/i }));
    expect(onAddLineItem).toHaveBeenCalledWith({
      description: "Repair labour",
      lineType: "labor",
      quantity: 1,
      serviceCaseId: "case-1",
      unitPrice: 150,
    });

    await user.type(screen.getByLabelText(/material sku/i), "sku-1");
    await user.type(screen.getByLabelText(/material quantity/i), "2");
    await user.click(screen.getByRole("button", { name: /record material usage/i }));
    expect(onRecordInventoryUsage).toHaveBeenCalledWith({
      productSkuId: "sku-1",
      quantity: 2,
      serviceCaseId: "case-1",
      usageType: "consumed",
    });

    await chooseSelectOption(user, /case status/i, /awaiting pickup/i);
    await user.click(screen.getByRole("button", { name: /update status/i }));
    expect(onUpdateStatus).toHaveBeenCalledWith({
      serviceCaseId: "case-1",
      status: "awaiting_pickup",
    });
  });
});
