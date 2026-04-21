import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceAppointmentsViewContent } from "./ServiceAppointmentsView";

const baseProps = {
  appointments: [
    {
      _id: "appointment-1",
      assignedStaffName: "Adjoa Tetteh",
      customerName: "Ama Mensah",
      endAt: 1_710_000_000_000,
      serviceCatalogName: "Closure Repair",
      startAt: 1_709_999_640_000,
      status: "scheduled",
    },
  ],
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
  onCancelAppointment: vi.fn().mockResolvedValue(undefined),
  onConvertAppointment: vi.fn().mockResolvedValue(undefined),
  onCreateAppointment: vi.fn().mockResolvedValue(undefined),
  onRescheduleAppointment: vi.fn().mockResolvedValue(undefined),
  searchQuery: "",
  setSearchQuery: vi.fn(),
  staffOptions: [
    {
      _id: "staff-1",
      fullName: "Adjoa Tetteh",
      roles: ["stylist"],
    },
  ],
};

describe("ServiceAppointmentsViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
  });

  it("validates required appointment fields before scheduling", async () => {
    const user = userEvent.setup();
    const onCreateAppointment = vi.fn().mockResolvedValue(undefined);

    render(
      <ServiceAppointmentsViewContent
        {...baseProps}
        onCreateAppointment={onCreateAppointment}
      />,
    );

    await user.click(screen.getByRole("button", { name: /schedule appointment/i }));

    expect(onCreateAppointment).not.toHaveBeenCalled();
    expect(screen.getByText("Select a customer.")).toBeInTheDocument();
    expect(screen.getByText("Select a catalog item.")).toBeInTheDocument();
    expect(screen.getByText("Select a staff member.")).toBeInTheDocument();
    expect(screen.getByText("Choose an appointment start time.")).toBeInTheDocument();
  });

  it("creates appointments from catalog and selected customers", async () => {
    const user = userEvent.setup();
    const onCreateAppointment = vi.fn().mockResolvedValue(undefined);

    render(
      <ServiceAppointmentsViewContent
        {...baseProps}
        onCreateAppointment={onCreateAppointment}
      />,
    );

    await user.click(screen.getByRole("button", { name: /use customer/i }));
    await user.selectOptions(screen.getByLabelText(/service catalog/i), "catalog-1");
    await user.selectOptions(screen.getByLabelText(/assigned staff/i), "staff-1");
    await user.type(screen.getByLabelText(/appointment start/i), "2026-05-01T10:00");
    await user.click(screen.getByRole("button", { name: /schedule appointment/i }));

    await waitFor(() => expect(onCreateAppointment).toHaveBeenCalledTimes(1));
    expect(onCreateAppointment.mock.calls[0][0]).toMatchObject({
      assignedStaffProfileId: "staff-1",
      customerProfileId: "customer-1",
      serviceCatalogId: "catalog-1",
    });
    expect(typeof onCreateAppointment.mock.calls[0][0].startAt).toBe("number");
  });

  it("reschedules, cancels, and converts appointments", async () => {
    const user = userEvent.setup();
    const onCancelAppointment = vi.fn().mockResolvedValue(undefined);
    const onConvertAppointment = vi.fn().mockResolvedValue(undefined);
    const onRescheduleAppointment = vi.fn().mockResolvedValue(undefined);

    render(
      <ServiceAppointmentsViewContent
        {...baseProps}
        onCancelAppointment={onCancelAppointment}
        onConvertAppointment={onConvertAppointment}
        onRescheduleAppointment={onRescheduleAppointment}
      />,
    );

    await user.type(
      screen.getByLabelText(/new time for closure repair/i),
      "2026-05-02T12:30",
    );
    await user.click(screen.getByRole("button", { name: /reschedule closure repair/i }));

    await waitFor(() => expect(onRescheduleAppointment).toHaveBeenCalledTimes(1));
    expect(onRescheduleAppointment.mock.calls[0][0]).toMatchObject({
      appointmentId: "appointment-1",
    });
    expect(typeof onRescheduleAppointment.mock.calls[0][0].startAt).toBe("number");

    await user.click(screen.getByRole("button", { name: /cancel closure repair/i }));
    expect(onCancelAppointment).toHaveBeenCalledWith({
      appointmentId: "appointment-1",
    });

    await user.click(screen.getByRole("button", { name: /convert closure repair/i }));
    expect(onConvertAppointment).toHaveBeenCalledWith({
      appointmentId: "appointment-1",
    });
  });
});
