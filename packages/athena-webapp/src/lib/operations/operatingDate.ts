/**
 * Operating-date derivation shared by the operations workspaces (Daily Operations,
 * Opening Handoff, EOD Review).
 *
 * These were previously duplicated verbatim in `DailyOperationsView`,
 * `DailyOpeningView`, and `DailyCloseView`. The operating date is the store's local
 * calendar day, derived from the browser clock and overridden by the `operatingDate`
 * search param when present.
 */

/**
 * The store-local calendar day for `date`, as `YYYY-MM-DD`.
 *
 * Shifts by the local UTC offset before formatting so the ISO slice yields the local
 * day rather than the UTC one.
 */
export function getLocalOperatingDate(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return localDate.toISOString().slice(0, 10);
}

/**
 * The local midnight-to-midnight window containing `date`, plus its operating date.
 *
 * `startAt`/`endAt` are epoch millis and are sent to the server as the snapshot range.
 */
export function getLocalOperatingDateRange(date = new Date()) {
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
      return getLocalOperatingDateRange(localDate);
    }
  }

  return getLocalOperatingDateRange();
}
