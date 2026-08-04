import { z } from "zod";

import { REPORT_OVERVIEW_WINDOWS } from "./reportPeriodKeys";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Units-moved sheet state, identical on Overview and Weekly. Every key is
 * omitted at its default so a plain `units=true` URL stays canonical:
 * - `unitsTab` serializes only the non-default Granular tab.
 * - `unitsPage` serializes only a Granular page greater than one.
 * - `unitsFocus` is the productSkuId of the drill-down link the operator
 *   activated; present only while a return restoration is pending.
 * - `unitsScroll` is the captured underlying-report scroll offset for the
 *   same pending restoration.
 * The sheet state is period-scoped, so like `units` itself it never rides
 * through the weekly<->overview return-context bridges below.
 */
const unitsSheetSearchShape = {
  units: z.boolean().optional(),
  unitsTab: z.literal("granular").optional(),
  unitsPage: z.coerce.number().int().positive().optional(),
  unitsFocus: z.string().min(1).max(256).optional(),
  unitsScroll: z.coerce.number().int().min(0).optional(),
};
const weeklyHistoryCursorSchema = z.string().min(1).max(2_048);
const weeklyHistoryCursorTrailSchema = z
  .array(weeklyHistoryCursorSchema.nullable())
  .max(24);

/**
 * Shared, unchanged Overview route contract. Keeping it outside the route
 * lets the Weekly tab carry explicit return context without importing a
 * route module into workspace navigation.
 */
export const reportsOverviewSearchSchema = z.object({
  window: z.enum(REPORT_OVERVIEW_WINDOWS).optional(),
  daysStart: dateSchema.optional(),
  daysEnd: dateSchema.optional(),
  daysTableStart: dateSchema.optional(),
  daysTableEnd: dateSchema.optional(),
  daysPage: z.coerce.number().int().positive().optional(),
  selectedDay: dateSchema.optional(),
  ...unitsSheetSearchShape,
});

type ReportsOverviewSearch = z.infer<typeof reportsOverviewSearchSchema>;

/**
 * Sheet-context reset: a period or operating-day change invalidates the tab,
 * page, focus, and scroll continuity keys (they describe the previous period)
 * while leaving the open/closed flag itself alone.
 */
export const resetUnitsSheetContextSearch = {
  unitsTab: undefined,
  unitsPage: undefined,
  unitsFocus: undefined,
  unitsScroll: undefined,
} as const;

const UNITS_CHART_FOCUS_PREFIX = "chart:";

/** Keep the originating surface inside the existing one-shot focus token. */
export function unitsSheetFocusSearchValue(
  productSkuId: string,
  surface: "chart" | "table",
): string {
  return surface === "chart"
    ? `${UNITS_CHART_FOCUS_PREFIX}${productSkuId}`
    : productSkuId;
}

export function parseUnitsSheetFocusSearch(value: string | undefined): {
  productSkuId: string | undefined;
  surface: "chart" | "table" | undefined;
} {
  if (!value) return { productSkuId: undefined, surface: undefined };
  if (value.startsWith(UNITS_CHART_FOCUS_PREFIX)) {
    return {
      productSkuId: value.slice(UNITS_CHART_FOCUS_PREFIX.length),
      surface: "chart",
    };
  }
  return { productSkuId: value, surface: "table" };
}

/** Closing the sheet clears every sheet-owned key, including `units`. */
export const closedUnitsSheetSearch = {
  units: undefined,
  ...resetUnitsSheetContextSearch,
} as const;

/**
 * Weekly owns its selection. Overview context is intentionally field-by-field
 * and namespaced so direct Weekly entries do not modify the Overview route.
 */
export const reportsWeeklySearchSchema = z.object({
  reportId: z
    .string()
    .regex(/^week:\d{4}-\d{2}-\d{2}$/)
    .optional(),
  history: z.boolean().optional(),
  historyCursor: weeklyHistoryCursorSchema.optional(),
  historyCursorTrail: weeklyHistoryCursorTrailSchema.optional(),
  ...unitsSheetSearchShape,
  overviewWindow: z.enum(REPORT_OVERVIEW_WINDOWS).optional(),
  overviewDaysStart: dateSchema.optional(),
  overviewDaysEnd: dateSchema.optional(),
  overviewDaysTableStart: dateSchema.optional(),
  overviewDaysTableEnd: dateSchema.optional(),
  overviewDaysPage: z.coerce.number().int().positive().optional(),
  overviewSelectedDay: dateSchema.optional(),
});

export type ReportsWeeklySearch = z.infer<typeof reportsWeeklySearchSchema>;

export function weeklyReturnSearchFromOverview(
  search: ReportsOverviewSearch,
): Pick<
  ReportsWeeklySearch,
  | "overviewWindow"
  | "overviewDaysStart"
  | "overviewDaysEnd"
  | "overviewDaysTableStart"
  | "overviewDaysTableEnd"
  | "overviewDaysPage"
  | "overviewSelectedDay"
> {
  return {
    overviewWindow: search.window,
    overviewDaysStart: search.daysStart,
    overviewDaysEnd: search.daysEnd,
    overviewDaysTableStart: search.daysTableStart,
    overviewDaysTableEnd: search.daysTableEnd,
    overviewDaysPage: search.daysPage,
    overviewSelectedDay: search.selectedDay,
  };
}

export function overviewSearchFromWeeklyReturn(
  search: Partial<ReportsWeeklySearch>,
): ReportsOverviewSearch {
  return {
    window: search.overviewWindow,
    daysStart: search.overviewDaysStart,
    daysEnd: search.overviewDaysEnd,
    daysTableStart: search.overviewDaysTableStart,
    daysTableEnd: search.overviewDaysTableEnd,
    daysPage: search.overviewDaysPage,
    selectedDay: search.overviewSelectedDay,
  };
}
