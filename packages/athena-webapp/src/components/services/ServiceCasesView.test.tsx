import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GENERIC_UNEXPECTED_ERROR_MESSAGE, userError } from "~/shared/commandResult";
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
  onAddLineItem: vi.fn().mockResolvedValue({ kind: "ok", data: null }),
  onCreateCase: vi.fn().mockResolvedValue({ kind: "ok", data: null }),
  onRecordInventoryUsage: vi.fn().mockResolvedValue({ kind: "ok", data: null }),
  onRecordPayment: vi.fn().mockResolvedValue({ kind: "ok", data: null }),
  onUpdateStatus: vi.fn().mockResolvedValue({ kind: "ok", data: null }),
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
    const onCreateCase = vi.fn().mockResolvedValue({ kind: "ok", data: null });

    render(<ServiceCasesViewContent {...baseProps} onCreateCase={onCreateCase} />);

    await user.click(screen.getByRole("button", { name: /create service case/i }));

    expect(onCreateCase).not.toHaveBeenCalled();
    expect(screen.getByText("Select a customer.")).toBeInTheDocument();
    expect(screen.getByText("Provide a service title.")).toBeInTheDocument();
    expect(screen.getByText("Select a staff member.")).toBeInTheDocument();
  });

  it("creates walk-in service cases from selected customers and catalog items", async () => {
    const user = userEvent.setup();
    const onCreateCase = vi.fn().mockResolvedValue({ kind: "ok", data: null });

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
    const onAddLineItem = vi.fn().mockResolvedValue({ kind: "ok", data: null });
    const onRecordInventoryUsage = vi.fn().mockResolvedValue({ kind: "ok", data: null });
    const onRecordPayment = vi.fn().mockResolvedValue({ kind: "ok", data: null });
    const onUpdateStatus = vi.fn().mockResolvedValue({ kind: "ok", data: null });

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

  it("renders safe user_error copy inline for create failures and clears stale errors before retry", async () => {
    const user = userEvent.setup();
    const onCreateCase = vi
      .fn()
      .mockResolvedValueOnce(
        userError({
          code: "precondition_failed",
          message: "Assigned staff member is not available for this store.",
        }),
      )
      .mockResolvedValueOnce({ kind: "ok", data: null });

    render(<ServiceCasesViewContent {...baseProps} onCreateCase={onCreateCase} />);

    await user.click(screen.getByRole("button", { name: /use customer/i }));
    await user.type(screen.getByLabelText(/service title/i), "Closure Repair");
    await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);
    await user.click(screen.getByRole("button", { name: /create service case/i }));

    expect(
      await screen.findByText("Assigned staff member is not available for this store."),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/service title/i));
    await user.type(screen.getByLabelText(/service title/i), "Revamp");
    await user.click(screen.getByRole("button", { name: /create service case/i }));

    await waitFor(() => expect(onCreateCase).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByText("Assigned staff member is not available for this store."),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders generic fallback copy inline for unexpected create failures", async () => {
    const user = userEvent.setup();
    const onCreateCase = vi.fn().mockResolvedValue({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      },
    });

    render(<ServiceCasesViewContent {...baseProps} onCreateCase={onCreateCase} />);

    await user.click(screen.getByRole("button", { name: /use customer/i }));
    await user.type(screen.getByLabelText(/service title/i), "Closure Repair");
    await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);
    await user.click(screen.getByRole("button", { name: /create service case/i }));

    expect(await screen.findByText(GENERIC_UNEXPECTED_ERROR_MESSAGE)).toBeInTheDocument();
  });

  it("renders safe inline copy for status update failures", async () => {
    const user = userEvent.setup();
    const onUpdateStatus = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message: "Refund service payments before cancelling the case.",
      }),
    );

    render(<ServiceCasesViewContent {...baseProps} onUpdateStatus={onUpdateStatus} />);

    await chooseSelectOption(user, /case status/i, /cancelled/i);
    await user.click(screen.getByRole("button", { name: /update status/i }));

    expect(
      await screen.findByText("Refund service payments before cancelling the case."),
    ).toBeInTheDocument();
  });

  it("clears detail errors when switching to a different case", async () => {
    const user = userEvent.setup();
    const onUpdateStatus = vi.fn().mockResolvedValueOnce(
      userError({
        code: "precondition_failed",
        message: "Refund service payments before cancelling the case.",
      }),
    );

    const { rerender } = render(
      <ServiceCasesViewContent
        {...baseProps}
        onUpdateStatus={onUpdateStatus}
        serviceCases={[
          ...baseProps.serviceCases,
          {
            _id: "case-2",
            balanceDueAmount: 0,
            customerName: "Kojo Mensimah",
            paymentStatus: "paid",
            pendingApprovalCount: 0,
            serviceCatalogName: "Revamp",
            staffName: "Adjoa Tetteh",
            status: "awaiting_pickup",
          },
        ]}
      />,
    );

    await chooseSelectOption(user, /case status/i, /cancelled/i);
    await user.click(screen.getByRole("button", { name: /update status/i }));

    expect(
      await screen.findByText("Refund service payments before cancelling the case."),
    ).toBeInTheDocument();

    rerender(
      <ServiceCasesViewContent
        {...baseProps}
        onUpdateStatus={onUpdateStatus}
        selectedCaseDetails={{
          _id: "case-2",
          balanceDueAmount: 0,
          lineItems: [],
          paymentAllocations: [],
          paymentStatus: "paid",
          pendingApprovals: [],
          status: "awaiting_pickup",
        }}
        selectedCaseId="case-2"
        serviceCases={[
          ...baseProps.serviceCases,
          {
            _id: "case-2",
            balanceDueAmount: 0,
            customerName: "Kojo Mensimah",
            paymentStatus: "paid",
            pendingApprovalCount: 0,
            serviceCatalogName: "Revamp",
            staffName: "Adjoa Tetteh",
            status: "awaiting_pickup",
          },
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.queryByText("Refund service payments before cancelling the case."),
      ).not.toBeInTheDocument(),
    );
  });
});
