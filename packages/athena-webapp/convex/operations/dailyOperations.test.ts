import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import {
  buildDailyOperationsSnapshotWithCtx,
  getDailyOperationsSnapshot,
} from "./dailyOperations";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

type TableName =
  | "approvalRequest"
  | "automationRun"
  | "dailyClose"
  | "dailyOpening"
  | "expenseTransaction"
  | "operationalEvent"
  | "operationalWorkItem"
  | "paymentAllocation"
  | "posLocalSyncConflict"
  | "posLocalSyncEvent"
  | "posLocalSyncMapping"
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

function createDb(seed: Partial<Record<TableName, Row[]>> = {}) {
  const tables = new Map<TableName, Map<string, Row>>();

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
        const leftValue = Number(
          left.createdAt ?? left.completedAt ?? left.startedAt ?? 0,
        );
        const rightValue = Number(
          right.createdAt ?? right.completedAt ?? right.startedAt ?? 0,
        );
        return sortDirection === "desc"
          ? rightValue - leftValue
          : leftValue - rightValue;
      });
    };

    const chain = {
      collect: async () => filteredRows(),
      first: async () => filteredRows()[0] ?? null,
      order(direction: "asc" | "desc") {
        sortDirection = direction;
        return chain;
      },
      take: async (limit: number) => filteredRows().slice(0, limit),
      async *[Symbol.asyncIterator]() {
        for (const row of filteredRows()) {
          yield row;
        }
      },
      withIndex(
        _index: string,
        applyIndex: (builder: {
          eq: (field: string, value: unknown) => typeof builder;
          gte: (field: string, value: number) => typeof builder;
          lt: (field: string, value: number) => typeof builder;
          lte: (field: string, value: number) => typeof builder;
        }) => unknown,
      ) {
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return builder;
          },
          gte(field: string, value: number) {
            filters.push([field, { gte: value }]);
            return builder;
          },
          lt(field: string, value: number) {
            filters.push([field, { lt: value }]);
            return builder;
          },
          lte(field: string, value: number) {
            filters.push([field, { lte: value }]);
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

  return { db };
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

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
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

  it("surfaces latest skipped EOD auto-complete evidence over EOD preparation", async () => {
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

    expect(snapshot.automationStatuses.find((status) => status.lane === "close"))
      .toMatchObject({
        decisionEvidence: {
          classification: "outside_completion_window",
          kind: "eod_auto_complete",
        },
        id: "automation-close-auto-skip",
        outcome: "skipped",
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
            decisionReason: "EOD Review is clean and eligible for auto-complete.",
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
            decisionReason: "EOD Review is already completed for this store day.",
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
      automationDecisionReason: "EOD Review is clean and eligible for auto-complete.",
      automationRunId: "automation-close-applied",
    });
    expect(snapshot.automationStatuses.find((status) => status.lane === "close"))
      .toMatchObject({
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
    expect(snapshot.completedClose).not.toHaveProperty("policyReviewedItemKeys");
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
        description: "1 opening item will be reviewed when Opening Handoff starts.",
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
      snapshot.weekMetrics.find((metric) => metric.operatingDate === "2026-05-08"),
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
          item.owner === "daily_close" &&
          item.label === "EOD Review reopened",
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
      description:
        "1 close blocker must be resolved after reopening the end of day review.",
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
      snapshot.weekMetrics.find((metric) => metric.operatingDate === "2026-05-07"),
    ).toMatchObject({
      isClosed: true,
      isSelected: false,
      salesTotal: 50000,
      transactionCount: 1,
    });
    expect(
      snapshot.weekMetrics.find((metric) => metric.operatingDate === "2026-05-08"),
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
      snapshot.weekMetrics.find((metric) => metric.operatingDate === "2026-05-05"),
    ).toMatchObject({
      isSelected: true,
      salesTotal: 0,
      transactionCount: 0,
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
    expect(
      snapshot.weekMetrics.find((metric) => metric.operatingDate === "2026-06-21"),
    ).toMatchObject({
      paymentTotals: [],
      salesTotal: 0,
      transactionCount: 1,
    });
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
      snapshot.weekMetrics.find((metric) => metric.operatingDate === "2026-06-21"),
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
    ).mockRejectedValue(new Error("You cannot view daily operations for this store."));

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
    expect(snapshot.timeline).toEqual([]);
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
      snapshot.weekMetrics.find((metric) => metric.operatingDate === "2026-05-10"),
    ).toMatchObject({
      salesTotal: 187899,
      transactionCount: 1,
    });
    expect(
      snapshot.weekMetrics.find((metric) => metric.operatingDate === "2026-05-11"),
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
    });
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
    expect(
      snapshot.attentionItems.filter(
        (item) => item.owner === "operations_queue",
      ),
    ).toHaveLength(3);
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
            message: "Variance of -19500 exceeded the closeout approval threshold.",
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

  it("surfaces pending synced register count submissions for the operating day", async () => {
    const ctx = buildCtx(buildPendingRegisterCountSeed());
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      ctx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

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

  it("orders same-minute cycle count lifecycle events by operator relevance", async () => {
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
      "event-draft-submitted",
      "event-adjustment-applied",
      "event-draft-updated",
      "event-draft-started",
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
});
