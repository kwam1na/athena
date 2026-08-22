/**
 * Read port for `operations.storeDay` (V26-1267).
 *
 * Authority boundary: `defineAgentReadPortQuery` reauthorizes the run inside
 * this query's own transaction, derives the store scope from the verified grant
 * (never from arguments), strips ungranted projections, refuses undeclared
 * fields and raw identifiers, and hashes the sanitized envelope. This module
 * only decides WHICH authoritative rows to read and how to say them
 * semantically.
 *
 * The read is `buildDailyOperationsSnapshotWithCtx` — the same seam the Daily
 * Operations surface uses — plus the opening and close records for readiness
 * counts and record provenance. The operating window is derived server-side
 * from the operating date through `storeTime`, so the agent can never supply an
 * offset or a raw window.
 */
import type { Doc } from "../../_generated/dataModel";
import {
  mintAgentSourceRef,
  resolveAgentOperatingWindowWithCtx,
} from "../../lib/agentCapabilitySupport";
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";
import type { AgentReadPortHandler, AgentReadPortHandlerOutput } from "../../agentHarness/readPorts";
import type { AgentSourceCompleteness, AgentWarning } from "../../../shared/agentHarness/results";
import {
  buildDailyOperationsSnapshotWithCtx,
  getDailyCloseRecordForDate,
  getDailyOpeningRecordForDate,
} from "../dailyOperations";
import { STORE_DAY_PORT_KEY } from "./storeDay";

type Readiness = { blockerCount: number; carryForwardCount: number; readyCount: number; reviewCount: number };

const EMPTY_READINESS: Readiness = { blockerCount: 0, carryForwardCount: 0, readyCount: 0, reviewCount: 0 };

function readinessOf(record: { readiness?: Readiness } | null): Readiness {
  return record?.readiness
    ? {
        blockerCount: record.readiness.blockerCount,
        carryForwardCount: record.readiness.carryForwardCount,
        readyCount: record.readiness.readyCount,
        reviewCount: record.readiness.reviewCount,
      }
    : EMPTY_READINESS;
}

function closeStatusOf(close: Doc<"dailyClose"> | null): "not_started" | "open" | "completed" | "reopened" {
  if (!close) return "not_started";
  if (close.lifecycleStatus === "reopened") return "reopened";
  return close.status === "completed" ? "completed" : "open";
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const getStoreDayHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "lifecycle" };
  }
  const operatingDate = String(input.args.operatingDate);
  const window = await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "lifecycle" };
  }

  const [snapshot, closeRecord, openingRecord] = await Promise.all([
    buildDailyOperationsSnapshotWithCtx(ctx, {
      endAt: window.endAt,
      includeAnalyticsDetails: false,
      includeFinancialDetails: false,
      includeManagerReviewEvidence: true,
      includeScheduledRunSummaries: false,
      includeStorePulseDetails: false,
      operatingDate,
      startAt: window.startAt,
      storeId,
      timelineLimit: 0,
      timelinePreviewLimit: 0,
    }),
    getDailyCloseRecordForDate(ctx, { operatingDate, storeId }),
    getDailyOpeningRecordForDate(ctx, { operatingDate, storeId }),
  ]);

  const laneCount = (key: string) => snapshot.lanes.find((lane) => lane.key === key)?.count ?? 0;
  const isClosed = closeStatusOf(closeRecord) === "completed";
  const warnings: AgentWarning[] = [];
  if (window.derivation === "utc_fallback") {
    warnings.push({
      code: "operating_window_fallback",
      message: "No store schedule governed this date, so the calendar day was used for the window.",
      sourceKey: "lifecycle",
    });
  }

  const sources: AgentSourceCompleteness[] = [
    { sourceKey: "lifecycle", status: "complete", capturedAt: input.now },
    closeRecord || !isClosed
      ? { sourceKey: "closeRecords", status: "complete", capturedAt: input.now }
      : {
          sourceKey: "closeRecords",
          status: "unavailable",
          reason: "close_record_missing",
          capturedAt: input.now,
        },
  ];

  const sourceRefs = [
    {
      ref: mintAgentSourceRef("store_day_record", storeId, `${operatingDate}:lifecycle`),
      kind: "store_day_record",
      label: `Store day ${operatingDate}`,
      version: openingRecord ? String(openingRecord.updatedAt) : undefined,
      capturedAt: input.now,
    },
    ...(closeRecord
      ? [
          {
            ref: mintAgentSourceRef("close_record", storeId, String(closeRecord._id)),
            kind: "close_record",
            label: `Close record ${operatingDate}`,
            version: String(closeRecord.reportingCloseVersion ?? closeRecord.updatedAt),
            capturedAt: input.now,
          },
        ]
      : []),
  ];

  return {
    kind: "data",
    data: {
      operatingDate,
      operatingWindow: { derivation: window.derivation, timezone: window.timezone },
      lifecycleStage: snapshot.lifecycle.status,
      lifecycleSummary: snapshot.lifecycle.description,
      openingStatus: openingRecord?.status === "started" ? "started" : "not_started",
      openingReadiness: readinessOf(openingRecord),
      closeStatus: closeStatusOf(closeRecord),
      closeReadiness: readinessOf(closeRecord),
      attentionCount: snapshot.attentionItems.length,
      openWorkItemCount: laneCount("queue"),
      pendingApprovalCount: laneCount("approvals"),
      registerBlockerCount: laneCount("registers"),
      transactionCount: snapshot.closeSummary.transactionCount,
      completedCloseAt: closeRecord?.completedAt,
      completedCloseActor: closeRecord?.actorType,
      openingRecordRef: openingRecord
        ? mintAgentSourceRef("store_day_record", storeId, String(openingRecord._id))
        : undefined,
      closeRecordRef: closeRecord
        ? mintAgentSourceRef("close_record", storeId, String(closeRecord._id))
        : undefined,
      managerReviewEvidence: (openingRecord?.managerReviewEvidence ?? []).slice(0, 20).map((entry) => ({
        key: entry.key,
        severity: entry.severity,
        title: entry.title,
        message: entry.message,
      })),
    },
    observedAt: input.now,
    // A completed day stands on the accepted close record; an open day is live.
    freshness: isClosed
      ? { class: "accepted", authority: "authoritative_record", sourceVersion: String(closeRecord?.reportingCloseVersion ?? "") }
      : { class: "live", authority: "authoritative_record" },
    sources,
    warnings,
    sourceRefs,
  };
};

export const getStoreDay = defineAgentReadPortQuery({ portKey: STORE_DAY_PORT_KEY, handler: getStoreDayHandler });
