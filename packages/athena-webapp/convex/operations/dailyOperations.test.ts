import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { buildDailyOperationsSnapshotWithCtx } from "./dailyOperations";

type TableName =
  | "approvalRequest"
  | "dailyClose"
  | "dailyOpening"
  | "expenseTransaction"
  | "operationalEvent"
  | "operationalWorkItem"
  | "paymentAllocation"
  | "posSession"
  | "posTerminal"
  | "posTransaction"
  | "registerSession"
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

function buildCtx(seed: Partial<Record<TableName, Row[]>>) {
  const { db } = createDb(seed);
  return { db } as unknown as QueryCtx;
}

describe("daily operations overview read model", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats a store day with no opening as not opened and points to Opening Handoff", async () => {
    const snapshot = await buildDailyOperationsSnapshotWithCtx(
      buildCtx({
        dailyClose: [priorClose],
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("not_opened");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Start Opening Handoff",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    });
    expect(snapshot.attentionItems[0]).toMatchObject({
      owner: "daily_opening",
      severity: "warning",
    });
    expect(snapshot.lanes.find((lane) => lane.key === "opening")).toMatchObject(
      {
        status: "needs_attention",
      },
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
      label: "Start End-of-Day Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    });
    expect(snapshot.lanes.find((lane) => lane.key === "close")).toMatchObject({
      count: 0,
      status: "ready",
    });
    expect(snapshot.closeSummary).toMatchObject({
      carriedOverCashTotal: 0,
      currentDayCashTotal: 0,
      expenseTotal: 0,
      netCashVariance: 0,
      salesTotal: 0,
      transactionCount: 0,
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
      label: "Start End-of-Day Review",
    });
    expect(snapshot.lanes.find((lane) => lane.key === "close")).toMatchObject({
      description: "End-of-Day Review is available for review.",
      status: "ready",
    });
    expect(
      snapshot.attentionItems.some(
        (item) =>
          item.owner === "daily_close" &&
          item.label === "End-of-Day Review reopened",
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
        "1 close blocker must be resolved after reopening End-of-Day Review.",
      status: "blocked",
    });
    expect(snapshot.attentionItems).toContainEqual(
      expect.objectContaining({
        owner: "daily_close",
        label: "End-of-Day Review reopened",
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
            payments: [{ amount: 85000, method: "cash" }],
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
            message: "End-of-Day Review completed.",
            storeId: "store-1",
            subjectId: "close-current",
            subjectType: "daily_close",
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
        store: [store],
      }),
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.lifecycle.status).toBe("closed");
    expect(snapshot.primaryAction).toMatchObject({
      label: "Review End-of-Day Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    });
    expect(snapshot.timeline.map((event) => event.id)).toEqual([
      "event-2",
      "event-1",
    ]);
    expect(snapshot.attentionItems).toEqual([]);
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
});
