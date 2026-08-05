/**
 * Operating-date derivation shared by the operations workspaces (Daily Operations,
 * Opening Handoff, EOD Review).
 *
 * These were previously duplicated verbatim in `DailyOperationsView`,
 * `DailyOpeningView`, and `DailyCloseView`. The operating date is the store's local
 * calendar day, derived from the browser clock and overridden by the `operatingDate`
 * search param when present.
 */

let operatingClockOverride: Date | null = null;
let operatingTimezoneOverride: string | null = null;

function isResolvableTimezone(timezone: string) {
  if (!timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pins the zone these helpers treat as the store's own.
 *
 * The shared demo is one store served to visitors in every zone, and its server
 * resolves operating dates in STORE time (`convex/reports/operatingDay.ts`). Left
 * on the browser clock, a visitor west of the store reads a day the server has
 * already closed — the fixture rail and the live rows would name different days.
 *
 * Set from the demo context; `null` restores browser-local derivation, which is
 * correct for a real store an operator runs from inside its own timezone. An
 * unresolvable zone is ignored rather than thrown on: a bad config value must
 * degrade to the old behaviour, never blank the workspace.
 */
export function setOperatingTimezoneOverride(timezone: string | null) {
  operatingTimezoneOverride =
    timezone && isResolvableTimezone(timezone) ? timezone : null;
}

/** The store zone in force, or `null` when deriving from the browser. */
export function getOperatingTimezone() {
  return operatingTimezoneOverride;
}

/**
 * Calendar parts for `date` as seen in `timezone`.
 *
 * `en-CA` yields ISO-ordered numeric parts, which is the same formatting the
 * server's `localDateLabel` relies on — so client and server agree on the day
 * label by construction rather than by coincidence.
 */
function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    day: Number(values.day),
    // `hour12: false` renders midnight as 24 in some runtimes.
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    month: Number(values.month),
    second: Number(values.second),
    year: Number(values.year),
  };
}

/** How far `timezone` is ahead of UTC at `date`, in milliseconds. */
function zoneOffsetMs(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which `operatingDate` begins in `timezone`.
 *
 * Resolved by guessing from the zone's offset at the naive UTC midnight and
 * re-checking with the offset actually in force at that guess, so a day that
 * starts across a DST boundary still lands on its own first instant.
 */
/** Calendar arithmetic on a `YYYY-MM-DD` label; no clock involved. */
function addDaysToOperatingDate(operatingDate: string, days: number) {
  const [year, month, day] = operatingDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return shifted.toISOString().slice(0, 10);
}

function zonedStartOfDay(operatingDate: string, timezone: string) {
  const [year, month, day] = operatingDate.split("-").map(Number);
  const naiveUtc = Date.UTC(year, month - 1, day);
  const firstGuess = naiveUtc - zoneOffsetMs(new Date(naiveUtc), timezone);
  const settled = naiveUtc - zoneOffsetMs(new Date(firstGuess), timezone);

  return settled;
}

/**
 * Pins what these helpers treat as "now", so a fixture can render as the current day.
 *
 * Screenshot fixtures only — the operations workspaces derive "today" from the browser
 * clock in ~30 module-level call sites, so an override is the only practical seam short
 * of threading a `now` through all of them. Pass `null` to restore the real clock.
 *
 * Callers are responsible for gating this to development; the mechanism is deliberately
 * unguarded so it stays testable.
 */
export function setOperatingClockOverride(date: Date | null) {
  operatingClockOverride = date ? new Date(date.getTime()) : null;
}

/** The current instant, honouring any override set by `setOperatingClockOverride`. */
export function getOperatingClockNow() {
  return operatingClockOverride
    ? new Date(operatingClockOverride.getTime())
    : new Date();
}

/**
 * The store-local calendar day for `date`, as `YYYY-MM-DD`.
 *
 * Shifts by the local UTC offset before formatting so the ISO slice yields the local
 * day rather than the UTC one.
 */
export function getLocalOperatingDate(date = getOperatingClockNow()) {
  if (operatingTimezoneOverride) {
    const parts = zonedParts(date, operatingTimezoneOverride);

    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return localDate.toISOString().slice(0, 10);
}

/**
 * The local midnight-to-midnight window containing `date`, plus its operating date.
 *
 * `startAt`/`endAt` are epoch millis and are sent to the server as the snapshot range.
 */
export function getLocalOperatingDateRange(date = getOperatingClockNow()) {
  if (operatingTimezoneOverride) {
    const operatingDate = getLocalOperatingDate(date);
    const startAt = zonedStartOfDay(operatingDate, operatingTimezoneOverride);

    return {
      // Derived from the NEXT day's label rather than `startAt + 24h`, so a
      // DST-shortened or -lengthened day still ends on its own boundary.
      endAt: zonedStartOfDay(
        addDaysToOperatingDate(operatingDate, 1),
        operatingTimezoneOverride,
      ),
      operatingDate,
      startAt,
    };
  }

  const localStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const localEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  );

  return {
    endAt: localEnd.getTime(),
    operatingDate: getLocalOperatingDate(date),
    startAt: localStart.getTime(),
  };
}

/**
 * Parses a `YYYY-MM-DD` operating date into a local `Date`, or `undefined` when the
 * string is malformed or names a date that does not exist (e.g. `2026-02-30`).
 */
export function getLocalDateFromOperatingDate(operatingDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(operatingDate);

  if (!match) return undefined;

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));

  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return undefined;
  }

  return parsed;
}

/**
 * Resolves the operating range from an untrusted search-param value, falling back to
 * the current local day when the value is absent or unparseable.
 */
export function getLocalOperatingDateRangeFromSearch(operatingDate?: unknown) {
  if (typeof operatingDate === "string") {
    const localDate = getLocalDateFromOperatingDate(operatingDate);

    if (localDate) {
      // Under a store zone the label IS the answer; re-deriving it from a
      // browser-local midnight would round-trip through the wrong day.
      if (operatingTimezoneOverride) {
        return {
          endAt: zonedStartOfDay(
            addDaysToOperatingDate(operatingDate, 1),
            operatingTimezoneOverride,
          ),
          operatingDate,
          startAt: zonedStartOfDay(operatingDate, operatingTimezoneOverride),
        };
      }

      return getLocalOperatingDateRange(localDate);
    }
  }

  return getLocalOperatingDateRange();
}
