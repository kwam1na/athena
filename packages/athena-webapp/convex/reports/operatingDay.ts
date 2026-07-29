import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Operating-day resolution for the rebuilt reports layer.
 *
 * Ported from legacy `reporting/operatingPeriods.ts` + `storeTimeAuthority.ts`,
 * deliberately simplified:
 *   - no opening-hours schedule machinery (a store's financial day is its
 *     local calendar day; schedules never moved the boundary in practice),
 *   - no 100-version pagination or conflict taxonomy — one bounded `.take`,
 *   - unresolvable authority degrades to the store's configured timezone and
 *     finally to the platform default, instead of failing ingestion.
 *
 * The returned label is a store-local calendar date ("YYYY-MM-DD"). Downstream
 * period math (contract `weekPeriodKey`/`monthPeriodKey`) operates on the label
 * in UTC, which is correct by construction because the label is timezone-free.
 */

export const DEFAULT_STORE_TIMEZONE = "Africa/Accra";

/** Bounded read: the newest versions effective at or before `occurredAt`. */
const TIMEZONE_VERSION_SCAN_LIMIT = 4;

type ReadCtx = { db: QueryCtx["db"] };

function isValidTimezone(timezone: string): boolean {
  if (!timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Store-local calendar date label for an instant. */
export function localDateLabel(occurredAt: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(occurredAt));
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function configuredTimezone(config: unknown): string | undefined {
  if (!config || typeof config !== "object") return undefined;
  const candidate = (config as Record<string, unknown>).timezone;
  return typeof candidate === "string" && isValidTimezone(candidate)
    ? candidate
    : undefined;
}

/**
 * The timezone in force for `storeId` at `occurredAt`.
 *
 * Version rows are effective-dated and non-overlapping (enforced where they are
 * written). We read the newest few starting at `occurredAt` and pick the first
 * whose interval actually contains the instant — `effectiveTo` may have closed
 * before it, in which case an older row does not apply either and we fall back.
 */
export async function resolveStoreTimezone(
  ctx: ReadCtx,
  storeId: Id<"store">,
  occurredAt: number,
): Promise<string> {
  const versions = await ctx.db
    .query("storeTimezoneVersion")
    .withIndex("by_storeId_effectiveFrom", (q) =>
      q.eq("storeId", storeId).lte("effectiveFrom", occurredAt),
    )
    .order("desc")
    .take(TIMEZONE_VERSION_SCAN_LIMIT);

  const effective = versions.find(
    (version) =>
      version.effectiveFrom <= occurredAt &&
      (version.effectiveTo === undefined || occurredAt < version.effectiveTo) &&
      isValidTimezone(version.timezone),
  );
  if (effective) return effective.timezone;

  const store = await ctx.db.get("store", storeId);
  return configuredTimezone(store?.config) ?? DEFAULT_STORE_TIMEZONE;
}

/**
 * Store-local operating date for a business instant. This is the single
 * authority for which day a fact belongs to; ingestion stamps it onto the row
 * so the fold never re-derives it.
 */
export async function resolveOperatingDate(
  ctx: ReadCtx,
  storeId: Id<"store">,
  occurredAt: number,
): Promise<string> {
  const timezone = await resolveStoreTimezone(ctx, storeId, occurredAt);
  return localDateLabel(occurredAt, timezone);
}
