import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  buildDailyCloseSnapshotWithCtx,
  completeDailyCloseWithCtx,
  getDailyCloseOpeningContextWithCtx,
} from "./dailyClose";

type TableName =
  | "approvalRequest"
  | "dailyClose"
  | "expenseTransaction"
  | "operationalEvent"
  | "operationalWorkItem"
  | "paymentAllocation"
  | "posSession"
  | "posTransaction"
  | "registerSession"
  | "store";

type Row = Record<string, unknown> & { _id: string };

function createDb(seed: Partial<Record<TableName, Row[]>> = {}) {
  const tables = new Map<TableName, Map<string, Row>>();
  const inserts: Array<{ table: TableName; value: Row }> = [];
  const patches: Array<{ id: string; table: TableName; value: Record<string, unknown> }> = [];

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
    const filters: Array<[string, unknown | { gte?: number; lt?: number; lte?: number }]> = [];
    let sortDirection: "asc" | "desc" = "asc";
    const filteredRows = () => {
      const rows = Array.from(tableFor(table).values()).filter((row) =>
        filters.every(([field, value]) => {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            if ("gte" in value && typeof value.gte === "number" && Number(row[field]) < value.gte) {
              return false;
            }

            if ("lt" in value && typeof value.lt === "number" && Number(row[field]) >= value.lt) {
              return false;
            }

            if ("lte" in value && typeof value.lte === "number" && Number(row[field]) > value.lte) {
              return false;
            }

            return true;
          }

          return row[field] === value;
        }),
      );

      return rows.sort((left, right) => {
        const leftValue = Number(left.createdAt ?? left.completedAt ?? 0);
        const rightValue = Number(right.createdAt ?? right.completedAt ?? 0);
        return sortDirection === "desc" ? rightValue - leftValue : leftValue - rightValue;
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
    async insert(table: TableName, value: Record<string, unknown>) {
      const id = `${table}-${tableFor(table).size + 1}`;
      const row = { _id: id, ...value };
      tableFor(table).set(id, row);
      inserts.push({ table, value: row });
      return id;
    },
    async patch(tableOrId: string, maybeIdOrPatch: string | Record<string, unknown>, maybePatch?: Record<string, unknown>) {
      const [table, id, patch] =
        maybePatch === undefined
          ? findTableById(tableOrId, maybeIdOrPatch as Record<string, unknown>)
          : [tableOrId as TableName, maybeIdOrPatch as string, maybePatch];
      const row = tableFor(table).get(id);

      if (!row) {
        throw new Error(`Missing ${table}:${id}`);
      }

      Object.assign(row, patch);
      patches.push({ id, table, value: patch });
    },
    query,
  };

  function findTableById(id: string, patch: Record<string, unknown>): [TableName, string, Record<string, unknown>] {
    for (const [tableName, table] of tables.entries()) {
      if (table.has(id)) {
        return [tableName, id, patch];
      }
    }

    throw new Error(`Missing row ${id}`);
  }

  return { db, inserts, patches, tables };
}

const store = {
  _id: "store-1",
  createdByUserId: "user-1",
  currency: "GHS",
  name: "Accra",
  organizationId: "org-1",
  slug: "accra",
};

describe("daily close backend foundation", () => {
  it("classifies blockers, review items, carry-forward items, ready items, and summary totals", async () => {
    const { db } = createDb({
      approvalRequest: [
        {
          _id: "approval-1",
          createdAt: 3,
          registerSessionId: "register-closing",
          requestType: "variance_review",
          status: "pending",
          storeId: "store-1",
          subjectId: "register-closing",
          subjectType: "register_session",
        },
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: 4,
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer tomorrow",
          type: "customer_follow_up",
        },
      ],
      paymentAllocation: [
        {
          _id: "deposit-1",
          allocationType: "cash_deposit",
          amount: 3000,
          direction: "out",
          method: "cash",
          recordedAt: Date.UTC(2026, 4, 7, 18),
          registerSessionId: "register-closed",
          status: "recorded",
          storeId: "store-1",
          targetId: "deposit-key",
          targetType: "register_cash_deposit",
        },
      ],
      posSession: [
        {
          _id: "pos-held",
          createdAt: 2,
          expiresAt: Date.UTC(2026, 4, 7, 20),
          sessionNumber: "SES-1",
          status: "held",
          storeId: "store-1",
          terminalId: "terminal-1",
          updatedAt: 2,
        },
      ],
      posTransaction: [
        {
          _id: "txn-1",
          completedAt: Date.UTC(2026, 4, 7, 14),
          payments: [{ amount: 12000, method: "cash", timestamp: 1 }],
          status: "completed",
          storeId: "store-1",
          subtotal: 12000,
          tax: 0,
          total: 12000,
          totalPaid: 12000,
          transactionNumber: "TXN-1",
        },
        {
          _id: "txn-void",
          completedAt: Date.UTC(2026, 4, 7, 15),
          payments: [{ amount: 5000, method: "card", timestamp: 1 }],
          status: "void",
          storeId: "store-1",
          subtotal: 5000,
          tax: 0,
          total: 5000,
          totalPaid: 5000,
          transactionNumber: "TXN-2",
        },
      ],
      registerSession: [
        {
          _id: "register-open",
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 7, 9),
          openingFloat: 10000,
          registerNumber: "A1",
          status: "open",
          storeId: "store-1",
        },
        {
          _id: "register-closing",
          countedCash: 8000,
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 7, 10),
          openingFloat: 10000,
          registerNumber: "A2",
          status: "closing",
          storeId: "store-1",
          variance: -2000,
        },
        {
          _id: "register-closed",
          closedAt: Date.UTC(2026, 4, 7, 19),
          countedCash: 9500,
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 7, 10),
          openingFloat: 10000,
          registerNumber: "A3",
          status: "closed",
          storeId: "store-1",
          variance: -500,
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.readiness.status).toBe("blocked");
    expect(snapshot.blockers.map((item) => item.key)).toEqual([
      "register_session:register-open:open",
      "register_session:register-closing:closing",
      "approval_request:approval-1:pending",
      "pos_session:pos-held:held",
    ]);
    expect(snapshot.reviewItems.map((item) => item.key)).toContain("register_session:register-closed:variance");
    expect(snapshot.reviewItems.map((item) => item.key)).toContain("pos_transaction:txn-void:void");
    expect(snapshot.carryForwardItems).toHaveLength(1);
    expect(snapshot.readyItems.map((item) => item.key)).toContain("pos_transaction:txn-1:completed");
    expect(snapshot.summary).toMatchObject({
      cashDepositTotal: 3000,
      closedRegisterSessionCount: 1,
      openWorkItemCount: 1,
      pendingApprovalCount: 1,
      salesTotal: 12000,
      voidedTransactionCount: 1,
    });
  });

  it("rejects completion when command-time readiness has blockers", async () => {
    const { db, inserts } = createDb({
      registerSession: [
        {
          _id: "register-open",
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 7, 9),
          openingFloat: 10000,
          status: "open",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const result = await completeDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Daily Close cannot be completed while blocker items remain.",
        metadata: { blockerCount: 1 },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("requires review item acknowledgement before completion", async () => {
    const { db } = createDb({
      posTransaction: [
        {
          _id: "txn-void",
          completedAt: Date.UTC(2026, 4, 7, 15),
          payments: [],
          status: "void",
          storeId: "store-1",
          subtotal: 5000,
          tax: 0,
          total: 5000,
          totalPaid: 5000,
          transactionNumber: "TXN-2",
        },
      ],
      store: [store],
    });

    const result = await completeDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: { reviewItemCount: 1, unreviewedItemKeys: ["pos_transaction:txn-void:void"] },
      },
    });
  });

  it("completes a ready day, persists carry-forward links, and records audit events", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const { db, inserts } = createDb({
      operationalWorkItem: [
        {
          _id: "work-existing",
          approvalState: "not_required",
          createdAt: 4,
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Existing follow-up",
          type: "customer_follow_up",
        },
      ],
      posTransaction: [
        {
          _id: "txn-1",
          completedAt: Date.UTC(2026, 4, 7, 14),
          payments: [{ amount: 12000, method: "cash", timestamp: 1 }],
          status: "completed",
          storeId: "store-1",
          subtotal: 12000,
          tax: 0,
          total: 12000,
          totalPaid: 12000,
          transactionNumber: "TXN-1",
        },
      ],
      store: [store],
    });

    const result = await completeDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        carryForwardWorkItemIds: ["work-existing" as Id<"operationalWorkItem">],
        createCarryForwardWorkItems: [{ notes: "Check display case.", title: "Count front display" }],
        notes: "Close reviewed.",
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        dailyClose: {
          completedByStaffProfileId: "staff-1",
          completedByUserId: "user-1",
          isCurrent: true,
          notes: "Close reviewed.",
          operatingDate: "2026-05-07",
          status: "completed",
          storeId: "store-1",
        },
      },
    });
    expect(result.kind === "ok" ? result.data.dailyClose.carryForwardWorkItemIds : []).toEqual([
      "work-existing",
      "operationalWorkItem-2",
    ]);
    expect(inserts.map((insert) => insert.table)).toEqual([
      "operationalWorkItem",
      "dailyClose",
      "operationalEvent",
      "operationalEvent",
    ]);
    expect(inserts.find((insert) => insert.table === "operationalEvent")?.value).toMatchObject({
      eventType: "daily_close_completed",
      subjectType: "daily_close",
    });
  });

  it("exposes prior completed close and carry-forward work for future opening", async () => {
    const { db } = createDb({
      dailyClose: [
        {
          _id: "daily-close-1",
          carryForwardWorkItemIds: ["work-1"],
          completedAt: Date.UTC(2026, 4, 6, 22),
          createdAt: Date.UTC(2026, 4, 6, 22),
          isCurrent: false,
          operatingDate: "2026-05-06",
          organizationId: "org-1",
          readiness: { blockerCount: 0, carryForwardCount: 1, readyCount: 1, reviewCount: 0, status: "ready" },
          sourceSubjects: [],
          status: "completed",
          storeId: "store-1",
          summary: { salesTotal: 1000 },
          updatedAt: Date.UTC(2026, 4, 6, 22),
        },
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: 4,
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Carry forward",
          type: "daily_close_carry_forward",
        },
      ],
      store: [store],
    });

    const context = await getDailyCloseOpeningContextWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(context.priorClose?._id).toBe("daily-close-1");
    expect(context.carryForwardWorkItems.map((item) => item._id)).toEqual(["work-1"]);
  });
});
