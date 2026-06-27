import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "convex/react";

import { StoreHoursView } from "./StoreHoursView";

const mockUpdateSchedule = vi.fn();
let mockActiveStore: { _id: string; config: Record<string, unknown> } | null =
  null;
let mockHasFullAdminAccess = true;

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    inventory: {
      storeSchedule: {
        getStoreScheduleForAdmin: "getStoreScheduleForAdmin",
        getStoreScheduleSummary: "getStoreScheduleSummary",
      },
    },
  },
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: mockActiveStore,
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasFullAdminAccess: mockHasFullAdminAccess,
    isLoading: false,
  }),
}));

vi.mock("../hooks/useStoreScheduleUpdate", () => ({
  useStoreScheduleUpdate: () => ({
    isUpdating: false,
    updateSchedule: mockUpdateSchedule,
  }),
}));

const mockedUseQuery = vi.mocked(useQuery);

const candidateSchedule = {
  adminConfirmed: false,
  confirmationStatus: "candidate",
  timezone: "America/New_York",
  todayScheduleLabel: "Open today, 9:00 AM to 5:00 PM",
  nextCloseLabel: "Today at 5:00 PM",
  nextOpenLabel: "Tomorrow at 9:00 AM",
  weeklyHours: [
    {
      closed: false,
      day: "monday",
      windows: [{ openTime: "09:00", closeTime: "17:00" }],
    },
    {
      closed: true,
      day: "sunday",
      windows: [],
    },
  ],
  exceptions: [
    {
      closed: true,
      date: "2026-07-04",
      label: "Holiday",
      windows: [],
    },
  ],
};

describe("StoreHoursView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveStore = { _id: "store-1", config: {} };
    mockHasFullAdminAccess = true;
    mockedUseQuery.mockReturnValue(candidateSchedule as never);
    mockUpdateSchedule.mockResolvedValue(undefined);
  });

  it("shows candidate store hours and requires full-admin confirmation before saving", async () => {
    const user = userEvent.setup();

    render(<StoreHoursView />);

    expect(screen.getByText("Store Hours")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review these suggested hours before Athena uses them as the store schedule.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs admin review")).toBeInTheDocument();
    expect(screen.getByText("Open today, 9:00 AM to 5:00 PM")).toBeInTheDocument();
    expect(screen.getByLabelText("Store timezone")).toHaveValue(
      "America/New_York",
    );
    expect(screen.getByRole("button", { name: "Save store hours" }))
      .toBeDisabled();

    await user.click(screen.getByLabelText("Confirm suggested store hours"));
    await user.clear(screen.getByLabelText("Monday close time"));
    await user.type(screen.getByLabelText("Monday close time"), "18:30");
    await user.click(screen.getByRole("button", { name: "Save store hours" }));

    await waitFor(() =>
      expect(mockUpdateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: "store-1",
          schedule: expect.objectContaining({
            dateExceptions: expect.arrayContaining([
              expect.objectContaining({
                closed: true,
                localDate: "2026-07-04",
                note: "Holiday",
              }),
            ]),
            timezone: "America/New_York",
            weeklyClosedDays: expect.arrayContaining([0]),
            weeklyWindows: expect.arrayContaining([
              expect.objectContaining({
                dayOfWeek: 1,
                endMinute: 18 * 60 + 30,
                startMinute: 9 * 60,
              }),
            ]),
          }),
        }),
      ),
    );
  });

  it("keeps non-full-admin accounts in a read-only summary state", () => {
    mockHasFullAdminAccess = false;
    mockedUseQuery.mockReturnValue({
      context: {
        currentWindow: {
          localEndLabel: "5:00 PM",
          localStartLabel: "9:00 AM",
        },
        isOpen: true,
        nextWindow: null,
        phase: "during_window",
        timezone: "America/New_York",
      },
      schedule: {
        dateExceptions: [],
        source: "admin",
        status: "active",
        timezone: "America/New_York",
        weeklyClosedDays: [0],
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
        ],
      },
    } as never);

    render(<StoreHoursView />);

    expect(mockedUseQuery).toHaveBeenCalledWith("getStoreScheduleSummary", {
      storeId: "store-1",
    });
    expect(
      screen.getByText("Store hours are read-only for this account."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Store timezone")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save store hours" }),
    ).not.toBeInTheDocument();
  });

  it("renders weekday rows as one-column rows before wider breakpoints", () => {
    render(<StoreHoursView />);

    expect(screen.getAllByTestId("store-hours-weekday-row")[0]).toHaveClass(
      "grid-cols-1",
    );
  });

  it("associates validation copy with inputs and announces errors", async () => {
    const user = userEvent.setup();

    render(<StoreHoursView />);

    await user.click(screen.getByLabelText("Confirm suggested store hours"));
    await user.clear(screen.getByLabelText("Store timezone"));
    await user.click(screen.getByRole("button", { name: "Save store hours" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Choose a valid store timezone.");
    expect(screen.getByLabelText("Store timezone")).toHaveAttribute(
      "aria-describedby",
      "store-hours-message",
    );
    expect(mockUpdateSchedule).not.toHaveBeenCalled();
  });

  it("validates overlapping date exceptions before saving", async () => {
    const user = userEvent.setup();

    render(<StoreHoursView />);

    await user.click(screen.getByLabelText("Confirm suggested store hours"));
    await user.click(screen.getByRole("button", { name: "Add exception" }));
    await user.type(screen.getByLabelText("Exception 2 date"), "2026-07-04");
    await user.click(screen.getByRole("button", { name: "Save store hours" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "These hours overlap. Adjust one time range before saving.",
    );
    expect(mockUpdateSchedule).not.toHaveBeenCalled();
  });
});
