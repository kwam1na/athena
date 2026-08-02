import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "convex/react";

import { StoreHoursView } from "./StoreHoursView";

const mockUpdateSchedule = vi.fn();
let mockActiveStore: {
  _id: string;
  config: Record<string, unknown>;
  organizationId?: string;
} | null = null;
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
        listStoreScheduleVersions: "listStoreScheduleVersions",
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

/** An already-confirmed, versioned schedule — the state a real store is in. */
const activeSchedule = {
  ...candidateSchedule,
  adminConfirmed: true,
  confirmationStatus: "admin_confirmed",
  reportingCycleStartsOn: 1,
  scheduleVersionId: "schedule-1",
};

describe("StoreHoursView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveStore = {
      _id: "store-1",
      config: {},
      organizationId: "org-1",
    };
    mockHasFullAdminAccess = true;
    mockedUseQuery.mockReturnValue(candidateSchedule as never);
    mockUpdateSchedule.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(
      screen.getByRole("combobox", { name: "Store timezone" }),
    ).toHaveTextContent("America/New_York");
    expect(
      screen.getByRole("button", { name: "Save store hours" }),
    ).toBeDisabled();

    await user.click(screen.getByLabelText("Confirm suggested store hours"));
    await user.click(screen.getByRole("combobox", { name: "Store timezone" }));
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
            reportingCycleStartsOn: 1,
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
  }, 15_000);

  it("saves the reporting-cycle weekday without using store hours as a report filter", async () => {
    const user = userEvent.setup();
    render(<StoreHoursView />);

    await user.click(
      screen.getByRole("combobox", { name: "Reporting cycle starts" }),
    );
    await user.click(await screen.findByRole("option", { name: "Wednesday" }));
    await user.click(screen.getByLabelText("Confirm suggested store hours"));
    await user.click(screen.getByRole("button", { name: "Save store hours" }));

    await waitFor(() =>
      expect(mockUpdateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: expect.objectContaining({ reportingCycleStartsOn: 3 }),
        }),
      ),
    );
    expect(
      screen.getByText(
        "Report sales are included by scheduled day, not store hours.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the active and pending reporting-cycle configuration", () => {
    mockedUseQuery.mockImplementation(((query: unknown) => {
      if (query === "listStoreScheduleVersions") {
        return [
          {
            effectiveFrom: Date.parse("2026-08-03T12:00:00.000Z"),
            reportingCycleStartsOn: 3,
            scheduleVersionId: "pending-schedule",
            timezone: "America/New_York",
          },
        ] as never;
      }
      return candidateSchedule as never;
    }) as never);

    render(<StoreHoursView />);

    const configuration = screen.getByLabelText(
      "Reporting cycle configuration",
    );
    expect(within(configuration).getByText("Active")).toBeInTheDocument();
    expect(within(configuration).getByText("Monday")).toBeInTheDocument();
    expect(within(configuration).getByText("Pending")).toBeInTheDocument();
    expect(
      within(configuration).getByText("Wednesday from Aug 3, 2026"),
    ).toBeInTheDocument();
  });

  describe("staged reporting-cycle confirmation", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
      mockedUseQuery.mockReturnValue(activeSchedule as never);
    });

    const changeAnchorAndSave = async (
      user: ReturnType<typeof userEvent.setup>,
    ) => {
      await user.click(
        screen.getByRole("combobox", { name: "Reporting cycle starts" }),
      );
      await user.click(
        await screen.findByRole("option", { name: "Wednesday" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Save store hours" }),
      );
    };

    it("names the effective date and the staged scope before the mutation runs", async () => {
      const user = userEvent.setup();
      render(<StoreHoursView />);

      await changeAnchorAndSave(user);

      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText("Stage this reporting-cycle change?"),
      ).toBeInTheDocument();
      // Tuesday 2026-08-04 in New York -> the next Monday boundary.
      expect(dialog).toHaveTextContent("Wednesday on Aug 10, 2026");
      expect(dialog).toHaveTextContent(
        /Every change in this save .* is staged to Aug 10, 2026 with it\./,
      );
      expect(dialog).toHaveTextContent(
        "To change an operational day now, cancel, save that change on its own, then stage the reporting cycle.",
      );
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
    });

    it("returns to editing without mutating when the operator cancels", async () => {
      const user = userEvent.setup();
      render(<StoreHoursView />);

      await changeAnchorAndSave(user);
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Cancel",
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
      expect(
        screen.getByRole("combobox", { name: "Reporting cycle starts" }),
      ).toHaveTextContent("Wednesday");
    });

    it("stages the change and keeps the post-save message on confirm", async () => {
      const user = userEvent.setup();
      mockUpdateSchedule.mockImplementation(async ({ onSuccess }) => {
        onSuccess?.({
          effectiveFrom: Date.now() + 86_400_000,
          reportingCycleStartsOn: 3,
          scheduleVersionId: "pending-schedule",
          timezone: "America/New_York",
        });
      });

      render(<StoreHoursView />);

      await changeAnchorAndSave(user);
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Stage change",
        }),
      );

      await waitFor(() =>
        expect(mockUpdateSchedule).toHaveBeenCalledWith(
          expect.objectContaining({
            schedule: expect.objectContaining({ reportingCycleStartsOn: 3 }),
          }),
        ),
      );
      expect(
        await screen.findByText(/Reporting cycle change staged for/),
      ).toBeInTheDocument();
    });

    it("saves an operational-only change immediately without a confirmation", async () => {
      const user = userEvent.setup();
      render(<StoreHoursView />);

      await user.click(
        screen.getByRole("combobox", { name: "Monday close time" }),
      );
      await user.click(await screen.findByRole("option", { name: "06:30 PM" }));
      await user.click(
        screen.getByRole("button", { name: "Save store hours" }),
      );

      await waitFor(() => expect(mockUpdateSchedule).toHaveBeenCalled());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
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
  }, 15_000);
});
