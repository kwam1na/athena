import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type {
  ReportVerificationAlertDifference,
  ReportVerificationAlertProps,
} from "../emails/ReportVerificationAlert";
import { getStoreScheduleContextForStoreAtWithCtx } from "../inventory/storeSchedule";
import { toDisplayAmount } from "../lib/currency";
import {
  DAY_FIELD_INVENTORY,
  WEEK_FIELD_INVENTORY,
} from "../reports/verificationClassify";
import { currencyFormatter } from "../utils";
import { resolveAppUrl } from "./dailyManagerReportEmail";

/**
 * Payload query for the `reports.verification_discrepancy` notification kind
 * (plan U5).
 *
 * Reads the `reportVerificationRun` row — and NOTHING heavier. It deliberately
 * does not re-run verification at send time: one day verify is many bounded
 * source scans, far past what a prepareEmail can afford, and the run row is
 * the source of truth for what the sweep actually observed.
 *
 * The intent payload carries refs only (store, subject, fingerprint, re-arm
 * epoch); everything rendered is rebuilt here from a FRESH read, per the rail
 * convention.
 *
 * THROW vs NULL, the rail's whole retry discipline:
 *  - `null` means the subject is genuinely no longer alertable — the run row
 *    was re-verified clean (fingerprint cleared, epoch bumped) or now carries
 *    a different unexplained set. Dispatch suppresses the intent and records
 *    an operational event, so the dropped alert leaves a trace.
 *  - a THROW means the read itself could not be completed (missing store /
 *    organization context). Dispatch keeps the batch retryable.
 */

/** Absent = a legacy row written before checked-field capture; see below. */
type RunRow = Doc<"reportVerificationRun">;

export type ReportVerificationAlertPayload = ReportVerificationAlertProps;

// The field inventories are imported from `reports/verificationClassify.ts`
// (pure, no Convex imports — safe to import here), so the "not checked"
// complement is computed against the same list the classifier checks. A field
// added or renamed there flows through automatically instead of making the
// operator-facing section lie.

const FIELD_LABELS: Record<string, string> = {
  amendmentMatches: "Weekly amendments",
  closeEvidenceMatches: "Weekly close evidence",
  closeMatches: "Weekly closes",
  grossSalesMinor: "Gross sales",
  inventoryMatches: "Weekly inventory",
  netSalesMinor: "Net sales",
  paymentAllocatedMinor: "Payments allocated",
  paymentAllocationCoverage: "Payment allocation coverage",
  paymentAllocationOmittedMinor: "Payment allocation omitted",
  paymentHasInvalidAllocation: "Invalid payment allocation",
  paymentsCollectedMinor: "Payments collected",
  paymentsRefundedMinor: "Payments refunded",
  paymentUnsettledMinor: "Payments unsettled",
  refundsMinor: "Refunds",
  scheduleMatches: "Weekly schedule",
  unitsReturned: "Units returned",
  unitsSold: "Units sold",
  varianceMatches: "Weekly variance",
};

/** Human copy for the classifier's explained-difference reasons. */
const EXPLAINED_REASON_NOTES: Record<string, string> = {
  blind_spot_field:
    "Known blind spot - there is no independent source to compare against.",
  flagged_exclusions:
    "This day carries quarantined or foreign-currency facts, which the report excludes.",
  outside_schedule:
    "Activity outside the scheduled trading frame is excluded from the week's totals.",
  void_sign_convention:
    "Accounted for by the documented void sign convention between the report and the verifier.",
};

function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field;
}

export const getReportVerificationAlertPayload = internalQuery({
  args: {
    storeId: v.id("store"),
    subjectKind: v.union(v.literal("day"), v.literal("week")),
    subjectKey: v.string(),
    fingerprint: v.string(),
    reArmEpoch: v.number(),
    /** The emission counter minted with this intent. Optional because intents
     * written before the column landed carry none; when present it must match
     * the row, or this intent belongs to a superseded emission. */
    alertSeq: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<ReportVerificationAlertPayload | null> => {
    const row = await ctx.db
      .query("reportVerificationRun")
      .withIndex("by_store_subject", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("subjectKind", args.subjectKind)
          .eq("subjectKey", args.subjectKey),
      )
      .unique();

    // No longer alertable. Either the subject was re-verified clean (the
    // fingerprint is erased and the epoch bumped), or the unexplained set
    // moved on to a different fingerprint that will alert on its own intent.
    // Suppress rather than send an alert about a state that no longer holds.
    if (!row) return null;
    if (row.unexplainedFingerprint !== args.fingerprint) return null;
    if (row.reArmEpoch !== args.reArmEpoch) return null;
    // An oscillating fingerprint (A -> B -> A with no intervening clean run)
    // leaves the fingerprint AND epoch matching the FIRST A-intent, so a
    // delayed dispatch of that stale intent would double-send: the newer
    // A-intent carries its own, higher alertSeq. When both sides have the
    // column, only the intent minted with the row's current emission renders.
    if (
      args.alertSeq !== undefined &&
      row.alertSeq !== undefined &&
      row.alertSeq !== args.alertSeq
    ) {
      return null;
    }

    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      // A read that could not be completed, not a resolved subject: throw so
      // the rail retries instead of permanently silencing the alert.
      throw new Error("Report verification alert store was not found.");
    }
    const organization = await ctx.db.get("organization", store.organizationId);

    const currency = store.currency || "GHS";
    const money = currencyFormatter(currency);
    const format = (field: string, minor: number | undefined): string => {
      if (typeof minor !== "number") return "-";
      return field.endsWith("Minor")
        ? money.format(toDisplayAmount(minor))
        : String(minor);
    };
    const toDifference = (
      difference: RunRow["unexplainedDifferences"][number],
      withNote: boolean,
    ): ReportVerificationAlertDifference => ({
      actual: format(difference.field, difference.actualMinor),
      expected: format(difference.field, difference.expectedMinor),
      label: fieldLabel(difference.field),
      ...(withNote && EXPLAINED_REASON_NOTES[difference.classification]
        ? { note: EXPLAINED_REASON_NOTES[difference.classification] }
        : {}),
    });

    const scheduleContext = await getStoreScheduleContextForStoreAtWithCtx(
      ctx,
      { at: row.verifiedAt, storeId: store._id },
    ).then((result) => result.context);
    const timezone =
      scheduleContext.kind === "resolved" ? scheduleContext.timezone : "UTC";

    const inventory =
      args.subjectKind === "week" ? WEEK_FIELD_INVENTORY : DAY_FIELD_INVENTORY;
    // A row written before checked-field capture records nothing, and an
    // empty list is indistinguishable from "checked nothing". Treat absent as
    // unknown and claim nothing, rather than declaring every field withheld.
    const checked = new Set(row.checkedFields ?? inventory);
    const notCheckedFields = inventory
      .filter((field) => !checked.has(field))
      .map(fieldLabel);

    return {
      differences: row.unexplainedDifferences.map((difference) =>
        toDifference(difference, false),
      ),
      explainedDifferences: row.explainedDifferences.map((difference) =>
        toDifference(difference, true),
      ),
      notCheckedFields,
      reviewUrl: `${resolveAppUrl()}/${organization?.slug ?? store.slug}/store/${store.slug}/reports`,
      storeName: store.name,
      streakCount: row.streakCount,
      subjectKindLabel: args.subjectKind === "week" ? "Week" : "Day",
      subjectLabel: formatSubjectLabel(args.subjectKind, args.subjectKey),
      verifiedAtLabel: formatVerifiedAt(row.verifiedAt, timezone),
    };
  },
});

export function formatSubjectLabel(
  subjectKind: "day" | "week",
  subjectKey: string,
) {
  const parsed = new Date(`${subjectKey}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return subjectKey;
  const day = parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: subjectKind === "day" ? "long" : undefined,
  });
  return subjectKind === "week" ? `week of ${day}` : day;
}

function formatVerifiedAt(timestamp: number, timezone: string) {
  const date = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
    weekday: "short",
  }).format(new Date(timestamp));
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(timestamp));
  return `${date} · Verified at ${time}`;
}
