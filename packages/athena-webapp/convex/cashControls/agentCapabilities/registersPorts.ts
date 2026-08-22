/**
 * Read port for `cash.registerSessions` (V26-1267).
 *
 * Authority boundary: the kernel's port query reauthorizes and derives the
 * store scope; this handler serves both verbs from the same bounded read so a
 * `get` can never reach a session the caller's own `list` could not.
 *
 * `get({ sessionRef })` resolves the reference against the VERIFIED store
 * scope. A reference minted for another store, another kind, or invented
 * outright fails the binding digest and the read answers `unavailable` — it
 * never falls through to a database lookup.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import {
  mintAgentResourceRef,
  mintAgentSourceRef,
  money,
  pageOf,
  resolveAgentOperatingWindowWithCtx,
  resolveAgentResourceRef,
} from "../../lib/agentCapabilitySupport";
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";
import type { AgentReadPortHandler, AgentReadPortHandlerOutput } from "../../agentHarness/readPorts";
import type { AgentSourceCompleteness, AgentWarning } from "../../../shared/agentHarness/results";
import { known, unknown } from "../../../shared/agentHarness/results";
import { REGISTER_SESSIONS_PORT_KEY } from "./registers";

const SESSION_STATUSES = ["open", "active", "closing", "closeout_rejected", "closed"] as const;
type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Per-status read ceiling. One more than a page so exhaustion is detectable. */
const STATUS_READ_LIMIT = 101;
const REF_KIND = "register_session";

const STATUS_ORDER: Record<SessionStatus, number> = {
  open: 0,
  active: 1,
  closing: 2,
  closeout_rejected: 3,
  closed: 4,
};

type SessionRow = Doc<"registerSession">;
type CashCtx = Pick<QueryCtx, "db">;

function registerSessionQuery(ctx: CashCtx, storeId: Id<"store">, status: SessionStatus): Promise<SessionRow[]> {
  return ctx.db
    .query("registerSession")
    .withIndex("by_storeId_status", (q) => q.eq("storeId", storeId).eq("status", status))
    .order("desc")
    .take(STATUS_READ_LIMIT);
}

async function readSessions(ctx: CashCtx, args: { storeId: Id<"store">; statuses: readonly SessionStatus[] }) {
  const pages = await Promise.all(args.statuses.map((status) => registerSessionQuery(ctx, args.storeId, status)));
  return {
    rows: pages.flat(),
    truncated: pages.some((page) => page.length >= STATUS_READ_LIMIT),
  };
}

function touchesOperatingDate(session: SessionRow, operatingDate: string, window: { endAt: number }): boolean {
  if (session.openedOperatingDate !== undefined) {
    if (session.openedOperatingDate === operatingDate) return true;
  } else if (session.openedAt < window.endAt) {
    return true;
  }
  return session.closeoutOperatingDate === operatingDate;
}

function closeoutVersionOf(session: SessionRow): string {
  return `${session.status}@${session.closedAt ?? session.closeoutOwnedAt ?? session.openedAt}#${
    session.closeoutRecords?.length ?? 0
  }`;
}

function projectSession(
  session: SessionRow,
  storeId: Id<"store">,
  terminalLabels: Map<string, string>,
  window: { derivation: "schedule" | "utc_fallback"; timezone?: string },
  currency: string,
) {
  const hasCount = typeof session.countedCash === "number";
  return {
    sessionRef: mintAgentResourceRef(REF_KIND, storeId, String(session._id)),
    registerLabel: session.registerNumber?.trim() || "Unnamed register",
    terminalLabel: session.terminalId ? terminalLabels.get(String(session.terminalId)) : undefined,
    status: session.status,
    openedOperatingDate: session.openedOperatingDate,
    closeoutOperatingDate: session.closeoutOperatingDate,
    operatingWindow: { derivation: window.derivation, timezone: window.timezone },
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    hasPendingApproval: session.managerApprovalRequestId !== undefined,
    closeoutEventCount: session.closeoutRecords?.length ?? 0,
    closeoutVersion: closeoutVersionOf(session),
    openingFloat: known(money(session.openingFloat, currency)),
    expectedCash: known(money(session.expectedCash, currency)),
    // Absent-shaped, never zero: an open drawer has not been counted yet.
    countedCash: hasCount ? known(money(session.countedCash!, currency)) : unknown("not_yet_available"),
    variance:
      typeof session.variance === "number"
        ? known(money(session.variance, currency))
        : unknown("not_yet_available"),
    closeoutHistory: (session.closeoutRecords ?? []).slice(0, 20).map((record) => ({
      kind: record.type,
      occurredAt: record.occurredAt,
      expectedCash: money(record.expectedCash, currency),
      countedCash: typeof record.countedCash === "number" ? money(record.countedCash, currency) : undefined,
      variance: typeof record.variance === "number" ? money(record.variance, currency) : undefined,
      reason: record.reason ?? record.notes,
    })),
  };
}

async function terminalLabelsFor(ctx: CashCtx, sessions: readonly SessionRow[]) {
  const terminalIds = [
    ...new Set(sessions.map((session) => session.terminalId).filter((id): id is Id<"posTerminal"> => Boolean(id))),
  ];
  const terminals = await Promise.all(terminalIds.map((terminalId) => ctx.db.get("posTerminal", terminalId)));
  return new Map(
    terminals
      .filter((terminal): terminal is NonNullable<typeof terminal> => Boolean(terminal?.displayName?.trim()))
      .map((terminal) => [String(terminal._id), terminal.displayName!.trim()]),
  );
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const readRegisterSessionsHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "partitions" };
  }
  const store = await ctx.db.get("store", storeId);
  const currency = store?.currency ?? "GHS";

  if (input.verb === "get") {
    const sessionId = resolveAgentResourceRef(REF_KIND, storeId, input.args.sessionRef);
    if (!sessionId) {
      // A guessed, tampered, cross-store, or cross-kind reference stops here.
      return { kind: "unavailable", reason: "session_reference_unresolvable", retryable: false, sourceKey: "partitions" };
    }
    const session = await ctx.db.get("registerSession", sessionId as Id<"registerSession">);
    if (!session || session.storeId !== storeId) {
      return { kind: "unavailable", reason: "session_not_found_in_store", retryable: false, sourceKey: "partitions" };
    }
    const terminalLabels = await terminalLabelsFor(ctx, [session]);
    const operatingDate = session.closeoutOperatingDate ?? session.openedOperatingDate;
    const window = operatingDate
      ? await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId })
      : null;
    return {
      kind: "data",
      data: projectSession(
        session,
        storeId,
        terminalLabels,
        window ?? { derivation: "utc_fallback" },
        currency,
      ),
      observedAt: input.now,
      freshness: { class: "live", authority: "live_read" },
      sources: [
        { sourceKey: "partitions", status: "complete", capturedAt: input.now },
        { sourceKey: "pages", status: "complete", capturedAt: input.now },
      ],
      warnings: [],
      sourceRefs: [
        {
          ref: mintAgentSourceRef(REF_KIND, storeId, String(session._id)),
          kind: "register_session",
          label: session.registerNumber ?? undefined,
          version: closeoutVersionOf(session),
          capturedAt: input.now,
        },
      ],
    };
  }

  const operatingDate = String(input.args.operatingDate);
  const window = await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "partitions" };
  }
  const requestedStatus = input.args.status as SessionStatus | undefined;
  const statuses = requestedStatus ? [requestedStatus] : SESSION_STATUSES;
  const read = await readSessions(ctx, { storeId, statuses });
  const matching = read.rows
    .filter((session) => touchesOperatingDate(session, operatingDate, window))
    .sort(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || right.openedAt - left.openedAt,
    );
  const page = pageOf(matching, input.pageIndex * input.pageSize, input.pageSize);
  const terminalLabels = await terminalLabelsFor(ctx, page.items);
  const warnings: AgentWarning[] = [];
  if (window.derivation === "utc_fallback") {
    warnings.push({
      code: "operating_window_fallback",
      message: "No store schedule governed this date, so the calendar day was used for the window.",
      sourceKey: "partitions",
    });
  }

  const sources: AgentSourceCompleteness[] = [
    {
      sourceKey: "partitions",
      status: read.truncated ? "truncated" : requestedStatus ? "partial" : "complete",
      reason: read.truncated
        ? "status_read_ceiling_reached"
        : requestedStatus
          ? "single_status_partition_requested"
          : undefined,
      capturedAt: input.now,
    },
    {
      sourceKey: "pages",
      status: page.hasMore ? "partial" : "complete",
      reason: page.hasMore ? "more_pages_available" : undefined,
      capturedAt: input.now,
    },
  ];

  return {
    kind: "data",
    data: page.items.map((session) => projectSession(session, storeId, terminalLabels, window, currency)),
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources,
    warnings,
    sourceRefs: page.items.map((session) => ({
      ref: mintAgentSourceRef(REF_KIND, storeId, String(session._id)),
      kind: "register_session",
      label: session.registerNumber ?? undefined,
      version: closeoutVersionOf(session),
      capturedAt: input.now,
    })),
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

export const readRegisterSessions = defineAgentReadPortQuery({ portKey: REGISTER_SESSIONS_PORT_KEY, handler: readRegisterSessionsHandler });
