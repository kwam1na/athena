import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import * as sharedDemoActor from "../sharedDemo/actor";
import {
  buildDailyOperationsSnapshotWithCtx,
  getDailyOperationsAutomationSnapshot,
  getDailyOperationsDetailSnapshot,
  getDailyOperationsOpenRegisterSessionsSnapshot,
  getDailyOperationsSnapshot,
  getDailyOperationsStorePulseSnapshot,
  getDailyOperationsStoreRequestsSnapshot,
  getDailyOperationsTodayRefreshSnapshot,
  getDailyOperationsTimelinePreviewSnapshot,
  getDailyOperationsTimelineSnapshot,
  getDailyOperationsWeekAnalyticsSnapshot,
} from "./dailyOperations";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

vi.mock("../sharedDemo/actor", () => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));

type TableName =
  | "approvalRequest"
  | "automationRun"
  | "dailyClose"
  | "dailyOpening"
  | "expenseTransaction"
  | "onlineOrder"
  | "operationalEvent"
  | "operationalWorkItem"
  | "oversizedOperationalWorkRepair"
  | "paymentAllocation"
  | "posLocalSyncConflict"
  | "posLocalSyncEvent"
  | "posLocalSyncMapping"
  | "posPendingCheckoutItem"
  | "posSession"
  | "posTerminal"
  | "posTransactionAdjustment"
  | "posTransaction"
  | "posTransactionItem"
  | "productSku"
  | "registerSession"
  | "scheduledRunLedger"
  | "staffProfile"
  | "store";

type Row = Record<string, unknown> & { _id: string };

type QueryPredicate = {
  field: string;
  operator: "eq" | "gte" | "lt" | "lte";
  value: unknown;
};

type QueryObservation = {
  indexName?: string;
  limit?: number;
  order: "asc" | "desc";
  predicates: QueryPredicate[];
  table: TableName;
  terminal: "collect" | "first" | "iterate" | "take";
};

function createDb(seed: Partial<Record<TableName, Row[]>> = {}) {
  const tables = new Map<TableName, Map<string, Row>>();
  const observations: QueryObservation[] = [];

  const tableFor = (table: TableName) => {
    if (!tables.has(table)) {
      tables.set(table, new Map());
    }

    return tables.get(table)!;
  };

  Object.entries(seed).forEach(([tableName, rows]) => {
    const table = tableFor(tableName as TableName);
    rows?.forEach((row) => table.set(row._id, { ...row }));
  });

  const query = (table: TableName) => {
    const filters: Array<
      [string, unknown | { gte?: number; lt?: number; lte?: number }]
    > = [];
    const predicates: QueryPredicate[] = [];
    let indexName: string | undefined;
    let sortDirection: "asc" | "desc" = "asc";
    const filteredRows = () => {
      const rows = Array.from(tableFor(table).values()).filter((row) =>
        filters.every(([field, value]) => {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            if (
              "gte" in value &&
              typeof value.gte === "number" &&
              Number(row[field]) < value.gte
            ) {
              return false;
            }

            if (
              "lt" in value &&
              typeof value.lt === "number" &&
              Number(row[field]) >= value.lt
            ) {
              return false;
            }

            if (
              "lte" in value &&
              typeof value.lte === "number" &&
              Number(row[field]) > value.lte
            ) {
              return false;
            }

            return true;
          }

          return row[field] === value;
        }),
      );

      return rows.sort((left, right) => {
        if (indexName === "by_storeId_operatingDate") {
          const storeComparison = String(left.storeId ?? "").localeCompare(
            String(right.storeId ?? ""),
          );
          if (storeComparison !== 0) {
            return sortDirection === "desc"
              ? -storeComparison
              : storeComparison;
          }

          const dateComparison = String(left.operatingDate ?? "").localeCompare(
            String(right.operatingDate ?? ""),
          );
          if (dateComparison !== 0) {
            return sortDirection === "desc" ? -dateComparison : dateComparison;
          }
        }

        const leftValue = Number(
          left._creationTime ??
            left.createdAt ??
            left.completedAt ??
            left.startedAt ??
            0,
        );
        const rightValue = Number(
          right._creationTime ??
            right.createdAt ??
            right.completedAt ??
            right.startedAt ??
            0,
        );
        return sortDirection === "desc"
          ? rightValue - leftValue
          : leftValue - rightValue;
      });
    };
    const observe = (
      terminal: QueryObservation["terminal"],
      limit?: number,
    ) => {
      observations.push({
        indexName,
        limit,
        order: sortDirection,
        predicates: predicates.map((predicate) => ({ ...predicate })),
        table,
        terminal,
      });
    };

    const chain = {
      collect: async () => {
        observe("collect");
        return filteredRows();
      },
      first: async () => {
        observe("first");
        return filteredRows()[0] ?? null;
      },
      order(direction: "asc" | "desc") {
        sortDirection = direction;
        return chain;
      },
      take: async (limit: number) => {
        observe("take", limit);
        return filteredRows().slice(0, limit);
      },
      async *[Symbol.asyncIterator]() {
        observe("iterate");
        for (const row of filteredRows()) {
          yield row;
        }
      },
      withIndex(
        selectedIndex: string,
        applyIndex: (builder: {
          eq: (field: string, value: unknown) => typeof builder;
          gte: (field: string, value: number) => typeof builder;
          lt: (field: string, value: number) => typeof builder;
          lte: (field: string, value: number) => typeof builder;
        }) => unknown,
      ) {
        indexName = selectedIndex;
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            predicates.push({ field, operator: "eq", value });
            return builder;
          },
          gte(field: string, value: number) {
            filters.push([field, { gte: value }]);
            predicates.push({ field, operator: "gte", value });
            return builder;
          },
          lt(field: string, value: number) {
            filters.push([field, { lt: value }]);
            predicates.push({ field, operator: "lt", value });
            return builder;
          },
          lte(field: string, value: number) {
            filters.push([field, { lte: value }]);
            predicates.push({ field, operator: "lte", value });
            return builder;
          },
        };

        applyIndex(builder);
        return chain;
      },
    };

    return chain;
  };

  const db = {
    async get(tableOrId: string, maybeId?: string) {
      if (maybeId !== undefined) {
        return tableFor(tableOrId as TableName).get(maybeId) ?? null;
      }

      for (const table of tables.values()) {
        const row = table.get(tableOrId);
        if (row) return row;
      }

      return null;
    },
    normalizeId(table: TableName, id: string) {
      return tableFor(table).has(id) ? id : null;
    },
    query,
  };

  return { db, observations };
}

const store = {
  _id: "store-1",
  createdByUserId: "user-1",
  currency: "GHS",
  name: "Osu",
  organizationId: "org-1",
  slug: "osu",
};

const startedOpening = {
  _id: "opening-1",
  acknowledgedItemKeys: [],
  actorStaffProfileId: "staff-1",
  carryForwardWorkItemIds: [],
  createdAt: Date.UTC(2026, 4, 8, 8),
  operatingDate: "2026-05-08",
  organizationId: "org-1",
  priorDailyCloseId: "close-prior",
  readiness: {
    blockerCount: 0,
    carryForwardCount: 0,
    readyCount: 1,
    reviewCount: 0,
    status: "ready",
  },
  sourceSubjects: [],
  startedAt: Date.UTC(2026, 4, 8, 8),
  status: "started",
  storeId: "store-1",
  updatedAt: Date.UTC(2026, 4, 8, 8),
};

const priorClose = {
  _id: "close-prior",
  carryForwardWorkItemIds: [],
  completedAt: Date.UTC(2026, 4, 7, 22),
  completedByStaffProfileId: "staff-1",
  completedByUserId: "user-1",
  createdAt: Date.UTC(2026, 4, 7, 22),
  isCurrent: false,
  operatingDate: "2026-05-07",
  organizationId: "org-1",
  readiness: {
    blockerCount: 0,
    carryForwardCount: 0,
    readyCount: 1,
    reviewCount: 0,
    status: "ready",
  },
  sourceSubjects: [],
  status: "completed",
  storeId: "store-1",
  summary: { salesTotal: 45000 },
  updatedAt: Date.UTC(2026, 4, 7, 22),
};

function buildPendingRegisterCountSeed(): Partial<Record<TableName, Row[]>> {
  return {
    dailyClose: [priorClose],
    dailyOpening: [startedOpening],
    posLocalSyncConflict: [
      {
        _id: "conflict-register-count",
        conflictType: "permission",
        createdAt: Date.UTC(2026, 4, 8, 20, 46),
        details: {
          countedCash: 232_500,
          expectedCash: 190_500,
          variance: 42_000,
        },
        localEventId: "local-closeout-event",
        localRegisterSessionId: "local-register-1",
        sequence: 8,
        status: "needs_review",
        storeId: "store-1",
        summary:
          "Register closeout variance requires manager review before synced closeout can be applied.",
        terminalId: "terminal-1",
      },
    ],
    posLocalSyncEvent: [
      {
        _id: "sync-register-count",
        acceptedAt: Date.UTC(2026, 4, 8, 20, 46),
        eventType: "register_closed",
        localEventId: "local-closeout-event",
        localRegisterSessionId: "local-register-1",
        occurredAt: Date.UTC(2026, 4, 8, 20, 45),
        payload: {
          countedCash: 232_500,
        },
        sequence: 8,
        staffProfileId: "staff-pos",
        status: "conflicted",
        storeId: "store-1",
        submittedAt: Date.UTC(2026, 4, 8, 20, 46),
        terminalId: "terminal-1",
      },
    ],
    posLocalSyncMapping: [
      {
        _id: "mapping-register-1",
        cloudId: "register-1",
        cloudTable: "registerSession",
        createdAt: Date.UTC(2026, 4, 8, 8),
        localEventId: "local-open-event",
        localId: "local-register-1",
        localIdKind: "registerSession",
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ],
    registerSession: [
      {
        _id: "register-1",
        expectedCash: 190_500,
        openedAt: Date.UTC(2026, 4, 8, 8),
        openingFloat: 16_000,
        organizationId: "org-1",
        registerNumber: "1",
        status: "active",
        storeId: "store-1",
      },
    ],
    staffProfile: [
      {
        _id: "staff-pos",
        fullName: "P OS",
        organizationId: "org-1",
        storeId: "store-1",
      },
    ],
    store: [store],
  };
}

function buildCtx(seed: Partial<Record<TableName, Row[]>>) {
  const { db } = createDb(seed);
  return { db } as unknown as QueryCtx;
}

function buildObservedCtx(seed: Partial<Record<TableName, Row[]>>) {
  const { db, observations } = createDb(seed);
  return {
    ctx: { db } as unknown as QueryCtx,
    observations,
  };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function operatingDateRange(
  operatingDate: string,
  operatingTimezoneOffsetMinutes = 0,
) {
  const startAt =
    Date.parse(`${operatingDate}T00:00:00.000Z`) +
    operatingTimezoneOffsetMinutes * 60_000;
  return { endAt: startAt + 24 * 60 * 60 * 1000, startAt };
}

function frozenFinancialCompleteness(
  operatingDate: string,
  operatingTimezoneOffsetMinutes = 0,
) {
  const range = operatingDateRange(
    operatingDate,
    operatingTimezoneOffsetMinutes,
  );
  return {
    complete: true,
    entries: [
      {
        complete: true,
        limit: 200,
        range,
        readMode: "by_storeId_status_completedAt",
        recordCount: 2,
        source: "pos_transaction",
        statuses: ["completed"],
      },
      {
        complete: true,
        limit: 200,
        range,
        readMode: "by_storeId_status_completedAt",
        recordCount: 1,
        source: "pos_transaction",
        statuses: ["void"],
      },
      {
        complete: true,
        limit: 200,
        range,
        readMode: "by_storeId_status_appliedAt",
        recordCount: 1,
        source: "pos_transaction_adjustment",
        statuses: ["applied"],
      },
      {
        complete: true,
        limit: 200,
        range,
        readMode: "by_storeId_status_completedAt",
        recordCount: 1,
        source: "expense_transaction",
        statuses: ["completed"],
      },
    ],
  };
}

function frozenFinancialCompletenessForRange(
  operatingDate: string,
  range: { endAt: number; startAt: number },
) {
  const completeness = frozenFinancialCompleteness(operatingDate);
  return {
    ...completeness,
    entries: completeness.entries.map((entry) => ({ ...entry, range })),
  };
}

function frozenFinancialCompletenessWithExpenseOverride(
  overrides: Record<string, unknown>,
  options: { omitLimit?: boolean } = {},
) {
  const completeness = frozenFinancialCompleteness("2026-05-08");
  return {
    ...completeness,
    entries: completeness.entries.map((entry) => {
      if (entry.source !== "expense_transaction") return entry;
      const updated: Record<string, unknown> = { ...entry, ...overrides };
      if (options.omitLimit) delete updated.limit;
      return updated;
    }),
  };
}

function buildCompletedPosTransaction(
  overrides: Partial<Row> & Pick<Row, "_id">,
) {
  const total = typeof overrides.total === "number" ? overrides.total : 77_000;
  return {
    changeGiven: 0,
    completedAt: Date.UTC(2026, 4, 8, 12),
    paymentMethod: "cash",
    paymentAllocations: [],
    payments: [{ amount: total, method: "cash" }],
    status: "completed",
    storeId: "store-1",
    terminalId: "terminal-1",
    total,
    totalPaid: total,
    transactionNumber: String(overrides._id).toUpperCase(),
    ...overrides,
  };
}

function buildFrozenClose(args: {
  id?: string;
  isCurrent?: boolean;
  lifecycleStatus?: "active" | "reopened" | "superseded";
  operatingDate: string;
  operatingTimezoneOffsetMinutes?: number;
  rowOverrides?: Record<string, unknown>;
  salesTotal?: number;
  snapshotOverrides?: Record<string, unknown>;
  summaryOverrides?: Record<string, unknown>;
}) {
  const range = operatingDateRange(
    args.operatingDate,
    args.operatingTimezoneOffsetMinutes,
  );
  const completedAt = range.endAt - 60 * 60 * 1000;
  const summary = {
    adjustedSalesTotal: (args.salesTotal ?? 111_000) + 5_000,
    adjustmentCashSettlementTotal: 5_000,
    adjustmentCollectionTotal: 5_000,
    adjustmentNetSettlementTotal: 5_000,
    adjustmentPaymentTotals: [
      {
        amount: 5_000,
        method: "cash",
        transactionCount: 1,
      },
    ],
    adjustmentRefundTotal: 0,
    carriedOverCashTotal: 987_654,
    carriedOverRegisterCount: 9,
    currentDayCashTotal: args.salesTotal ?? 111_000,
    currentDayCashTransactionCount: 2,
    expenseTotal: 12_000,
    expenseTransactionCount: 1,
    itemAdjustmentCount: 1,
    netCashMovementTotal: (args.salesTotal ?? 111_000) - 7_000,
    netCashVariance: 654_321,
    paymentTotals: [
      {
        amount: args.salesTotal ?? 111_000,
        method: "cash",
        transactionCount: 2,
      },
    ],
    registerVarianceCount: 8,
    salesTotal: args.salesTotal ?? 111_000,
    transactionCount: 2,
    ...args.summaryOverrides,
  };
  const baseSnapshot = {
    snapshotContractVersion: 2,
    carryForwardItems: [],
    closeMetadata: {
      carryForwardWorkItemIds: [],
      completedAt,
      endAt: range.endAt,
      operatingDate: args.operatingDate,
      organizationId: "org-1",
      startAt: range.startAt,
      storeId: "store-1",
    },
    readiness: {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
      reviewCount: 0,
      status: "ready",
    },
    readyItems: [],
    reviewedItems: [],
    sourceCompleteness: frozenFinancialCompleteness(
      args.operatingDate,
      args.operatingTimezoneOffsetMinutes,
    ),
    sourceSubjects: [],
    summary,
  };
  const snapshotOverrides = args.snapshotOverrides ?? {};
  const reportSnapshot = {
    ...baseSnapshot,
    ...snapshotOverrides,
    closeMetadata: {
      ...baseSnapshot.closeMetadata,
      ...((snapshotOverrides.closeMetadata as Record<string, unknown>) ?? {}),
    },
    summary: {
      ...summary,
      ...((snapshotOverrides.summary as Record<string, unknown>) ?? {}),
    },
  };

  return {
    _id: args.id ?? `close-${args.operatingDate}`,
    carryForwardWorkItemIds: [],
    completedAt,
    createdAt: completedAt,
    isCurrent: args.isCurrent ?? false,
    lifecycleStatus: args.lifecycleStatus ?? "active",
    operatingDate: args.operatingDate,
    organizationId: "org-1",
    readiness: baseSnapshot.readiness,
    reportSnapshot,
    sourceCompleteness: reportSnapshot.sourceCompleteness,
    sourceSubjects: [],
    status: "completed",
    storeId: "store-1",
    summary,
    updatedAt: completedAt,
    ...args.rowOverrides,
  };
}

type FrozenFallbackCase = {
  label: string;
  snapshotOverrides?: Record<string, unknown>;
  summaryOverrides?: Record<string, unknown>;
};

function mockDailyOperationsRole(role: "full_admin" | "pos_only") {
  vi.mocked(
    athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
  ).mockResolvedValue({
    _creationTime: 0,
    _id: "user-1" as Id<"athenaUser">,
    email: role === "full_admin" ? "admin@wigclub.store" : "pos@wigclub.store",
  });
  vi.mocked(
    athenaUserAuth.requireOrganizationMemberRoleWithCtx,
  ).mockResolvedValue({
    _creationTime: 0,
    _id: `member-${role}` as Id<"organizationMember">,
    organizationId: "org-1" as Id<"organization">,
    role,
    userId: "user-1" as Id<"athenaUser">,
  });
}

const metricSourceTables = new Set<TableName>([
  "dailyClose",
  "expenseTransaction",
  "posTransaction",
  "posTransactionAdjustment",
]);

function metricSourceObservations(observations: QueryObservation[]) {
  return observations.filter((observation) =>
    metricSourceTables.has(observation.table),
  );
}

describe("daily operations overview read model", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("treats a store day with no opening as ready to start when opening has no review work", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        store: [store],
      }),
      {
        includeScheduledRunSummaries: true,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.lifecycle.status).toBe("not_opened");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Start Opening Handoff",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    });
    expect(snapshot.attentionItems).toHaveLength(0);
    expect(snapshot.lanes.find((lane) => lane.key === "opening")).toMatchObject(
      {
        description: "Opening Handoff is ready to start.",
        status: "ready",
      },
    );
  });

  it("exposes latest Daily Operations automation runs as normalized UI status", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        automationRun: [
          {
            _id: "automation-opening-old",
            action: "opening.auto_start",
            createdAt: Date.UTC(2026, 4, 8, 7, 30),
            domain: "daily_operations",
            eventIds: [],
            idempotencyKey:
              "daily_operations:opening.auto_start:store-1:2026-05-08:old",
            mutationBoundary: "daily_opening",
            operatingDate: "2026-05-08",
            outcome: "skipped",
            policyMode: "dry_run",
            policyVersion: "daily-operations-automation-v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 7, 30),
          },
          {
            _id: "automation-opening",
            action: "opening.auto_start",
            appliedAt: Date.UTC(2026, 4, 8, 8),
            createdAt: Date.UTC(2026, 4, 8, 8),
            domain: "daily_operations",
            eventIds: [],
            idempotencyKey:
              "daily_operations:opening.auto_start:store-1:2026-05-08",
            mutationBoundary: "daily_opening",
            operatingDate: "2026-05-08",
            outcome: "applied",
            policyMode: "enabled",
            policyVersion: "daily-operations-automation-v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 8),
          },
          {
            _id: "automation-close",
            action: "eod.prepare",
            createdAt: Date.UTC(2026, 4, 8, 19),
            domain: "daily_operations",
            eventIds: [],
            idempotencyKey: "daily_operations:eod.prepare:store-1:2026-05-08",
            mutationBoundary: "daily_close",
            operatingDate: "2026-05-08",
            outcome: "prepared",
            policyMode: "enabled",
            policyVersion: "daily-operations-automation-v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 19),
          },
        ],
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      {
        includeManagerReviewEvidence: true,
        includeScheduledRunSummaries: true,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.automationStatuses).toEqual([
      {
        bucket: "needs_review",
        id: "automation-close",
        lane: "close",
        occurredAt: Date.UTC(2026, 4, 8, 19),
        outcome: "prepared",
        policyMode: "enabled",
        policyVersion: "daily-operations-automation-v1",
        sourceLink: {
          search: { operatingDate: "2026-05-08" },
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        },
      },
      {
        bucket: "action_taken",
        id: "automation-opening",
        lane: "opening",
        occurredAt: Date.UTC(2026, 4, 8, 8),
        outcome: "applied",
        policyMode: "enabled",
        policyVersion: "daily-operations-automation-v1",
        sourceLink: {
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
        },
      },
    ]);
  });

  it("exposes Daily Operations automation as a narrow subscribed snapshot", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });

    const snapshot = await getHandler(getDailyOperationsAutomationSnapshot)(
      buildCtx({
        automationRun: [
          {
            _id: "automation-opening",
            action: "opening.auto_start",
            appliedAt: Date.UTC(2026, 4, 8, 8),
            createdAt: Date.UTC(2026, 4, 8, 8),
            domain: "daily_operations",
            eventIds: [],
            idempotencyKey:
              "daily_operations:opening.auto_start:store-1:2026-05-08",
            mutationBoundary: "daily_opening",
            operatingDate: "2026-05-08",
            outcome: "applied",
            policyMode: "enabled",
            policyVersion: "daily-operations-automation-v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 8),
          },
        ],
        dailyOpening: [startedOpening],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot).toEqual({
      automationStatuses: [
        {
          bucket: "action_taken",
          id: "automation-opening",
          lane: "opening",
          occurredAt: Date.UTC(2026, 4, 8, 8),
          outcome: "applied",
          policyMode: "enabled",
          policyVersion: "daily-operations-automation-v1",
          sourceLink: {
            to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
          },
        },
      ],
      operatingDate: "2026-05-08",
    });
  });

  it("keeps EOD preparation visible over pre-window auto-complete checks", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        automationRun: [
          {
            _id: "automation-close-prepare",
            action: "eod.prepare",
            createdAt: Date.UTC(2026, 4, 8, 19),
            domain: "daily_operations",
            eventIds: [],
            idempotencyKey: "daily_operations:eod.prepare:store-1:2026-05-08",
            mutationBoundary: "daily_close",
            operatingDate: "2026-05-08",
            outcome: "prepared",
            policyMode: "enabled",
            policyVersion: "daily-operations-automation-v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 19),
          },
          {
            _id: "automation-close-auto-skip",
            action: "eod.auto_complete",
            createdAt: Date.UTC(2026, 4, 8, 20),
            decisionEvidence: {
              classification: "outside_completion_window",
              eligible: false,
              kind: "eod_auto_complete",
              observed: {
                absoluteCashVariance: 0,
                voidedSaleTotal: 0,
              },
              policy: {
                localCompletionWindowMinutes: 1260,
              },
            },
            decisionReason:
              "EOD Review auto-complete is outside the configured local completion window.",
            domain: "daily_operations",
            eventIds: [],
            idempotencyKey:
              "daily_operations:eod.auto_complete:store-1:2026-05-08",
            mutationBoundary: "daily_close",
            operatingDate: "2026-05-08",
            outcome: "skipped",
            policyMode: "enabled",
            policyVersion: "daily-operations.v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 20),
          },
        ],
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      {
        includeManagerReviewEvidence: true,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(
      snapshot.automationStatuses.find((status) => status.lane === "close"),
    ).toMatchObject({
      bucket: "needs_review",
      id: "automation-close-prepare",
      outcome: "prepared",
      policyMode: "enabled",
    });
  });

  it("prefers applied EOD auto-complete status for closed days over stale skipped dry-run runs", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        automationRun: [
          {
            _id: "automation-close-applied",
            action: "eod.auto_complete",
            appliedAt: Date.UTC(2026, 4, 8, 22),
            createdAt: Date.UTC(2026, 4, 8, 22),
            decisionEvidence: {
              gates: [
                {
                  key: "absolute_cash_variance",
                  passed: true,
                  reason: "0 <= 5000",
                },
              ],
              kind: "eod_auto_complete",
              observed: {
                absoluteCashVariance: 0,
                voidedSaleTotal: 0,
              },
              policy: {
                maxAbsoluteCashVariance: 5000,
                maxVoidedSaleTotal: 0,
              },
            },
            decisionReason:
              "EOD Review is clean and eligible for auto-complete.",
            domain: "daily_operations",
            idempotencyKey:
              "daily_operations:eod.auto_complete:store-1:2026-05-08",
            mutationBoundary: "daily_close",
            operatingDate: "2026-05-08",
            outcome: "applied",
            policyMode: "enabled",
            policyVersion: "daily-operations.v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 22),
          },
          {
            _id: "automation-close-stale-skipped",
            action: "eod.auto_complete",
            createdAt: Date.UTC(2026, 4, 8, 23),
            decisionReason:
              "EOD Review is already completed for this store day.",
            domain: "daily_operations",
            idempotencyKey:
              "daily_operations:eod.auto_complete:store-1:2026-05-08:retry",
            mutationBoundary: "daily_close",
            operatingDate: "2026-05-08",
            outcome: "skipped",
            policyMode: "dry_run",
            policyVersion: "daily-operations.v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 23),
          },
        ],
        dailyClose: [
          {
            _id: "daily-close-automation",
            actorType: "automation",
            automationDecisionReason:
              "EOD Review is clean and eligible for auto-complete.",
            automationPolicyVersion: "daily-operations.v1",
            automationRunId: "automation-close-applied",
            carryForwardWorkItemIds: [],
            completedAt: Date.UTC(2026, 4, 8, 22),
            createdAt: Date.UTC(2026, 4, 8, 22),
            isCurrent: true,
            lifecycleStatus: "active",
            operatingDate: "2026-05-08",
            organizationId: "org-1",
            readiness: {
              blockerCount: 0,
              carryForwardCount: 0,
              readyCount: 1,
              reviewCount: 0,
              status: "ready",
            },
            reportSnapshot: {
              closeMetadata: {
                actorType: "automation",
                automationDecisionReason:
                  "EOD Review is clean and eligible for auto-complete.",
                automationPolicyVersion: "daily-operations.v1",
                automationRunId: "automation-close-applied",
                carryForwardWorkItemIds: [],
                completedAt: Date.UTC(2026, 4, 8, 22),
                endAt: Date.UTC(2026, 4, 9),
                operatingDate: "2026-05-08",
                organizationId: "org-1",
                startAt: Date.UTC(2026, 4, 8),
                storeId: "store-1",
              },
              carryForwardItems: [],
              readiness: {
                blockerCount: 0,
                carryForwardCount: 0,
                readyCount: 1,
                reviewCount: 0,
                status: "ready",
              },
              readyItems: [],
              reviewedItems: [],
              sourceSubjects: [],
              summary: {
                salesTotal: 0,
                transactionCount: 0,
              },
            },
            sourceSubjects: [],
            status: "completed",
            storeId: "store-1",
            summary: {
              salesTotal: 0,
              transactionCount: 0,
            },
            updatedAt: Date.UTC(2026, 4, 8, 22),
          },
        ],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      {
        includeManagerReviewEvidence: true,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.lifecycle.status).toBe("closed");
    expect(snapshot.completedClose).toMatchObject({
      actorType: "automation",
      automationDecisionReason:
        "EOD Review is clean and eligible for auto-complete.",
      automationRunId: "automation-close-applied",
    });
    expect(
      snapshot.automationStatuses.find((status) => status.lane === "close"),
    ).toMatchObject({
      decisionEvidence: {
        kind: "eod_auto_complete",
      },
      decisionReason: "EOD Review is clean and eligible for auto-complete.",
      id: "automation-close-applied",
      outcome: "applied",
      policyMode: "enabled",
      policyVersion: "daily-operations.v1",
    });
  });

  it("redacts EOD auto-complete decision evidence for broad Daily Operations readers", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        automationRun: [
          {
            _id: "automation-close-applied",
            action: "eod.auto_complete",
            appliedAt: Date.UTC(2026, 4, 8, 22),
            createdAt: Date.UTC(2026, 4, 8, 22),
            decisionEvidence: {
              kind: "eod_auto_complete",
              observed: {
                absoluteCashVariance: 2000,
                voidedSaleTotal: 42000,
              },
              policy: {
                maxAbsoluteCashVariance: 5000,
                maxVoidedSaleTotal: 50000,
              },
            },
            decisionReason:
              "EOD Review has only low-risk review evidence within policy thresholds.",
            domain: "daily_operations",
            idempotencyKey:
              "daily_operations:eod.auto_complete:store-1:2026-05-08",
            mutationBoundary: "daily_close",
            operatingDate: "2026-05-08",
            outcome: "applied",
            policyMode: "enabled",
            policyVersion: "daily-operations.v1",
            snapshotCounts: {},
            sourceSubjects: [],
            storeId: "store-1",
            triggerType: "scheduled",
            updatedAt: Date.UTC(2026, 4, 8, 22),
          },
        ],
        dailyClose: [
          {
            _id: "daily-close-automation",
            actorType: "automation",
            automationDecisionReason:
              "EOD Review has only low-risk review evidence within policy thresholds.",
            automationPolicyVersion: "daily-operations.v1",
            automationRunId: "automation-close-applied",
            carryForwardWorkItemIds: [],
            completedAt: Date.UTC(2026, 4, 8, 22),
            createdAt: Date.UTC(2026, 4, 8, 22),
            isCurrent: true,
            lifecycleStatus: "active",
            operatingDate: "2026-05-08",
            organizationId: "org-1",
            readiness: {
              blockerCount: 0,
              carryForwardCount: 0,
              readyCount: 1,
              reviewCount: 0,
              status: "ready",
            },
            reportSnapshot: {
              closeMetadata: {
                actorType: "automation",
                automationDecisionReason:
                  "EOD Review has only low-risk review evidence within policy thresholds.",
                automationPolicyVersion: "daily-operations.v1",
                automationRunId: "automation-close-applied",
                carryForwardWorkItemIds: [],
                completedAt: Date.UTC(2026, 4, 8, 22),
                endAt: Date.UTC(2026, 4, 9),
                operatingDate: "2026-05-08",
                organizationId: "org-1",
                startAt: Date.UTC(2026, 4, 8),
                storeId: "store-1",
              },
              carryForwardItems: [],
              readiness: {
                blockerCount: 0,
                carryForwardCount: 0,
                readyCount: 1,
                reviewCount: 0,
                status: "ready",
              },
              readyItems: [],
              reviewedItems: [],
              sourceSubjects: [],
              summary: {
                salesTotal: 0,
                transactionCount: 0,
              },
            },
            sourceSubjects: [],
            status: "completed",
            storeId: "store-1",
            summary: {
              salesTotal: 0,
              transactionCount: 0,
            },
            updatedAt: Date.UTC(2026, 4, 8, 22),
          },
        ],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      {
        includeFinancialDetails: false,
        includeManagerReviewEvidence: false,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    const closeStatus = snapshot.automationStatuses.find(
      (status) => status.lane === "close",
    );
    expect(closeStatus).toMatchObject({
      decisionReason:
        "EOD Review has only low-risk review evidence within policy thresholds.",
      id: "automation-close-applied",
      outcome: "applied",
    });
    expect(closeStatus).not.toHaveProperty("decisionEvidence");
    expect(snapshot.completedClose).toMatchObject({
      actorType: "automation",
      automationRunId: "automation-close-applied",
    });
    expect(snapshot.completedClose).not.toHaveProperty(
      "policyReviewedItemKeys",
    );
  });

  it("exposes only operator-visible scheduled run evidence for the store day", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        scheduledRunLedger: [
          {
            _id: "run-applied",
            actorType: "system",
            candidateCount: 2,
            completedAt: Date.UTC(2026, 4, 8, 9),
            createdAt: Date.UTC(2026, 4, 8, 9),
            cronFamily: "complete-checkout-sessions",
            failedCount: 0,
            organizationId: "org-1",
            outcome: "applied",
            processedCount: 2,
            runKey: "scheduled-run:complete-checkout-sessions:store",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 9, 30),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 9),
            scope: "store",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "checkout_session",
            storeId: "store-1",
            succeededCount: 2,
            updatedAt: Date.UTC(2026, 4, 8, 9),
            visibility: "store",
          },
          {
            _id: "run-partial",
            actorType: "system",
            candidateCount: 3,
            completedAt: Date.UTC(2026, 4, 8, 10),
            createdAt: Date.UTC(2026, 4, 8, 10),
            cronFamily: "auto-verify-payments",
            failedCount: 1,
            organizationId: "org-1",
            outcome: "partial_failure",
            processedCount: 3,
            runKey: "scheduled-run:auto-verify-payments:store",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 10, 10),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 10),
            scope: "store",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "payment",
            storeId: "store-1",
            succeededCount: 2,
            updatedAt: Date.UTC(2026, 4, 8, 10),
            visibility: "store",
          },
          {
            _id: "run-zero-meaningful",
            actorType: "system",
            candidateCount: 0,
            completedAt: Date.UTC(2026, 4, 8, 11),
            createdAt: Date.UTC(2026, 4, 8, 11),
            cronFamily: "complete-checkout-sessions",
            failedCount: 0,
            organizationId: "org-1",
            outcome: "no_candidates",
            processedCount: 0,
            runKey: "scheduled-run:complete-checkout-sessions:zero",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 11, 30),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 11),
            scope: "store",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "checkout_session",
            storeId: "store-1",
            succeededCount: 0,
            updatedAt: Date.UTC(2026, 4, 8, 11),
            visibility: "store",
          },
          {
            _id: "run-hidden-support",
            actorType: "system",
            candidateCount: 1,
            completedAt: Date.UTC(2026, 4, 8, 12),
            createdAt: Date.UTC(2026, 4, 8, 12),
            cronFamily: "auto-verify-payments",
            failedCount: 0,
            outcome: "applied",
            processedCount: 1,
            runKey: "scheduled-run:auto-verify-payments:support",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 12, 10),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 12),
            scope: "store",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "payment",
            storeId: "store-1",
            succeededCount: 1,
            updatedAt: Date.UTC(2026, 4, 8, 12),
            visibility: "support",
          },
          {
            _id: "run-hidden-system",
            actorType: "system",
            candidateCount: 1,
            completedAt: Date.UTC(2026, 4, 8, 13),
            createdAt: Date.UTC(2026, 4, 8, 13),
            cronFamily: "auto-verify-payments",
            failedCount: 0,
            outcome: "applied",
            processedCount: 1,
            runKey: "scheduled-run:auto-verify-payments:system",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 13, 10),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 13),
            scope: "system",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "payment",
            succeededCount: 1,
            updatedAt: Date.UTC(2026, 4, 8, 13),
            visibility: "store",
          },
          {
            _id: "run-hidden-failed",
            actorType: "system",
            candidateCount: 1,
            completedAt: Date.UTC(2026, 4, 8, 14),
            createdAt: Date.UTC(2026, 4, 8, 14),
            cronFamily: "auto-verify-payments",
            failedCount: 1,
            outcome: "failed",
            processedCount: 1,
            runKey: "scheduled-run:auto-verify-payments:failed",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 14, 10),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 14),
            scope: "store",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "payment",
            storeId: "store-1",
            succeededCount: 0,
            updatedAt: Date.UTC(2026, 4, 8, 14),
            visibility: "store",
          },
          {
            _id: "run-hidden-zero",
            actorType: "system",
            candidateCount: 0,
            completedAt: Date.UTC(2026, 4, 8, 15),
            createdAt: Date.UTC(2026, 4, 8, 15),
            cronFamily: "release-checkout-items",
            failedCount: 0,
            outcome: "no_candidates",
            processedCount: 0,
            runKey: "scheduled-run:release-checkout-items:zero",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 15, 10),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 15),
            scope: "store",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "checkout_session",
            storeId: "store-1",
            succeededCount: 0,
            updatedAt: Date.UTC(2026, 4, 8, 15),
            visibility: "store",
          },
        ],
        store: [store],
      }),
      {
        includeManagerReviewEvidence: true,
        includeScheduledRunSummaries: true,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.scheduledRunSummaries).toEqual([
      expect.objectContaining({
        id: "run-zero-meaningful",
        outcome: "no_candidates",
      }),
      expect.objectContaining({
        id: "run-partial",
        outcome: "partial_failure",
      }),
      expect.objectContaining({
        id: "run-applied",
        outcome: "applied",
      }),
    ]);
  });

  it("omits scheduled run evidence when the caller is not authorized for manager evidence", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        scheduledRunLedger: [
          {
            _id: "run-applied",
            actorType: "system",
            candidateCount: 2,
            completedAt: Date.UTC(2026, 4, 8, 9),
            createdAt: Date.UTC(2026, 4, 8, 9),
            cronFamily: "complete-checkout-sessions",
            failedCount: 0,
            outcome: "applied",
            processedCount: 2,
            runKey: "scheduled-run:complete-checkout-sessions:store",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 9, 30),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 9),
            scope: "store",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "checkout_session",
            storeId: "store-1",
            succeededCount: 2,
            updatedAt: Date.UTC(2026, 4, 8, 9),
            visibility: "store",
          },
        ],
        store: [store],
      }),
      {
        includeManagerReviewEvidence: false,
        includeScheduledRunSummaries: true,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.scheduledRunSummaries).toEqual([]);
  });

  it("keeps Opening Handoff in review when prior EOD Review is missing", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("not_opened");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Start Opening Handoff",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    });
    expect(snapshot.lanes.find((lane) => lane.key === "opening")).toMatchObject(
      {
        description:
          "1 opening item will be reviewed when Opening Handoff starts.",
        status: "needs_attention",
      },
    );
    expect(snapshot.attentionItems).toContainEqual(
      expect.objectContaining({
        label: "Prior EOD Review not found",
        owner: "daily_opening",
        severity: "warning",
      }),
    );
  });

  it("marks an opened store day as ready to close when close has no blockers", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("ready_to_close");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Start EOD Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    });
    expect(snapshot.lanes.find((lane) => lane.key === "close")).toMatchObject({
      count: 0,
      status: "ready",
    });
    expect(snapshot.closeSummary).toMatchObject({
      adjustedSalesTotal: 0,
      adjustmentCashSettlementTotal: 0,
      adjustmentCollectionTotal: 0,
      adjustmentNetSettlementTotal: 0,
      adjustmentRefundTotal: 0,
      carriedOverCashTotal: 0,
      currentDayCashTotal: 0,
      expenseTotal: 0,
      itemAdjustmentCount: 0,
      netCashVariance: 0,
      netCashMovementTotal: 0,
      salesTotal: 0,
      transactionCount: 0,
    });
  });

  it("surfaces adjusted/net settlement totals without replacing original close sales", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        posTransaction: [
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 8, 16),
            payments: [{ amount: 50000, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            total: 50000,
            totalPaid: 50000,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        posTransactionAdjustment: [
          {
            _id: "adjustment-applied",
            appliedAt: Date.UTC(2026, 4, 8, 17),
            correctedTotal: 43000,
            deltaTotal: -7000,
            originalTotal: 50000,
            transactionId: "txn-current",
            settlementAmount: 7000,
            settlementDirection: "refund",
            settlementMethod: "cash",
            status: "applied",
            storeId: "store-1",
            transactionNumber: "TXN-CURRENT",
          },
          {
            _id: "adjustment-pending",
            appliedAt: Date.UTC(2026, 4, 8, 18),
            correctedTotal: 56000,
            deltaTotal: 6000,
            originalTotal: 50000,
            transactionId: "txn-current",
            settlementAmount: 6000,
            settlementDirection: "collect",
            settlementMethod: "cash",
            status: "pending",
            storeId: "store-1",
            transactionNumber: "TXN-CURRENT",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.closeSummary).toMatchObject({
      adjustedSalesTotal: 43000,
      adjustmentCashSettlementTotal: -7000,
      adjustmentNetSettlementTotal: -7000,
      adjustmentRefundTotal: 7000,
      itemAdjustmentCount: 1,
      netCashMovementTotal: 43000,
      paymentTotals: [
        {
          amount: 50000,
          method: "cash",
          transactionCount: 1,
        },
      ],
      salesTotal: 50000,
      transactionCount: 1,
    });
    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      adjustedSalesTotal: 43000,
      adjustmentCashSettlementTotal: -7000,
      adjustmentNetSettlementTotal: -7000,
      itemAdjustmentCount: 1,
      netCashMovementTotal: 43000,
      salesTotal: 50000,
      transactionCount: 1,
    });
  });

  it("treats a reopened active close as ready when no close work remains", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [
          priorClose,
          {
            ...priorClose,
            _id: "close-reopened",
            completedAt: Date.UTC(2026, 4, 8, 22),
            isCurrent: true,
            lifecycleStatus: "reopened",
            operatingDate: "2026-05-08",
            reopenedAt: Date.UTC(2026, 4, 9, 8),
            reopenReason: "Cash count corrected after close.",
          },
        ],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("ready_to_close");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Start EOD Review",
    });
    expect(snapshot.lanes.find((lane) => lane.key === "close")).toMatchObject({
      description: "The end of day review is available for review.",
      status: "ready",
    });
    expect(
      snapshot.attentionItems.some(
        (item) =>
          item.owner === "daily_close" && item.label === "EOD Review reopened",
      ),
    ).toBe(false);
  });

  it("keeps reopened store days blocked while close blockers remain", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [
          priorClose,
          {
            ...priorClose,
            _id: "close-reopened",
            completedAt: Date.UTC(2026, 4, 8, 22),
            isCurrent: true,
            lifecycleStatus: "reopened",
            operatingDate: "2026-05-08",
            reopenedAt: Date.UTC(2026, 4, 9, 8),
            reopenReason: "Cash count corrected after close.",
          },
        ],
        dailyOpening: [startedOpening],
        registerSession: [
          {
            _id: "register-1",
            expectedCash: 25000,
            openedAt: Date.UTC(2026, 4, 8, 9),
            registerNumber: "1",
            status: "open",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("close_blocked");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Review close blockers",
    });
    expect(snapshot.lanes.find((lane) => lane.key === "close")).toMatchObject({
      count: 1,
      description: "1 blocker after reopening.",
      status: "blocked",
    });
    expect(snapshot.attentionItems).toContainEqual(
      expect.objectContaining({
        owner: "daily_close",
        label: "EOD Review reopened",
        severity: "warning",
      }),
    );
    expect(snapshot.attentionItems).toContainEqual(
      expect.objectContaining({
        owner: "daily_close",
        source: expect.objectContaining({ id: "register-1" }),
        severity: "critical",
      }),
    );
  });

  it("keeps the week summary anchored separately from the selected operating date", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [
          priorClose,
          {
            ...priorClose,
            _id: "close-current",
            completedAt: Date.UTC(2026, 4, 8, 22),
            isCurrent: true,
            lifecycleStatus: "reopened",
            operatingDate: "2026-05-08",
            status: "needs_review",
          },
        ],
        dailyOpening: [startedOpening],
        expenseTransaction: [
          {
            _id: "expense-current",
            completedAt: Date.UTC(2026, 4, 8, 16),
            notes: "Supplies",
            registerNumber: "1",
            sessionId: "expense-session-1",
            staffProfileId: "staff-1",
            status: "completed",
            storeId: "store-1",
            totalValue: 12000,
            transactionNumber: "EXP-1",
          },
        ],
        posTransaction: [
          {
            _id: "txn-prior",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 7, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 50000, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 50000,
            totalPaid: 50000,
            transactionNumber: "TXN-PRIOR",
          },
          {
            _id: "txn-current",
            changeGiven: 5000,
            completedAt: Date.UTC(2026, 4, 8, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [
              { amount: 45000, method: "cash" },
              { amount: 40000, method: "cash" },
            ],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 80000,
            totalPaid: 85000,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        store: [store],
      }),
      {
        operatingDate: "2026-05-05",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-08",
      },
    );

    expect(snapshot.weekMetrics.map((metric) => metric.operatingDate)).toEqual([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
    ]);
    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-05-07",
      ),
    ).toMatchObject({
      isClosed: true,
      isSelected: false,
      salesTotal: 50000,
      transactionCount: 1,
    });
    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      currentDayCashTotal: 80000,
      expenseTotal: 12000,
      isClosed: false,
      isReopened: true,
      isSelected: false,
      paymentTotals: [
        {
          amount: 80000,
          method: "cash",
          transactionCount: 1,
        },
      ],
      salesTotal: 80000,
      transactionCount: 1,
    });
    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-05-05",
      ),
    ).toMatchObject({
      isSelected: true,
      salesTotal: 0,
      transactionCount: 0,
    });
  });

  it("marks week metrics reopened when the completed close was superseded by reopening", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [
          {
            ...priorClose,
            _id: "close-original",
            completedAt: Date.UTC(2026, 4, 8, 22),
            isCurrent: false,
            lifecycleStatus: "superseded",
            operatingDate: "2026-05-08",
            reopenedAt: Date.UTC(2026, 4, 9, 8),
            status: "completed",
            supersededByDailyCloseId: "close-reopened",
          },
        ],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: false,
      isReopened: true,
    });
  });

  it("marks week metrics closed when a reopened close was completed again", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [
          {
            ...priorClose,
            _id: "close-original",
            completedAt: Date.UTC(2026, 4, 8, 22),
            isCurrent: false,
            lifecycleStatus: "superseded",
            operatingDate: "2026-05-08",
            reopenedAt: Date.UTC(2026, 4, 9, 8),
            status: "completed",
            supersededByDailyCloseId: "close-reclosed",
          },
          {
            ...priorClose,
            _id: "close-reclosed",
            completedAt: Date.UTC(2026, 4, 9, 10),
            isCurrent: false,
            lifecycleStatus: "active",
            operatingDate: "2026-05-08",
            reopenedAt: Date.UTC(2026, 4, 9, 8),
            reopenedFromDailyCloseId: "close-original",
            status: "completed",
          },
        ],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: true,
      isReopened: false,
    });
  });

  it("exposes prior-day metric when yesterday is outside the selected week", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyOpening: [
          {
            ...startedOpening,
            _id: "opening-current",
            operatingDate: "2026-06-21",
          },
        ],
        posTransaction: [
          {
            _id: "txn-yesterday",
            changeGiven: 5000,
            completedAt: Date.UTC(2026, 5, 20, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 50000,
            totalPaid: 55000,
            transactionNumber: "TXN-YESTERDAY",
          },
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 5, 21, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 821500, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 821500,
            totalPaid: 821500,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        store: [store],
      }),
      {
        operatingDate: "2026-06-21",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-06-27",
      },
    );

    expect(snapshot.weekMetrics.map((metric) => metric.operatingDate)).toEqual([
      "2026-06-21",
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
      "2026-06-27",
    ]);
    expect(snapshot.priorDayMetric).toMatchObject({
      currentDayCashTotal: 50000,
      operatingDate: "2026-06-20",
      paymentTotals: [
        {
          amount: 50000,
          method: "cash",
          transactionCount: 1,
        },
      ],
      salesTotal: 50000,
      transactionCount: 1,
    });
  });

  it("redacts financial details when the snapshot is built for a non-manager viewer", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyOpening: [
          {
            ...startedOpening,
            _id: "opening-current",
            operatingDate: "2026-06-21",
          },
        ],
        posTransaction: [
          {
            _id: "txn-yesterday",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 5, 20, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 50000, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 50000,
            totalPaid: 50000,
            transactionNumber: "TXN-YESTERDAY",
          },
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 5, 21, 16),
            paymentMethod: "mobile_money",
            paymentAllocations: [],
            payments: [{ amount: 821500, method: "mobile_money" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 821500,
            totalPaid: 821500,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        store: [store],
      }),
      {
        includeFinancialDetails: false,
        operatingDate: "2026-06-21",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-06-27",
      },
    );

    expect(snapshot.closeSummary).toMatchObject({
      currentDayCashTotal: 0,
      paymentTotals: [],
      salesTotal: 0,
      transactionCount: 1,
    });
    expect(snapshot.priorDayMetric).toBeUndefined();
    expect(snapshot.weekMetrics).toEqual([]);
    expect(snapshot).not.toHaveProperty("storePulse");
  });

  it("adds a store pulse snapshot for financial viewers using the selected operating date window", async () => {
    vi.setSystemTime(new Date("2026-06-22T18:00:00.000Z"));

    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyOpening: [
          {
            ...startedOpening,
            _id: "opening-current",
            endAt: Date.parse("2026-06-22T04:00:00.000Z"),
            operatingDate: "2026-06-21",
            startAt: Date.parse("2026-06-21T04:00:00.000Z"),
          },
        ],
        posTransaction: [
          {
            _id: "txn-before-selected-window",
            changeGiven: 0,
            completedAt: Date.parse("2026-06-21T02:00:00.000Z"),
            paymentMethod: "cash",
            payments: [{ amount: 99999, method: "cash", timestamp: 1 }],
            status: "completed",
            storeId: "store-1",
            total: 99999,
            totalPaid: 99999,
            transactionNumber: "TXN-BEFORE",
          },
          {
            _id: "txn-before-midnight",
            changeGiven: 0,
            completedAt: Date.parse("2026-06-21T12:00:00.000Z"),
            paymentMethod: "cash",
            payments: [{ amount: 18000, method: "cash", timestamp: 1 }],
            status: "completed",
            storeId: "store-1",
            total: 18000,
            totalPaid: 18000,
            transactionNumber: "TXN-1",
          },
          {
            _id: "txn-after-midnight",
            changeGiven: 0,
            completedAt: Date.parse("2026-06-22T01:30:00.000Z"),
            paymentMethod: "mobile_money",
            payments: [{ amount: 12000, method: "mobile_money", timestamp: 1 }],
            status: "completed",
            storeId: "store-1",
            total: 12000,
            totalPaid: 12000,
            transactionNumber: "TXN-2",
          },
          {
            _id: "txn-after-selected-window",
            changeGiven: 0,
            completedAt: Date.parse("2026-06-22T12:00:00.000Z"),
            paymentMethod: "card",
            payments: [{ amount: 45000, method: "card", timestamp: 1 }],
            status: "completed",
            storeId: "store-1",
            total: 45000,
            totalPaid: 45000,
            transactionNumber: "TXN-AFTER",
          },
        ],
        posTransactionItem: [
          {
            _id: "item-1",
            productId: "product-1",
            productName: "Wig cap",
            productSku: "CAP",
            productSkuId: "sku-1",
            quantity: 2,
            totalPrice: 18000,
            transactionId: "txn-before-midnight",
          },
          {
            _id: "item-2",
            productId: "product-2",
            productName: "Bundle",
            productSku: "BUNDLE",
            productSkuId: "sku-2",
            quantity: 1,
            totalPrice: 12000,
            transactionId: "txn-after-midnight",
          },
        ],
        store: [store],
      }),
      {
        endAt: Date.parse("2026-06-22T04:00:00.000Z"),
        operatingDate: "2026-06-21",
        startAt: Date.parse("2026-06-21T04:00:00.000Z"),
        storeId: "store-1" as Id<"store">,
        storePulseWindow: "today",
      },
    );

    expect(snapshot.storePulse).toBeDefined();
    expect(snapshot.storePulse!).toMatchObject({
      averageTransaction: 15000,
      date: "2026-06-21",
      totalItemsSold: 3,
      totalSales: 30000,
      totalTransactions: 2,
    });
    expect(snapshot.storePulse!.operatorSnapshot.paymentMix).toEqual([
      expect.objectContaining({
        method: "cash",
        total: 18000,
      }),
      expect.objectContaining({
        method: "mobile_money",
        total: 12000,
      }),
    ]);
    expect(snapshot.storePulse!.operatorSnapshot.trend.at(-1)).toMatchObject({
      date: "2026-06-21",
      totalItemsSold: 3,
      totalSales: 30000,
      transactionCount: 2,
    });
  });

  it("honors the requested Daily Operations store pulse window without changing close or week totals", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyOpening: [
          {
            ...startedOpening,
            _id: "opening-current",
            operatingDate: "2026-06-21",
          },
        ],
        posTransaction: [
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 5, 21, 16),
            paymentMethod: "cash",
            payments: [{ amount: 20000, method: "cash", timestamp: 1 }],
            status: "completed",
            storeId: "store-1",
            total: 20000,
            totalPaid: 20000,
            transactionNumber: "TXN-CURRENT",
          },
          {
            _id: "txn-older",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 5, 16),
            paymentMethod: "card",
            payments: [],
            status: "completed",
            storeId: "store-1",
            total: 10000,
            totalPaid: 10000,
            transactionNumber: "TXN-OLDER",
          },
        ],
        posTransactionItem: [
          {
            _id: "item-current",
            productId: "product-1",
            productName: "Wig cap",
            productSku: "CAP",
            productSkuId: "sku-1",
            quantity: 2,
            totalPrice: 20000,
            transactionId: "txn-current",
          },
          {
            _id: "item-older",
            productId: "product-2",
            productName: "Comb",
            productSku: "COMB",
            productSkuId: "sku-2",
            quantity: 1,
            totalPrice: 10000,
            transactionId: "txn-older",
          },
        ],
        store: [store],
      }),
      {
        operatingDate: "2026-06-21",
        storeId: "store-1" as Id<"store">,
        storePulseWindow: "all_time",
        weekEndOperatingDate: "2026-06-27",
      },
    );

    expect(snapshot.storePulse).toBeDefined();
    expect(snapshot.storePulse!).toMatchObject({
      totalItemsSold: 3,
      totalSales: 30000,
      totalTransactions: 2,
    });
    expect(snapshot.closeSummary).toMatchObject({
      paymentTotals: [
        {
          amount: 20000,
          method: "cash",
          transactionCount: 1,
        },
      ],
      salesTotal: 20000,
      transactionCount: 1,
    });
    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-06-21",
      ),
    ).toMatchObject({
      salesTotal: 20000,
      transactionCount: 1,
    });
  });

  it("keeps historical store pulse detail rows when newer transactions exceed the snapshot cap", async () => {
    const selectedCompletedAt = Date.parse("2026-04-15T15:00:00.000Z");
    const newerTransactions = Array.from({ length: 401 }, (_, index) => ({
      _id: `txn-newer-${index}`,
      changeGiven: 0,
      completedAt: Date.parse("2026-05-01T12:00:00.000Z") + index,
      paymentMethod: "cash",
      payments: [{ amount: 1000, method: "cash", timestamp: index }],
      status: "completed",
      storeId: "store-1",
      total: 1000,
      totalPaid: 1000,
      transactionNumber: `TXN-NEWER-${index}`,
    }));

    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyOpening: [
          {
            ...startedOpening,
            _id: "opening-historical",
            endAt: Date.parse("2026-04-16T04:00:00.000Z"),
            operatingDate: "2026-04-15",
            startAt: Date.parse("2026-04-15T04:00:00.000Z"),
          },
        ],
        posTransaction: [
          ...newerTransactions,
          {
            _id: "txn-selected",
            changeGiven: 0,
            completedAt: selectedCompletedAt,
            paymentMethod: "card",
            payments: [{ amount: 25000, method: "card", timestamp: 1 }],
            status: "completed",
            storeId: "store-1",
            total: 25000,
            totalPaid: 25000,
            transactionNumber: "TXN-SELECTED",
          },
        ],
        posTransactionItem: [
          {
            _id: "item-selected",
            productId: "product-1",
            productName: "Historical bundle",
            productSku: "HIST",
            productSkuId: "sku-1",
            quantity: 2,
            totalPrice: 25000,
            transactionId: "txn-selected",
          },
        ],
        store: [store],
      }),
      {
        endAt: Date.parse("2026-04-16T04:00:00.000Z"),
        operatingDate: "2026-04-15",
        startAt: Date.parse("2026-04-15T04:00:00.000Z"),
        storeId: "store-1" as Id<"store">,
        storePulseWindow: "today",
      },
    );

    expect(snapshot.storePulse).toMatchObject({
      totalItemsSold: 2,
      totalSales: 25000,
      totalTransactions: 1,
    });
    expect(snapshot.storePulse!.operatorSnapshot.paymentMix).toEqual([
      expect.objectContaining({
        method: "card",
        total: 25000,
      }),
    ]);
    expect(snapshot.storePulse!.operatorSnapshot.topItems).toEqual([
      expect.objectContaining({
        name: "Historical bundle",
        quantity: 2,
      }),
    ]);
    expect(snapshot.storePulse!.operatorSnapshot.trend.at(-1)).toMatchObject({
      date: "2026-04-15",
      totalItemsSold: 2,
      totalSales: 25000,
      transactionCount: 1,
    });
  });

  it("requires store membership before returning a daily operations snapshot", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "pos@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockRejectedValue(
      new Error("You cannot view daily operations for this store."),
    );

    await expect(
      getHandler(getDailyOperationsSnapshot)(
        buildCtx({ store: [store] }) as never,
        {
          operatingDate: "2026-06-21",
          storeId: "store-1" as Id<"store">,
          weekEndOperatingDate: "2026-06-27",
        },
      ),
    ).rejects.toThrow("You cannot view daily operations for this store.");
    expect(
      sharedDemoActor.requireSharedDemoStoreCapabilityIfApplicable,
    ).not.toHaveBeenCalled();
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).toHaveBeenCalledWith(expect.anything());
  });

  it("admits shared-demo actors through the daily operations read rail", async () => {
    vi.mocked(sharedDemoActor.getSharedDemoActorWithCtx).mockResolvedValue({
      kind: "shared_demo",
      authUserId: "auth-user-demo" as Id<"users">,
      athenaUserId: "demo-user-1" as Id<"athenaUser">,
      organizationId: "org-1" as Id<"organization">,
      storeId: "store-1" as Id<"store">,
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-demo" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "pos_only",
      userId: "demo-user-1" as Id<"athenaUser">,
    });

    const snapshot = await getHandler(getDailyOperationsSnapshot)(
      buildCtx({
        dailyOpening: [
          {
            ...startedOpening,
            _id: "opening-current",
            operatingDate: "2026-06-21",
          },
        ],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-06-21",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-06-27",
      },
    );

    expect(snapshot.operatingDate).toBe("2026-06-21");
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot view daily operations for this store.",
      organizationId: "org-1",
      userId: "demo-user-1",
    });
    expect(
      sharedDemoActor.requireSharedDemoStoreCapabilityIfApplicable,
    ).not.toHaveBeenCalled();
  });

  it("denies shared-demo store mismatches across daily operations read exports without falling back to normal auth", async () => {
    vi.mocked(sharedDemoActor.getSharedDemoActorWithCtx).mockResolvedValue({
      kind: "shared_demo",
      authUserId: "auth-user-demo" as Id<"users">,
      athenaUserId: "demo-user-1" as Id<"athenaUser">,
      organizationId: "org-1" as Id<"organization">,
      storeId: "demo-store" as Id<"store">,
    });
    const readQueries = [
      getDailyOperationsSnapshot,
      getDailyOperationsDetailSnapshot,
      getDailyOperationsWeekAnalyticsSnapshot,
      getDailyOperationsStorePulseSnapshot,
      getDailyOperationsStoreRequestsSnapshot,
      getDailyOperationsOpenRegisterSessionsSnapshot,
      getDailyOperationsAutomationSnapshot,
      getDailyOperationsTodayRefreshSnapshot,
      getDailyOperationsTimelineSnapshot,
      getDailyOperationsTimelinePreviewSnapshot,
    ];

    for (const readQuery of readQueries) {
      await expect(
        getHandler(readQuery)(buildCtx({ store: [store] }) as never, {
          operatingDate: "2026-06-21",
          refreshRequestedAt: Date.UTC(2026, 5, 21, 12),
          storeId: "store-1" as Id<"store">,
          weekEndOperatingDate: "2026-06-27",
        }),
      ).rejects.toThrow("This action isn't allowed in the demo.");
    }

    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).not.toHaveBeenCalled();
  });

  it("returns a redacted daily operations snapshot for POS-only store members", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "pos@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-pos" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "pos_only",
      userId: "user-1" as Id<"athenaUser">,
    });

    const snapshot = await getHandler(getDailyOperationsSnapshot)(
      buildCtx({
        dailyOpening: [
          {
            ...startedOpening,
            _id: "opening-current",
            operatingDate: "2026-06-21",
          },
        ],
        operationalEvent: [
          {
            _id: "event-register-opened",
            createdAt: Date.UTC(2026, 5, 21, 9),
            eventType: "register_session_opened",
            message: "Register session opened.",
            metadata: {
              openingFloat: 50000,
            },
            storeId: "store-1",
            subjectId: "register-1",
            subjectLabel: "Register 1",
            subjectType: "register_session",
          },
        ],
        posTransaction: [
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 5, 21, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 821500, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 821500,
            totalPaid: 821500,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-06-21",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-06-27",
      },
    );

    expect(snapshot.closeSummary).toMatchObject({
      paymentTotals: [],
      salesTotal: 0,
      transactionCount: 1,
    });
    expect(snapshot.priorDayMetric).toBeUndefined();
    expect(snapshot.storePulse).toBeUndefined();
    expect(snapshot.timeline).toEqual([]);
    expect(snapshot.timelineHasMore).toBe(false);
    expect(snapshot.weekMetrics).toEqual([]);
  });

  it("keeps the default public snapshot compact for high-cardinality store-day history", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });
    const events = Array.from({ length: 20 }, (_, index) => ({
      _id: `event-${index}`,
      createdAt: Date.UTC(2026, 4, 8, 8, index),
      eventType: "operations.event",
      message: `Event ${index}`,
      storeId: "store-1",
      subjectId: `subject-${index}`,
      subjectType: "operations",
    }));

    const snapshot = await getHandler(getDailyOperationsSnapshot)(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: events,
        scheduledRunLedger: [
          {
            _id: "run-applied",
            actorType: "system",
            candidateCount: 2,
            completedAt: Date.UTC(2026, 4, 8, 9),
            createdAt: Date.UTC(2026, 4, 8, 9),
            cronFamily: "complete-checkout-sessions",
            failedCount: 0,
            outcome: "applied",
            processedCount: 2,
            runKey: "scheduled-run:complete-checkout-sessions:store",
            sampleSubjectIds: [],
            scheduledWindowEndAt: Date.UTC(2026, 4, 8, 9, 30),
            scheduledWindowStartAt: Date.UTC(2026, 4, 8, 9),
            scope: "store",
            skippedCount: 0,
            snapshotCounts: {},
            sourceSubjectType: "checkout_session",
            storeId: "store-1",
            succeededCount: 2,
            updatedAt: Date.UTC(2026, 4, 8, 9),
            visibility: "store",
          },
        ],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(snapshot.lifecycle.status).toBe("ready_to_close");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Start EOD Review",
    });
    expect(snapshot.timeline).toEqual([]);
    expect(snapshot.timelineHasMore).toBe(false);
    expect(snapshot.scheduledRunSummaries).toEqual([
      expect.objectContaining({ id: "run-applied" }),
    ]);
    expect(snapshot.priorDayMetric).toBeUndefined();
    expect(snapshot.storePulse).toBeUndefined();
    expect(snapshot.weekMetrics).toEqual([]);
  });

  it("returns selected-day detail without rebuilding the surrounding week", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });
    const events = Array.from({ length: 20 }, (_, index) => ({
      _id: `event-${index}`,
      createdAt: Date.UTC(2026, 4, 8, 8, index),
      eventType: "operations.event",
      message: `Event ${index}`,
      storeId: "store-1",
      subjectId: `subject-${index}`,
      subjectType: "operations",
    }));

    const snapshot = await getHandler(getDailyOperationsDetailSnapshot)(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: events,
        posTransaction: [
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 8, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 821500, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 821500,
            totalPaid: 821500,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(snapshot.timeline).toEqual([]);
    expect(snapshot.timelineHasMore).toBe(false);
    expect(snapshot.scheduledRunSummaries).toEqual([]);
    expect(snapshot.storePulse).toBeUndefined();
    expect(snapshot.weekMetrics).toEqual([]);
    expect(snapshot.weekStorePulses).toBeUndefined();
    expect(snapshot).not.toHaveProperty("weekSnapshots");
    expect(snapshot.closeSummary).toMatchObject({
      salesTotal: 821500,
      transactionCount: 1,
    });
  });

  it("returns week analytics from a bounded contract without day snapshots", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        posTransaction: [
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 8, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 821500, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 821500,
            totalPaid: 821500,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(snapshot).toEqual({
      operatingDate: "2026-05-08",
      priorWeekBoundaryMetric: expect.objectContaining({
        operatingDate: "2026-05-02",
      }),
      weekEndOperatingDate: "2026-05-09",
      weekMetrics: expect.arrayContaining([
        expect.objectContaining({
          operatingDate: "2026-05-08",
          salesTotal: 821500,
          transactionCount: 1,
        }),
      ]),
    });
    expect(snapshot.weekMetrics).toHaveLength(7);
    expect(snapshot).not.toHaveProperty("weekSnapshots");
    expect(snapshot).not.toHaveProperty("timeline");
    expect(snapshot).not.toHaveProperty("storePulse");
  });

  it("returns selected-day store pulse detail from the explicit store pulse query", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });

    const snapshot = await getHandler(getDailyOperationsStorePulseSnapshot)(
      buildCtx({
        posTransaction: [
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 8, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 821500, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 821500,
            totalPaid: 821500,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        posTransactionItem: [
          {
            _id: "txn-item-current",
            productId: "product-1",
            productName: "Braiding Hair",
            productSku: "BRAID-1",
            productSkuId: "sku-1",
            quantity: 2,
            totalPrice: 821500,
            transactionId: "txn-current",
            unitPrice: 410750,
          },
        ],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot).toMatchObject({
      operatingDate: "2026-05-08",
      storePulse: {
        operatorSnapshot: {
          paymentMix: [
            expect.objectContaining({
              count: 1,
              label: "Cash",
              total: 821500,
            }),
          ],
          topItems: [
            expect.objectContaining({
              name: "Braiding Hair",
              quantity: 2,
              totalSales: 821500,
            }),
          ],
        },
      },
    });
  });

  it("returns a current-day refresh payload with selected day metric and store pulse detail", async () => {
    vi.setSystemTime(new Date("2026-05-08T18:30:00.000Z"));
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });

    const snapshot = await getHandler(getDailyOperationsTodayRefreshSnapshot)(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        posTransaction: [
          {
            _id: "txn-prior",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 7, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 20000, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 20000,
            totalPaid: 20000,
            transactionNumber: "TXN-PRIOR",
          },
          {
            _id: "txn-current",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 8, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 821500, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 821500,
            totalPaid: 821500,
            transactionNumber: "TXN-CURRENT",
          },
        ],
        posTransactionItem: [
          {
            _id: "txn-item-current",
            productId: "product-1",
            productName: "Braiding Hair",
            productSku: "BRAID-1",
            productSkuId: "sku-1",
            quantity: 2,
            totalPrice: 821500,
            transactionId: "txn-current",
            unitPrice: 410750,
          },
        ],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        refreshRequestedAt: 12345,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot).toMatchObject({
      closeSummary: {
        salesTotal: 821500,
        transactionCount: 1,
      },
      operatingDate: "2026-05-08",
      refreshedAt: Date.parse("2026-05-08T18:30:00.000Z"),
      refreshRequestedAt: 12345,
      storePulse: {
        operatorSnapshot: {
          paymentMix: [
            expect.objectContaining({
              method: "cash",
              total: 821500,
            }),
          ],
          topItems: [
            expect.objectContaining({
              name: "Braiding Hair",
              quantity: 2,
            }),
          ],
        },
      },
      weekMetric: expect.objectContaining({
        isSelected: true,
        operatingDate: "2026-05-08",
        salesTotal: 821500,
        transactionCount: 1,
      }),
    });
    expect(snapshot.priorDayMetric).toMatchObject({
      operatingDate: "2026-05-07",
      salesTotal: 20000,
      transactionCount: 1,
    });
    expect(snapshot).not.toHaveProperty("weekSnapshots");
    expect(snapshot).not.toHaveProperty("timeline");
  });

  it("returns full bounded timeline history from the explicit timeline query", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });
    const events = Array.from({ length: 8 }, (_, index) => ({
      _id: `timeline-event-${index}`,
      createdAt: Date.UTC(2026, 4, 8, 9, index),
      eventType: "operations.event",
      message: `Timeline event ${index}`,
      storeId: "store-1",
      subjectId: `subject-${index}`,
      subjectType: "operations",
    }));

    const snapshot = await getHandler(getDailyOperationsTimelineSnapshot)(
      buildCtx({
        dailyOpening: [startedOpening],
        operationalEvent: events,
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot).toEqual({
      operatingDate: "2026-05-08",
      timeline: expect.arrayContaining([
        expect.objectContaining({ id: "timeline-event-7" }),
        expect.objectContaining({ id: "timeline-event-0" }),
      ]),
    });
    expect(snapshot.timeline).toHaveLength(8);
    expect(snapshot).not.toHaveProperty("storePulse");
    expect(snapshot).not.toHaveProperty("weekMetrics");
  });

  it("returns the same first five events from the timeline preview query", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });
    const seed = {
      dailyOpening: [startedOpening],
      operationalEvent: Array.from({ length: 8 }, (_, index) => ({
        _id: `timeline-event-${index}`,
        createdAt: Date.UTC(2026, 4, 8, 9, index),
        eventType: "operations.event",
        message: `Timeline event ${index}`,
        storeId: "store-1",
        subjectId: `subject-${index}`,
        subjectType: "operations",
      })),
      store: [store],
    };
    const args = {
      operatingDate: "2026-05-08",
      storeId: "store-1" as Id<"store">,
    };

    const previewSnapshot = await getHandler(
      getDailyOperationsTimelinePreviewSnapshot,
    )(buildCtx(seed) as never, args);
    const fullSnapshot = await getHandler(getDailyOperationsTimelineSnapshot)(
      buildCtx(seed) as never,
      args,
    );

    expect(previewSnapshot).toEqual({
      operatingDate: "2026-05-08",
      timeline: fullSnapshot.timeline.slice(0, 5),
      timelineHasMore: true,
    });
  });

  it("buckets week sales by the local operating-day offset instead of UTC midnight", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyOpening: [startedOpening],
        posTransaction: [
          {
            _id: "txn-local-evening",
            changeGiven: 0,
            completedAt: Date.UTC(2026, 4, 11, 2),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [{ amount: 187899, method: "cash" }],
            status: "completed",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 187899,
            totalPaid: 187899,
            transactionNumber: "TXN-LOCAL-EVENING",
          },
        ],
        store: [store],
      }),
      {
        operatingDate: "2026-05-10",
        operatingTimezoneOffsetMinutes: 240,
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-16",
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-05-10",
      ),
    ).toMatchObject({
      salesTotal: 187899,
      transactionCount: 1,
    });
    expect(
      snapshot.weekMetrics.find(
        (metric) => metric.operatingDate === "2026-05-11",
      ),
    ).toMatchObject({
      salesTotal: 0,
      transactionCount: 0,
    });
  });

  it("keeps the store day operating while close review items remain", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        posTransaction: [
          {
            _id: "txn-void",
            completedAt: Date.UTC(2026, 4, 8, 16),
            paymentMethod: "cash",
            paymentAllocations: [],
            payments: [],
            status: "void",
            storeId: "store-1",
            terminalId: "terminal-1",
            total: 12000,
            totalPaid: 12000,
            transactionNumber: "TXN-VOID",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("operating");
    expect(snapshot.lanes.find((lane) => lane.key === "close")).toMatchObject({
      count: 0,
      status: "needs_attention",
    });
    expect(snapshot.attentionItems[0]).toMatchObject({
      owner: "daily_close",
      source: {
        id: "txn-void",
        type: "pos_transaction",
      },
    });
  });

  it("elevates close blockers while preserving source workflow ownership", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 18));

    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        registerSession: [
          {
            _id: "register-1",
            expectedCash: 25000,
            openedAt: Date.UTC(2026, 4, 8, 9),
            registerNumber: "1",
            status: "open",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("close_blocked");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Review close blockers",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    });
    expect(snapshot.attentionItems[0]).toMatchObject({
      owner: "daily_close",
      registerSession: {
        isOpenedForOperatingDate: true,
      },
      source: {
        type: "register_session",
        id: "register-1",
      },
      severity: "critical",
    });
    expect(
      snapshot.lanes.find((lane) => lane.key === "registers"),
    ).toMatchObject({
      count: 1,
      status: "blocked",
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
    });
  });

  it("surfaces review-only closeouts as close work instead of closed drawer health", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        approvalRequest: [
          {
            _id: "approval-submitted",
            createdAt: Date.UTC(2026, 4, 8, 19),
            metadata: {
              countedCash: 9200,
              expectedCash: 10000,
              variance: -800,
            },
            reason:
              "Register closeout variance requires manager review before synced closeout can be applied.",
            registerSessionId: "register-submitted",
            requestType: "variance_review",
            status: "pending",
            storeId: "store-1",
            subjectId: "register-submitted",
            subjectType: "register_session",
          },
        ],
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        registerSession: [
          {
            _id: "register-rejected",
            countedCash: 8500,
            expectedCash: 10000,
            openedAt: Date.UTC(2026, 4, 8, 9),
            openingFloat: 10000,
            registerNumber: "1",
            status: "closeout_rejected",
            storeId: "store-1",
            variance: -1500,
          },
          {
            _id: "register-submitted",
            countedCash: 9200,
            expectedCash: 10000,
            managerApprovalRequestId: "approval-submitted",
            openedAt: Date.UTC(2026, 4, 8, 10),
            openingFloat: 10000,
            registerNumber: "2",
            status: "closing",
            storeId: "store-1",
            variance: -800,
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("close_blocked");
    expect(snapshot.closeSummary).toMatchObject({
      registerVarianceCount: 0,
    });
    expect(snapshot.lanes.find((lane) => lane.key === "close")).toMatchObject({
      count: 3,
      status: "blocked",
    });
    expect(
      snapshot.lanes.find((lane) => lane.key === "registers"),
    ).toMatchObject({
      count: 2,
      status: "blocked",
    });
    expect(snapshot.attentionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "register_session:register-rejected:closeout_rejected",
          label: "Register closeout needs review",
          owner: "daily_close",
          source: {
            id: "register-rejected",
            label: "Register 1",
            type: "register_session",
          },
        }),
        expect.objectContaining({
          id: "register_session:register-submitted:variance_review",
          label: "Register closeout variance needs review",
          owner: "daily_close",
          source: {
            id: "register-submitted",
            label: "Register 2",
            type: "register_session",
          },
        }),
      ]),
    );
    expect(snapshot.attentionItems.map((item) => item.id)).not.toContain(
      "register_session:register-submitted:closing",
    );
  });

  it("surfaces open queue work and pending approvals without counting terminal work", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        approvalRequest: [
          {
            _id: "approval-pending",
            createdAt: Date.UTC(2026, 4, 8, 10),
            reason: "Cash variance review",
            requestType: "variance_review",
            status: "pending",
            storeId: "store-1",
            subjectId: "register-1",
            subjectType: "register_session",
          },
          {
            _id: "approval-approved",
            createdAt: Date.UTC(2026, 4, 8, 11),
            reason: "Resolved",
            requestType: "variance_review",
            status: "approved",
            storeId: "store-1",
            subjectId: "register-2",
            subjectType: "register_session",
          },
          {
            _id: "approval-other-day",
            createdAt: Date.UTC(2026, 4, 9, 10),
            reason: "Next day variance review",
            requestType: "variance_review",
            status: "pending",
            storeId: "store-1",
            subjectId: "register-next",
            subjectType: "register_session",
          },
        ],
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalWorkItem: [
          {
            _id: "work-open",
            approvalState: "not_required",
            createdAt: 1,
            organizationId: "org-1",
            priority: "normal",
            status: "open",
            storeId: "store-1",
            title: "Call customer",
            type: "customer_follow_up",
          },
          {
            _id: "work-progress",
            approvalState: "not_required",
            createdAt: 2,
            organizationId: "org-1",
            priority: "normal",
            status: "in_progress",
            storeId: "store-1",
            title: "Receive order",
            type: "purchase_order",
          },
          {
            _id: "work-completed",
            approvalState: "not_required",
            createdAt: 3,
            organizationId: "org-1",
            priority: "normal",
            status: "completed",
            storeId: "store-1",
            title: "Already done",
            type: "customer_follow_up",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lanes.find((lane) => lane.key === "queue")).toMatchObject({
      count: 2,
      countLabel: "2",
      status: "needs_attention",
    });
    expect(
      snapshot.lanes.find((lane) => lane.key === "approvals"),
    ).toMatchObject({
      count: 1,
      countLabel: "1",
      status: "blocked",
    });
    expect(snapshot.attentionItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "approval_request:approval-pending:pending",
        "operational_work_item:work-open:open",
        "operational_work_item:work-progress:in_progress",
      ]),
    );
    expect(snapshot.attentionItems.map((item) => item.id)).not.toContain(
      "operational_work_item:work-completed:completed",
    );
    expect(snapshot.attentionItems.map((item) => item.id)).not.toContain(
      "approval_request:approval-other-day:pending",
    );
    expect(
      snapshot.attentionItems.filter(
        (item) => item.owner === "operations_queue",
      ),
    ).toHaveLength(3);
  });

  it("counts and surfaces synced sale inventory reviews as SKU-scoped logical work", async () => {
    const syncedSaleReview = (args: {
      id: string;
      skuId?: string;
      status?: "open" | "in_progress";
      title: string;
    }) => ({
      _id: args.id,
      approvalState: "not_required",
      createdAt: 1,
      metadata: args.skuId
        ? {
            primaryProductSkuId: args.skuId,
            sourceId: `sale-${args.id}`,
            sourceType: "posTransaction",
          }
        : {
            sourceId: `sale-${args.id}`,
            sourceType: "posTransaction",
          },
      organizationId: "org-1",
      priority: "normal",
      status: args.status ?? "open",
      storeId: "store-1",
      title: args.title,
      type: "synced_sale_inventory_review",
    });
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalWorkItem: [
          syncedSaleReview({
            id: "review-sku-1-open",
            skuId: "sku-1",
            title: "Review first sale",
          }),
          syncedSaleReview({
            id: "review-sku-1-progress",
            skuId: "sku-1",
            status: "in_progress",
            title: "Review second sale",
          }),
          syncedSaleReview({
            id: "review-sku-2",
            skuId: "sku-2",
            title: "Review third sale",
          }),
          syncedSaleReview({
            id: "review-without-sku",
            title: "Review sale without SKU",
          }),
          {
            _id: "work-unrelated",
            approvalState: "not_required",
            createdAt: 2,
            organizationId: "org-1",
            priority: "normal",
            status: "open",
            storeId: "store-1",
            title: "Call customer",
            type: "customer_follow_up",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lanes.find((lane) => lane.key === "queue")).toMatchObject({
      count: 4,
      countLabel: "4",
      description: "4 open items.",
      status: "needs_attention",
    });
    const queueAttention = snapshot.attentionItems.filter(
      (item) => item.owner === "operations_queue",
    );
    expect(queueAttention).toHaveLength(4);
    expect(queueAttention.map((item) => item.to)).toEqual([
      "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
    ]);
    expect(queueAttention.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        "Review second sale",
        "Review third sale",
        "Review sale without SKU",
        "Call customer",
      ]),
    );
  });

  it("keeps later same-SKU sales separate from active frozen repair membership", async () => {
    const review = (id: string, transactionId: string) => ({
      _id: id,
      approvalState: "not_required",
      createdAt: 1,
      metadata: {
        localTransactionId: transactionId,
        primaryProductSkuId: "sku-1",
      },
      organizationId: "org-1",
      priority: "normal",
      productSkuId: "sku-1",
      status: "open",
      storeId: "store-1",
      title: `Review ${transactionId}`,
      type: "synced_sale_inventory_review",
    });
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalWorkItem: [
          review("review-frozen", "transaction-frozen"),
          review("review-later", "transaction-later"),
        ],
        oversizedOperationalWorkRepair: [
          {
            _id: "repair-1",
            groupKey: "synced_sale_inventory_review:store-1:sku-1",
            sourceIdentities: [
              "synced_sale_inventory_review:store-1:transaction-frozen",
            ],
            status: "running",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lanes.find((lane) => lane.key === "queue")).toMatchObject({
      count: 2,
      countLabel: "2",
    });
    expect(
      snapshot.attentionItems.filter(
        (item) => item.owner === "operations_queue",
      ),
    ).toHaveLength(2);
  });

  it("fails open-work counts closed when active repair membership is capped", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalWorkItem: [
          {
            _id: "review-1",
            approvalState: "not_required",
            createdAt: 1,
            metadata: { primaryProductSkuId: "sku-1" },
            organizationId: "org-1",
            priority: "normal",
            productSkuId: "sku-1",
            status: "open",
            storeId: "store-1",
            title: "Review inventory",
            type: "synced_sale_inventory_review",
          },
        ],
        oversizedOperationalWorkRepair: Array.from(
          { length: 201 },
          (_, index) => ({
            _id: `repair-${index}`,
            groupKey: `synced_sale_inventory_review:store-1:sku-${index}`,
            sourceIdentities: [`source-${index}`],
            status: "pending",
            storeId: "store-1",
          }),
        ),
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lanes.find((lane) => lane.key === "queue")).toMatchObject({
      countLabel: "1+",
    });
    expect(
      snapshot.attentionItems.filter(
        (item) => item.owner === "operations_queue",
      ),
    ).toEqual([
      expect.objectContaining({ label: "Open Work count is still updating" }),
    ]);
  });

  it("reports incomplete open work as an observed logical lower bound", async () => {
    const operationalWorkItem = Array.from({ length: 201 }, (_, index) => ({
      _id: `review-${index}`,
      approvalState: "not_required",
      createdAt: index,
      metadata: {
        primaryProductSkuId: "sku-1",
        sourceId: `sale-${index}`,
        sourceType: "posTransaction",
      },
      organizationId: "org-1",
      priority: "normal",
      status: "open",
      storeId: "store-1",
      title: `Review sale ${index}`,
      type: "synced_sale_inventory_review",
    }));
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalWorkItem,
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lanes.find((lane) => lane.key === "queue")).toMatchObject({
      count: 1,
      countLabel: "1+",
      description: "1+ open item.",
      status: "needs_attention",
    });
    expect(
      snapshot.attentionItems.filter(
        (item) => item.owner === "operations_queue",
      ),
    ).toEqual([
      expect.objectContaining({
        label: "Open Work count is still updating",
        message:
          "Open Work is still loading the complete inventory review set.",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      }),
    ]);
  });

  it("keeps an exact logical count when each status probe is complete", async () => {
    const operationalWorkItem = ["open", "in_progress"].flatMap((status) =>
      Array.from({ length: 101 }, (_, index) => ({
        _id: `${status}-${index}`,
        approvalState: "not_required",
        createdAt: index,
        organizationId: "org-1",
        priority: "normal",
        status,
        storeId: "store-1",
        title: `Work ${status} ${index}`,
        type: "customer_follow_up",
      })),
    );
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalWorkItem,
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lanes.find((lane) => lane.key === "queue")).toMatchObject({
      count: 202,
      countLabel: "202",
      description: "202 open items.",
    });
    expect(
      snapshot.attentionItems.filter(
        (item) => item.owner === "operations_queue",
      ),
    ).toHaveLength(200);
  });

  it("carries prior-day pending approvals into the current operating day", async () => {
    vi.setSystemTime(new Date("2026-05-08T12:00:00.000Z"));

    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        approvalRequest: [
          {
            _id: "approval-prior-day",
            createdAt: Date.UTC(2026, 4, 7, 20),
            reason: "Prior day variance review",
            requestType: "variance_review",
            status: "pending",
            storeId: "store-1",
            subjectId: "register-prior",
            subjectType: "register_session",
          },
          {
            _id: "approval-current-day",
            createdAt: Date.UTC(2026, 4, 8, 10),
            reason: "Current day variance review",
            requestType: "variance_review",
            status: "pending",
            storeId: "store-1",
            subjectId: "register-current",
            subjectType: "register_session",
          },
          {
            _id: "approval-future-day",
            createdAt: Date.UTC(2026, 4, 9, 10),
            reason: "Future day variance review",
            requestType: "variance_review",
            status: "pending",
            storeId: "store-1",
            subjectId: "register-future",
            subjectType: "register_session",
          },
        ],
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(
      snapshot.lanes.find((lane) => lane.key === "approvals"),
    ).toMatchObject({
      count: 2,
      countLabel: "2",
      status: "blocked",
    });
    expect(snapshot.attentionItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "approval_request:approval-prior-day:pending",
        "approval_request:approval-current-day:pending",
      ]),
    );
    expect(snapshot.attentionItems.map((item) => item.id)).not.toContain(
      "approval_request:approval-future-day:pending",
    );
  });

  it("returns pending approval requests through a separate store requests snapshot", async () => {
    vi.setSystemTime(new Date("2026-05-08T12:00:00.000Z"));
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });

    const snapshot = await getHandler(getDailyOperationsStoreRequestsSnapshot)(
      buildCtx({
        approvalRequest: [
          {
            _id: "approval-prior-day",
            createdAt: Date.UTC(2026, 4, 7, 20),
            reason: "Prior day variance review",
            requestType: "variance_review",
            status: "pending",
            storeId: "store-1",
            subjectId: "register-prior",
            subjectType: "register_session",
          },
          {
            _id: "approval-current-day",
            createdAt: Date.UTC(2026, 4, 8, 10),
            reason: "Current day variance review",
            requestType: "variance_review",
            status: "pending",
            storeId: "store-1",
            subjectId: "register-current",
            subjectType: "register_session",
          },
          {
            _id: "approval-approved",
            createdAt: Date.UTC(2026, 4, 8, 11),
            reason: "Resolved",
            requestType: "variance_review",
            status: "approved",
            storeId: "store-1",
            subjectId: "register-resolved",
            subjectType: "register_session",
          },
        ],
        operationalWorkItem: [
          {
            _id: "work-open",
            approvalState: "not_required",
            createdAt: 1,
            organizationId: "org-1",
            priority: "normal",
            status: "open",
            storeId: "store-1",
            title: "Call customer",
            type: "customer_follow_up",
          },
        ],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot).toEqual({
      approvalsLane: {
        count: 2,
        countLabel: "2",
        description: "2 approvals pending.",
        key: "approvals",
        label: "Approvals",
        status: "blocked",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      operatingDate: "2026-05-08",
    });
  });

  it("keeps a completed store day reviewable and scopes timeline events to the day", async () => {
    const completedClose = {
      ...priorClose,
      _id: "close-current",
      completedAt: Date.UTC(2026, 4, 8, 22),
      isCurrent: true,
      operatingDate: "2026-05-08",
    };

    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose, completedClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-1",
            createdAt: Date.UTC(2026, 4, 8, 8),
            eventType: "daily_opening.started",
            message: "Store day started.",
            storeId: "store-1",
            subjectId: "opening-1",
            subjectType: "daily_opening",
          },
          {
            _id: "event-2",
            createdAt: Date.UTC(2026, 4, 8, 22),
            eventType: "daily_close.completed",
            message: "EOD Review completed.",
            storeId: "store-1",
            subjectId: "close-current",
            subjectType: "daily_close",
          },
          {
            _id: "event-quick-add",
            createdAt: Date.UTC(2026, 4, 8, 12),
            eventType: "pos_quick_add_product_created",
            message: "Kwamina Nuh quick added Vitamilk with quantity 100.",
            metadata: {
              productId: "product-1",
              productName: "Vitamilk",
              productSkuId: "sku-1",
              sku: "VITAMILK-001",
            },
            storeId: "store-1",
            subjectId: "sku-1",
            subjectLabel: "Vitamilk",
            subjectType: "product_sku",
          },
          {
            _id: "event-pending-checkout-item",
            createdAt: Date.UTC(2026, 4, 8, 13),
            eventType: "pos_pending_checkout_item_created",
            message:
              "Ama Mensah added pending checkout item Loose wave bundle. Quantity entered: 2.",
            metadata: {
              provisionalProductId: "product-pending",
              provisionalProductSkuId: "sku-pending",
            },
            storeId: "store-1",
            subjectId: "pending-item-1",
            subjectLabel: "Loose wave bundle",
            subjectType: "pos_pending_checkout_item",
          },
          {
            _id: "event-online-order-created",
            createdAt: Date.UTC(2026, 4, 8, 14),
            eventType: "online_order_created",
            message: "Online order #273912 created.",
            onlineOrderId: "online-order-273912",
            storeId: "store-1",
            subjectId: "online-order-273912",
            subjectLabel: "273912",
            subjectType: "online_order",
          },
          {
            _id: "event-pos-sale-synced",
            createdAt: Date.UTC(2026, 4, 8, 18),
            eventType: "pos_local_sync.sale_projected",
            message:
              "Offline POS sale #946956 synced: 3 sale lines, GH₵1,039, cash.",
            metadata: {
              receiptNumber: "946956",
              transactionNumber: "946956",
            },
            storeId: "store-1",
            subjectId: "txn-946956",
            subjectType: "posTransaction",
          },
          {
            _id: "event-pos-recovery-code-updated",
            createdAt: Date.UTC(2026, 4, 8, 19),
            eventType: "pos_recovery_code_login_succeeded",
            message: "POS recovery-code credential updated.",
            metadata: {
              reason: "verified",
              status: "active",
            },
            storeId: "store-1",
            subjectId: "pos-recovery-credential-1",
            subjectType: "posRecoveryCredential",
          },
          {
            _id: "event-pending-checkout-item-reused",
            createdAt: Date.UTC(2026, 4, 8, 17),
            eventType: "pos_pending_checkout_item_reused",
            message:
              "Ama Mensah reused pending checkout item Loose wave bundle. Quantity entered: 2.",
            metadata: {
              posTransactionId: "txn-946956",
              provisionalProductId: "product-pending",
              provisionalProductSkuId: "sku-pending",
              transactionCount: 1,
            },
            storeId: "store-1",
            subjectId: "pending-item-1",
            subjectLabel: "Loose wave bundle",
            subjectType: "pos_pending_checkout_item",
          },
          {
            _id: "event-register-opened",
            actorStaffProfileId: "staff-pos",
            createdAt: Date.UTC(2026, 4, 8, 16),
            eventType: "pos_local_sync.register_opened_projected",
            message: "Offline POS register opened.",
            storeId: "store-1",
            subjectId: "register-session-80",
            subjectType: "registerSession",
          },
          {
            _id: "event-other-day",
            createdAt: Date.UTC(2026, 4, 9, 8),
            eventType: "daily_opening.started",
            message: "Next day started.",
            storeId: "store-1",
            subjectId: "opening-next",
            subjectType: "daily_opening",
          },
        ],
        productSku: [
          {
            _id: "sku-pending",
            productId: "product-pending",
            productName: "Loose wave bundle",
            sku: "ZZZZ-1-1",
            storeId: "store-1",
          },
        ],
        onlineOrder: [
          {
            _id: "online-order-273912",
            orderNumber: "273912",
            storeId: "store-1",
          },
        ],
        registerSession: [
          {
            _id: "register-session-80",
            expectedCash: 0,
            openedAt: Date.UTC(2026, 4, 8, 16),
            openingFloat: 50_000,
            registerNumber: "80",
            status: "closed",
            storeId: "store-1",
          },
        ],
        staffProfile: [
          {
            _id: "staff-pos",
            fullName: "P OS",
            organizationId: "org-1",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("closed");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Review EOD Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    });
    expect(snapshot.timeline.map((event) => event.id)).toEqual([
      "event-2",
      "event-pos-sale-synced",
      "event-register-opened",
      "event-online-order-created",
      "event-pending-checkout-item",
      "event-quick-add",
      "event-1",
    ]);
    expect(snapshot.timeline.map((event) => event.id)).not.toContain(
      "event-pending-checkout-item-reused",
    );
    expect(snapshot.timeline.map((event) => event.id)).not.toContain(
      "event-pos-recovery-code-updated",
    );
    expect(
      snapshot.timeline.find((event) => event.id === "event-pos-sale-synced")
        ?.message,
    ).toBe("Sale #946956 synced: 3 sale lines, GH₵1,039, cash.");
    expect(
      snapshot.timeline.find((event) => event.id === "event-pos-sale-synced")
        ?.transactionLink,
    ).toEqual({
      label: "#946956",
      params: {
        transactionId: "txn-946956",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
    });
    expect(
      snapshot.timeline.find(
        (event) => event.id === "event-online-order-created",
      )?.onlineOrderLink,
    ).toEqual({
      label: "#273912",
      matchLabel: "273912",
      params: {
        orderSlug: "online-order-273912",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug",
    });
    expect(
      snapshot.timeline.find((event) => event.id === "event-register-opened")
        ?.message,
    ).toBe("Register 80 opened by P OS with opening float GH₵500.");
    expect(
      snapshot.timeline.find((event) => event.id === "event-register-opened")
        ?.registerLink,
    ).toEqual({
      label: "Register 80",
      params: {
        sessionId: "register-session-80",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
    });
    expect(
      snapshot.timeline.find((event) => event.id === "event-quick-add")
        ?.productLink,
    ).toEqual({
      label: "Vitamilk",
      params: {
        productSlug: "product-1",
      },
      search: {
        variant: "VITAMILK-001",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
    });
    expect(
      snapshot.timeline.find(
        (event) => event.id === "event-pending-checkout-item",
      )?.productLink,
    ).toEqual({
      label: "Loose wave bundle",
      params: {
        productSlug: "product-pending",
      },
      search: {
        variant: "ZZZZ-1-1",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
    });
    expect(snapshot.attentionItems).toEqual([]);
  });

  it("surfaces register closeout records when no operational event was recorded", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        registerSession: [
          {
            _id: "register-2",
            closeoutRecords: [
              {
                actorStaffProfileId: "staff-1",
                countedCash: 450,
                expectedCash: 450,
                occurredAt: Date.UTC(2026, 4, 8, 20, 45),
                type: "closed",
                variance: 0,
              },
            ],
            expectedCash: 450,
            openedAt: Date.UTC(2026, 4, 8, 8),
            openingFloat: 100,
            organizationId: "org-1",
            registerNumber: "Register 2",
            status: "closed",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "register_closeout:register-2:closed:1778273100000",
      message: "Register 2 closeout recorded with an exact cash match.",
      registerLink: {
        label: "Register 2",
        params: {
          sessionId: "register-2",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      subject: {
        id: "register-2",
        label: "Register 2",
        type: "register_session",
      },
      type: "register_session_closed",
    });
  });

  it("selects the most recent compact timeline events after merging fallback sources", async () => {
    const operationalEvents = Array.from({ length: 6 }, (_, index) => ({
      _id: `older-event-${index}`,
      createdAt: Date.UTC(2026, 4, 8, 10, index),
      eventType: "operations.event",
      message: `Older event ${index}`,
      storeId: "store-1",
      subjectId: `subject-${index}`,
      subjectType: "operations",
    }));
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: operationalEvents,
        registerSession: [
          {
            _id: "register-latest",
            closeoutRecords: [
              {
                actorStaffProfileId: "staff-1",
                countedCash: 450,
                expectedCash: 450,
                occurredAt: Date.UTC(2026, 4, 8, 20, 45),
                type: "closed",
                variance: 0,
              },
            ],
            expectedCash: 450,
            openedAt: Date.UTC(2026, 4, 8, 8),
            openingFloat: 100,
            organizationId: "org-1",
            registerNumber: "Register 9",
            status: "closed",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        timelineLimit: 5,
        timelinePreviewLimit: 5,
      },
    );

    expect(snapshot.timeline).toHaveLength(5);
    expect(snapshot.timeline[0]).toMatchObject({
      id: "register_closeout:register-latest:closed:1778273100000",
      message: "Register 9 closeout recorded with an exact cash match.",
    });
    expect(snapshot.timeline.map((event) => event.id)).not.toContain(
      "older-event-0",
    );
  });

  it("matches the compact timeline preview to the full timeline first rows", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-admin" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });
    const seed = {
      dailyClose: [priorClose],
      dailyOpening: [startedOpening],
      operationalEvent: Array.from({ length: 8 }, (_, index) => ({
        _id: `timeline-event-${index}`,
        createdAt: Date.UTC(2026, 4, 8, 10, index),
        eventType: "operations.event",
        message: `Timeline event ${index}`,
        storeId: "store-1",
        subjectId: `subject-${index}`,
        subjectType: "operations",
      })),
      registerSession: [
        {
          _id: "register-latest",
          closeoutRecords: [
            {
              actorStaffProfileId: "staff-1",
              countedCash: 450,
              expectedCash: 450,
              occurredAt: Date.UTC(2026, 4, 8, 20, 45),
              type: "closed",
              variance: 0,
            },
          ],
          expectedCash: 450,
          openedAt: Date.UTC(2026, 4, 8, 8),
          openingFloat: 100,
          organizationId: "org-1",
          registerNumber: "Register 9",
          status: "closed",
          storeId: "store-1",
        },
      ],
      store: [store],
    };
    const args = {
      operatingDate: "2026-05-08",
      storeId: "store-1" as Id<"store">,
    };
    const compactSnapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx(seed),
      {
        ...args,
        timelineLimit: 5,
        timelinePreviewLimit: 5,
      },
    );
    const fullTimelineSnapshot = await getHandler(
      getDailyOperationsTimelineSnapshot,
    )(buildCtx(seed) as never, args);

    expect(compactSnapshot.timeline.map((event) => event.id)).toEqual(
      fullTimelineSnapshot.timeline
        .slice(0, 5)
        .map(
          (event: (typeof fullTimelineSnapshot.timeline)[number]) => event.id,
        ),
    );
  });

  it("formats fallback register closeout variance records for the timeline", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        registerSession: [
          {
            _id: "register-1",
            closeoutRecords: [
              {
                actorStaffProfileId: "staff-1",
                countedCash: 124_500,
                expectedCash: 144_000,
                occurredAt: Date.UTC(2026, 4, 8, 20, 45),
                type: "closed",
                variance: -19_500,
              },
            ],
            expectedCash: 144_000,
            openedAt: Date.UTC(2026, 4, 8, 8),
            openingFloat: 100,
            organizationId: "org-1",
            registerNumber: "1",
            status: "closed",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "register_closeout:register-1:closed:1778273100000",
      message: "Register 1 closeout recorded with a cash variance of GH₵-195.",
      type: "register_session_closed",
    });
  });

  it("labels and links generic register session close operational events", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-register-session-closed",
            createdAt: Date.UTC(2026, 4, 8, 20, 45),
            eventType: "register_session_closed",
            message: "Register session closed with an exact cash match.",
            metadata: {
              countedCash: 450,
              expectedCash: 450,
              variance: 0,
            },
            storeId: "store-1",
            subjectId: "register-session-80",
            subjectLabel: "80",
            subjectType: "register_session",
          },
        ],
        registerSession: [
          {
            _id: "register-session-80",
            expectedCash: 450,
            openedAt: Date.UTC(2026, 4, 8, 8),
            registerNumber: "80",
            status: "closed",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-register-session-closed",
      message: "Register 80 closed with an exact cash match.",
      registerLink: {
        label: "Register 80",
        params: {
          sessionId: "register-session-80",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      subject: {
        id: "register-session-80",
        label: "Register 80",
        type: "register_session",
      },
      type: "register_session_closed",
    });
  });

  it("formats raw generic register session close variance amounts", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-register-session-closed-variance",
            createdAt: Date.UTC(2026, 4, 8, 20, 45),
            eventType: "register_session_closed",
            message: "Register session closed with a variance of 8000.",
            metadata: {
              countedCash: 85500,
              expectedCash: 77500,
              variance: 8000,
            },
            storeId: "store-1",
            subjectId: "register-session-1",
            subjectLabel: "1",
            subjectType: "register_session",
          },
        ],
        posTerminal: [
          {
            _id: "terminal-1",
            displayName: "M Supplies",
            storeId: "store-1",
          },
        ],
        registerSession: [
          {
            _id: "register-session-1",
            expectedCash: 77500,
            openedAt: Date.UTC(2026, 4, 8, 8),
            registerNumber: "1",
            status: "closed",
            storeId: "store-1",
            terminalId: "terminal-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-register-session-closed-variance",
      message: "M Supplies / Register 1 closed with a variance of GH₵80.",
      type: "register_session_closed",
    });
  });

  it("normalizes raw closeout variance approval events for the timeline", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-variance-review-requested",
            createdAt: Date.UTC(2026, 4, 8, 20, 45),
            eventType: "register_session_variance_review_requested",
            message:
              "Variance of -19500 exceeded the closeout approval threshold.",
            metadata: {
              countedCash: 124_500,
              expectedCash: 144_000,
              variance: -19_500,
            },
            registerSessionId: "register-1",
            storeId: "store-1",
            subjectId: "register-1",
            subjectLabel: "1",
            subjectType: "register_session",
          },
        ],
        registerSession: [
          {
            _id: "register-1",
            expectedCash: 144_000,
            openedAt: Date.UTC(2026, 4, 8, 8),
            registerNumber: "1",
            status: "closing",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-variance-review-requested",
      message: "Register 1 closeout recorded with a cash variance of GH₵-195.",
      registerLink: {
        label: "Register 1",
        params: {
          sessionId: "register-1",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      type: "register_session_variance_review_requested",
    });
  });

  it("normalizes synced closeout review requests with terminal register labels", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-sync-closeout-review-requested",
            actorStaffProfileId: "staff-1",
            createdAt: Date.UTC(2026, 4, 8, 20, 45),
            eventType: "register_session_sync_closeout_review_requested",
            message:
              "Register 8 closeout submitted with a cash variance of GH₵-10. Review before applying it.",
            metadata: {
              countedCash: 71_000,
              expectedCash: 72_000,
              registerNumber: "8",
              variance: -1_000,
            },
            registerSessionId: "register-8",
            storeId: "store-1",
            subjectId: "register-8",
            subjectLabel: "Register 8",
            subjectType: "register_session",
          },
        ],
        posTerminal: [
          {
            _id: "terminal-codex",
            displayName: "Codex",
            storeId: "store-1",
          },
        ],
        registerSession: [
          {
            _id: "register-8",
            expectedCash: 72_000,
            openedAt: Date.UTC(2026, 4, 8, 8),
            registerNumber: "8",
            status: "closing",
            storeId: "store-1",
            terminalId: "terminal-codex",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-sync-closeout-review-requested",
      message:
        "Codex / Register 8 closeout submitted with a cash variance of GH₵-10. Review before applying it.",
      registerLink: {
        label: "Codex / Register 8",
        params: {
          sessionId: "register-8",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      type: "register_session_sync_closeout_review_requested",
    });
  });

  it("normalizes synced closeout recorded events with terminal register labels", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-sync-closeout-recorded",
            actorStaffProfileId: "staff-1",
            createdAt: Date.UTC(2026, 4, 8, 20, 45),
            eventType: "register_session_closed",
            message:
              "Register 8 closeout recorded with a cash variance of GH₵-270.",
            metadata: {
              countedCash: 45_000,
              expectedCash: 72_000,
              registerNumber: "8",
              variance: -27_000,
            },
            registerSessionId: "register-8",
            storeId: "store-1",
            subjectId: "register-8",
            subjectLabel: "Register 8",
            subjectType: "register_session",
          },
        ],
        posTerminal: [
          {
            _id: "terminal-codex",
            displayName: "Codex",
            storeId: "store-1",
          },
        ],
        registerSession: [
          {
            _id: "register-8",
            expectedCash: 72_000,
            openedAt: Date.UTC(2026, 4, 8, 8),
            registerNumber: "8",
            status: "closed",
            storeId: "store-1",
            terminalId: "terminal-codex",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-sync-closeout-recorded",
      message:
        "Codex / Register 8 closeout recorded with a cash variance of GH₵-270.",
      registerLink: {
        label: "Codex / Register 8",
        params: {
          sessionId: "register-8",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      type: "register_session_closed",
    });
  });

  it("normalizes manager approval audit events for the store-day timeline", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-manager-approval-granted",
            actorStaffProfileId: "manager-1",
            createdAt: Date.UTC(2026, 4, 8, 15, 4),
            eventType: "approval.manager_granted",
            message: "approval.manager_granted on 8",
            metadata: {
              actionKey: "cash.register.opening_float.correct",
            },
            storeId: "store-1",
            subjectId: "register-session-8",
            subjectLabel: "8",
            subjectType: "register_session",
          },
          {
            _id: "event-manager-approval-applied",
            actorStaffProfileId: "manager-1",
            createdAt: Date.UTC(2026, 4, 8, 15, 5),
            eventType: "approval.proof_consumed",
            message: "approval.proof_consumed on 8",
            metadata: {
              actionKey: "cash.register.opening_float.correct",
            },
            storeId: "store-1",
            subjectId: "register-session-8",
            subjectLabel: "8",
            subjectType: "register_session",
          },
        ],
        staffProfile: [
          {
            _id: "manager-1",
            fullName: "Mina Q.",
            organizationId: "org-1",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline.map((event) => event.id)).toEqual([
      "event-manager-approval-applied",
      "event-manager-approval-granted",
    ]);
    expect(snapshot.timeline[0]).toMatchObject({
      message: "Manager approval applied for Register 8.",
      subject: {
        id: "register-session-8",
        label: "Register 8",
        type: "register_session",
      },
      type: "approval.proof_consumed",
    });
    expect(snapshot.timeline[1]).toMatchObject({
      message: "Manager approval granted by Mina Q. for Register 8.",
      subject: {
        id: "register-session-8",
        label: "Register 8",
        type: "register_session",
      },
      type: "approval.manager_granted",
    });
  });

  it("includes the actor on register opening float correction timeline events", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-opening-float-corrected",
            actorStaffProfileId: "manager-1",
            createdAt: Date.UTC(2026, 4, 8, 15, 6),
            eventType: "register_session_opening_float_corrected",
            message: "Register session opening float corrected.",
            metadata: {
              correctedOpeningFloat: 500,
              previousOpeningFloat: 300,
            },
            storeId: "store-1",
            subjectId: "register-session-8",
            subjectLabel: "8",
            subjectType: "register_session",
          },
        ],
        staffProfile: [
          {
            _id: "manager-1",
            fullName: "Mina Q.",
            organizationId: "org-1",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-opening-float-corrected",
      message: "Register 8 opening float corrected by Mina Q.",
      subject: {
        id: "register-session-8",
        label: "Register 8",
        type: "register_session",
      },
      type: "register_session_opening_float_corrected",
    });
  });

  it("links void approval requests to the transaction and includes the requester", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-void-requested",
            actorStaffProfileId: "cashier-1",
            createdAt: Date.UTC(2026, 4, 8, 15, 7),
            eventType: "pos_transaction_void_approval_requested",
            message: "Void requested for Transaction #851031.",
            metadata: {
              transactionNumber: "851031",
            },
            storeId: "store-1",
            subjectId: "transaction-851031",
            subjectLabel: "Transaction #851031",
            subjectType: "pos_transaction",
          },
        ],
        staffProfile: [
          {
            _id: "cashier-1",
            fullName: "Joyce O.",
            organizationId: "org-1",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-void-requested",
      message: "Void requested by Joyce O. for Transaction #851031.",
      subject: {
        id: "transaction-851031",
        label: "Transaction #851031",
        type: "pos_transaction",
      },
      transactionLink: {
        label: "#851031",
        params: {
          transactionId: "transaction-851031",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      },
      type: "pos_transaction_void_approval_requested",
    });
  });

  it("links applied item adjustment events to the adjusted transaction without requiring stored transaction metadata", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-item-adjustment-applied",
            createdAt: Date.UTC(2026, 4, 8, 15, 8),
            eventType: "pos_transaction_item_adjustment_applied",
            message: "Applied item adjustment for Transaction #856721.",
            metadata: {
              adjustmentId: "adjustment-1",
            },
            storeId: "store-1",
            subjectId: "transaction-856721",
            subjectLabel: "Transaction #856721",
            subjectType: "pos_transaction",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-item-adjustment-applied",
      message: "Applied item adjustment for Transaction #856721.",
      transactionLink: {
        label: "#856721",
        params: {
          transactionId: "transaction-856721",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      },
      type: "pos_transaction_item_adjustment_applied",
    });
  });

  it("links pending checkout evidence corrections to the approved product after linking", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-pending-checkout-evidence-corrected",
            createdAt: Date.UTC(2026, 4, 8, 15, 9),
            eventType: "pos_pending_checkout_item_evidence_corrected",
            message: "Adjusted pending checkout item hodor evidence by -2.",
            metadata: {
              pendingCheckoutItemId: "pending-hodor",
              quantityDelta: -2,
              reason: "item_adjustment",
            },
            storeId: "store-1",
            subjectId: "pending-hodor",
            subjectLabel: "hodor evidence",
            subjectType: "pos_pending_checkout_item",
          },
        ],
        posPendingCheckoutItem: [
          {
            _id: "pending-hodor",
            evidence: {
              firstSeenAt: 1,
              lastSeenAt: 1,
              observedLookupCodes: ["HODOR"],
              observedPrices: [260],
              totalQuantitySold: 1,
              transactionCount: 1,
            },
            lookupCode: "HODOR",
            name: "hodor evidence",
            organizationId: "org-1",
            provisionalPrice: 260,
            provisionalProductId: "product-hodor",
            provisionalProductSkuId: "sku-hodor",
            approvedProductId: "product-hodor-trusted",
            approvedProductSkuId: "sku-hodor-trusted",
            reviewPriority: "normal",
            status: "linked_to_catalog",
            storeId: "store-1",
          },
        ],
        productSku: [
          {
            _id: "sku-hodor",
            productId: "product-hodor",
            productName: "hodor evidence",
            sku: "HODOR",
            storeId: "store-1",
          },
          {
            _id: "sku-hodor-trusted",
            productId: "product-hodor-trusted",
            productName: "Hodor Trusted",
            sku: "HODOR-TRUSTED",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-pending-checkout-evidence-corrected",
      message: "Adjusted pending checkout item hodor evidence by -2.",
      productLink: {
        label: "hodor evidence",
        params: {
          productSlug: "product-hodor-trusted",
        },
        search: {
          variant: "HODOR-TRUSTED",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
      },
      type: "pos_pending_checkout_item_evidence_corrected",
    });
  });

  it("links pending checkout review events to the provisional product after linking", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-pending-checkout-reviewed",
            createdAt: Date.UTC(2026, 4, 8, 15, 9),
            eventType: "pos_pending_checkout_item_reviewed",
            message:
              "Pending checkout item got 2b gel was marked linked to catalog.",
            metadata: {
              pendingCheckoutItemId: "pending-got2b",
            },
            storeId: "store-1",
            subjectId: "pending-got2b",
            subjectLabel: "got 2b gel",
            subjectType: "pos_pending_checkout_item",
          },
        ],
        posPendingCheckoutItem: [
          {
            _id: "pending-got2b",
            evidence: {
              firstSeenAt: 1,
              lastSeenAt: 1,
              observedLookupCodes: ["GOT2B"],
              observedPrices: [12000],
              totalQuantitySold: 1,
              transactionCount: 1,
            },
            lookupCode: "GOT2B",
            name: "got 2b gel",
            organizationId: "org-1",
            provisionalPrice: 12000,
            provisionalProductId: "product-got2b-pending",
            provisionalProductSkuId: "sku-got2b-pending",
            approvedProductId: "product-got2b-trusted",
            approvedProductSkuId: "sku-got2b-trusted",
            reviewPriority: "normal",
            status: "linked_to_catalog",
            storeId: "store-1",
          },
        ],
        productSku: [
          {
            _id: "sku-got2b-pending",
            productId: "product-got2b-pending",
            productName: "got 2b gel",
            sku: "GOT2B-PENDING",
            storeId: "store-1",
          },
          {
            _id: "sku-got2b-trusted",
            productId: "product-got2b-trusted",
            productName: "Got2b Gel Trusted",
            sku: "GOT2B-TRUSTED",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      approvedProductLink: {
        label: "Got2b Gel Trusted",
        params: {
          productSlug: "product-got2b-trusted",
        },
        search: {
          variant: "GOT2B-TRUSTED",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
      },
      id: "event-pending-checkout-reviewed",
      productLink: {
        label: "got 2b gel",
        params: {
          productSlug: "product-got2b-pending",
        },
        search: {
          variant: "GOT2B-PENDING",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
      },
      type: "pos_pending_checkout_item_reviewed",
    });
  });

  it("surfaces pending synced register count submissions for the operating day", async () => {
    const ctx = buildCtx(buildPendingRegisterCountSeed());
    const snapshot = await buildDailyOperationsSnapshotWithCtx(ctx, {
      operatingDate: "2026-05-08",
      storeId: "store-1" as Id<"store">,
    });

    expect(snapshot.timeline[0]).toMatchObject({
      id: "pos_local_sync_register_count:sync-register-count",
      message:
        "P OS submitted Register 1 count of GH₵2,325. Variance GH₵420 needs manager review.",
      registerLink: {
        label: "Register 1",
        params: {
          sessionId: "register-1",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      subject: {
        id: "register-1",
        label: "Register 1",
        type: "register_session",
      },
      type: "register_session_count_submitted",
    });
  });

  it("omits pending synced register count submissions without manager evidence access", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx(buildPendingRegisterCountSeed()),
      {
        includeManagerReviewEvidence: false,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.timeline.map((event) => event.id)).not.toContain(
      "pos_local_sync_register_count:sync-register-count",
    );
  });

  it("renders legacy register session timeline events with non-ID subjects", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-legacy-register-opened",
            createdAt: Date.UTC(2026, 4, 8, 9),
            eventType: "pos_local_sync.register_opened_projected",
            message: "POS register opened.",
            metadata: {
              openingFloat: 50_000,
            },
            storeId: "store-1",
            subjectId: "8",
            subjectLabel: "8",
            subjectType: "register_session",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-legacy-register-opened",
      message: "Register 8 opened with opening float GH₵500.",
      registerLink: undefined,
      subject: {
        id: "8",
        label: "Register 8",
        type: "register_session",
      },
    });
  });

  it("links projected register closeout operational events without duplicating the fallback closeout row", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-register-closeout",
            createdAt: Date.UTC(2026, 4, 8, 20, 45),
            eventType: "register_session_closed",
            message: "Register 2 closeout recorded with an exact cash match.",
            metadata: {
              countedCash: 450,
              expectedCash: 450,
              registerNumber: "2",
              syncOrigin: "local_sync",
              variance: 0,
            },
            storeId: "store-1",
            subjectId: "register-2",
            subjectType: "register_session",
          },
        ],
        registerSession: [
          {
            _id: "register-2",
            closeoutRecords: [
              {
                actorStaffProfileId: "staff-1",
                countedCash: 450,
                expectedCash: 450,
                occurredAt: Date.UTC(2026, 4, 8, 20, 45),
                type: "closed",
                variance: 0,
              },
            ],
            expectedCash: 450,
            openedAt: Date.UTC(2026, 4, 8, 8),
            openingFloat: 100,
            organizationId: "org-1",
            registerNumber: "Register 2",
            status: "closed",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(
      snapshot.timeline.filter(
        (event) => event.type === "register_session_closed",
      ),
    ).toHaveLength(1);
    expect(snapshot.timeline[0]).toMatchObject({
      id: "event-register-closeout",
      registerLink: {
        label: "Register 2",
        params: {
          sessionId: "register-2",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      subject: {
        id: "register-2",
        label: "Register 2",
        type: "register_session",
      },
      type: "register_session_closed",
    });
  });

  it("returns the newest timeline events before applying the timeline limit", async () => {
    const events = Array.from({ length: 201 }, (_, index) => ({
      _id: `event-${index}`,
      createdAt: Date.UTC(2026, 4, 8, 8, index),
      eventType: "operations.event",
      message: `Event ${index}`,
      storeId: "store-1",
      subjectId: `subject-${index}`,
      subjectType: "operations",
    }));

    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: events,
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline).toHaveLength(200);
    expect(snapshot.timeline[0].id).toBe("event-200");
    expect(snapshot.timeline.map((event) => event.id)).not.toContain("event-0");
  });

  it("orders same-minute timeline events by exact recency", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        dailyOpening: [startedOpening],
        operationalEvent: [
          {
            _id: "event-draft-started",
            createdAt: Date.UTC(2026, 4, 8, 20, 41, 50),
            eventType: "cycle_count_draft_created",
            message: "Operator started a cycle count for POS quick add.",
            storeId: "store-1",
            subjectId: "draft-next",
            subjectType: "cycle_count_draft",
          },
          {
            _id: "event-draft-submitted",
            createdAt: Date.UTC(2026, 4, 8, 20, 41, 40),
            eventType: "cycle_count_draft_submitted",
            message:
              "Operator submitted the POS quick add cycle count with 1 changed SKU.",
            storeId: "store-1",
            subjectId: "draft-1",
            subjectType: "cycle_count_draft",
          },
          {
            _id: "event-adjustment-applied",
            createdAt: Date.UTC(2026, 4, 8, 20, 41, 30),
            eventType: "stock_adjustment_applied",
            message:
              "Operator applied a cycle count for 1 SKU. Net inventory change +171 units.",
            metadata: {
              adjustmentType: "cycle_count",
            },
            storeId: "store-1",
            subjectId: "adjustment-1",
            subjectType: "stock_adjustment_batch",
          },
          {
            _id: "event-draft-updated",
            createdAt: Date.UTC(2026, 4, 8, 20, 41, 20),
            eventType: "cycle_count_draft_updated",
            message: "Operator counted agya (6N2Y-RFF-1J1) as 950.",
            metadata: {
              productSkuId: "sku-1",
              productSkuLabel: "agya (6N2Y-RFF-1J1)",
            },
            storeId: "store-1",
            subjectId: "draft-1",
            subjectType: "cycle_count_draft",
          },
        ],
        productSku: [
          {
            _id: "sku-1",
            productId: "product-1",
            productName: "agya",
            sku: "6N2Y-RFF-1J1",
            storeId: "store-1",
          },
        ],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.timeline.map((event) => event.id)).toEqual([
      "event-draft-started",
      "event-draft-submitted",
      "event-adjustment-applied",
      "event-draft-updated",
    ]);
    expect(
      snapshot.timeline.find((event) => event.id === "event-draft-updated")
        ?.productLink,
    ).toEqual({
      label: "agya (6N2Y-RFF-1J1)",
      params: {
        productSlug: "product-1",
      },
      search: {
        variant: "6N2Y-RFF-1J1",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
    });
  });

  it("serves a finalized week with distinct completed and void POS evidence from one bounded frozen-close read", async () => {
    mockDailyOperationsRole("full_admin");
    const operatingDates = [
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
    ];
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        ...operatingDates.map((operatingDate, index) =>
          buildFrozenClose({
            operatingDate,
            salesTotal: 100_000 + index * 1_000,
          }),
        ),
        buildFrozenClose({
          id: "close-before-window",
          operatingDate: "2026-05-01",
          salesTotal: 800_001,
        }),
        buildFrozenClose({
          id: "close-after-window",
          operatingDate: "2026-05-10",
          salesTotal: 800_010,
        }),
        buildFrozenClose({
          id: "close-other-store",
          operatingDate: "2026-05-08",
          rowOverrides: { storeId: "store-2" },
          salesTotal: 900_000,
          snapshotOverrides: {
            closeMetadata: { storeId: "store-2" },
          },
        }),
      ],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "mutable-live-row",
          completedAt: Date.UTC(2026, 4, 8, 16),
          total: 999_999,
          transactionNumber: "MUTABLE",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );
    const selectedMetric = snapshot.weekMetrics.find(
      (metric: { operatingDate: string }) =>
        metric.operatingDate === "2026-05-08",
    );

    expect(selectedMetric).toEqual({
      adjustedSalesTotal: 111_000,
      adjustmentCashSettlementTotal: 5_000,
      adjustmentCollectionTotal: 5_000,
      adjustmentNetSettlementTotal: 5_000,
      adjustmentPaymentTotals: [
        { amount: 5_000, method: "cash", transactionCount: 1 },
      ],
      adjustmentRefundTotal: 0,
      carriedOverCashTotal: 0,
      carriedOverRegisterCount: 0,
      currentDayCashTotal: 106_000,
      currentDayCashTransactionCount: 2,
      expenseTotal: 12_000,
      expenseTransactionCount: 1,
      isClosed: true,
      isReopened: false,
      isSelected: true,
      itemAdjustmentCount: 1,
      netCashMovementTotal: 99_000,
      netCashVariance: 0,
      operatingDate: "2026-05-08",
      paymentTotals: [{ amount: 106_000, method: "cash", transactionCount: 2 }],
      registerVarianceCount: 0,
      salesTotal: 106_000,
      transactionCount: 2,
    });
    expect(snapshot.priorWeekBoundaryMetric).toMatchObject({
      operatingDate: "2026-05-02",
      salesTotal: 100_000,
    });
    expect(metricSourceObservations(observations)).toEqual([
      {
        indexName: "by_storeId_operatingDate",
        limit: 201,
        order: "asc",
        predicates: [
          { field: "storeId", operator: "eq", value: "store-1" },
          {
            field: "operatingDate",
            operator: "gte",
            value: "2026-05-02",
          },
          {
            field: "operatingDate",
            operator: "lte",
            value: "2026-05-09",
          },
        ],
        table: "dailyClose",
        terminal: "take",
      },
    ]);
  });

  it("uses one close-range read plus three financial reads for each live-fallback date", async () => {
    mockDailyOperationsRole("full_admin");
    const frozenDates = [
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-09",
    ];
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        ...frozenDates.map((operatingDate) =>
          buildFrozenClose({ operatingDate }),
        ),
        {
          ...buildFrozenClose({ operatingDate: "2026-05-02" }),
          reportSnapshot: undefined,
        },
        {
          ...buildFrozenClose({ operatingDate: "2026-05-08" }),
          lifecycleStatus: "reopened",
          reopenedAt: Date.UTC(2026, 4, 9, 8),
          status: "open",
        },
      ],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "live-prior-boundary",
          completedAt: Date.UTC(2026, 4, 2, 12),
          total: 22_000,
          transactionNumber: "LIVE-PRIOR",
        }),
        buildCompletedPosTransaction({
          _id: "live-selected",
          total: 88_000,
          transactionNumber: "LIVE-SELECTED",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: false,
      isReopened: true,
      salesTotal: 88_000,
    });
    expect(snapshot.priorWeekBoundaryMetric).toMatchObject({
      operatingDate: "2026-05-02",
      salesTotal: 22_000,
    });
    const sourceReads = metricSourceObservations(observations);
    expect(sourceReads).toHaveLength(1 + 3 * 2);
    expect(
      sourceReads.filter((observation) => observation.table === "dailyClose"),
    ).toHaveLength(1);
    for (const table of [
      "posTransaction",
      "posTransactionAdjustment",
      "expenseTransaction",
    ] as const) {
      expect(
        sourceReads.filter((observation) => observation.table === table),
      ).toHaveLength(2);
    }
    const frozenMetric = snapshot.weekMetrics.find(
      (metric: { operatingDate: string }) =>
        metric.operatingDate === "2026-05-07",
    );
    const liveMetric = snapshot.weekMetrics.find(
      (metric: { operatingDate: string }) =>
        metric.operatingDate === "2026-05-08",
    );
    const expectedMetricKeys = [
      "adjustedSalesTotal",
      "adjustmentCashSettlementTotal",
      "adjustmentCollectionTotal",
      "adjustmentNetSettlementTotal",
      "adjustmentPaymentTotals",
      "adjustmentRefundTotal",
      "carriedOverCashTotal",
      "carriedOverRegisterCount",
      "currentDayCashTotal",
      "currentDayCashTransactionCount",
      "expenseTotal",
      "expenseTransactionCount",
      "isClosed",
      "isReopened",
      "isSelected",
      "itemAdjustmentCount",
      "netCashMovementTotal",
      "netCashVariance",
      "operatingDate",
      "paymentTotals",
      "registerVarianceCount",
      "salesTotal",
      "transactionCount",
    ].sort();
    expect(Object.keys(frozenMetric).sort()).toEqual(expectedMetricKeys);
    expect(Object.keys(liveMetric).sort()).toEqual(expectedMetricKeys);
  });

  it.each<FrozenFallbackCase>([
    {
      label: "unsupported snapshot contract",
      snapshotOverrides: { snapshotContractVersion: 1 },
    },
    {
      label: "aggregate source incompleteness",
      snapshotOverrides: {
        sourceCompleteness: {
          ...frozenFinancialCompleteness("2026-05-08"),
          complete: false,
        },
      },
    },
    {
      label: "missing required financial source",
      snapshotOverrides: {
        sourceCompleteness: {
          complete: true,
          entries: frozenFinancialCompleteness("2026-05-08").entries.slice(
            0,
            2,
          ),
        },
      },
    },
    {
      label: "duplicate required financial source",
      snapshotOverrides: {
        sourceCompleteness: {
          complete: true,
          entries: [
            ...frozenFinancialCompleteness("2026-05-08").entries,
            frozenFinancialCompleteness("2026-05-08").entries[0],
          ],
        },
      },
    },
    {
      label: "combined completed and void POS evidence",
      snapshotOverrides: {
        sourceCompleteness: {
          complete: true,
          entries: frozenFinancialCompleteness("2026-05-08").entries.map(
            (entry) =>
              entry.source === "pos_transaction" &&
              entry.statuses.includes("completed")
                ? { ...entry, statuses: ["completed", "void"] }
                : entry,
          ),
        },
      },
    },
    {
      label: "contradictory source status",
      snapshotOverrides: {
        sourceCompleteness: {
          complete: true,
          entries: frozenFinancialCompleteness("2026-05-08").entries.map(
            (entry) =>
              entry.source === "expense_transaction"
                ? { ...entry, statuses: ["pending"] }
                : entry,
          ),
        },
      },
    },
    {
      label: "shifted source range",
      snapshotOverrides: {
        sourceCompleteness: {
          complete: true,
          entries: frozenFinancialCompleteness("2026-05-08").entries.map(
            (entry) =>
              entry.source === "pos_transaction"
                ? {
                    ...entry,
                    range: {
                      ...entry.range,
                      startAt: entry.range.startAt + 60_000,
                    },
                  }
                : entry,
          ),
        },
      },
    },
    {
      label: "contradictory source read mode",
      snapshotOverrides: {
        sourceCompleteness: {
          complete: true,
          entries: frozenFinancialCompleteness("2026-05-08").entries.map(
            (entry) =>
              entry.source === "pos_transaction_adjustment"
                ? { ...entry, readMode: "by_storeId_status_completedAt" }
                : entry,
          ),
        },
      },
    },
    {
      label: "required source record count equal to its limit",
      snapshotOverrides: {
        sourceCompleteness: frozenFinancialCompletenessWithExpenseOverride({
          limit: 200,
          recordCount: 200,
        }),
      },
    },
    {
      label: "required source record count greater than its limit",
      snapshotOverrides: {
        sourceCompleteness: frozenFinancialCompletenessWithExpenseOverride({
          limit: 200,
          recordCount: 201,
        }),
      },
    },
    {
      label: "required source missing its limit",
      snapshotOverrides: {
        sourceCompleteness: frozenFinancialCompletenessWithExpenseOverride(
          {},
          { omitLimit: true },
        ),
      },
    },
    {
      label: "required source with a zero limit",
      snapshotOverrides: {
        sourceCompleteness: frozenFinancialCompletenessWithExpenseOverride({
          limit: 0,
        }),
      },
    },
    {
      label: "required source with a negative limit",
      snapshotOverrides: {
        sourceCompleteness: frozenFinancialCompletenessWithExpenseOverride({
          limit: -1,
        }),
      },
    },
    {
      label: "required source with a fractional limit",
      snapshotOverrides: {
        sourceCompleteness: frozenFinancialCompletenessWithExpenseOverride({
          limit: 1.5,
        }),
      },
    },
    {
      label: "mismatched snapshot metadata",
      snapshotOverrides: {
        closeMetadata: { operatingDate: "2026-05-07" },
      },
    },
    {
      label: "snapshot boundary shifted beyond DST tolerance",
      snapshotOverrides: {
        closeMetadata: {
          endAt: Date.UTC(2026, 4, 9, 1, 1),
          startAt: Date.UTC(2026, 4, 8, 1, 1),
        },
        sourceCompleteness: frozenFinancialCompletenessForRange("2026-05-08", {
          endAt: Date.UTC(2026, 4, 9, 1, 1),
          startAt: Date.UTC(2026, 4, 8, 1, 1),
        }),
      },
    },
    {
      label: "snapshot duration outside the 23 to 25 hour DST window",
      snapshotOverrides: {
        closeMetadata: {
          endAt: Date.UTC(2026, 4, 8, 23),
          startAt: Date.UTC(2026, 4, 8, 1),
        },
        sourceCompleteness: frozenFinancialCompletenessForRange("2026-05-08", {
          endAt: Date.UTC(2026, 4, 8, 23),
          startAt: Date.UTC(2026, 4, 8, 1),
        }),
      },
    },
    {
      label: "non-finite required amount",
      summaryOverrides: { salesTotal: Number.NaN },
    },
    ...[
      "currentDayCashTransactionCount",
      "expenseTransactionCount",
      "itemAdjustmentCount",
      "transactionCount",
    ].flatMap((field) => [
      {
        label: `negative summary count ${field}`,
        summaryOverrides: { [field]: -1 },
      },
      {
        label: `fractional summary count ${field}`,
        summaryOverrides: { [field]: 1.5 },
      },
    ]),
    {
      label: "summary transaction count contradicts completed POS evidence",
      summaryOverrides: { transactionCount: 3 },
    },
    {
      label: "summary expense count contradicts expense evidence",
      summaryOverrides: { expenseTransactionCount: 2 },
    },
    {
      label: "summary adjustment count contradicts adjustment evidence",
      summaryOverrides: { itemAdjustmentCount: 2 },
    },
    {
      label: "cash transaction count exceeds completed POS evidence",
      summaryOverrides: { currentDayCashTransactionCount: 3 },
    },
    {
      label: "payment method count exceeds completed POS evidence",
      summaryOverrides: {
        paymentTotals: [
          { amount: 111_000, method: "cash", transactionCount: 3 },
        ],
      },
    },
    {
      label: "adjustment payment count exceeds adjustment evidence",
      summaryOverrides: {
        adjustmentPaymentTotals: [
          { amount: 5_000, method: "cash", transactionCount: 2 },
        ],
      },
    },
    {
      label: "malformed payment total",
      summaryOverrides: {
        paymentTotals: [
          { amount: Number.NaN, method: "cash", transactionCount: 1 },
        ],
      },
    },
    {
      label: "negative payment total transaction count",
      summaryOverrides: {
        paymentTotals: [
          { amount: 5_000, method: "cash", transactionCount: -1 },
        ],
      },
    },
    {
      label: "fractional payment total transaction count",
      summaryOverrides: {
        paymentTotals: [
          { amount: 5_000, method: "cash", transactionCount: 1.5 },
        ],
      },
    },
    {
      label: "duplicate payment total methods",
      summaryOverrides: {
        paymentTotals: [
          { amount: 3_000, method: "cash", transactionCount: 1 },
          { amount: 2_000, method: "cash", transactionCount: 1 },
        ],
      },
    },
    {
      label: "non-finite adjustment payment total",
      summaryOverrides: {
        adjustmentPaymentTotals: [
          {
            amount: Number.POSITIVE_INFINITY,
            method: "cash",
            transactionCount: 1,
          },
        ],
      },
    },
    {
      label: "malformed adjustment payment total",
      summaryOverrides: {
        adjustmentPaymentTotals: [
          { amount: 5_000, method: "", transactionCount: 1 },
        ],
      },
    },
    {
      label: "negative adjustment payment total transaction count",
      summaryOverrides: {
        adjustmentPaymentTotals: [
          { amount: 5_000, method: "cash", transactionCount: -1 },
        ],
      },
    },
    {
      label: "fractional adjustment payment total transaction count",
      summaryOverrides: {
        adjustmentPaymentTotals: [
          { amount: 5_000, method: "cash", transactionCount: 1.5 },
        ],
      },
    },
    {
      label: "duplicate adjustment payment total methods",
      summaryOverrides: {
        adjustmentPaymentTotals: [
          { amount: 3_000, method: "cash", transactionCount: 1 },
          { amount: 2_000, method: "cash", transactionCount: 1 },
        ],
      },
    },
  ])("falls back live for $label", async (testCase) => {
    mockDailyOperationsRole("full_admin");
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        buildFrozenClose({
          operatingDate: "2026-05-08",
          salesTotal: 555_000,
          snapshotOverrides: testCase.snapshotOverrides,
          summaryOverrides: testCase.summaryOverrides,
        }),
      ],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "trusted-live-row",
          transactionNumber: "TRUSTED-LIVE",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({ salesTotal: 77_000, transactionCount: 1 });
    expect(
      metricSourceObservations(observations).filter(
        (observation) =>
          observation.table !== "dailyClose" &&
          observation.predicates.some(
            (predicate) =>
              predicate.operator === "gte" &&
              predicate.value === Date.UTC(2026, 4, 8),
          ),
      ),
    ).toHaveLength(3);
  });

  it("accepts legitimate zero-valued frozen metrics without importing close-only totals", async () => {
    mockDailyOperationsRole("full_admin");
    const zeroSummary = {
      adjustedSalesTotal: 0,
      adjustmentCashSettlementTotal: 0,
      adjustmentCollectionTotal: 0,
      adjustmentNetSettlementTotal: 0,
      adjustmentPaymentTotals: [],
      adjustmentRefundTotal: 0,
      currentDayCashTotal: 0,
      currentDayCashTransactionCount: 0,
      expenseTotal: 0,
      expenseTransactionCount: 0,
      itemAdjustmentCount: 0,
      netCashMovementTotal: 0,
      paymentTotals: [],
      salesTotal: 0,
      transactionCount: 0,
    };
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        buildFrozenClose({
          operatingDate: "2026-05-08",
          snapshotOverrides: {
            sourceCompleteness: {
              ...frozenFinancialCompleteness("2026-05-08"),
              entries: frozenFinancialCompleteness("2026-05-08").entries.map(
                (entry) => ({ ...entry, recordCount: 0 }),
              ),
            },
          },
          summaryOverrides: zeroSummary,
        }),
      ],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "mutable-nonzero-row",
          transactionNumber: "MUTABLE-NONZERO",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );
    const metric = snapshot.weekMetrics.find(
      (candidate: { operatingDate: string }) =>
        candidate.operatingDate === "2026-05-08",
    );

    expect(metric).toMatchObject({
      carriedOverCashTotal: 0,
      carriedOverRegisterCount: 0,
      netCashVariance: 0,
      paymentTotals: [],
      registerVarianceCount: 0,
      salesTotal: 0,
      transactionCount: 0,
    });
    expect(
      metricSourceObservations(observations).filter(
        (observation) =>
          observation.table !== "dailyClose" &&
          observation.predicates.some(
            (predicate) =>
              predicate.operator === "gte" &&
              predicate.value === Date.UTC(2026, 4, 8),
          ),
      ),
    ).toHaveLength(0);
  });

  it("moves writer-shaped reopen authority from live data to the completed replacement snapshot", async () => {
    mockDailyOperationsRole("full_admin");
    const reopenedAt = Date.UTC(2026, 4, 9, 8);
    const reopenedOriginal = {
      ...buildFrozenClose({
        id: "writer-original",
        isCurrent: false,
        operatingDate: "2026-05-08",
        salesTotal: 410_000,
      }),
      lifecycleStatus: "reopened",
      reopenedAt,
      supersededByDailyCloseId: "writer-replacement",
    };
    const openReplacement = {
      ...buildFrozenClose({
        id: "writer-replacement",
        isCurrent: true,
        operatingDate: "2026-05-08",
        salesTotal: 420_000,
      }),
      completedAt: undefined,
      lifecycleStatus: "active",
      reopenedAt,
      reopenedFromDailyCloseId: "writer-original",
      reportSnapshot: undefined,
      status: "open",
      supersedesDailyCloseId: "writer-original",
    };
    const liveTransaction = buildCompletedPosTransaction({
      _id: "writer-live-row",
      transactionNumber: "WRITER-LIVE",
    });
    const openPhase = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      buildCtx({
        dailyClose: [reopenedOriginal, openReplacement],
        posTransaction: [liveTransaction],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      openPhase.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: false,
      isReopened: true,
      salesTotal: 77_000,
    });

    const completedReplacement = {
      ...buildFrozenClose({
        id: "writer-replacement",
        isCurrent: true,
        operatingDate: "2026-05-08",
        salesTotal: 431_000,
      }),
      reopenedAt,
      reopenedFromDailyCloseId: "writer-original",
      supersedesDailyCloseId: "writer-original",
    };
    const completedPhase = await getHandler(
      getDailyOperationsWeekAnalyticsSnapshot,
    )(
      buildCtx({
        dailyClose: [
          {
            ...reopenedOriginal,
            lifecycleStatus: "superseded",
          },
          completedReplacement,
        ],
        posTransaction: [liveTransaction],
        store: [store],
      }) as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      completedPhase.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: true,
      isReopened: false,
      salesTotal: 431_000,
    });
  });

  it("selects the completed v2 terminal snapshot after two writer-shaped reopen cycles", async () => {
    mockDailyOperationsRole("full_admin");
    const firstReopenedAt = Date.UTC(2026, 4, 9, 8);
    const secondReopenedAt = Date.UTC(2026, 4, 10, 8);
    const firstClose = {
      ...buildFrozenClose({
        id: "cycle-a",
        isCurrent: false,
        operatingDate: "2026-05-08",
        salesTotal: 610_000,
      }),
      lifecycleStatus: "superseded",
      reopenedAt: firstReopenedAt,
      supersededByDailyCloseId: "cycle-b",
    };
    const secondClose = {
      ...buildFrozenClose({
        id: "cycle-b",
        isCurrent: false,
        operatingDate: "2026-05-08",
        salesTotal: 620_000,
      }),
      lifecycleStatus: "superseded",
      reopenedAt: secondReopenedAt,
      reopenedFromDailyCloseId: "cycle-a",
      supersededByDailyCloseId: "cycle-c",
      supersedesDailyCloseId: "cycle-a",
    };
    const terminalClose = {
      ...buildFrozenClose({
        id: "cycle-c",
        isCurrent: true,
        operatingDate: "2026-05-08",
        salesTotal: 630_000,
      }),
      reopenedAt: secondReopenedAt,
      reopenedFromDailyCloseId: "cycle-b",
      supersedesDailyCloseId: "cycle-b",
    };
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [firstClose, secondClose, terminalClose],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "mutable-two-cycle-row",
          transactionNumber: "MUTABLE-TWO-CYCLE",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: true,
      isReopened: false,
      salesTotal: 630_000,
    });
    expect(
      metricSourceObservations(observations).filter(
        (observation) =>
          observation.table !== "dailyClose" &&
          observation.predicates.some(
            (predicate) =>
              predicate.operator === "gte" &&
              predicate.value === Date.UTC(2026, 4, 8),
          ),
      ),
    ).toEqual([]);
  });

  it("accepts a frozen snapshot whose exact store-day range uses a nonzero timezone offset", async () => {
    mockDailyOperationsRole("full_admin");
    const operatingTimezoneOffsetMinutes = 240;
    const selectedRange = operatingDateRange(
      "2026-05-08",
      operatingTimezoneOffsetMinutes,
    );
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        buildFrozenClose({
          operatingDate: "2026-05-08",
          operatingTimezoneOffsetMinutes,
          salesTotal: 240_000,
        }),
      ],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "mutable-offset-row",
          completedAt: selectedRange.startAt + 12 * 60 * 60_000,
          total: 999_000,
          transactionNumber: "MUTABLE-OFFSET",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        operatingTimezoneOffsetMinutes,
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: true,
      salesTotal: 240_000,
    });
    expect(
      observations.filter(
        (observation) =>
          observation.table !== "dailyClose" &&
          metricSourceTables.has(observation.table) &&
          observation.predicates.some(
            (predicate) =>
              predicate.operator === "gte" &&
              predicate.value === selectedRange.startAt,
          ),
      ),
    ).toEqual([]);
  });

  it.each([
    {
      endAt: Date.UTC(2026, 4, 9),
      label: "23-hour day",
      salesTotal: 523_000,
      startAt: Date.UTC(2026, 4, 8, 1),
    },
    {
      endAt: Date.UTC(2026, 4, 9),
      label: "25-hour day",
      salesTotal: 525_000,
      startAt: Date.UTC(2026, 4, 7, 23),
    },
  ])(
    "accepts a valid frozen $label range within the DST boundary tolerance",
    async ({ endAt, salesTotal, startAt }) => {
      mockDailyOperationsRole("full_admin");
      const actualRange = { endAt, startAt };
      const { ctx, observations } = buildObservedCtx({
        dailyClose: [
          buildFrozenClose({
            operatingDate: "2026-05-08",
            salesTotal,
            snapshotOverrides: {
              closeMetadata: actualRange,
              sourceCompleteness: frozenFinancialCompletenessForRange(
                "2026-05-08",
                actualRange,
              ),
            },
          }),
        ],
        posTransaction: [
          buildCompletedPosTransaction({
            _id: `mutable-dst-${salesTotal}`,
            total: 999_000,
            transactionNumber: `MUTABLE-DST-${salesTotal}`,
          }),
        ],
        store: [store],
      });

      const snapshot = await getHandler(
        getDailyOperationsWeekAnalyticsSnapshot,
      )(ctx as never, {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      });

      expect(
        snapshot.weekMetrics.find(
          (metric: { operatingDate: string }) =>
            metric.operatingDate === "2026-05-08",
        ),
      ).toMatchObject({
        isClosed: true,
        salesTotal,
      });
      expect(
        metricSourceObservations(observations).filter(
          (observation) =>
            observation.table !== "dailyClose" &&
            observation.predicates.some(
              (predicate) =>
                predicate.operator === "gte" &&
                predicate.value === Date.UTC(2026, 4, 8),
            ),
        ),
      ).toEqual([]);
    },
  );

  it("uses the request-derived range when DST-tolerant close metadata contradicts required source ranges", async () => {
    mockDailyOperationsRole("full_admin");
    const requestedRange = operatingDateRange("2026-05-08");
    const displacedRange = {
      endAt: requestedRange.endAt,
      startAt: requestedRange.startAt + 60 * 60_000,
    };
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        buildFrozenClose({
          operatingDate: "2026-05-08",
          salesTotal: 508_000,
          snapshotOverrides: {
            closeMetadata: displacedRange,
            // The default source ranges remain request-derived and therefore
            // deliberately contradict this otherwise DST-tolerant metadata.
          },
        }),
      ],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "request-edge-hour",
          completedAt: requestedRange.startAt + 30 * 60_000,
          total: 33_000,
          transactionNumber: "REQUEST-EDGE-HOUR",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: true,
      salesTotal: 33_000,
      transactionCount: 1,
    });
    expect(
      observations
        .filter(
          (observation) =>
            observation.table === "posTransaction" &&
            observation.terminal === "take",
        )
        .find((observation) =>
          observation.predicates.some(
            (predicate) =>
              predicate.operator === "gte" &&
              predicate.value === requestedRange.startAt,
          ),
        ),
    ).toBeDefined();
  });

  it("uses trusted DST source evidence for a writer-shaped reopened live fallback", async () => {
    mockDailyOperationsRole("full_admin");
    const requestedRange = operatingDateRange("2026-05-08");
    const trustedReopenedRange = {
      endAt: requestedRange.endAt,
      startAt: requestedRange.startAt + 60 * 60_000,
    };
    const reopenedAt = Date.UTC(2026, 4, 9, 8);
    const original = {
      ...buildFrozenClose({
        id: "dst-reopened-original",
        isCurrent: false,
        operatingDate: "2026-05-08",
        salesTotal: 608_000,
        snapshotOverrides: {
          closeMetadata: trustedReopenedRange,
          sourceCompleteness: frozenFinancialCompletenessForRange(
            "2026-05-08",
            trustedReopenedRange,
          ),
        },
      }),
      lifecycleStatus: "reopened",
      reopenedAt,
      supersededByDailyCloseId: "dst-reopened-successor",
    };
    const successor = {
      ...buildFrozenClose({
        id: "dst-reopened-successor",
        isCurrent: true,
        operatingDate: "2026-05-08",
      }),
      completedAt: undefined,
      lifecycleStatus: "active",
      reopenedAt,
      reopenedFromDailyCloseId: "dst-reopened-original",
      reportSnapshot: undefined,
      status: "open",
      supersedesDailyCloseId: "dst-reopened-original",
    };
    const { ctx } = buildObservedCtx({
      dailyClose: [original, successor],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "excluded-request-edge",
          completedAt: requestedRange.startAt + 30 * 60_000,
          total: 33_000,
          transactionNumber: "EXCLUDED-REQUEST-EDGE",
        }),
        buildCompletedPosTransaction({
          _id: "included-trusted-dst",
          completedAt: trustedReopenedRange.startAt + 60 * 60_000,
          total: 44_000,
          transactionNumber: "INCLUDED-TRUSTED-DST",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({
      isClosed: false,
      isReopened: true,
      salesTotal: 44_000,
      transactionCount: 1,
    });
  });

  it("resolves historical, reopened, reclosed, ambiguous, and broken date-local close authority conservatively", async () => {
    mockDailyOperationsRole("full_admin");
    const cases = [
      {
        candidates: [
          buildFrozenClose({
            isCurrent: false,
            operatingDate: "2026-05-08",
            rowOverrides: {
              currentnessMode: "historical_record",
            },
            salesTotal: 410_000,
            snapshotOverrides: {
              closeMetadata: { currentnessMode: "historical_record" },
            },
          }),
          buildFrozenClose({
            id: "store-global-current-other-date",
            isCurrent: true,
            operatingDate: "2026-05-09",
            salesTotal: 999_000,
          }),
        ],
        expected: { isClosed: true, isReopened: false, salesTotal: 410_000 },
        label: "historical completed row",
      },
      {
        candidates: [
          {
            ...buildFrozenClose({
              operatingDate: "2026-05-08",
              salesTotal: 420_000,
            }),
            lifecycleStatus: "reopened",
            reopenedAt: Date.UTC(2026, 4, 9, 8),
          },
        ],
        expected: { isClosed: false, isReopened: true, salesTotal: 77_000 },
        label: "reopened original",
      },
      {
        candidates: [
          {
            ...buildFrozenClose({
              id: "close-original",
              operatingDate: "2026-05-08",
              salesTotal: 430_000,
            }),
            lifecycleStatus: "superseded",
            reopenedAt: Date.UTC(2026, 4, 9, 8),
            supersededByDailyCloseId: "close-replacement",
          },
          {
            ...buildFrozenClose({
              id: "close-replacement",
              operatingDate: "2026-05-08",
              salesTotal: 431_000,
            }),
            reopenedFromDailyCloseId: "close-original",
            supersedesDailyCloseId: "close-original",
          },
        ],
        expected: { isClosed: true, isReopened: false, salesTotal: 431_000 },
        label: "effective reclose replacement",
      },
      {
        candidates: [
          buildFrozenClose({
            id: "duplicate-active-a",
            operatingDate: "2026-05-08",
            salesTotal: 440_000,
          }),
          buildFrozenClose({
            id: "duplicate-active-b",
            operatingDate: "2026-05-08",
            salesTotal: 441_000,
          }),
        ],
        expected: { salesTotal: 77_000 },
        label: "duplicate active completions",
      },
      {
        candidates: [
          {
            ...buildFrozenClose({
              id: "broken-replacement",
              operatingDate: "2026-05-08",
              salesTotal: 450_000,
            }),
            reopenedFromDailyCloseId: "missing-original",
            supersedesDailyCloseId: "missing-original",
          },
        ],
        expected: { salesTotal: 77_000 },
        label: "broken replacement link",
      },
      {
        candidates: [
          {
            ...buildFrozenClose({
              id: "cross-date-original",
              operatingDate: "2026-05-07",
              salesTotal: 451_000,
            }),
            lifecycleStatus: "superseded",
            supersededByDailyCloseId: "cross-date-replacement",
          },
          {
            ...buildFrozenClose({
              id: "cross-date-replacement",
              operatingDate: "2026-05-08",
              salesTotal: 452_000,
            }),
            reopenedFromDailyCloseId: "cross-date-original",
            supersedesDailyCloseId: "cross-date-original",
          },
        ],
        expected: { salesTotal: 77_000 },
        label: "cross-date replacement link",
      },
    ];

    for (const testCase of cases) {
      const { ctx } = buildObservedCtx({
        dailyClose: testCase.candidates,
        posTransaction: [
          buildCompletedPosTransaction({
            _id: `live-${testCase.label}`,
            transactionNumber: `LIVE-${testCase.label}`,
          }),
        ],
        store: [store],
      });
      const snapshot = await getHandler(
        getDailyOperationsWeekAnalyticsSnapshot,
      )(ctx as never, {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      });

      expect(
        snapshot.weekMetrics.find(
          (metric: { operatingDate: string }) =>
            metric.operatingDate === "2026-05-08",
        ),
        testCase.label,
      ).toMatchObject(testCase.expected);
    }
  });

  it("keeps exactly 200 close candidates complete and ordered before the range limit", async () => {
    mockDailyOperationsRole("full_admin");
    const dates = [
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
    ];
    const closeCandidates = [
      ...dates.map((operatingDate) =>
        buildFrozenClose({ operatingDate, salesTotal: 500_000 }),
      ),
      ...Array.from({ length: 192 }, (_, index) =>
        buildFrozenClose({
          id: `dense-close-${index}`,
          operatingDate: "2026-05-02",
          salesTotal: 600_000 + index,
        }),
      ),
    ];
    const { ctx, observations } = buildObservedCtx({
      dailyClose: closeCandidates,
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "mutable-selected-at-200",
          total: 88_000,
          transactionNumber: "LIVE-200",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(
      snapshot.weekMetrics.find(
        (metric: { operatingDate: string }) =>
          metric.operatingDate === "2026-05-08",
      ),
    ).toMatchObject({ salesTotal: 500_000 });
    expect(metricSourceObservations(observations)).toHaveLength(4);
  });

  it.each(["2026-05-02", "2026-05-06", "2026-05-09"])(
    "falls the whole window back when 201 close candidates concentrate on %s",
    async (denseOperatingDate) => {
      mockDailyOperationsRole("full_admin");
      const dates = [
        "2026-05-02",
        "2026-05-03",
        "2026-05-04",
        "2026-05-05",
        "2026-05-06",
        "2026-05-07",
        "2026-05-08",
        "2026-05-09",
      ];
      const closeCandidates = [
        ...dates.map((operatingDate) =>
          buildFrozenClose({ operatingDate, salesTotal: 700_000 }),
        ),
        ...Array.from({ length: 193 }, (_, index) =>
          buildFrozenClose({
            id: `overflow-${denseOperatingDate}-${index}`,
            operatingDate: denseOperatingDate,
            salesTotal: 800_000 + index,
          }),
        ),
      ];
      const liveTransactions = dates.map((operatingDate, index) =>
        buildCompletedPosTransaction({
          _id: `live-overflow-${index}`,
          completedAt:
            operatingDateRange(operatingDate).startAt + 12 * 60 * 60_000,
          total: 80_000 + index,
          transactionNumber: `LIVE-OVERFLOW-${index}`,
        }),
      );
      const { ctx, observations } = buildObservedCtx({
        dailyClose: closeCandidates,
        posTransaction: liveTransactions,
        store: [store],
      });

      const snapshot = await getHandler(
        getDailyOperationsWeekAnalyticsSnapshot,
      )(ctx as never, {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      });

      expect(
        snapshot.weekMetrics.find(
          (metric: { operatingDate: string }) =>
            metric.operatingDate === "2026-05-08",
        ),
      ).toMatchObject({ salesTotal: 80_006 });
      expect(snapshot.priorWeekBoundaryMetric).toMatchObject({
        salesTotal: 80_000,
      });
      expect(metricSourceObservations(observations)).toHaveLength(33);
    },
  );

  it("uses frozen authority for both selected and prior metrics in today refresh", async () => {
    vi.setSystemTime(new Date("2026-05-08T18:30:00.000Z"));
    mockDailyOperationsRole("full_admin");
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        buildFrozenClose({
          operatingDate: "2026-05-07",
          salesTotal: 107_000,
        }),
        buildFrozenClose({
          isCurrent: true,
          operatingDate: "2026-05-08",
          salesTotal: 108_000,
        }),
      ],
      dailyOpening: [startedOpening],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "mutable-refresh-selected",
          total: 999_000,
          transactionNumber: "MUTABLE-REFRESH",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsTodayRefreshSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        refreshRequestedAt: 12345,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.weekMetric).toMatchObject({
      isClosed: true,
      isSelected: true,
      salesTotal: 108_000,
    });
    expect(snapshot.priorDayMetric).toMatchObject({
      isClosed: true,
      isSelected: false,
      operatingDate: "2026-05-07",
      salesTotal: 107_000,
    });
    expect(snapshot.refreshRequestedAt).toBe(12345);
    expect(
      observations.filter(
        (observation) =>
          observation.terminal === "take" &&
          observation.table !== "dailyClose" &&
          metricSourceTables.has(observation.table) &&
          observation.predicates.some(
            (predicate) =>
              predicate.operator === "gte" &&
              predicate.value === Date.UTC(2026, 4, 7),
          ) &&
          observation.predicates.some(
            (predicate) =>
              predicate.operator === "lt" &&
              predicate.value === Date.UTC(2026, 4, 8),
          ),
      ),
    ).toEqual([]);
  });

  it("uses live reopened authority for today refresh while preserving a frozen prior metric", async () => {
    vi.setSystemTime(new Date("2026-05-08T18:30:00.000Z"));
    mockDailyOperationsRole("full_admin");
    const reopenedAt = Date.UTC(2026, 4, 9, 8);
    const original = {
      ...buildFrozenClose({
        id: "refresh-original",
        isCurrent: false,
        operatingDate: "2026-05-08",
        salesTotal: 508_000,
      }),
      lifecycleStatus: "reopened",
      reopenedAt,
      supersededByDailyCloseId: "refresh-replacement",
    };
    const openReplacement = {
      ...buildFrozenClose({
        id: "refresh-replacement",
        isCurrent: true,
        operatingDate: "2026-05-08",
        salesTotal: 608_000,
      }),
      completedAt: undefined,
      lifecycleStatus: "active",
      reopenedAt,
      reopenedFromDailyCloseId: "refresh-original",
      reportSnapshot: undefined,
      status: "open",
      supersedesDailyCloseId: "refresh-original",
    };
    const { ctx } = buildObservedCtx({
      dailyClose: [
        buildFrozenClose({
          operatingDate: "2026-05-07",
          salesTotal: 107_000,
        }),
        original,
        openReplacement,
      ],
      dailyOpening: [startedOpening],
      posTransaction: [
        buildCompletedPosTransaction({
          _id: "refresh-live-reopened",
          total: 78_000,
          transactionNumber: "REFRESH-LIVE-REOPENED",
        }),
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsTodayRefreshSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        refreshRequestedAt: 12346,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.weekMetric).toMatchObject({
      isClosed: false,
      isReopened: true,
      isSelected: true,
      salesTotal: 78_000,
    });
    expect(snapshot.priorDayMetric).toMatchObject({
      isClosed: true,
      operatingDate: "2026-05-07",
      salesTotal: 107_000,
    });
  });

  it("short-circuits POS-only week analytics before all metric-source reads", async () => {
    mockDailyOperationsRole("pos_only");
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        buildFrozenClose({
          isCurrent: true,
          operatingDate: "2026-05-08",
          salesTotal: 999_000,
        }),
      ],
      posTransaction: [
        {
          _id: "restricted-financial-row",
          completedAt: Date.UTC(2026, 4, 8, 12),
          status: "completed",
          storeId: "store-1",
          total: 999_000,
        },
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsWeekAnalyticsSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
        weekEndOperatingDate: "2026-05-09",
      },
    );

    expect(snapshot.weekMetrics).toEqual([]);
    expect(snapshot.priorWeekBoundaryMetric).toBeNull();
    expect(metricSourceObservations(observations)).toEqual([]);
  });

  it("returns null POS-only today metrics without reading financial source tables", async () => {
    mockDailyOperationsRole("pos_only");
    const { ctx, observations } = buildObservedCtx({
      dailyClose: [
        buildFrozenClose({
          isCurrent: true,
          operatingDate: "2026-05-08",
          salesTotal: 999_000,
        }),
      ],
      dailyOpening: [startedOpening],
      posTransaction: [
        {
          _id: "restricted-refresh-row",
          completedAt: Date.UTC(2026, 4, 8, 12),
          status: "completed",
          storeId: "store-1",
          total: 999_000,
        },
      ],
      store: [store],
    });

    const snapshot = await getHandler(getDailyOperationsTodayRefreshSnapshot)(
      ctx as never,
      {
        operatingDate: "2026-05-08",
        refreshRequestedAt: 12345,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.weekMetric).toBeNull();
    expect(snapshot.priorDayMetric).toBeNull();
    expect(
      observations.filter((observation) =>
        (
          [
            "expenseTransaction",
            "posTransaction",
            "posTransactionAdjustment",
          ] as TableName[]
        ).includes(observation.table),
      ),
    ).toEqual([]);
  });
});
