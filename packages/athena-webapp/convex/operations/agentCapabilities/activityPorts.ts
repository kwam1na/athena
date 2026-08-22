/**
 * Read port for `operations.activity` (V26-1267).
 *
 * Authority boundary: `defineAgentReadPortQuery` owns reauthorization, scope,
 * projection stripping, and the raw-identifier scan. This module reads
 * `listTimelineEvents` — the authoritative normalized timeline — and turns each
 * event into a semantic row with an opaque reference.
 *
 * The seam reads at most `MAX_OPERATIONS_QUERY_LIMIT` events for a day. That
 * ceiling is reported through the `pages` source rather than hidden, so a
 * program that pages to the end learns it read a bounded window rather than
 * the whole day.
 */
import {
  decodeOffsetCursor,
  mintAgentResourceRef,
  mintAgentSourceRef,
  pageOf,
  resolveAgentOperatingWindowWithCtx,
} from "../../lib/agentCapabilitySupport";
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";
import type { AgentReadPortHandler, AgentReadPortHandlerOutput } from "../../agentHarness/readPorts";
import type { AgentSourceCompleteness, AgentWarning } from "../../../shared/agentHarness/results";
import {
  MAX_OPERATIONS_QUERY_LIMIT,
  listTimelineEvents,
  type DailyOperationsTimelineEvent,
} from "../dailyOperations";
import { ACTIVITY_PORT_KEY } from "./activity";

/** Which normalized family an event id came from. */
function familyOf(event: DailyOperationsTimelineEvent): "operational_event" | "register_closeout" | "register_count" {
  if (event.id.startsWith("register_closeout:")) return "register_closeout";
  if (event.id.startsWith("pos_local_sync_register_count:")) return "register_count";
  return "operational_event";
}

/**
 * Manager/financial detail carried by an event. The kernel omits it entirely
 * for a reader without the `financialEvents` projection, so it is safe to build
 * unconditionally here.
 */
function financialDetailOf(event: DailyOperationsTimelineEvent): string {
  const links = [
    event.transactionLink ? "a transaction" : null,
    event.registerLink ? "a register session" : null,
    event.onlineOrderLink ? "an online order" : null,
    event.productLink || event.approvedProductLink ? "a catalogue item" : null,
  ].filter((part): part is string => part !== null);
  return links.length > 0 ? `${event.message} Related records: ${links.join(", ")}.` : event.message;
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const listActivityHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "pages" };
  }
  if (decodeOffsetCursor(input.cursor) < 0) {
    return { kind: "unavailable", reason: "cursor_unreadable", retryable: false, sourceKey: "pages" };
  }
  const operatingDate = String(input.args.operatingDate);
  const window = await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "pages" };
  }

  const events = await listTimelineEvents(ctx, {
    endAt: window.endAt,
    includeManagerReviewEvidence: true,
    limit: MAX_OPERATIONS_QUERY_LIMIT,
    startAt: window.startAt,
    storeId,
  });

  // `before` is an event reference this resource minted: page strictly older.
  let ordered = events;
  if (input.args.before !== undefined) {
    const beforeIndex = events.findIndex(
      (event) => mintAgentResourceRef("timeline_event", storeId, event.id) === input.args.before,
    );
    if (beforeIndex < 0) {
      return { kind: "unavailable", reason: "before_event_unknown", retryable: false, sourceKey: "pages" };
    }
    ordered = events.slice(beforeIndex + 1);
  }

  const page = pageOf(ordered, input.pageIndex * input.pageSize, input.pageSize);
  const sourceCeilingReached = events.length >= MAX_OPERATIONS_QUERY_LIMIT;
  const warnings: AgentWarning[] = [];
  if (window.derivation === "utc_fallback") {
    warnings.push({
      code: "operating_window_fallback",
      message: "No store schedule governed this date, so the calendar day was used for the window.",
      sourceKey: "pages",
    });
  }
  if (sourceCeilingReached) {
    warnings.push({
      code: "activity_source_ceiling_reached",
      message: `The timeline read is bounded at ${MAX_OPERATIONS_QUERY_LIMIT} events for one operating day.`,
      sourceKey: "sourceFamilies",
    });
  }

  const sources: AgentSourceCompleteness[] = [
    {
      sourceKey: "pages",
      status: page.hasMore ? "partial" : "complete",
      reason: page.hasMore ? "more_pages_available" : undefined,
      capturedAt: input.now,
    },
    {
      sourceKey: "sourceFamilies",
      status: sourceCeilingReached ? "truncated" : "complete",
      reason: sourceCeilingReached ? "source_read_ceiling_reached" : undefined,
      capturedAt: input.now,
    },
  ];

  return {
    kind: "data",
    data: page.items.map((event) => ({
      eventRef: mintAgentResourceRef("timeline_event", storeId, event.id),
      operatingDate,
      operatingWindow: { derivation: window.derivation, timezone: window.timezone },
      occurredAt: event.createdAt,
      family: familyOf(event),
      eventKind: event.type,
      summary: event.message,
      subjectKind: event.subject.type,
      subjectLabel: event.subject.label,
      financialDetail: financialDetailOf(event),
    })),
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources,
    warnings,
    sourceRefs: page.items.map((event) => ({
      ref: mintAgentSourceRef("timeline_event", storeId, event.id),
      kind: "timeline_event",
      label: event.type,
      capturedAt: input.now,
    })),
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

export const listActivity = defineAgentReadPortQuery({ portKey: ACTIVITY_PORT_KEY, handler: listActivityHandler });
