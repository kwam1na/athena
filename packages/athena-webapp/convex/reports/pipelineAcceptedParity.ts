import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { localDateStartAt } from "../lib/storeScheduleTime";
import {
  acceptedTopSkuLeaders,
  foldWeekFromAcceptedFacts,
  MAX_WEEKLY_FACTS,
} from "./weekly";
import { resolveWeeklyPeriod, type WeeklyPeriod } from "./weeklyPeriods";
import {
  aggregateWeeklyCloseEvidence,
  type CloseSnapshot,
} from "./weeklyCloseEvidence";
import {
  CLOSE_EVIDENCE_CHUNK_BYTES,
  CLOSE_EVIDENCE_MAX_CHUNKS,
  closeEvidenceAsSnapshot,
  compactFrozenInventoryAttention,
  readCloseEvidenceWithCtx,
} from "./closeEvidence";
import { readPipelineControl } from "./pipelineControl";
import { storedCloseEvidenceConsistent } from "./verify";
import { stableStringHash } from "./fingerprint";

type Accepted = Doc<"reportWeekAccepted">;
type Header = Doc<"reportCloseEvidence">;
export type AcceptedParityReason =
  | "invalid_frame"
  | "unsupported_legacy_evidence"
  | "cutoff_evidence_unavailable"
  | "capacity_exceeded"
  | "financial_mismatch"
  | "payment_mismatch"
  | "leader_mismatch"
  | "close_evidence_mismatch"
  | "close_identity_mismatch"
  | "inventory_mismatch"
  | "missing_close_evidence";
const BYTE_BUDGET = 4 * 1024 * 1024;
const BYTE_RESERVE = 128 * 1024;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Structural equality, including finite numeric evidence; field order is not evidence. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number")
    return (
      typeof a === "number" &&
      typeof b === "number" &&
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      a === b
    );
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  const left = Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => x.localeCompare(y));
  const right = Object.entries(b)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => x.localeCompare(y));
  return (
    left.length === right.length &&
    left.every(
      ([key, value], i) => key === right[i][0] && same(value, right[i][1]),
    )
  );
}

function storedFrame(
  row: Accepted,
): Extract<WeeklyPeriod, { kind: "resolved" }> | null {
  const start = Date.parse(`${row.cycleStartDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(start) ||
    new Date(start).toISOString().slice(0, 10) !== row.cycleStartDate ||
    row.scheduleLineage.length !== 7 ||
    !Number.isFinite(row.cutoffObservedAt) ||
    row.cutoffObservedAt < 0 ||
    row.metricVersion !== 1 ||
    !row.baselineFingerprint
  )
    return null;
  const dates = row.scheduleLineage.map((day) => ({
    localDate: day.localDate,
    included: day.included,
    scheduleVersionId: day.scheduleVersionId,
  }));
  if (
    dates.some(
      (day, i) =>
        day.localDate !==
        new Date(start + i * 86400000).toISOString().slice(0, 10),
    ) ||
    dates[6].localDate !== row.cycleEndDate
  )
    return null;
  const includedDates = dates
    .filter((day) => day.included)
    .map((day) => day.localDate);
  if (!includedDates.length) return null;
  return {
    kind: "resolved",
    startDate: row.cycleStartDate,
    endDate: row.cycleEndDate,
    dates,
    includedDates,
    finalScheduledDate: includedDates[includedDates.length - 1],
    automaticFinalizationReason: null,
  };
}

/** Reopen time proves historical eligibility; missing supersession timing is not guessed. */
function atCutoff(
  header: Header,
  cohort: readonly Header[],
  cutoff: number,
): boolean | null {
  if (header.status !== "completed") return false;
  if (header.completedAt === undefined || !Number.isFinite(header.completedAt))
    return null;
  if (header.completedAt > cutoff) return false;
  if (header.reopenedAt !== undefined) {
    if (!Number.isFinite(header.reopenedAt)) return null;
    return header.reopenedAt > cutoff;
  }
  if (header.lifecycleStatus === "reopened") return null;
  if (header.lifecycleStatus === "superseded") {
    const successor = cohort.find(
      (candidate) => candidate.closeId === header.supersededByCloseId,
    );
    if (
      !successor ||
      successor.completedAt === undefined ||
      !Number.isFinite(successor.completedAt)
    )
      return null;
    return successor.completedAt > cutoff;
  }
  return true;
}

async function verifyOne(
  ctx: QueryCtx,
  row: Accepted,
): Promise<AcceptedParityReason | null> {
  const period = storedFrame(row);
  if (!period) return "invalid_frame";
  const control = await readPipelineControl(ctx, row.storeId);
  const store = await ctx.db.get("store", row.storeId);
  if (
    !store ||
    store.reportingReseedStartedAt !== undefined ||
    store.weeklyObservedAtVerification?.status !== "complete" ||
    (control?.acceptedReplayUnavailableBefore !== undefined &&
      row.cutoffObservedAt <= control.acceptedReplayUnavailableBefore)
  )
    return "cutoff_evidence_unavailable";
  // A set-once correction can depend on an external sealed source manifest.
  // This migration cannot silently certify or replace that repair authority.
  if (
    row.correction ||
    !row.paymentMix ||
    !row.outsideSchedulePaymentMix ||
    !row.closeEvidence ||
    !row.closeEvidence.transactions ||
    !row.topSkuLeaders ||
    !row.inventoryAttention ||
    row.scheduleLineage.some((day) => day.dayClosed === undefined) ||
    row.topSkuLeaders.some(
      (leader) => !leader.productName || !leader.productSku,
    )
  )
    return "unsupported_legacy_evidence";
  let readBytes = bytes(row) + bytes(store) + bytes(control);
  // Resolve only the frozen version cohort, never today's schedule history.
  // A missing, foreign, or changed reference is not evidence of the original
  // membership and must block instead of reclassifying an accepted baseline.
  const schedules = new Map<string, Doc<"storeSchedule">>();
  for (const day of row.scheduleLineage) {
    if (!day.scheduleVersionId) return "unsupported_legacy_evidence";
    if (schedules.has(day.scheduleVersionId)) continue;
    const schedule = await ctx.db.get("storeSchedule", day.scheduleVersionId);
    if (
      !schedule ||
      schedule.storeId !== row.storeId ||
      schedule.organizationId !== store.organizationId ||
      schedule.status === "candidate"
    )
      return "unsupported_legacy_evidence";
    readBytes += bytes(schedule);
    schedules.set(day.scheduleVersionId, schedule);
  }
  let frameStart: number | null;
  try {
    const first = schedules.get(row.scheduleLineage[0].scheduleVersionId!);
    const final = schedules.get(
      row.scheduleLineage.find(
        (day) => day.localDate === period.finalScheduledDate,
      )!.scheduleVersionId!,
    );
    if (!first?.timezone || !final?.timezone)
      return "unsupported_legacy_evidence";
    frameStart = localDateStartAt(row.cycleStartDate, first.timezone);
    const referenceAt = localDateStartAt(
      period.finalScheduledDate!,
      final.timezone,
    );
    if (frameStart === null || referenceAt === null)
      return "unsupported_legacy_evidence";
    const sourceFrame = resolveWeeklyPeriod({
      referenceAt,
      timezone: final.timezone,
      schedules: [...schedules.values()],
    });
    if (
      sourceFrame.kind !== "resolved" ||
      !same(sourceFrame.dates, period.dates) ||
      sourceFrame.startDate !== period.startDate ||
      sourceFrame.endDate !== period.endDate
    )
      return "unsupported_legacy_evidence";
  } catch {
    return "unsupported_legacy_evidence";
  }
  let remaining = MAX_WEEKLY_FACTS;
  const factsByDate = new Map<string, Doc<"reportFact">[]>();
  for (const day of period.dates) {
    const facts = await ctx.db
      .query("reportFact")
      .withIndex("by_storeId_operatingDate_observedAt", (q) =>
        q
          .eq("storeId", row.storeId)
          .eq("operatingDate", day.localDate)
          .lte("observedAt", row.cutoffObservedAt),
      )
      .take(remaining + 1);
    if (facts.length > remaining) return "capacity_exceeded";
    if (facts.some((fact) => fact.observedAt === undefined))
      return "cutoff_evidence_unavailable";
    readBytes += bytes(facts);
    if (readBytes + BYTE_RESERVE > BYTE_BUDGET) return "capacity_exceeded";
    remaining -= facts.length;
    factsByDate.set(day.localDate, facts);
  }
  const expected = foldWeekFromAcceptedFacts({
    currency: row.currency,
    period,
    factsByDate,
  });
  if (!expected.completeness.complete) return "cutoff_evidence_unavailable";
  if (
    !same(row.included, expected.included) ||
    !same(row.outsideSchedule, expected.outsideSchedule)
  )
    return "financial_mismatch";
  if (
    !same(row.paymentMix, expected.includedPaymentMix) ||
    !same(row.outsideSchedulePaymentMix, expected.outsideSchedulePaymentMix)
  )
    return "payment_mismatch";
  if (
    !same(
      row.topSkuLeaders.map(({ productSkuId, unitsSold }) => ({
        productSkuId,
        unitsSold,
      })),
      acceptedTopSkuLeaders({ currency: row.currency, factsByDate }),
    )
  )
    return "leader_mismatch";
  if (!storedCloseEvidenceConsistent(row, period.includedDates.length))
    return "close_evidence_mismatch";

  const snapshots = new Map<string, CloseSnapshot>();
  const days: Array<{ operatingDate: string; closeId?: Id<"dailyClose"> }> = [];
  let finalRead:
    | Extract<
        Awaited<ReturnType<typeof readCloseEvidenceWithCtx>>,
        { status: "ready" }
      >
    | undefined;
  for (const day of row.scheduleLineage) {
    if (!day.included) continue;
    const headers = await ctx.db
      .query("reportCloseEvidence")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", row.storeId).eq("operatingDate", day.localDate),
      )
      .take(9);
    readBytes += bytes(headers);
    if (headers.length > 8) return "capacity_exceeded";
    const eligibility = headers.map((header) => ({
      header,
      active: atCutoff(header, headers, row.cutoffObservedAt),
    }));
    if (eligibility.some((value) => value.active === null))
      return "unsupported_legacy_evidence";
    const eligible = eligibility.filter((value) => value.active);
    if (!day.dayClosed) {
      if (eligible.length !== 0) return "unsupported_legacy_evidence";
      continue;
    }
    if (eligible.length !== 1) return "unsupported_legacy_evidence";
    const header = eligible[0].header;
    if (
      day.localDate === period.finalScheduledDate &&
      header.closeId !== row.closeId
    )
      return "close_identity_mismatch";
    if (
      header.chunkCount === undefined ||
      header.chunkCount > CLOSE_EVIDENCE_MAX_CHUNKS
    )
      return "missing_close_evidence";
    // Refuse before hydrating the next generation if even its bounded chunk
    // ceiling cannot fit; prior reads are charged at their actual fixture size.
    if (
      readBytes +
        bytes(header) +
        header.chunkCount * (CLOSE_EVIDENCE_CHUNK_BYTES + 1024) +
        BYTE_RESERVE >
      BYTE_BUDGET
    )
      return "capacity_exceeded";
    const read = await readCloseEvidenceWithCtx(
      ctx,
      row.storeId,
      header.closeId,
    );
    if (read.status !== "ready") return "missing_close_evidence";
    readBytes +=
      bytes(read.header) + bytes(read.items) + header.chunkCount * 1024;
    // Only the lifecycle projection changes: the normalized frozen evidence
    // remains byte-identical to the source generation verified by close parity.
    snapshots.set(String(header.closeId), {
      ...closeEvidenceAsSnapshot(read),
      lifecycleStatus: "active",
    });
    days.push({ operatingDate: day.localDate, closeId: header.closeId });
    if (day.localDate === period.finalScheduledDate) finalRead = read;
  }
  if (!finalRead) return "close_identity_mismatch";
  const closeEvidence = aggregateWeeklyCloseEvidence({
    closes: snapshots,
    days,
    scheduledDates: period.includedDates,
  });
  if (!same(row.closeEvidence, closeEvidence)) return "close_evidence_mismatch";
  if (
    !same(
      row.inventoryAttention,
      compactFrozenInventoryAttention(finalRead, frameStart),
    )
  )
    return "inventory_mismatch";

  // Reconstruct the metricVersion1 producer's field order, rather than relying
  // on database object-key ordering. Older unknown fingerprint shapes block.
  const fingerprint = stableStringHash(
    JSON.stringify({
      cutoffObservedAt: row.cutoffObservedAt,
      included: expected.included,
      outsideSchedule: expected.outsideSchedule,
      scheduleLineage: row.scheduleLineage.map((day) => ({
        localDate: day.localDate,
        included: day.included,
        scheduleVersionId: day.scheduleVersionId,
        dayStatus: day.dayStatus,
        dayAvailable: day.dayAvailable,
        dayClosed: day.dayClosed,
        activityPosture: day.activityPosture,
      })),
      topSkuLeaders: row.topSkuLeaders.map((leader) => ({
        productSkuId: leader.productSkuId,
        unitsSold: leader.unitsSold,
        productName: leader.productName,
        productSku: leader.productSku,
      })),
      closeEvidence,
    }),
  );
  return fingerprint === row.baselineFingerprint
    ? null
    : "unsupported_legacy_evidence";
}

/** One retained accepted frame per page; caller owns source+accepted watermark fences. */
export async function verifyAcceptedBaselinePageWithCtx(
  ctx: QueryCtx,
  args: { storeId: Id<"store">; cursor: string | null },
) {
  const page = await ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_cycleStartDate", (q) =>
      q.eq("storeId", args.storeId),
    )
    .paginate({ cursor: args.cursor, numItems: 1 });
  const issues: Array<{
    acceptedWeekId: Id<"reportWeekAccepted">;
    reason: AcceptedParityReason;
  }> = [];
  for (const row of page.page) {
    const reason = await verifyOne(ctx, row);
    if (reason) issues.push({ acceptedWeekId: row._id, reason });
  }
  return {
    nextCursor: page.isDone ? null : page.continueCursor,
    done: page.isDone,
    checked: page.page.length,
    issues,
  };
}
