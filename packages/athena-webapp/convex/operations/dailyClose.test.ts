import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  buildDailyCloseSnapshotWithCtx,
  completeDailyCloseWithCtx,
  getDailyCloseOpeningContextWithCtx,
} from "./dailyClose";

type TableName =
  | "approvalProof"
  | "approvalRequest"
  | "dailyClose"
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
  const inserts: Array<{ table: TableName; value: Row }> = [];
  const patches: Array<{
    id: string;
    table: TableName;
    value: Record<string, unknown>;
  }> = [];

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
        const leftValue = Number(left.createdAt ?? left.completedAt ?? 0);
        const rightValue = Number(right.createdAt ?? right.completedAt ?? 0);
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
    async insert(table: TableName, value: Record<string, unknown>) {
      const id = `${table}-${tableFor(table).size + 1}`;
      const row = { _id: id, ...value };
      tableFor(table).set(id, row);
      inserts.push({ table, value: row });
      return id;
    },
    async patch(
      tableOrId: string,
      maybeIdOrPatch: string | Record<string, unknown>,
      maybePatch?: Record<string, unknown>,
    ) {
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

  function findTableById(
    id: string,
    patch: Record<string, unknown>,
  ): [TableName, string, Record<string, unknown>] {
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

function dailyCloseApprovalProof(overrides: Partial<Row> = {}): Row {
  return {
    _id: "approval-proof-1",
    actionKey: "operations.daily_close.complete",
    approvedByCredentialId: "credential-manager-1",
    approvedByStaffProfileId: "staff-manager-1",
    createdAt: Date.UTC(2026, 4, 7, 21),
    expiresAt: Date.UTC(2026, 4, 7, 23),
    requiredRole: "manager",
    requestedByStaffProfileId: "staff-1",
    storeId: "store-1",
    subjectId: "store-1:2026-05-07",
    subjectLabel: "Daily Close 2026-05-07",
    subjectType: "daily_close",
    ...overrides,
  };
}

describe("daily close backend foundation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies blockers, review items, carry-forward items, ready items, and summary totals", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 19));

    const { db } = createDb({
      approvalRequest: [
        {
          _id: "approval-1",
          createdAt: Date.UTC(2026, 4, 7, 16),
          metadata: {
            amount: 12000,
            paymentMethod: "cash",
            previousPaymentMethod: "mobile_money",
            transactionId: "txn-1",
            transactionNumber: "TXN-1",
          },
          notes: "Customer paid cash after mobile money failed.",
          reason:
            "Manager approval is required to correct a completed transaction payment method.",
          registerSessionId: "register-closing",
          requestedByStaffProfileId: "staff-1",
          requestType: "payment_method_correction",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-1",
          subjectType: "pos_transaction",
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
      expenseTransaction: [
        {
          _id: "expense-1",
          completedAt: Date.UTC(2026, 4, 7, 17),
          notes: "Restocked petty cash supplies.",
          registerNumber: "A3",
          sessionId: "expense-session-1",
          staffProfileId: "staff-1",
          status: "completed",
          storeId: "store-1",
          totalValue: 4500,
          transactionNumber: "EXP-1",
        },
        {
          _id: "expense-2",
          completedAt: Date.UTC(2026, 4, 7, 18),
          sessionId: "expense-session-2",
          staffProfileId: "staff-1",
          status: "completed",
          storeId: "store-1",
          totalValue: 2500,
          transactionNumber: "EXP-2",
        },
        {
          _id: "expense-prior-day",
          completedAt: Date.UTC(2026, 4, 6, 18),
          sessionId: "expense-session-prior",
          staffProfileId: "staff-1",
          status: "completed",
          storeId: "store-1",
          totalValue: 9000,
          transactionNumber: "EXP-PRIOR",
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
          _id: "pos-expired-held",
          createdAt: 1,
          expiresAt: Date.UTC(2026, 4, 7, 18),
          sessionNumber: "SES-expired",
          status: "held",
          storeId: "store-1",
          terminalId: "terminal-1",
          updatedAt: 1,
        },
        {
          _id: "pos-held",
          customerInfo: {
            name: "Ama Mensah",
          },
          createdAt: 2,
          expiresAt: Date.UTC(2026, 4, 7, 20),
          registerNumber: "A1",
          sessionNumber: "SES-1",
          staffProfileId: "staff-1",
          status: "held",
          storeId: "store-1",
          total: 33500,
          terminalId: "terminal-1",
          updatedAt: 2,
        },
      ],
      posTerminal: [
        {
          _id: "terminal-1",
          displayName: "Front counter terminal",
          storeId: "store-1",
        },
      ],
      staffProfile: [
        {
          _id: "staff-1",
          firstName: "Kofi",
          fullName: "Kofi Mensah",
          lastName: "Mensah",
          organizationId: "org-1",
          status: "active",
          storeId: "store-1",
        },
      ],
      posTransaction: [
        {
          _id: "txn-1",
          changeGiven: 500,
          completedAt: Date.UTC(2026, 4, 7, 14),
          customerInfo: {
            phone: "0240000000",
          },
          payments: [
            { amount: 10000, method: "cash", timestamp: 1 },
            { amount: 2500, method: "mobile_money", timestamp: 2 },
          ],
          registerNumber: "A1",
          registerSessionId: "register-open",
          staffProfileId: "staff-1",
          status: "completed",
          storeId: "store-1",
          subtotal: 12000,
          tax: 0,
          total: 12000,
          terminalId: "terminal-1",
          totalPaid: 12500,
          transactionNumber: "TXN-1",
        },
        {
          _id: "txn-prior-day",
          completedAt: Date.UTC(2026, 4, 6, 21),
          payments: [{ amount: 9000, method: "cash", timestamp: 1 }],
          registerSessionId: "register-open",
          status: "completed",
          storeId: "store-1",
          subtotal: 9000,
          tax: 0,
          total: 9000,
          totalPaid: 9000,
          transactionNumber: "TXN-PRIOR",
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
          expectedCash: 19500,
          openedAt: Date.UTC(2026, 4, 6, 20),
          openingFloat: 10000,
          registerNumber: "A1",
          status: "open",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        {
          _id: "register-closing",
          countedCash: 8000,
          expectedCash: 10000,
          openedByStaffProfileId: "staff-1",
          openedAt: Date.UTC(2026, 4, 7, 10),
          openingFloat: 10000,
          registerNumber: "A2",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
          variance: -2000,
        },
        {
          _id: "register-closed",
          closedAt: Date.UTC(2026, 4, 7, 19),
          closedByStaffProfileId: "staff-1",
          countedCash: 9500,
          expectedCash: 10000,
          openedByStaffProfileId: "staff-1",
          openedAt: Date.UTC(2026, 4, 7, 10),
          openingFloat: 10000,
          registerNumber: "A3",
          status: "closed",
          storeId: "store-1",
          terminalId: "terminal-1",
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
    expect(snapshot.blockers[0].metadata).toMatchObject({
      openedAt: Date.UTC(2026, 4, 6, 20),
      operatingScope: "Carried over from prior day",
      register: "Register A1",
      terminal: "Front counter terminal",
    });
    expect(snapshot.blockers[1].metadata).toMatchObject({
      countedCash: 8000,
      expectedCash: 10000,
      openedAt: Date.UTC(2026, 4, 7, 10),
      openedBy: "Kofi Mensah",
      operatingScope: "Opened today",
      register: "Register A2",
      status: "closing",
      terminal: "Front counter terminal",
      variance: -2000,
    });
    expect(snapshot.blockers[0].link).toEqual({
      label: "View session",
      params: { sessionId: "register-open" },
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
    });
    expect(snapshot.blockers[2]).toMatchObject({
      link: {
        label: "View approvals",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      metadata: {
        amount: 12000,
        approval: "Payment method correction",
        currentMethod: "Mobile Money",
        notes: "Customer paid cash after mobile money failed.",
        reason:
          "Manager approval is required to correct a completed transaction payment method.",
        register: "Register A2",
        requestedAt: Date.UTC(2026, 4, 7, 16),
        requestedBy: "Kofi Mensah",
        requestedMethod: "Cash",
        transactionId: "txn-1",
        transaction: "TXN-1",
      },
      title: "Payment method correction pending",
    });
    expect(snapshot.blockers[3].metadata).toMatchObject({
      customer: "Ama Mensah",
      expiresAt: Date.UTC(2026, 4, 7, 20),
      owner: "Kofi Mensah",
      session: "SES-1",
      status: "held",
      terminal: "Front counter terminal / Register A1",
      total: 33500,
    });
    expect(snapshot.reviewItems.map((item) => item.key)).toContain(
      "register_session:register-closed:variance",
    );
    expect(
      snapshot.reviewItems.find(
        (item) => item.key === "register_session:register-closed:variance",
      )?.metadata,
    ).toMatchObject({
      closedAt: Date.UTC(2026, 4, 7, 19),
      countedCash: 9500,
      expectedCash: 10000,
      openedAt: Date.UTC(2026, 4, 7, 10),
      operatingScope: "Opened today",
      register: "Register A3",
      status: "closed",
      terminal: "Front counter terminal",
      variance: -500,
    });
    expect(snapshot.reviewItems.map((item) => item.key)).toContain(
      "pos_transaction:txn-void:void",
    );
    expect(
      snapshot.reviewItems.find(
        (item) => item.key === "pos_transaction:txn-void:void",
      )?.metadata,
    ).toMatchObject({
      completedAt: Date.UTC(2026, 4, 7, 15),
      paymentMethods: "Card",
      total: 5000,
      totalPaid: 5000,
      transaction: "TXN-2",
    });
    expect(snapshot.carryForwardItems).toHaveLength(1);
    expect(snapshot.readyItems.map((item) => item.key)).toContain(
      "pos_transaction:txn-1:completed",
    );
    expect(snapshot.readyItems.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "expense_transaction:expense-1:completed",
        "expense_transaction:expense-2:completed",
      ]),
    );
    expect(
      snapshot.readyItems.find(
        (item) => item.key === "pos_transaction:txn-1:completed",
      )?.metadata,
    ).toMatchObject({
      changeGiven: 500,
      completedAt: Date.UTC(2026, 4, 7, 14),
      customer: "0240000000",
      owner: "Kofi Mensah",
      paymentMethods: "Cash, Mobile Money",
      terminal: "Front counter terminal / Register A1",
      total: 12000,
      totalPaid: 12500,
      transaction: "TXN-1",
    });
    expect(
      snapshot.readyItems.find(
        (item) => item.key === "register_session:register-closed:closed",
      )?.metadata,
    ).toMatchObject({
      closedAt: Date.UTC(2026, 4, 7, 19),
      closedBy: "Kofi Mensah",
      countedCash: 9500,
      expectedCash: 10000,
      openedAt: Date.UTC(2026, 4, 7, 10),
      openedBy: "Kofi Mensah",
      operatingScope: "Opened today",
      register: "Register A3",
      status: "closed",
      terminal: "Front counter terminal",
      variance: -500,
    });
    expect(
      snapshot.readyItems.find(
        (item) => item.key === "pos_transaction:txn-1:completed",
      )?.link,
    ).toEqual({
      label: "View transaction",
      params: { transactionId: "txn-1" },
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
    });
    expect(
      snapshot.readyItems.find(
        (item) => item.key === "expense_transaction:expense-1:completed",
      ),
    ).toMatchObject({
      category: "expense",
      link: {
        label: "View expense",
        params: { reportId: "expense-1" },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId",
      },
      metadata: {
        completedAt: Date.UTC(2026, 4, 7, 17),
        notes: "Restocked petty cash supplies.",
        owner: "Kofi Mensah",
        register: "Register A3",
        report: "EXP-1",
        total: 4500,
      },
      subject: {
        id: "expense-1",
        label: "EXP-1",
        type: "expense_transaction",
      },
      title: "Completed expense",
    });
    expect(snapshot.summary).toMatchObject({
      carriedOverCashTotal: 10000,
      carriedOverRegisterCount: 1,
      cashDepositTotal: 3000,
      closedRegisterSessionCount: 1,
      currentDayCashTotal: 9500,
      currentDayCashTransactionCount: 1,
      expectedCashTotal: 39500,
      expenseStaffCount: 1,
      expenseTotal: 7000,
      netCashVariance: -2500,
      openWorkItemCount: 1,
      pendingApprovalCount: 1,
      registerCount: 3,
      registerVarianceCount: 2,
      salesTotal: 12000,
      transactionCount: 1,
      voidedTransactionCount: 1,
    });
    expect(snapshot.readyItems.map((item) => item.key)).not.toContain(
      "pos_transaction:txn-prior-day:completed",
    );
    expect(snapshot.readyItems.map((item) => item.key)).not.toContain(
      "expense_transaction:expense-prior-day:completed",
    );
    expect(snapshot.sourceSubjects).toEqual(
      expect.arrayContaining([
        {
          id: "expense-1",
          label: "EXP-1",
          type: "expense_transaction",
        },
      ]),
    );
  });

  it("does not repeat the register when the terminal label already includes it", async () => {
    const { db } = createDb({
      posTerminal: [
        {
          _id: "terminal-codex",
          displayName: "Codex / Register 3",
          storeId: "store-1",
        },
      ],
      registerSession: [
        {
          _id: "register-3",
          closedAt: Date.UTC(2026, 4, 8, 1),
          countedCash: 39099,
          expectedCash: 39099,
          openedAt: Date.UTC(2026, 4, 6, 4, 42),
          openingFloat: 10000,
          registerNumber: "3",
          status: "closed",
          storeId: "store-1",
          terminalId: "terminal-codex",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        endAt: Date.UTC(2026, 4, 8, 4),
        operatingDate: "2026-05-07",
        startAt: Date.UTC(2026, 4, 7, 4),
        storeId: "store-1" as Id<"store">,
      },
    );
    const metadata = snapshot.readyItems.find(
      (item) => item.key === "register_session:register-3:closed",
    )?.metadata;

    expect(metadata).toMatchObject({
      terminal: "Codex / Register 3",
    });
    expect(metadata).not.toHaveProperty("register");
  });

  it("uses the supplied operating-day range for same-local-day transactions after UTC midnight", async () => {
    const { db } = createDb({
      posTransaction: [
        {
          _id: "txn-after-utc-midnight",
          changeGiven: 5000,
          completedAt: Date.UTC(2026, 4, 8, 1, 3),
          payments: [{ amount: 30000, method: "cash", timestamp: 1 }],
          status: "completed",
          storeId: "store-1",
          subtotal: 25000,
          tax: 0,
          total: 25000,
          totalPaid: 30000,
          transactionNumber: "022332",
        },
      ],
      store: [store],
    });

    const utcSnapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );
    const localSnapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        endAt: Date.UTC(2026, 4, 8, 4),
        operatingDate: "2026-05-07",
        startAt: Date.UTC(2026, 4, 7, 4),
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(utcSnapshot.readyItems.map((item) => item.key)).not.toContain(
      "pos_transaction:txn-after-utc-midnight:completed",
    );
    expect(localSnapshot.readyItems.map((item) => item.key)).toContain(
      "pos_transaction:txn-after-utc-midnight:completed",
    );
    expect(localSnapshot.summary).toMatchObject({
      currentDayCashTotal: 25000,
      currentDayCashTransactionCount: 1,
      salesTotal: 25000,
      transactionCount: 1,
    });
  });

  it("uses the supplied operating-day range for completed expense transactions", async () => {
    const { db } = createDb({
      expenseTransaction: [
        {
          _id: "expense-after-utc-midnight",
          completedAt: Date.UTC(2026, 4, 8, 1, 3),
          sessionId: "expense-session-1",
          staffProfileId: "staff-1",
          status: "completed",
          storeId: "store-1",
          totalValue: 25000,
          transactionNumber: "EXP-LOCAL",
        },
        {
          _id: "expense-void",
          completedAt: Date.UTC(2026, 4, 8, 1, 4),
          sessionId: "expense-session-void",
          staffProfileId: "staff-1",
          status: "void",
          storeId: "store-1",
          totalValue: 10000,
          transactionNumber: "EXP-VOID",
        },
        {
          _id: "expense-other-store",
          completedAt: Date.UTC(2026, 4, 8, 1, 5),
          sessionId: "expense-session-other-store",
          staffProfileId: "staff-1",
          status: "completed",
          storeId: "store-2",
          totalValue: 9000,
          transactionNumber: "EXP-OTHER",
        },
      ],
      staffProfile: [
        {
          _id: "staff-1",
          firstName: "Kofi",
          fullName: "Kofi Mensah",
          lastName: "Mensah",
          organizationId: "org-1",
          status: "active",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const utcSnapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );
    const localSnapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        endAt: Date.UTC(2026, 4, 8, 4),
        operatingDate: "2026-05-07",
        startAt: Date.UTC(2026, 4, 7, 4),
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(utcSnapshot.readyItems.map((item) => item.key)).not.toContain(
      "expense_transaction:expense-after-utc-midnight:completed",
    );
    expect(localSnapshot.readyItems.map((item) => item.key)).toContain(
      "expense_transaction:expense-after-utc-midnight:completed",
    );
    expect(localSnapshot.readyItems.map((item) => item.key)).not.toContain(
      "expense_transaction:expense-void:completed",
    );
    expect(localSnapshot.readyItems.map((item) => item.key)).not.toContain(
      "expense_transaction:expense-other-store:completed",
    );
    expect(localSnapshot.summary).toMatchObject({
      expenseStaffCount: 1,
      expenseTotal: 25000,
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
        metadata: {
          reviewItemCount: 1,
          unreviewedItemKeys: ["pos_transaction:txn-void:void"],
        },
      },
    });
  });

  it("requires manager approval before completing a ready day", async () => {
    const { db, inserts } = createDb({
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
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "approval_required",
      approval: {
        action: {
          key: "operations.daily_close.complete",
          label: "Complete Daily Close",
        },
        copy: {
          message:
            "A manager needs to approve this Daily Close before the operating day is saved.",
          primaryActionLabel: "Approve and complete",
          secondaryActionLabel: "Cancel",
          title: "Manager approval required",
        },
        metadata: {
          operatingDate: "2026-05-07",
        },
        reason: "Manager approval is required to complete Daily Close.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        selfApproval: "allowed",
        subject: {
          id: "store-1:2026-05-07",
          label: "Daily Close 2026-05-07",
          type: "daily_close",
        },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("completes a ready day, persists carry-forward links, and records audit events", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const { db, inserts } = createDb({
      approvalProof: [dailyCloseApprovalProof()],
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
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        carryForwardWorkItemIds: ["work-existing" as Id<"operationalWorkItem">],
        createCarryForwardWorkItems: [
          { notes: "Check display case.", title: "Count front display" },
        ],
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
    expect(
      result.kind === "ok"
        ? result.data.dailyClose.carryForwardWorkItemIds
        : [],
    ).toEqual(["work-existing", "operationalWorkItem-2"]);
    expect(inserts.map((insert) => insert.table)).toEqual([
      "operationalEvent",
      "operationalWorkItem",
      "dailyClose",
      "operationalEvent",
      "operationalEvent",
    ]);
    expect(
      inserts.find(
        (insert) =>
          insert.table === "operationalEvent" &&
          insert.value.eventType === "daily_close_completed",
      )?.value,
    ).toMatchObject({
      eventType: "daily_close_completed",
      subjectType: "daily_close",
      metadata: {
        approvalProofId: "approval-proof-1",
        approvedByStaffProfileId: "staff-manager-1",
      },
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
          readiness: {
            blockerCount: 0,
            carryForwardCount: 1,
            readyCount: 1,
            reviewCount: 0,
            status: "ready",
          },
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
    expect(context.carryForwardWorkItems.map((item) => item._id)).toEqual([
      "work-1",
    ]);
  });
});
