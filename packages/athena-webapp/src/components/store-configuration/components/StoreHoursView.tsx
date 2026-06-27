import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { usePermissions } from "@/hooks/usePermissions";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type {
  StoreScheduleDayKey,
  StoreScheduleExceptionInput,
  StoreScheduleWeeklyDayInput,
} from "../hooks/useStoreScheduleUpdate";
import { useStoreScheduleUpdate } from "../hooks/useStoreScheduleUpdate";

type StoreScheduleQueryResult = {
  adminConfirmed?: boolean | null;
  confirmationStatus?: "candidate" | "admin_confirmed" | string | null;
  exceptions?: StoreScheduleExceptionInput[] | null;
  nextCloseLabel?: string | null;
  nextOpenLabel?: string | null;
  source?: string | null;
  scheduleVersionId?: string | null;
  summary?: {
    nextCloseLabel?: string | null;
    nextOpenLabel?: string | null;
    todayScheduleLabel?: string | null;
    timezoneLabel?: string | null;
  } | null;
  timezone?: string | null;
  todayScheduleLabel?: string | null;
  weeklyHours?: StoreScheduleWeeklyDayInput[] | null;
  context?: {
    currentWindow?: {
      localEndLabel: string;
      localStartLabel: string;
    } | null;
    isOpen?: boolean;
    nextWindow?: {
      localEndLabel: string;
      localStartLabel: string;
    } | null;
    phase?: string;
    timezone?: string | null;
  } | null;
  schedule?: {
    dateExceptions?: Array<{
      closed: boolean;
      localDate: string;
      note?: string;
      windows: Array<{
        endMinute: number;
        startMinute: number;
      }>;
    }> | null;
    source?: string | null;
    status?: string | null;
    timezone?: string | null;
    weeklyClosedDays?: number[] | null;
    weeklyWindows?: Array<{
      dayOfWeek: number;
      endMinute: number;
      startMinute: number;
    }> | null;
  } | null;
};

type StoreScheduleAdminQuery = FunctionReference<
  "query",
  "public",
  { storeId: string },
  StoreScheduleQueryResult | null
>;

const storeScheduleApi = (
  api as unknown as {
    inventory: {
      storeSchedule: {
        getStoreScheduleForAdmin: StoreScheduleAdminQuery;
        getStoreScheduleSummary: StoreScheduleAdminQuery;
      };
    };
  }
).inventory.storeSchedule;

const WEEKDAYS: Array<{ day: StoreScheduleDayKey; label: string }> = [
  { day: "monday", label: "Monday" },
  { day: "tuesday", label: "Tuesday" },
  { day: "wednesday", label: "Wednesday" },
  { day: "thursday", label: "Thursday" },
  { day: "friday", label: "Friday" },
  { day: "saturday", label: "Saturday" },
  { day: "sunday", label: "Sunday" },
];

const DAY_OF_WEEK_BY_KEY: Record<StoreScheduleDayKey, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DEFAULT_WEEKLY_HOURS: StoreScheduleWeeklyDayInput[] = WEEKDAYS.map(
  ({ day }) => ({
    closed: day === "sunday",
    day,
    windows:
      day === "sunday" ? [] : [{ openTime: "09:00", closeTime: "17:00" }],
  }),
);

function normalizeWeeklyHours(
  weeklyHours?: StoreScheduleWeeklyDayInput[] | null,
) {
  if (!weeklyHours?.length) {
    return DEFAULT_WEEKLY_HOURS;
  }

  return WEEKDAYS.map(({ day }) => {
    const savedDay = weeklyHours.find((entry) => entry.day === day);
    if (!savedDay) {
      return DEFAULT_WEEKLY_HOURS.find((entry) => entry.day === day)!;
    }

    return {
      closed: Boolean(savedDay.closed),
      day,
      windows: savedDay.closed
        ? []
        : savedDay.windows?.length
          ? savedDay.windows
          : [{ openTime: "09:00", closeTime: "17:00" }],
    };
  });
}

function normalizeException(
  exception: StoreScheduleExceptionInput,
): StoreScheduleExceptionInput {
  return {
    closed: Boolean(exception.closed),
    date: exception.date,
    label: exception.label ?? "",
    windows: exception.closed
      ? []
      : exception.windows?.length
        ? exception.windows
        : [{ openTime: "09:00", closeTime: "17:00" }],
  };
}

function isCandidateSchedule(schedule?: StoreScheduleQueryResult | null) {
  return (
    schedule?.confirmationStatus === "candidate" ||
    schedule?.adminConfirmed === false ||
    schedule?.source === "migration_candidate"
  );
}

function getDayLabel(day: StoreScheduleDayKey) {
  return WEEKDAYS.find((entry) => entry.day === day)?.label ?? day;
}

function hasDuplicateExceptionDates(exceptions: StoreScheduleExceptionInput[]) {
  const dates = exceptions
    .map((exception) => exception.date.trim())
    .filter(Boolean);

  return new Set(dates).size !== dates.length;
}

function timeInputToMinute(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function minuteToTimeInput(minute: number) {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minuteOfHour = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minuteOfHour).padStart(2, "0")}`;
}

function normalizeScheduleForForm(schedule?: StoreScheduleQueryResult | null) {
  if (schedule === undefined) {
    return undefined;
  }

  if (!schedule?.schedule) {
    return schedule ?? null;
  }

  const weeklyHours = WEEKDAYS.map(({ day }) => {
    const dayOfWeek = DAY_OF_WEEK_BY_KEY[day];
    const windows =
      schedule.schedule?.weeklyWindows
        ?.filter((window) => window.dayOfWeek === dayOfWeek)
        .map((window) => ({
          openTime: minuteToTimeInput(window.startMinute),
          closeTime: minuteToTimeInput(window.endMinute),
        })) ?? [];

    return {
      closed:
        schedule.schedule?.weeklyClosedDays?.includes(dayOfWeek) ||
        windows.length === 0,
      day,
      windows,
    };
  });
  const exceptions =
    schedule.schedule.dateExceptions?.map((exception) => ({
      closed: exception.closed,
      date: exception.localDate,
      label: exception.note,
      windows: exception.windows.map((window) => ({
        openTime: minuteToTimeInput(window.startMinute),
        closeTime: minuteToTimeInput(window.endMinute),
      })),
    })) ?? [];
  const currentOrNextWindow =
    schedule.context?.currentWindow ?? schedule.context?.nextWindow ?? null;
  const todayScheduleLabel = schedule.context?.isOpen
    ? `Open until ${schedule.context.currentWindow?.localEndLabel ?? "close"}.`
    : schedule.context?.phase === "closed"
      ? "Closed today."
      : currentOrNextWindow?.localStartLabel
        ? `Next open ${currentOrNextWindow.localStartLabel}.`
        : "Today follows the weekly store hours.";
  const nextCloseLabel = currentOrNextWindow?.localEndLabel ?? null;
  const nextOpenLabel = currentOrNextWindow?.localStartLabel ?? null;
  const timezone = schedule.schedule.timezone ?? "America/New_York";

  return {
    ...schedule,
    adminConfirmed:
      schedule.schedule.status === "active" && schedule.schedule.source === "admin",
    confirmationStatus:
      schedule.schedule.status === "active" && schedule.schedule.source === "admin"
        ? "admin_confirmed"
        : "candidate",
    exceptions,
    nextCloseLabel,
    nextOpenLabel,
    source: schedule.schedule.source,
    summary: {
      nextCloseLabel,
      nextOpenLabel,
      todayScheduleLabel,
      timezoneLabel: timezone,
    },
    timezone,
    todayScheduleLabel,
    weeklyHours,
  } satisfies StoreScheduleQueryResult;
}

function buildStoreSchedulePayload(args: {
  exceptions: StoreScheduleExceptionInput[];
  scheduleVersionId?: string | null;
  timezone: string;
  weeklyHours: StoreScheduleWeeklyDayInput[];
}) {
  const weeklyWindows: Array<{
    dayOfWeek: number;
    endMinute: number;
    startMinute: number;
  }> = [];
  const weeklyClosedDays: number[] = [];
  const dateExceptions: Array<{
    closed: boolean;
    localDate: string;
    note?: string;
    windows: Array<{
      endMinute: number;
      startMinute: number;
    }>;
  }> = [];

  for (const entry of args.weeklyHours) {
    const dayOfWeek = DAY_OF_WEEK_BY_KEY[entry.day];

    if (entry.closed) {
      weeklyClosedDays.push(dayOfWeek);
      continue;
    }

    for (const window of entry.windows) {
      const startMinute = timeInputToMinute(window.openTime);
      const endMinute = timeInputToMinute(window.closeTime);

      if (startMinute === null || endMinute === null) {
        return null;
      }

      weeklyWindows.push({ dayOfWeek, startMinute, endMinute });
    }
  }

  for (const exception of args.exceptions) {
    if (!exception.date.trim()) {
      return null;
    }

    const windows = [];
    if (!exception.closed) {
      for (const window of exception.windows) {
        const startMinute = timeInputToMinute(window.openTime);
        const endMinute = timeInputToMinute(window.closeTime);

        if (startMinute === null || endMinute === null) {
          return null;
        }

        windows.push({ startMinute, endMinute });
      }
    }

    dateExceptions.push({
      closed: exception.closed,
      localDate: exception.date,
      note: exception.label?.trim() || undefined,
      windows,
    });
  }

  return {
    dateExceptions,
    effectiveFrom: Date.now(),
    ...(args.scheduleVersionId
      ? { supersedesScheduleId: args.scheduleVersionId as Id<"storeSchedule"> }
      : {}),
    timezone: args.timezone,
    weeklyClosedDays,
    weeklyWindows,
  };
}

export const StoreHoursView = () => {
  const { activeStore } = useGetActiveStore();
  const { hasFullAdminAccess, isLoading } = usePermissions();
  const rawSchedule = useQuery(
    hasFullAdminAccess
      ? storeScheduleApi.getStoreScheduleForAdmin
      : storeScheduleApi.getStoreScheduleSummary,
    !isLoading && activeStore?._id ? { storeId: activeStore._id } : "skip",
  ) as StoreScheduleQueryResult | null | undefined;
  const schedule = useMemo(
    () => normalizeScheduleForForm(rawSchedule),
    [rawSchedule],
  );
  const { isUpdating, updateSchedule } = useStoreScheduleUpdate();
  const [timezone, setTimezone] = useState("America/New_York");
  const [weeklyHours, setWeeklyHours] = useState(DEFAULT_WEEKLY_HOURS);
  const [exceptions, setExceptions] = useState<StoreScheduleExceptionInput[]>(
    [],
  );
  const [confirmCandidate, setConfirmCandidate] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  const candidateSchedule = isCandidateSchedule(schedule);
  const statusLabel = candidateSchedule ? "Needs admin review" : "Admin confirmed";
  const summary = useMemo(
    () => ({
      nextClose:
        schedule?.summary?.nextCloseLabel ??
        schedule?.nextCloseLabel ??
        "Next close not available",
      nextOpen:
        schedule?.summary?.nextOpenLabel ??
        schedule?.nextOpenLabel ??
        "Next open not available",
      timezone:
        schedule?.summary?.timezoneLabel ??
        schedule?.timezone ??
        timezone,
      today:
        schedule?.summary?.todayScheduleLabel ??
        schedule?.todayScheduleLabel ??
        "Today follows the weekly store hours.",
    }),
    [schedule, timezone],
  );

  useEffect(() => {
    if (schedule === undefined) {
      return;
    }

    setTimezone(schedule?.timezone ?? "America/New_York");
    setWeeklyHours(normalizeWeeklyHours(schedule?.weeklyHours));
    setExceptions((schedule?.exceptions ?? []).map(normalizeException));
    setConfirmCandidate(false);
    setIsDirty(false);
    setMessage(null);
  }, [schedule]);

  const updateDay = (
    day: StoreScheduleDayKey,
    updater: (entry: StoreScheduleWeeklyDayInput) => StoreScheduleWeeklyDayInput,
  ) => {
    setWeeklyHours((current) =>
      current.map((entry) => (entry.day === day ? updater(entry) : entry)),
    );
    setIsDirty(true);
  };

  const updateException = (
    index: number,
    updater: (entry: StoreScheduleExceptionInput) => StoreScheduleExceptionInput,
  ) => {
    setExceptions((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? updater(entry) : entry,
      ),
    );
    setIsDirty(true);
  };

  const addException = () => {
    setExceptions((current) => [
      ...current,
      {
        closed: true,
        date: "",
        label: "",
        windows: [],
      },
    ]);
    setIsDirty(true);
  };

  const removeException = (index: number) => {
    setExceptions((current) =>
      current.filter((_entry, entryIndex) => entryIndex !== index),
    );
    setIsDirty(true);
  };

  const resetForm = () => {
    setTimezone(schedule?.timezone ?? "America/New_York");
    setWeeklyHours(normalizeWeeklyHours(schedule?.weeklyHours));
    setExceptions((schedule?.exceptions ?? []).map(normalizeException));
    setConfirmCandidate(false);
    setIsDirty(false);
    setMessage(null);
  };

  const validate = () => {
    if (!timezone.trim()) {
      return "Choose a valid store timezone.";
    }

    if (hasDuplicateExceptionDates(exceptions)) {
      return "These hours overlap. Adjust one time range before saving.";
    }

    return null;
  };

  const handleSave = async () => {
    if (!activeStore?._id) {
      setMessage({
        kind: "error",
        text: "Store hours were not saved. Review the highlighted fields.",
      });
      return;
    }

    const validationMessage = validate();
    if (validationMessage) {
      setMessage({ kind: "error", text: validationMessage });
      return;
    }

    const nextSchedule = buildStoreSchedulePayload({
      exceptions,
      scheduleVersionId: schedule?.scheduleVersionId,
      timezone: timezone.trim(),
      weeklyHours,
    });

    if (!nextSchedule) {
      setMessage({
        kind: "error",
        text: "Store hours were not saved. Review the highlighted fields.",
      });
      return;
    }

    await updateSchedule({
      storeId: activeStore._id,
      schedule: nextSchedule,
      onError: () => {
        setMessage({
          kind: "error",
          text: "Store hours were not saved. Review the highlighted fields.",
        });
      },
      onSuccess: () => {
        setIsDirty(false);
        setConfirmCandidate(false);
        setMessage({ kind: "success", text: "Store hours saved." });
      },
    });
  };

  if (isLoading || schedule === undefined) {
    return (
      <section className="border-b border-border py-layout-2xl">
        <p className="text-sm text-muted-foreground">Loading store hours...</p>
      </section>
    );
  }

  return (
    <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-layout-sm">
        <div className="flex items-center gap-layout-xs">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-2xl font-medium text-foreground">Store Hours</h2>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Set the store business hours Athena uses for Opening, EOD, and future
          store-local workflows.
        </p>
      </div>

      <div className="space-y-layout-lg">
        <div className="flex flex-wrap gap-layout-xs">
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {statusLabel}
          </span>
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {summary.timezone}
          </span>
          {isDirty ? (
            <span
              className="inline-flex rounded-full border border-warning/30 bg-warning/10 px-layout-sm py-layout-2xs text-sm text-warning"
              role="status"
            >
              You have unsaved store hours.
            </span>
          ) : null}
        </div>

        <dl className="grid gap-layout-sm text-sm sm:grid-cols-3">
          <div>
            <dt className="font-medium text-foreground">Today</dt>
            <dd className="mt-layout-2xs text-muted-foreground">
              {summary.today}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Next close</dt>
            <dd className="mt-layout-2xs text-muted-foreground">
              {summary.nextClose}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Next open</dt>
            <dd className="mt-layout-2xs text-muted-foreground">
              {summary.nextOpen}
            </dd>
          </div>
        </dl>

        {candidateSchedule ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm text-sm text-foreground">
            Review these suggested hours before Athena uses them as the store
            schedule.
          </div>
        ) : null}

        {!hasFullAdminAccess ? (
          <div className="rounded-md border border-border bg-background px-layout-md py-layout-sm text-sm text-muted-foreground">
            Store hours are read-only for this account.
          </div>
        ) : (
          <>
            <div className="space-y-layout-xs">
              <Label htmlFor="store-hours-timezone">Store timezone</Label>
              <Input
                aria-describedby={message?.kind === "error" ? "store-hours-message" : undefined}
                className="h-control-standard bg-background"
                id="store-hours-timezone"
                onChange={(event) => {
                  setTimezone(event.target.value);
                  setIsDirty(true);
                }}
                placeholder="America/New_York"
                value={timezone}
              />
              <p className="text-xs text-muted-foreground">
                Use an IANA timezone such as America/New_York.
              </p>
            </div>

            <div className="space-y-layout-sm">
              <h3 className="text-sm font-medium text-foreground">
                Weekly hours
              </h3>
              <div className="divide-y divide-border rounded-md border border-border bg-background">
                {weeklyHours.map((entry) => {
                  const dayLabel = getDayLabel(entry.day);
                  const window = entry.windows[0] ?? {
                    openTime: "09:00",
                    closeTime: "17:00",
                  };

                  return (
                    <div
                      className="grid grid-cols-1 gap-layout-sm p-layout-sm md:grid-cols-[8rem_9rem_1fr]"
                      data-testid="store-hours-weekday-row"
                      key={entry.day}
                    >
                      <div className="font-medium text-foreground">
                        {dayLabel}
                      </div>
                      <label className="flex min-h-control-compact items-center gap-layout-xs text-sm text-muted-foreground">
                        <Checkbox
                          aria-label={`${dayLabel} closed`}
                          checked={entry.closed}
                          onCheckedChange={(checked) =>
                            updateDay(entry.day, (current) => ({
                              ...current,
                              closed: checked === true,
                              windows:
                                checked === true
                                  ? []
                                  : current.windows.length
                                    ? current.windows
                                    : [
                                        {
                                          openTime: "09:00",
                                          closeTime: "17:00",
                                        },
                                      ],
                            }))
                          }
                        />
                        Closed
                      </label>
                      {entry.closed ? (
                        <p className="min-h-control-compact content-center text-sm text-muted-foreground">
                          Closed for store operations.
                        </p>
                      ) : (
                        <div className="grid gap-layout-sm sm:grid-cols-2">
                          <div className="space-y-layout-xs">
                            <Label htmlFor={`${entry.day}-open`}>
                              {dayLabel} open time
                            </Label>
                            <Input
                              className="h-control-standard bg-background"
                              id={`${entry.day}-open`}
                              onChange={(event) =>
                                updateDay(entry.day, (current) => ({
                                  ...current,
                                  windows: [
                                    {
                                      ...window,
                                      openTime: event.target.value,
                                    },
                                  ],
                                }))
                              }
                              type="time"
                              value={window.openTime}
                            />
                          </div>
                          <div className="space-y-layout-xs">
                            <Label htmlFor={`${entry.day}-close`}>
                              {dayLabel} close time
                            </Label>
                            <Input
                              className="h-control-standard bg-background"
                              id={`${entry.day}-close`}
                              onChange={(event) =>
                                updateDay(entry.day, (current) => ({
                                  ...current,
                                  windows: [
                                    {
                                      ...window,
                                      closeTime: event.target.value,
                                    },
                                  ],
                                }))
                              }
                              type="time"
                              value={window.closeTime}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-layout-sm">
              <div className="flex items-center justify-between gap-layout-sm">
                <h3 className="text-sm font-medium text-foreground">
                  Date exceptions
                </h3>
                <Button
                  className="h-control-compact"
                  onClick={addException}
                  type="button"
                  variant="utility"
                >
                  <Plus className="h-4 w-4" />
                  Add exception
                </Button>
              </div>

              {exceptions.length ? (
                <div className="space-y-layout-sm">
                  {exceptions.map((exception, index) => {
                    const window = exception.windows[0] ?? {
                      openTime: "09:00",
                      closeTime: "17:00",
                    };
                    const label = `Exception ${index + 1}`;

                    return (
                      <div
                        className="grid gap-layout-sm rounded-md border border-border bg-background p-layout-sm lg:grid-cols-[10rem_minmax(0,1fr)_9rem_2.75rem]"
                        key={`${exception.date}-${index}`}
                      >
                        <div className="space-y-layout-xs">
                          <Label htmlFor={`exception-${index}-date`}>
                            {label} date
                          </Label>
                          <Input
                            className="h-control-standard bg-background"
                            id={`exception-${index}-date`}
                            onChange={(event) =>
                              updateException(index, (current) => ({
                                ...current,
                                date: event.target.value,
                              }))
                            }
                            type="date"
                            value={exception.date}
                          />
                        </div>
                        <div className="space-y-layout-xs">
                          <Label htmlFor={`exception-${index}-label`}>
                            {label} note
                          </Label>
                          <Input
                            className="h-control-standard bg-background"
                            id={`exception-${index}-label`}
                            onChange={(event) =>
                              updateException(index, (current) => ({
                                ...current,
                                label: event.target.value,
                              }))
                            }
                            placeholder="Holiday or special hours"
                            value={exception.label ?? ""}
                          />
                        </div>
                        <label className="flex min-h-control-standard items-center gap-layout-xs text-sm text-muted-foreground">
                          <Checkbox
                            aria-label={`${label} closed`}
                            checked={exception.closed}
                            onCheckedChange={(checked) =>
                              updateException(index, (current) => ({
                                ...current,
                                closed: checked === true,
                                windows:
                                  checked === true
                                    ? []
                                    : current.windows.length
                                      ? current.windows
                                      : [
                                          {
                                            openTime: "09:00",
                                            closeTime: "17:00",
                                          },
                                        ],
                              }))
                            }
                          />
                          Closed
                        </label>
                        <Button
                          aria-label={`Remove ${label.toLowerCase()}`}
                          className="h-control-standard w-control-standard"
                          onClick={() => removeException(index)}
                          type="button"
                          variant="outline"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        {!exception.closed ? (
                          <div className="grid gap-layout-sm lg:col-span-4 sm:grid-cols-2">
                            <div className="space-y-layout-xs">
                              <Label htmlFor={`exception-${index}-open`}>
                                {label} open time
                              </Label>
                              <Input
                                className="h-control-standard bg-background"
                                id={`exception-${index}-open`}
                                onChange={(event) =>
                                  updateException(index, (current) => ({
                                    ...current,
                                    windows: [
                                      {
                                        ...window,
                                        openTime: event.target.value,
                                      },
                                    ],
                                  }))
                                }
                                type="time"
                                value={window.openTime}
                              />
                            </div>
                            <div className="space-y-layout-xs">
                              <Label htmlFor={`exception-${index}-close`}>
                                {label} close time
                              </Label>
                              <Input
                                className="h-control-standard bg-background"
                                id={`exception-${index}-close`}
                                onChange={(event) =>
                                  updateException(index, (current) => ({
                                    ...current,
                                    windows: [
                                      {
                                        ...window,
                                        closeTime: event.target.value,
                                      },
                                    ],
                                  }))
                                }
                                type="time"
                                value={window.closeTime}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-layout-md py-layout-sm text-sm text-muted-foreground">
                  No date exceptions are configured.
                </p>
              )}
            </div>

            {candidateSchedule ? (
              <label className="flex items-start gap-layout-sm rounded-md border border-border bg-background p-layout-sm text-sm">
                <Checkbox
                  aria-label="Confirm suggested store hours"
                  checked={confirmCandidate}
                  onCheckedChange={(checked) =>
                    setConfirmCandidate(checked === true)
                  }
                />
                <span>
                  <span className="block font-medium text-foreground">
                    Confirm these hours
                  </span>
                  <span className="mt-1 block text-muted-foreground">
                    Mark the suggested schedule as admin-confirmed when the
                    store hours are ready to use.
                  </span>
                </span>
              </label>
            ) : null}

            {message ? (
              <div
                className={
                  message.kind === "error"
                    ? "rounded-md border border-danger/20 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger"
                    : "rounded-md border border-success/20 bg-success/10 px-layout-md py-layout-sm text-sm text-success"
                }
                id="store-hours-message"
                role={message.kind === "error" ? "alert" : "status"}
              >
                {message.text}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-layout-sm border-t border-border pt-layout-md">
              <LoadingButton
                disabled={isUpdating || (candidateSchedule && !confirmCandidate)}
                isLoading={isUpdating}
                onClick={handleSave}
                variant="default"
              >
                Save store hours
              </LoadingButton>
              <Button
                disabled={!isDirty || isUpdating}
                onClick={resetForm}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
