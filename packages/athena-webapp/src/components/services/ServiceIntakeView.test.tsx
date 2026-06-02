import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { Id } from "~/convex/_generated/dataModel";
import { ServiceIntakeViewContent } from "./ServiceIntakeView";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const baseProps = {
  catalogOptions: [
    {
      _id: "catalog-1",
      durationMinutes: 90,
      name: "Wash and restyle closure wig",
      serviceMode: "same_day" as const,
    },
    {
      _id: "catalog-2",
      durationMinutes: 30,
      name: "Closure consultation",
      serviceMode: "consultation" as const,
    },
  ],
  customerResults: [] as {
    _id: string;
    email?: string;
    fullName: string;
    phoneNumber?: string;
  }[],
  hasFullAdminAccess: true,
  isLoadingPermissions: false,
  isSubmitting: false,
  onCreateIntake: vi.fn().mockResolvedValue({
    kind: "ok",
    data: {
      customerProfileId: "customer-7",
      serviceCaseId: "service-case-1",
      workItemId: "work-item-1",
    },
  }),
  searchQuery: "",
  setSearchQuery: vi.fn(),
  staffOptions: [
    {
      _id: "staff-1",
      fullName: "Adjoa Tetteh",
      phoneNumber: "+233200000000",
      roles: ["stylist"],
    },
  ],
  storeId: "store-1" as Id<"store">,
  userId: "user-1" as Id<"athenaUser">,
};

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: RegExp
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

async function chooseServiceCatalogOption(
  user: ReturnType<typeof userEvent.setup>,
  option: RegExp,
) {
  await user.click(screen.getByRole("combobox", { name: /service title/i }));
  await user.click(await screen.findByText(option));
}

describe("ServiceIntakeViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      disconnect: vi.fn(),
      observe: vi.fn(),
      unobserve: vi.fn(),
    }));
    vi.clearAllMocks();
  });

  it("shows validation errors before submitting an incomplete intake", async () => {
    const user = userEvent.setup();
    const onCreateIntake = vi.fn().mockResolvedValue(undefined);

    render(
      <ServiceIntakeViewContent
        {...baseProps}
        onCreateIntake={onCreateIntake}
      />,
    );

    await user.click(screen.getByRole("button", { name: /create intake/i }));

    expect(onCreateIntake).not.toHaveBeenCalled();
    expect(screen.getByText("An assignee is required.")).toBeInTheDocument();
    expect(screen.getByText("A service title is required.")).toBeInTheDocument();
    expect(
      screen.getByText("A customer name is required when no customer is linked."),
    ).toBeInTheDocument();
    expect(screen.getByText("Customer phone number is required."))
      .toBeInTheDocument();
  });

  it("submits a linked-customer intake with a parsed deposit", async () => {
    const user = userEvent.setup();
    const onCreateIntake = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        customerProfileId: "customer-7",
        serviceCaseId: "service-case-1",
        workItemId: "work-item-1",
      },
    });

    render(
      <ServiceIntakeViewContent
        {...baseProps}
        customerResults={[
          {
            _id: "customer-7" as Id<"customerProfile">,
            email: "ama@example.com",
            fullName: "Ama Mensah",
            phoneNumber: "+233200000000",
          },
        ]}
        onCreateIntake={onCreateIntake}
      />,
    );

    await user.click(screen.getByRole("button", { name: /use customer/i }));
    await chooseServiceCatalogOption(user, /^wash and restyle closure wig$/i);
    await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);
    await user.type(screen.getByLabelText(/deposit amount/i), "45.25");
    await chooseSelectOption(user, /deposit method/i, /^card$/i);
    await chooseSelectOption(user, /priority/i, /^urgent$/i);
    await chooseSelectOption(user, /channel/i, /phone booking/i);
    await user.type(
      screen.getByLabelText(/item description/i),
      "Customer dropped off closure wig with tangling at the crown.",
    );
    await user.type(
      screen.getByLabelText(/intake notes/i),
      "Customer requested a same-week turnaround if possible.",
    );

    await user.click(screen.getByRole("button", { name: /create intake/i }));

    await waitFor(() => expect(onCreateIntake).toHaveBeenCalledTimes(1));
    expect(onCreateIntake.mock.calls[0][0]).toMatchObject({
      assignedStaffProfileId: "staff-1",
      createdByUserId: "user-1",
      customerEmail: "ama@example.com",
      customerFullName: "Ama Mensah",
      customerPhoneNumber: "+233200000000",
      customerProfileId: "customer-7",
      depositAmount: 4525,
      depositMethod: "card",
      intakeChannel: "phone_booking",
      itemDescription:
        "Customer dropped off closure wig with tangling at the crown.",
      notes: "Customer requested a same-week turnaround if possible.",
      priority: "urgent",
      serviceTitle: "Wash and restyle closure wig",
      storeId: "store-1",
    });
    expect(toast.success).toHaveBeenCalledWith("Service intake created");
    expect(
      screen.getByRole("combobox", { name: /service title/i }),
    ).toHaveTextContent("Select service");
  }, 10_000);

  it("renders safe user_error copy inline and clears stale validation errors before submit", async () => {
    const user = userEvent.setup();
    const onCreateIntake = vi.fn().mockResolvedValue({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Assigned staff member is not available for this store.",
      },
    });

    render(
      <ServiceIntakeViewContent
        {...baseProps}
        onCreateIntake={onCreateIntake}
      />,
    );

    await user.click(screen.getByRole("button", { name: /create intake/i }));

    expect(screen.getByText("An assignee is required.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/customer name/i), "Ama Mensah");
    await user.type(screen.getByLabelText(/phone number/i), "+233200000000");
    await chooseServiceCatalogOption(user, /^wash and restyle closure wig$/i);
    await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);

    await user.click(screen.getByRole("button", { name: /create intake/i }));

    await waitFor(() => expect(onCreateIntake).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText("Assigned staff member is not available for this store."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("A customer name is required when no customer is linked."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Customer phone number is required."))
      .not.toBeInTheDocument();
    expect(screen.queryByText("An assignee is required.")).not.toBeInTheDocument();
    expect(screen.queryByText("A service title is required.")).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("renders generic fallback copy inline for unexpected command failures", async () => {
    const user = userEvent.setup();
    const onCreateIntake = vi.fn().mockResolvedValue({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: "Please try again.",
      },
    });

    render(
      <ServiceIntakeViewContent
        {...baseProps}
        onCreateIntake={onCreateIntake}
      />,
    );

    await user.type(screen.getByLabelText(/customer name/i), "Ama Mensah");
    await user.type(screen.getByLabelText(/phone number/i), "+233200000000");
    await chooseServiceCatalogOption(user, /^wash and restyle closure wig$/i);
    await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);

    await user.click(screen.getByRole("button", { name: /create intake/i }));

    await waitFor(() => expect(onCreateIntake).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Please try again.")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("renders the denied state for non-admin users", () => {
    render(
      <ServiceIntakeViewContent
        {...baseProps}
        hasFullAdminAccess={false}
      />,
    );

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("uses a filterable catalog select for service title and omits staff roles", async () => {
    const user = userEvent.setup();

    render(<ServiceIntakeViewContent {...baseProps} />);

    await user.click(screen.getByRole("combobox", { name: /service title/i }));
    await user.type(screen.getByPlaceholderText(/search services/i), "consultation");

    expect(await screen.findByText("Closure consultation")).toBeInTheDocument();
    expect(
      screen.queryByText("Wash and restyle closure wig"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("Closure consultation"));
    expect(
      screen.getByRole("combobox", { name: /service title/i }),
    ).toHaveTextContent("Closure consultation");

    await user.click(screen.getByRole("combobox", { name: /assigned staff/i }));
    expect(await screen.findByRole("option", { name: "Adjoa Tetteh" }))
      .toBeInTheDocument();
    expect(screen.queryByText(/stylist/i)).not.toBeInTheDocument();
  });
});
