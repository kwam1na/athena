import { capitalizeWords } from "../../shared/textCase";

export type StoreScheduleHoursSource = {
  weeklyClosedDays: number[];
  weeklyWindows: Array<{
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
  }>;
};

export type StoreHoursRow = {
  dayLabel: string;
  hoursLabel: string;
};

const WEEK_DAYS = [
  { dayOfWeek: 1, label: "Mon" },
  { dayOfWeek: 2, label: "Tue" },
  { dayOfWeek: 3, label: "Wed" },
  { dayOfWeek: 4, label: "Thu" },
  { dayOfWeek: 5, label: "Fri" },
  { dayOfWeek: 6, label: "Sat" },
  { dayOfWeek: 0, label: "Sun" },
] as const;

function formatMinuteOfDay(minute: number): string {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minuteOfHour = normalized % 60;
  const hour12 = hour24 % 12 || 12;
  const meridiem = hour24 < 12 ? "AM" : "PM";
  return `${hour12}:${String(minuteOfHour).padStart(2, "0")} ${meridiem}`;
}

export function formatStoreScheduleHours(
  schedule: StoreScheduleHoursSource | null | undefined,
): StoreHoursRow[] {
  if (!schedule) return [];

  const days = WEEK_DAYS.map(({ dayOfWeek, label }) => {
    const windows = schedule.weeklyWindows
      .filter((window) => window.dayOfWeek === dayOfWeek)
      .sort((left, right) => left.startMinute - right.startMinute);
    const hoursLabel =
      schedule.weeklyClosedDays.includes(dayOfWeek) || windows.length === 0
        ? "Closed"
        : windows
            .map(
              (window) =>
                `${formatMinuteOfDay(window.startMinute)}–${formatMinuteOfDay(window.endMinute)}`,
            )
            .join(", ");
    return { label, hoursLabel };
  });

  const groups: Array<{
    firstLabel: string;
    lastLabel: string;
    hoursLabel: string;
  }> = [];
  for (const day of days) {
    const previous = groups.at(-1);
    if (previous?.hoursLabel === day.hoursLabel) {
      previous.lastLabel = day.label;
    } else {
      groups.push({
        firstLabel: day.label,
        lastLabel: day.label,
        hoursLabel: day.hoursLabel,
      });
    }
  }

  return groups.map(({ firstLabel, lastLabel, hoursLabel }) => ({
    dayLabel:
      firstLabel === lastLabel ? firstLabel : `${firstLabel}–${lastLabel}`,
    hoursLabel,
  }));
}

export function formatPickupLocation({
  storeLocation,
  storeName,
}: {
  storeLocation?: string;
  storeName: string;
}): string {
  const normalizedStoreName = capitalizeWords(storeName.trim()) || "Store";
  const normalizedStoreLocation =
    storeLocation?.trim() || "Location not available";

  return `${normalizedStoreName} · ${normalizedStoreLocation}`;
}

export function buildReadyForPickupMessage(storeName: string): string {
  const normalizedStoreName = capitalizeWords(storeName.trim()) || "the store";
  return `Pick it up at ${normalizedStoreName} during store hours. Bring this email when you visit us.`;
}
