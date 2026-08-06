/**
 * One search param, `sheetReturn`, for every sheet that sends a visitor away.
 *
 * A sheet is usually a stop on the way somewhere: a row opens it, a link inside
 * it navigates to a detail page, and coming back should land on the same scroll
 * offset with focus on the link that was followed. That needs two values to
 * survive the round trip, and the URL is the only place they can live — a ref
 * dies with the unmount, and browser history restores the URL but not React
 * state.
 *
 * ## Why one param instead of one pair per route
 *
 * Every sheet needs the same two values, so a per-route naming scheme
 * (`unitsFocus`/`unitsScroll`, `timelineFocus`/`timelineScroll`, …) multiplies
 * parsing and clearing logic without ever differing in shape. One param with
 * one codec means a route adds return support by threading a single optional
 * string, and the clearing rule is the same everywhere.
 *
 * ## The focus key is opaque here
 *
 * This module carries the key and never interprets it. What identifies a return
 * target is the sheet's own vocabulary — a SKU under a chart-or-table surface, a
 * timeline event id, a log row — and only the sheet can build the selector or
 * decide whether the target is still expected. Keeping the key opaque is what
 * lets one param serve all of them.
 *
 * ## Format
 *
 *   sheetReturn=<uri-encoded focus key>~<scroll offset>
 *
 * `~` is unreserved, so it survives a round trip through URL encoding without
 * being escaped into noise. Either side may be empty: a sheet that only
 * restores scroll, or only focus, still uses the same param.
 */

/** The search-param name. One name, so every route spells it identically. */
export const SHEET_RETURN_SEARCH_KEY = "sheetReturn";

/**
 * The attribute a return target carries. A shared attribute means the focus
 * selector is built the same way everywhere, so a sheet cannot accidentally
 * return focus to an element another sheet marked.
 */
export const SHEET_RETURN_ATTRIBUTE = "data-sheet-return-key";

const SEPARATOR = "~";

export type SheetReturn = {
  /** Opaque to this module — see the note above. */
  focusKey?: string;
  scrollOffset?: number;
};

/** Encoded form, or `undefined` when there is nothing worth putting in a URL. */
export function encodeSheetReturn(value: SheetReturn): string | undefined {
  const focusKey = value.focusKey?.trim();
  const scrollOffset =
    value.scrollOffset !== undefined &&
    Number.isFinite(value.scrollOffset) &&
    value.scrollOffset > 0
      ? // Sub-pixel precision is noise in a URL and the restore is a scroll
        // position, not a measurement.
        String(Math.round(value.scrollOffset))
      : "";
  if (!focusKey && !scrollOffset) return undefined;
  return `${focusKey ? encodeFocusKey(focusKey) : ""}${SEPARATOR}${scrollOffset}`;
}

/**
 * `encodeURIComponent` leaves `~` alone — it is an unreserved character — so a
 * key containing the separator would split in the wrong place on the way back.
 * Escaping it here keeps the key opaque, which is the whole contract.
 */
function encodeFocusKey(focusKey: string): string {
  return encodeURIComponent(focusKey).replace(/~/g, "%7E");
}

/**
 * Parse a `sheetReturn` value.
 *
 * Total and forgiving by design: this arrives from a URL, so anything
 * unparseable is "no return token" rather than an error. A malformed value must
 * never keep a sheet from opening.
 */
export function decodeSheetReturn(raw: unknown): SheetReturn | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;

  const separatorAt = raw.indexOf(SEPARATOR);
  // A value with no separator is treated as a focus key alone, so a
  // hand-written or truncated URL still does something sensible.
  const rawFocusKey = separatorAt === -1 ? raw : raw.slice(0, separatorAt);
  const rawScrollOffset = separatorAt === -1 ? "" : raw.slice(separatorAt + 1);

  let focusKey: string | undefined;
  if (rawFocusKey) {
    try {
      focusKey = decodeURIComponent(rawFocusKey) || undefined;
    } catch {
      // Malformed percent-encoding. Drop the key rather than throwing.
      focusKey = undefined;
    }
  }

  const scrollOffset = /^\d+$/.test(rawScrollOffset)
    ? Number(rawScrollOffset)
    : undefined;

  const value: SheetReturn = {
    ...(focusKey ? { focusKey } : {}),
    ...(scrollOffset !== undefined && Number.isSafeInteger(scrollOffset)
      ? { scrollOffset }
      : {}),
  };
  return value.focusKey === undefined && value.scrollOffset === undefined
    ? undefined
    : value;
}

/**
 * Selector for the element a `focusKey` names.
 *
 * `CSS.escape` because the key came from a URL and would otherwise be read as
 * selector syntax — a key containing a quote could match the wrong element or
 * throw mid-restore.
 */
export function sheetReturnFocusSelector(focusKey: string): string {
  return `[${SHEET_RETURN_ATTRIBUTE}="${CSS.escape(focusKey)}"]`;
}

/** Props that mark an element as a return target. Spread onto the link. */
export function sheetReturnTargetProps(
  focusKey: string,
): Record<string, string> {
  return { [SHEET_RETURN_ATTRIBUTE]: focusKey };
}
