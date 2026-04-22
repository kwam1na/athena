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

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: RegExp
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

async function chooseDateTime(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  hours: string,
  minutes: string
) {
  await user.click(screen.getByLabelText(label));

  const dayCell = (await screen.findAllByRole("gridcell")).find((cell) =>
    /^\d+$/.test((cell.textContent ?? "").trim())
  );

  if (!dayCell) {
    throw new Error("No calendar day button found.");
  }

  const dayButton = dayCell.querySelector("button");

  if (dayButton) {
    await user.click(dayButton);
  } else {
    await user.click(dayCell);
  }
  await user.clear(screen.getByPlaceholderText("HH"));
  await user.type(screen.getByPlaceholderText("HH"), hours);
  await user.clear(screen.getByPlaceholderText("MM"));
  await user.type(screen.getByPlaceholderText("MM"), minutes);
  await user.click(screen.getByRole("button", { name: /done/i }));
}

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
    await chooseSelectOption(user, /service catalog/i, /closure repair/i);
    await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);
    await chooseDateTime(user, /appointment start/i, "10", "00");
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

    await chooseDateTime(user, /new time for closure repair/i, "12", "30");
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
