import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "shows candidate store hours and requires full-admin confirmation before saving",
    async () => {
      const user = userEvent.setup();

      render(<StoreHoursView />);

      expect(screen.getByText("Store Hours")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Review these suggested hours before Athena uses them as the store schedule.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Needs admin review")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Store timezone" }))
        .toHaveTextContent("America/New_York");
      expect(screen.getByRole("button", { name: "Save store hours" }))
        .toBeDisabled();

      await user.click(screen.getByLabelText("Confirm suggested store hours"));
      await user.click(
        screen.getByRole("combobox", { name: "Store timezone" }),
      );
      await user.click(
        await screen.findByRole("option", { name: "Africa/Accra" }),
      );
      await user.click(
        screen.getByRole("combobox", { name: "Monday close time" }),
      );
      await user.click(await screen.findByRole("option", { name: "06:30 PM" }));
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
              timezone: "Africa/Accra",
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
    },
    15_000,
  );

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

  it("renders store timezone as a selectable combobox", async () => {
    const user = userEvent.setup();

    render(<StoreHoursView />);

    const timezoneSelect = screen.getByRole("combobox", {
      name: "Store timezone",
    });
    expect(timezoneSelect).toHaveTextContent("America/New_York");

    await user.click(timezoneSelect);

    expect(
      await screen.findByRole("option", { name: "Africa/Accra" }),
    ).toBeInTheDocument();
  });

  it("formats raw 24-hour summary times for display", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));
    mockedUseQuery.mockReturnValue({
      ...candidateSchedule,
      nextCloseLabel: "19:00",
      nextOpenLabel: "09:00",
      todayScheduleLabel: "Next open 09:00.",
      timezone: "Africa/Accra",
      weeklyHours: [
        {
          closed: false,
          day: "monday",
          windows: [{ openTime: "09:00", closeTime: "19:00" }],
        },
        {
          closed: true,
          day: "sunday",
          windows: [],
        },
      ],
    } as never);

    render(<StoreHoursView />);

    const summary = screen.getByText("Today").closest("dl");
    expect(summary).not.toBeNull();
    expect(within(summary!).getByText("Closed today.")).toBeInTheDocument();
    expect(within(summary!).getByText("Monday 09:00 AM")).toBeInTheDocument();
    expect(within(summary!).getByText("Monday 07:00 PM")).toBeInTheDocument();
    expect(summary).toHaveTextContent(
      "TodayClosed today.Next openMonday 09:00 AMNext closeMonday 07:00 PM",
    );
  });

  it("orders the summary around the active store window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:00:00.000Z"));
    mockedUseQuery.mockReturnValue({
      ...candidateSchedule,
      nextCloseLabel: "19:00",
      nextOpenLabel: "09:00",
      timezone: "Africa/Accra",
      weeklyHours: [
        {
          closed: false,
          day: "monday",
          windows: [{ openTime: "09:00", closeTime: "19:00" }],
        },
        {
          closed: false,
          day: "tuesday",
          windows: [{ openTime: "09:00", closeTime: "19:00" }],
        },
      ],
    } as never);

    render(<StoreHoursView />);

    const summary = screen.getByText("Today").closest("dl");
    expect(summary).not.toBeNull();
    expect(within(summary!).getByText("Opened 09:00 AM.")).toBeInTheDocument();
    expect(within(summary!).getByText("Monday 07:00 PM")).toBeInTheDocument();
    expect(within(summary!).getByText("Tuesday 09:00 AM")).toBeInTheDocument();
    expect(summary).toHaveTextContent(
      "TodayOpened 09:00 AM.Next closeMonday 07:00 PMNext openTuesday 09:00 AM",
    );
  });

  it("validates overlapping date exceptions before saving", async () => {
    const user = userEvent.setup();
    mockedUseQuery.mockReturnValue({
      ...candidateSchedule,
      exceptions: [
        {
          closed: true,
          date: "2026-07-04",
          label: "Holiday",
          windows: [],
        },
        {
          closed: true,
          date: "2026-07-04",
          label: "Special closure",
          windows: [],
        },
      ],
    } as never);

    render(<StoreHoursView />);

    await user.click(screen.getByLabelText("Confirm suggested store hours"));
    await user.click(screen.getByRole("button", { name: "Save store hours" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "These hours overlap. Adjust one time range before saving.",
    );
    expect(mockUpdateSchedule).not.toHaveBeenCalled();
  });
});
