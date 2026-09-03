/**
 * Read ports for `operations.attention` and `operations.approvals` (V26-1267).
 *
 * Authority boundary: both handlers run inside `defineAgentReadPortQuery`, so
 * the store scope comes from the verified grant, ungranted projections are
 * stripped after the handler returns, and raw identifiers never survive. The
 * handlers return every declared field; deciding who may see `managerReason`
 * or `approvalProof` is the kernel's job, not theirs.
 *
 * Both reads are page-bounded and report page exhaustion honestly: a page that
 * could not cover its source says so through per-source completeness rather
 * than presenting a short list as the whole queue.
 */
import type { Doc } from "../../_generated/dataModel";
import {
  mintAgentResourceRef,
  mintAgentSourceRef,
  pageOf,
  resolveAgentOperatingWindowWithCtx,
} from "../../lib/agentCapabilitySupport";
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";
import type { AgentReadPortHandler, AgentReadPortHandlerOutput } from "../../agentHarness/readPorts";
import type { AgentSourceCompleteness, AgentSourceRef, AgentWarning } from "../../../shared/agentHarness/results";
import {
  buildDailyOperationsSnapshotWithCtx,
  listPendingApprovalRequestsSnapshot,
  type DailyOperationsAttentionItem,
} from "../dailyOperations";
import { APPROVALS_PORT_KEY, ATTENTION_PORT_KEY } from "./work";

/** Severity is how strongly the item holds up the day; the filter speaks that language. */
const ATTENTION_STATUS_BY_SEVERITY = {
  critical: "blocking",
  warning: "review",
  info: "informational",
} as const;

const ATTENTION_STATUS_ORDER = ["blocking", "review", "informational"] as const;

function windowFallbackWarning(sourceKey: string): AgentWarning {
  return {
    code: "operating_window_fallback",
    message: "No store schedule governed this date, so the calendar day was used for the window.",
    sourceKey,
  };
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const listAttentionHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "lanes" };
  }
  const operatingDate = String(input.args.operatingDate);
  const window = await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "lanes" };
  }

  const snapshot = await buildDailyOperationsSnapshotWithCtx(ctx, {
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
  });

  const requested = input.args.status;
  const ordered = [...(snapshot.attentionItems as DailyOperationsAttentionItem[])]
    .map((item) => ({ item, status: ATTENTION_STATUS_BY_SEVERITY[item.severity] }))
    .filter((entry) => requested === undefined || entry.status === requested)
    .sort(
      (left, right) =>
        ATTENTION_STATUS_ORDER.indexOf(left.status) - ATTENTION_STATUS_ORDER.indexOf(right.status) ||
        left.item.id.localeCompare(right.item.id),
    );

  const page = pageOf(ordered, input.pageIndex * input.pageSize, input.pageSize);
  const warnings: AgentWarning[] = window.derivation === "utc_fallback" ? [windowFallbackWarning("lanes")] : [];
  const sources: AgentSourceCompleteness[] = [
    // Every contributing lane was read by the snapshot in one pass.
    { sourceKey: "lanes", status: "complete", capturedAt: input.now },
    {
      sourceKey: "pages",
      status: page.hasMore ? "partial" : "complete",
      reason: page.hasMore ? "more_pages_available" : undefined,
      capturedAt: input.now,
    },
  ];

  return {
    kind: "data",
    data: page.items.map(({ item, status }) => ({
      itemRef: mintAgentResourceRef("attention_item", storeId, item.id),
      operatingDate,
      operatingWindow: { derivation: window.derivation, timezone: window.timezone },
      lane: item.owner,
      status,
      title: item.label,
      subjectKind: item.source.type,
      subjectLabel: item.source.label,
      registerLabel: item.registerSession?.displayLabel,
      managerReason: item.message,
    })),
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources,
    warnings,
    sourceRefs: page.items.map(({ item }) => ({
      ref: mintAgentSourceRef(item.source.type === "approval_request" ? "approval_request" : "work_item", storeId, item.id),
      kind: item.source.type === "approval_request" ? "approval_request" : "work_item",
      label: item.label,
      capturedAt: input.now,
    })),
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

export const listAttention = defineAgentReadPortQuery({ portKey: ATTENTION_PORT_KEY, handler: listAttentionHandler });

function approvalStateVersion(request: Doc<"approvalRequest">): string {
  return `${request.status}@${request.decidedAt ?? request.createdAt}`;
}

function approvalProofOf(request: Doc<"approvalRequest">): string {
  const reviewer = request.reviewedByStaffProfileId ?? request.decisionApprovedByStaffProfileId;
  const parts = [
    request.decisionNotes ? `Decision note: ${request.decisionNotes}` : null,
    request.notes ? `Requester note: ${request.notes}` : null,
    reviewer ? "A reviewer is recorded against this request." : "No reviewer is recorded yet.",
    request.decisionApprovalProofId ? "An approval proof is attached." : "No approval proof is attached.",
  ].filter((part): part is string => part !== null);
  return parts.join(" ");
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const listApprovalsHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "pages" };
  }
  const operatingDate = String(input.args.operatingDate);
  const window = await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "pages" };
  }

  const snapshot = await listPendingApprovalRequestsSnapshot(ctx, {
    endAt: window.endAt,
    storeId,
  });
  const ordered = [...snapshot.approvalRequests].sort((left, right) => right.createdAt - left.createdAt);
  const page = pageOf(ordered, input.pageIndex * input.pageSize, input.pageSize);
  // The seam's own read ceiling is a second reason a page may be short.
  const sourceTruncated = snapshot.hasMoreApprovalRequests;
  const warnings: AgentWarning[] = window.derivation === "utc_fallback" ? [windowFallbackWarning("pages")] : [];
  if (sourceTruncated) {
    warnings.push({
      code: "approval_source_truncated",
      message: "More pending approvals exist than the store-day read ceiling covers.",
      sourceKey: "pages",
    });
  }

  const sourceRefs: AgentSourceRef[] = page.items.map((request) => ({
    ref: mintAgentSourceRef("approval_request", storeId, String(request._id)),
    kind: "approval_request",
    label: request.requestType,
    version: approvalStateVersion(request),
    capturedAt: input.now,
  }));

  return {
    kind: "data",
    data: page.items.map((request) => ({
      requestRef: mintAgentResourceRef("approval_request", storeId, String(request._id)),
      operatingDate,
      requestKind: request.requestType,
      subjectKind: request.subjectType,
      state: "pending",
      stateVersion: approvalStateVersion(request),
      raisedAt: request.createdAt,
      reason: request.reason,
      approvalProof: approvalProofOf(request),
    })),
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources: [
      {
        sourceKey: "pages",
        status: page.hasMore || sourceTruncated ? "partial" : "complete",
        reason: sourceTruncated ? "source_read_ceiling_reached" : page.hasMore ? "more_pages_available" : undefined,
        capturedAt: input.now,
      },
    ],
    warnings,
    sourceRefs,
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

export const listApprovals = defineAgentReadPortQuery({ portKey: APPROVALS_PORT_KEY, handler: listApprovalsHandler });
