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
  customerResults: [] as {
    _id: string;
    email?: string;
    fullName: string;
    phoneNumber?: string;
  }[],
  hasFullAdminAccess: true,
  isLoadingPermissions: false,
  isSubmitting: false,
  onCreateIntake: vi.fn().mockResolvedValue(undefined),
  searchQuery: "",
  setSearchQuery: vi.fn(),
  staffOptions: [
    {
      _id: "staff-1",
      email: "adjoa@example.com",
      fullName: "Adjoa Tetteh",
      roles: ["stylist"],
    },
  ],
  storeId: "store-1" as Id<"store">,
  userId: "user-1" as Id<"athenaUser">,
};

describe("ServiceIntakeViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
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
  });

  it("submits a linked-customer intake with a parsed deposit", async () => {
    const user = userEvent.setup();
    const onCreateIntake = vi.fn().mockResolvedValue(undefined);

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
    await user.type(
      screen.getByLabelText(/service title/i),
      "Wash and restyle closure wig",
    );
    await user.selectOptions(
      screen.getByLabelText(/assigned staff/i),
      "staff-1",
    );
    await user.type(screen.getByLabelText(/deposit amount/i), "45");
    await user.selectOptions(screen.getByLabelText(/deposit method/i), "card");
    await user.selectOptions(screen.getByLabelText(/priority/i), "urgent");
    await user.selectOptions(
      screen.getByLabelText(/channel/i),
      "phone_booking",
    );
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
      depositAmount: 45,
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
    expect(screen.getByLabelText(/service title/i)).toHaveValue("");
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
});
