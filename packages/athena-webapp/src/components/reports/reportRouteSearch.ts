import { z } from "zod";

import { REPORT_OVERVIEW_WINDOWS } from "./reportPeriodKeys";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
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
});

type ReportsOverviewSearch = z.infer<typeof reportsOverviewSearchSchema>;

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
