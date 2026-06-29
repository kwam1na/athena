type ScheduleStatus = "active" | "superseded" | "candidate";
type ScheduleSource = "admin" | "seed" | "import" | "system";

export type StoreScheduleWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  label?: string;
};

export type StoreScheduleExceptionWindow = {
  startMinute: number;
  endMinute: number;
  label?: string;
};

export type StoreScheduleDateException = {
  localDate: string;
  closed: boolean;
  windows: StoreScheduleExceptionWindow[];
  note?: string;
};

export type StoreScheduleDraft = {
  _id?: any;
  organizationId: any;
  storeId: any;
  timezone: string;
  weeklyWindows: StoreScheduleWindow[];
  weeklyClosedDays: number[];
  dateExceptions: StoreScheduleDateException[];
  effectiveFrom: number;
  effectiveTo?: number;
  status: ScheduleStatus;
  source: ScheduleSource;
  createdAt: number;
  updatedAt: number;
  createdByUserId?: any;
  updatedByUserId?: any;
  supersededAt?: number;
  supersededByScheduleId?: any;
};

export type StoreScheduleContextWindow = {
  localDate: string;
  startMinute: number;
  endMinute: number;
  startsAt: number;
  endsAt: number;
  crossesDateBoundary: boolean;
  localStartLabel: string;
  localEndLabel: string;
  label?: string;
};

export type StoreScheduleContext =
  | {
      kind: "resolved";
      timezone: string;
      operatingDate: string;
      phase:
        | "before_first_window"
        | "during_window"
        | "between_windows"
        | "after_last_window"
        | "closed";
      isOpen: boolean;
      scheduleVersionId: string | null;
      currentWindow: StoreScheduleContextWindow | null;
      nextWindow: StoreScheduleContextWindow | null;
    }
  | {
      kind: "missing_schedule";
      timezone: null;
      operatingDate: string;
      phase: "unavailable";
      isOpen: false;
      scheduleVersionId: null;
      currentWindow: null;
      nextWindow: null;
    };

export type StoreOperatingRangeForDateResult =
  | {
      kind: "resolved";
      timezone: string;
      operatingDate: string;
      scheduleVersionId: string | null;
      startAt: number;
      endAt: number;
      windowCount: number;
    }
  | {
      kind: "closed";
      timezone: string;
      operatingDate: string;
      scheduleVersionId: string | null;
      reason: "closed_day";
    }
  | {
      kind: "missing_schedule";
      timezone: null;
      operatingDate: string;
      scheduleVersionId: null;
      reason: "missing_schedule";
    }
  | {
      kind: "invalid";
      timezone: string | null;
      operatingDate: string;
      scheduleVersionId: string | null;
      reason: "invalid_operating_date" | "unresolvable_schedule_window";
    };

export type StoreScheduleValidationResult =
  | { ok: true; fields: Record<string, never> }
  | { ok: false; fields: Record<string, string[]> };

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const WEEK_MINUTES = 7 * 24 * 60;
const NEXT_WINDOW_LOOKAHEAD_DAYS = 21;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string) {
  const cached = formatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

function addField(
  fields: Record<string, string[]>,
  field: string,
  message: string,
) {
  fields[field] ??= [];
  if (!fields[field].includes(message)) {
    fields[field].push(message);
  }
}

function isWholeNumber(value: number) {
  return Number.isFinite(value) && Math.floor(value) === value;
}

function parseLocalDate(localDate: string) {
  const match = localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, utc };
}

function localDateFromUtc(utc: number) {
  return new Date(utc).toISOString().slice(0, 10);
}

function addDays(localDate: string, days: number) {
  const parsed = parseLocalDate(localDate);
  if (!parsed) {
    throw new Error(`Invalid local date: ${localDate}`);
  }

  return localDateFromUtc(parsed.utc + days * DAY_MS);
}

function dayOfWeek(localDate: string) {
  const parsed = parseLocalDate(localDate);
  if (!parsed) {
    throw new Error(`Invalid local date: ${localDate}`);
  }

  return new Date(parsed.utc).getUTCDay();
}

function localPartsAt(timestamp: number, timezone: string) {
  const fields: Record<string, string> = {};

  for (const part of getFormatter(timezone).formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") {
      fields[part.type] = part.value;
    }
  }

  const year = Number(fields.year);
  const month = Number(fields.month);
  const day = Number(fields.day);
  const hour = Number(fields.hour);
  const minute = Number(fields.minute);
  const second = Number(fields.second);

  return {
    year,
    month,
    day,
    hour: hour === 24 ? 0 : hour,
    minute,
    second,
    localDate: `${fields.year}-${fields.month}-${fields.day}`,
  };
}

function localMinuteAt(timestamp: number, timezone: string) {
  const parts = localPartsAt(timestamp, timezone);
  return parts.hour * 60 + parts.minute;
}

function localDateMinuteToUtcCandidates(
  localDate: string,
  minuteOfDay: number,
  timezone: string,
) {
  const parsed = parseLocalDate(localDate);
  if (!parsed) {
    return [];
  }

  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const wantedUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, minute);
  let candidate = wantedUtc;

  for (let index = 0; index < 5; index += 1) {
    const parts = localPartsAt(candidate, timezone);
    const actualUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    const delta = wantedUtc - actualUtc;
    candidate += delta;
    if (delta === 0) {
      break;
    }
  }

  const matches = new Set<number>();
  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 30) {
    const timestamp = candidate + offsetMinutes * MINUTE_MS;
    const parts = localPartsAt(timestamp, timezone);

    if (
      parts.year === parsed.year &&
      parts.month === parsed.month &&
      parts.day === parsed.day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      matches.add(timestamp);
    }
  }

  return [...matches].sort((left, right) => left - right);
}

function localDateMinuteToUtc(
  localDate: string,
  minuteOfDay: number,
  timezone: string,
) {
  return localDateMinuteToUtcCandidates(localDate, minuteOfDay, timezone)[0] ?? null;
}

function minutesToLabel(minuteOfDay: number) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function validateMinute(
  fields: Record<string, string[]>,
  field: string,
  value: number,
) {
  if (!isWholeNumber(value) || value < 0 || value > 23 * 60 + 59) {
    addField(fields, field, "Use a valid store-local time.");
  }
}

function validateDayOfWeek(
  fields: Record<string, string[]>,
  field: string,
  value: number,
) {
  if (!isWholeNumber(value) || value < 0 || value > 6) {
    addField(fields, field, "Use a valid day of week.");
  }
}

function validateWindowShape(
  fields: Record<string, string[]>,
  field: string,
  window: { startMinute: number; endMinute: number },
) {
  validateMinute(fields, field, window.startMinute);
  validateMinute(fields, field, window.endMinute);

  if (window.startMinute === window.endMinute) {
    addField(fields, field, "Start and end times must be different.");
  }
}

function expandedWindowRange(
  window: { dayOfWeek: number; startMinute: number; endMinute: number },
) {
  const start = window.dayOfWeek * 24 * 60 + window.startMinute;
  let end = window.dayOfWeek * 24 * 60 + window.endMinute;
  if (end <= start) {
    end += 24 * 60;
  }

  return { start, end };
}

function hasOverlaps(ranges: Array<{ start: number; end: number }>) {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) {
      return true;
    }
  }

  return false;
}

function weeklyWindowsOverlap(windows: StoreScheduleWindow[]) {
  const ranges = windows.flatMap((window) => {
    const range = expandedWindowRange(window);
    return [
      range,
      {
        start: range.start + WEEK_MINUTES,
        end: range.end + WEEK_MINUTES,
      },
    ];
  });

  return hasOverlaps(ranges);
}

function exceptionWindowsOverlap(windows: StoreScheduleExceptionWindow[]) {
  const ranges = windows.map((window) => {
    let end = window.endMinute;
    if (end <= window.startMinute) {
      end += 24 * 60;
    }
    return { start: window.startMinute, end };
  });

  return hasOverlaps(ranges);
}

export function isValidStoreTimezone(timezone: string) {
  if (!timezone.trim()) {
    return false;
  }

  try {
    getFormatter(timezone).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function validateStoreScheduleDraft(
  schedule: StoreScheduleDraft,
): StoreScheduleValidationResult {
  const fields: Record<string, string[]> = {};
  const validTimezone = isValidStoreTimezone(schedule.timezone);

  if (!validTimezone) {
    addField(fields, "timezone", "Choose a valid store timezone.");
  }

  if (!Number.isFinite(schedule.effectiveFrom)) {
    addField(fields, "effectiveFrom", "Choose a valid effective start.");
  }

  if (
    schedule.effectiveTo !== undefined &&
    (!Number.isFinite(schedule.effectiveTo) ||
      schedule.effectiveTo <= schedule.effectiveFrom)
  ) {
    addField(fields, "effectiveTo", "Choose an effective end after the start.");
  }

  for (const day of schedule.weeklyClosedDays) {
    validateDayOfWeek(fields, "weeklyClosedDays", day);
  }

  if (new Set(schedule.weeklyClosedDays).size !== schedule.weeklyClosedDays.length) {
    addField(fields, "weeklyClosedDays", "Closed days must be unique.");
  }

  const closedDaySet = new Set(schedule.weeklyClosedDays);
  for (const window of schedule.weeklyWindows) {
    validateDayOfWeek(fields, "weeklyWindows", window.dayOfWeek);
    validateWindowShape(fields, "weeklyWindows", window);

    if (closedDaySet.has(window.dayOfWeek)) {
      addField(fields, "weeklyWindows", "Closed days cannot include hours.");
    }
  }

  if (weeklyWindowsOverlap(schedule.weeklyWindows)) {
    addField(
      fields,
      "weeklyWindows",
      "These hours overlap. Adjust one time range before saving.",
    );
  }

  const exceptionDates = new Set<string>();
  for (const exception of schedule.dateExceptions) {
    if (!parseLocalDate(exception.localDate)) {
      addField(fields, "dateExceptions", "Use valid exception dates.");
      continue;
    }

    if (exceptionDates.has(exception.localDate)) {
      addField(fields, "dateExceptions", "Exception dates must be unique.");
    }
    exceptionDates.add(exception.localDate);

    if (exception.closed && exception.windows.length > 0) {
      addField(fields, "dateExceptions", "Closed exception dates cannot include hours.");
    }

    for (const window of exception.windows) {
      validateWindowShape(fields, "dateExceptions", window);

      if (validTimezone) {
        const startCandidates = localDateMinuteToUtcCandidates(
          exception.localDate,
          window.startMinute,
          schedule.timezone,
        );
        const endLocalDate =
          window.endMinute <= window.startMinute
            ? addDays(exception.localDate, 1)
            : exception.localDate;
        const endCandidates = localDateMinuteToUtcCandidates(
          endLocalDate,
          window.endMinute,
          schedule.timezone,
        );

        if (startCandidates.length === 0 || endCandidates.length === 0) {
          addField(
            fields,
            "dateExceptions",
            "Some exception hours do not exist in the selected timezone.",
          );
        }

        if (startCandidates.length > 1 || endCandidates.length > 1) {
          addField(
            fields,
            "dateExceptions",
            "Some exception hours are ambiguous in the selected timezone.",
          );
        }
      }
    }

    if (exceptionWindowsOverlap(exception.windows)) {
      addField(
        fields,
        "dateExceptions",
        "These hours overlap. Adjust one time range before saving.",
      );
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return { ok: true, fields: {} };
}

function windowsForLocalDate(schedule: StoreScheduleDraft, localDate: string) {
  const exception = schedule.dateExceptions.find(
    (item) => item.localDate === localDate,
  );
  if (exception) {
    return exception.closed
      ? []
      : exception.windows.map((window) => ({
          ...window,
          dayOfWeek: dayOfWeek(localDate),
        }));
  }

  const localDayOfWeek = dayOfWeek(localDate);
  if (schedule.weeklyClosedDays.includes(localDayOfWeek)) {
    return [];
  }

  return schedule.weeklyWindows.filter(
    (window) => window.dayOfWeek === localDayOfWeek,
  );
}

function toContextWindow(
  schedule: StoreScheduleDraft,
  localDate: string,
  window: StoreScheduleWindow | (StoreScheduleExceptionWindow & { dayOfWeek: number }),
): StoreScheduleContextWindow | null {
  const startsAt = localDateMinuteToUtc(
    localDate,
    window.startMinute,
    schedule.timezone,
  );
  const endLocalDate =
    window.endMinute <= window.startMinute ? addDays(localDate, 1) : localDate;
  const endsAt = localDateMinuteToUtc(
    endLocalDate,
    window.endMinute,
    schedule.timezone,
  );

  if (startsAt === null || endsAt === null) {
    return null;
  }

  return {
    localDate,
    startMinute: window.startMinute,
    endMinute: window.endMinute,
    startsAt,
    endsAt,
    crossesDateBoundary: endLocalDate !== localDate,
    localStartLabel: minutesToLabel(window.startMinute),
    localEndLabel: minutesToLabel(window.endMinute),
    label: window.label,
  };
}

function contextWindowsForDate(schedule: StoreScheduleDraft, localDate: string) {
  return windowsForLocalDate(schedule, localDate)
    .map((window) => toContextWindow(schedule, localDate, window))
    .filter((window): window is StoreScheduleContextWindow => window !== null)
    .sort((left, right) => left.startsAt - right.startsAt);
}

function findNextWindow(
  schedule: StoreScheduleDraft,
  localDate: string,
  at: number,
) {
  for (let offset = 0; offset <= NEXT_WINDOW_LOOKAHEAD_DAYS; offset += 1) {
    const date = addDays(localDate, offset);
    const next = contextWindowsForDate(schedule, date).find(
      (window) => window.startsAt > at,
    );

    if (next) {
      return next;
    }
  }

  return null;
}

export function getMissingStoreScheduleContext(args: {
  at: number;
}): StoreScheduleContext {
  return {
    kind: "missing_schedule",
    timezone: null,
    operatingDate: new Date(args.at).toISOString().slice(0, 10),
    phase: "unavailable",
    isOpen: false,
    scheduleVersionId: null,
    currentWindow: null,
    nextWindow: null,
  };
}

export function resolveStoreScheduleContext(args: {
  schedule: StoreScheduleDraft | null | undefined;
  at: number;
}): StoreScheduleContext {
  if (!args.schedule) {
    return getMissingStoreScheduleContext({ at: args.at });
  }

  const { schedule, at } = args;
  const localDate = localPartsAt(at, schedule.timezone).localDate;
  const previousDate = addDays(localDate, -1);
  const currentCandidates = [
    ...contextWindowsForDate(schedule, previousDate),
    ...contextWindowsForDate(schedule, localDate),
  ];
  const currentWindow =
    currentCandidates.find((window) => at >= window.startsAt && at < window.endsAt) ??
    null;

  if (currentWindow) {
    return {
      kind: "resolved",
      timezone: schedule.timezone,
      operatingDate: currentWindow.localDate,
      phase: "during_window",
      isOpen: true,
      scheduleVersionId: schedule._id ?? null,
      currentWindow,
      nextWindow: findNextWindow(schedule, localDate, at),
    };
  }

  const localWindows = contextWindowsForDate(schedule, localDate);
  const nextWindow = findNextWindow(schedule, localDate, at);
  const previousWindow =
    currentCandidates
      .filter((window) => at >= window.endsAt)
      .sort((left, right) => right.endsAt - left.endsAt)[0] ?? null;

  if (previousWindow?.crossesDateBoundary) {
    return {
      kind: "resolved",
      timezone: schedule.timezone,
      operatingDate: previousWindow.localDate,
      phase: "after_last_window",
      isOpen: false,
      scheduleVersionId: schedule._id ?? null,
      currentWindow: null,
      nextWindow,
    };
  }

  if (localWindows.length === 0) {
    return {
      kind: "resolved",
      timezone: schedule.timezone,
      operatingDate: localDate,
      phase: "closed",
      isOpen: false,
      scheduleVersionId: schedule._id ?? null,
      currentWindow: null,
      nextWindow,
    };
  }

  const firstWindow = localWindows[0];
  const lastWindow = localWindows[localWindows.length - 1];
  const localMinute = localMinuteAt(at, schedule.timezone);
  const phase =
    at < firstWindow.startsAt
      ? "before_first_window"
      : at >= lastWindow.endsAt
        ? "after_last_window"
        : "between_windows";

  return {
    kind: "resolved",
    timezone: schedule.timezone,
    operatingDate: localDate,
    phase,
    isOpen: false,
    scheduleVersionId: schedule._id ?? null,
    currentWindow: null,
    nextWindow:
      nextWindow ??
      (localMinute < firstWindow.startMinute ? firstWindow : null),
  };
}

export function resolveStoreOperatingRangeForDate(args: {
  schedule: StoreScheduleDraft | null | undefined;
  operatingDate: string;
}): StoreOperatingRangeForDateResult {
  if (!parseLocalDate(args.operatingDate)) {
    return {
      kind: "invalid",
      timezone: args.schedule?.timezone ?? null,
      operatingDate: args.operatingDate,
      scheduleVersionId: args.schedule?._id ?? null,
      reason: "invalid_operating_date",
    };
  }

  if (!args.schedule) {
    return {
      kind: "missing_schedule",
      timezone: null,
      operatingDate: args.operatingDate,
      scheduleVersionId: null,
      reason: "missing_schedule",
    };
  }

  const windows = contextWindowsForDate(args.schedule, args.operatingDate);
  if (windows.length === 0) {
    return {
      kind: "closed",
      timezone: args.schedule.timezone,
      operatingDate: args.operatingDate,
      scheduleVersionId: args.schedule._id ?? null,
      reason: "closed_day",
    };
  }

  const startAt = Math.min(...windows.map((window) => window.startsAt));
  const endAt = Math.max(...windows.map((window) => window.endsAt));

  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    return {
      kind: "invalid",
      timezone: args.schedule.timezone,
      operatingDate: args.operatingDate,
      scheduleVersionId: args.schedule._id ?? null,
      reason: "unresolvable_schedule_window",
    };
  }

  return {
    kind: "resolved",
    timezone: args.schedule.timezone,
    operatingDate: args.operatingDate,
    scheduleVersionId: args.schedule._id ?? null,
    startAt,
    endAt,
    windowCount: windows.length,
  };
}

export function rangesOverlap(
  left: { effectiveFrom: number; effectiveTo?: number },
  right: { effectiveFrom: number; effectiveTo?: number },
) {
  const leftEnd = left.effectiveTo ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveTo ?? Number.POSITIVE_INFINITY;

  return left.effectiveFrom < rightEnd && right.effectiveFrom < leftEnd;
}

export function validateNoEffectiveRangeOverlap(
  candidate: { _id?: string; effectiveFrom: number; effectiveTo?: number },
  existingSchedules: Array<{
    _id?: string;
    effectiveFrom: number;
    effectiveTo?: number;
    status?: string;
  }>,
) {
  return !existingSchedules.some((existing) => {
    if (existing.status && existing.status !== "active") {
      return false;
    }

    if (candidate._id && existing._id === candidate._id) {
      return false;
    }

    return rangesOverlap(candidate, existing);
  });
}
