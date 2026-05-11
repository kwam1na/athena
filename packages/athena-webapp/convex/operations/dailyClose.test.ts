import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  buildDailyCloseSnapshotWithCtx,
  completeDailyCloseWithCtx,
  getCompletedDailyCloseHistoryDetailWithCtx,
  getDailyCloseOpeningContextWithCtx,
  listCompletedDailyCloseHistoryWithCtx,
  reopenDailyCloseWithCtx,
} from "./dailyClose";

type TableName =
  | "approvalProof"
  | "approvalRequest"
  | "dailyClose"
  | "expenseSession"
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
        const leftValue = String(
          left.operatingDate ?? left.createdAt ?? left.completedAt ?? "",
        );
        const rightValue = String(
          right.operatingDate ?? right.createdAt ?? right.completedAt ?? "",
        );
        return sortDirection === "desc"
          ? rightValue.localeCompare(leftValue)
          : leftValue.localeCompare(rightValue);
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

function dailyCloseSummary(overrides: Record<string, unknown> = {}) {
  return {
    carriedOverCashTotal: 0,
    carriedOverRegisterCount: 0,
    cashDepositTotal: 0,
    closedRegisterSessionCount: 0,
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expectedCashTotal: 0,
    expenseStaffCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    netCashVariance: 0,
    openWorkItemCount: 0,
    paymentTotals: [],
    pendingApprovalCount: 0,
    registerCount: 0,
    registerVarianceCount: 0,
    salesTotal: 0,
    transactionCount: 0,
    voidedTransactionCount: 0,
    ...overrides,
  };
}

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
    subjectLabel: "End-of-Day Review 2026-05-07",
    subjectType: "daily_close",
    ...overrides,
  };
}

function dailyCloseReopenApprovalProof(overrides: Partial<Row> = {}): Row {
  return {
    _id: "approval-proof-reopen-1",
    actionKey: "operations.daily_close.reopen",
    approvedByCredentialId: "credential-manager-1",
    approvedByStaffProfileId: "staff-manager-1",
    createdAt: Date.UTC(2026, 4, 8, 10),
    expiresAt: Date.UTC(2026, 4, 8, 12),
    requiredRole: "manager",
    requestedByStaffProfileId: "staff-1",
    storeId: "store-1",
    subjectId: "daily-close-1",
    subjectLabel: "End-of-Day Review 2026-05-07",
    subjectType: "daily_close",
    ...overrides,
  };
}

function completedDailyCloseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    closeMetadata: {
      completedAt: Date.UTC(2026, 4, 7, 22),
      completedByStaffProfileId: "staff-manager-1",
      completedByUserId: "user-1",
      operatingDate: "2026-05-07",
      organizationId: "org-1",
      startAt: Date.UTC(2026, 4, 7),
      endAt: Date.UTC(2026, 4, 8),
      storeId: "store-1",
    },
    readiness: {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
      reviewCount: 0,
      status: "ready",
    },
    summary: {
      salesTotal: 12000,
      transactionCount: 1,
    },
    reviewedItems: [],
    carryForwardItems: [],
    readyItems: [
      {
        key: "pos_transaction:txn-1:completed",
        severity: "ready",
        category: "sale",
        title: "Completed sale",
        message: "Completed sale is included in End-of-Day Review.",
        subject: {
          id: "txn-1",
          label: "TXN-1",
          type: "pos_transaction",
        },
        metadata: {
          total: 12000,
          transaction: "TXN-1",
        },
      },
    ],
    sourceSubjects: [
      {
        id: "txn-1",
        label: "TXN-1",
        type: "pos_transaction",
      },
    ],
    ...overrides,
  };
}

function completedDailyCloseRow(overrides: Partial<Row> = {}): Row {
  const reportSnapshot = completedDailyCloseSnapshot();

  return {
    _id: "daily-close-1",
    carryForwardWorkItemIds: [],
    completedAt: Date.UTC(2026, 4, 7, 22),
    completedByStaffProfileId: "staff-manager-1",
    completedByUserId: "user-1",
    createdAt: Date.UTC(2026, 4, 7, 22),
    isCurrent: true,
    lifecycleStatus: "active",
    operatingDate: "2026-05-07",
    organizationId: "org-1",
    readiness: reportSnapshot.readiness,
    reportSnapshot,
    sourceSubjects: reportSnapshot.sourceSubjects,
    status: "completed",
    storeId: "store-1",
    summary: reportSnapshot.summary,
    updatedAt: Date.UTC(2026, 4, 7, 22),
    ...overrides,
  };
}

describe("end-of-day review backend foundation", () => {
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
        {
          _id: "approval-next-day",
          createdAt: Date.UTC(2026, 4, 8, 16),
          metadata: {
            transactionId: "txn-next-day",
            transactionNumber: "TXN-NEXT",
          },
          registerSessionId: "register-next-day",
          requestType: "payment_method_correction",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-next-day",
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
      expenseSession: [
        {
          _id: "expense-session-1",
          completedAt: Date.UTC(2026, 4, 7, 17),
          createdAt: Date.UTC(2026, 4, 7, 16),
          expiresAt: Date.UTC(2026, 4, 7, 17, 5),
          registerNumber: "A3",
          sessionNumber: "EXP-SESSION-1",
          staffProfileId: "staff-1",
          status: "completed",
          storeId: "store-1",
          terminalId: "terminal-1",
          updatedAt: Date.UTC(2026, 4, 7, 17),
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
        {
          _id: "pos-next-day",
          createdAt: Date.UTC(2026, 4, 8, 10),
          expiresAt: Date.UTC(2026, 4, 8, 20),
          sessionNumber: "SES-next",
          status: "held",
          storeId: "store-1",
          terminalId: "terminal-1",
          updatedAt: Date.UTC(2026, 4, 8, 10),
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
        {
          _id: "txn-next-day",
          completedAt: Date.UTC(2026, 4, 8, 14),
          payments: [{ amount: 7000, method: "cash", timestamp: 1 }],
          registerSessionId: "register-next-day",
          status: "completed",
          storeId: "store-1",
          subtotal: 7000,
          tax: 0,
          total: 7000,
          totalPaid: 7000,
          transactionNumber: "TXN-NEXT",
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
        {
          _id: "register-next-day",
          expectedCash: 17000,
          openedAt: Date.UTC(2026, 4, 8, 9),
          openingFloat: 10000,
          registerNumber: "A4",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
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
      "approval_request:approval-1:pending",
      "register_session:register-closing:closing",
      "register_session:register-open:open",
      "pos_session:pos-held:held",
    ]);
    expect(snapshot.blockers[2].metadata).toMatchObject({
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
    expect(snapshot.blockers[2].link).toEqual({
      label: "View session",
      params: { sessionId: "register-open" },
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
    });
    expect(snapshot.blockers[0]).toMatchObject({
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
    expect(snapshot.blockers[0].metadata).not.toHaveProperty("openedAt");
    expect(snapshot.blockers[0].metadata).not.toHaveProperty("expectedCash");
    expect(snapshot.blockers[0].metadata).not.toHaveProperty("countedCash");
    expect(snapshot.blockers[0].metadata).not.toHaveProperty("variance");
    expect(snapshot.blockers[0].metadata).not.toHaveProperty("closedAt");
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
        report: "EXP-1",
        terminal: "Front counter terminal / Register A3",
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
      expenseTransactionCount: 2,
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

  it("serves the persisted report snapshot for completed End-of-Day Reviews", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 9, 12));

    const { db } = createDb({
      approvalRequest: [
        {
          _id: "approval-current",
          createdAt: Date.UTC(2026, 4, 9, 9),
          registerSessionId: "register-current",
          requestType: "payment_method_correction",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-current",
          subjectType: "pos_transaction",
        },
      ],
      dailyClose: [
        {
          _id: "daily-close-1",
          carryForwardWorkItemIds: [],
          completedAt: Date.UTC(2026, 4, 8, 22),
          completedByStaffProfileId: "staff-1",
          createdAt: Date.UTC(2026, 4, 8, 22),
          isCurrent: true,
          notes: "Closed cleanly.",
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
              carryForwardWorkItemIds: [],
              completedAt: Date.UTC(2026, 4, 8, 22),
              completedByStaffProfileId: "staff-1",
              endAt: Date.UTC(2026, 4, 9),
              notes: "Closed cleanly.",
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
            readyItems: [
              {
                category: "sale",
                key: "pos_transaction:txn-closed-day:completed",
                message: "Completed sale is included in End-of-Day Review.",
                severity: "ready",
                subject: {
                  id: "txn-closed-day",
                  label: "TXN-CLOSED",
                  type: "pos_transaction",
                },
                title: "Completed sale",
              },
            ],
            reviewedItems: [],
            sourceSubjects: [
              {
                id: "txn-closed-day",
                label: "TXN-CLOSED",
                type: "pos_transaction",
              },
            ],
            summary: {
              ...dailyCloseSummary({
                salesTotal: 46000,
                transactionCount: 1,
              }),
            },
          },
          reviewedItemKeys: [],
          sourceSubjects: [],
          status: "completed",
          storeId: "store-1",
          summary: {
            ...dailyCloseSummary({
              salesTotal: 46000,
              transactionCount: 1,
            }),
          },
          updatedAt: Date.UTC(2026, 4, 8, 22),
        },
      ],
      posSession: [
        {
          _id: "pos-current",
          createdAt: Date.UTC(2026, 4, 9, 10),
          expiresAt: Date.UTC(2026, 4, 9, 14),
          sessionNumber: "SES-CURRENT",
          status: "held",
          storeId: "store-1",
          terminalId: "terminal-1",
          updatedAt: Date.UTC(2026, 4, 9, 10),
        },
      ],
      posTransaction: [
        {
          _id: "txn-current",
          completedAt: Date.UTC(2026, 4, 9, 10),
          payments: [{ amount: 10000, method: "cash", timestamp: 1 }],
          registerSessionId: "register-current",
          status: "completed",
          storeId: "store-1",
          subtotal: 10000,
          tax: 0,
          total: 10000,
          totalPaid: 10000,
          transactionNumber: "TXN-CURRENT",
        },
      ],
      registerSession: [
        {
          _id: "register-current",
          expectedCash: 20000,
          openedAt: Date.UTC(2026, 4, 9, 9),
          openingFloat: 10000,
          registerNumber: "A1",
          status: "closing",
          storeId: "store-1",
        },
      ],
      staffProfile: [
        {
          _id: "staff-1",
          firstName: "Ama",
          fullName: "Ama Mensah",
          lastName: "Mensah",
          organizationId: "org-1",
          status: "active",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.status).toBe("completed");
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.readyItems.map((item) => item.key)).toEqual([
      "pos_transaction:txn-closed-day:completed",
    ]);
    expect(snapshot.summary.transactionCount).toBe(1);
    expect(snapshot.completedClose).toMatchObject({
      completedByStaffName: "Ama Mensah",
      notes: "Closed cleanly.",
    });
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

  it("keeps reopened register closeouts associated with their original closeout day", async () => {
    const originallyClosedAt = Date.UTC(2026, 4, 8, 17, 56);
    const reopenedAt = Date.UTC(2026, 4, 10, 16, 37);
    const correctedClosedAt = Date.UTC(2026, 4, 10, 17, 12);
    const registerSession = {
      _id: "register-reopened",
      closedAt: correctedClosedAt,
      closedByStaffProfileId: "staff-1",
      closeoutRecords: [
        {
          actorStaffProfileId: "staff-1",
          countedCash: 18975,
          expectedCash: 18975,
          occurredAt: originallyClosedAt,
          type: "closed",
          variance: 0,
        },
        {
          actorStaffProfileId: "manager-1",
          countedCash: 18975,
          expectedCash: 18975,
          occurredAt: reopenedAt,
          previousClosedAt: originallyClosedAt,
          type: "reopened",
          variance: 0,
        },
        {
          actorStaffProfileId: "manager-1",
          countedCash: 18977,
          expectedCash: 18975,
          occurredAt: correctedClosedAt,
          type: "closed",
          variance: 2,
        },
      ],
      countedCash: 18977,
      expectedCash: 18975,
      openedAt: Date.UTC(2026, 4, 8, 4, 48),
      openingFloat: 40000,
      registerNumber: "2",
      status: "closed",
      storeId: "store-1",
      terminalId: "terminal-1",
      variance: 2,
    };
    const { db } = createDb({
      registerSession: [registerSession],
      store: [store],
    });

    const originalDaySnapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );
    const reopenedDaySnapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-10", storeId: "store-1" as Id<"store"> },
    );

    expect(originalDaySnapshot.readyItems.map((item) => item.key)).toContain(
      "register_session:register-reopened:closed",
    );
    expect(
      reopenedDaySnapshot.readyItems.map((item) => item.key),
    ).not.toContain("register_session:register-reopened:closed");
    expect(reopenedDaySnapshot.summary.closedRegisterSessionCount).toBe(0);
  });

  it("includes the staff member name for completed close summaries", async () => {
    const { db } = createDb({
      dailyClose: [
        {
          _id: "daily-close-1",
          carryForwardWorkItemIds: [],
          completedAt: Date.UTC(2026, 4, 9, 1, 8),
          completedByStaffProfileId: "staff-1",
          completedByUserId: "user-1",
          createdAt: Date.UTC(2026, 4, 9, 1, 8),
          isCurrent: true,
          operatingDate: "2026-05-08",
          organizationId: "org-1",
          readiness: {
            blockerCount: 0,
            carryForwardCount: 0,
            readyCount: 0,
            reviewCount: 0,
            status: "ready",
          },
          sourceSubjects: [],
          status: "completed",
          storeId: "store-1",
          summary: {},
          updatedAt: Date.UTC(2026, 4, 9, 1, 8),
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

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.completedClose).toMatchObject({
      completedByStaffName: "Kofi Mensah",
      completedByStaffProfileId: "staff-1",
    });
  });

  it("falls back to the completion event approver for older close summaries", async () => {
    const { db } = createDb({
      dailyClose: [
        {
          _id: "daily-close-1",
          carryForwardWorkItemIds: [],
          completedAt: Date.UTC(2026, 4, 9, 1, 8),
          completedByUserId: "user-1",
          createdAt: Date.UTC(2026, 4, 9, 1, 8),
          isCurrent: true,
          operatingDate: "2026-05-08",
          organizationId: "org-1",
          readiness: {
            blockerCount: 0,
            carryForwardCount: 0,
            readyCount: 0,
            reviewCount: 0,
            status: "ready",
          },
          sourceSubjects: [],
          status: "completed",
          storeId: "store-1",
          summary: {},
          updatedAt: Date.UTC(2026, 4, 9, 1, 8),
        },
      ],
      operationalEvent: [
        {
          _id: "event-1",
          createdAt: Date.UTC(2026, 4, 9, 1, 8),
          eventType: "daily_close_completed",
          message: "End-of-Day Review completed for 2026-05-08.",
          metadata: {
            approvedByStaffProfileId: "staff-manager-1",
          },
          organizationId: "org-1",
          storeId: "store-1",
          subjectId: "daily-close-1",
          subjectLabel: "End-of-Day Review 2026-05-08",
          subjectType: "daily_close",
        },
      ],
      staffProfile: [
        {
          _id: "staff-manager-1",
          firstName: "Kwamina",
          fullName: "Kwamina Mensah",
          lastName: "Mensah",
          organizationId: "org-1",
          status: "active",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.completedClose).toMatchObject({
      completedByStaffName: "Kwamina Mensah",
      completedByStaffProfileId: "staff-manager-1",
    });
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
      expenseTransactionCount: 1,
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
        message:
          "End-of-Day Review cannot be completed while blocker items remain.",
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
          label: "Complete End-of-Day Review",
        },
        copy: {
          message:
            "A manager needs to approve this End-of-Day Review before the operating day is saved.",
          primaryActionLabel: "Approve and complete",
          secondaryActionLabel: "Cancel",
          title: "Manager approval required",
        },
        metadata: {
          operatingDate: "2026-05-07",
        },
        reason: "Manager approval is required to complete End-of-Day Review.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        selfApproval: "allowed",
        subject: {
          id: "store-1:2026-05-07",
          label: "End-of-Day Review 2026-05-07",
          type: "daily_close",
        },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("completes a ready day, persists carry-forward links, stores a report snapshot, and records audit events", async () => {
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
          completedByStaffProfileId: "staff-manager-1",
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
    const reportSnapshot =
      result.kind === "ok" ? result.data.dailyClose.reportSnapshot : null;
    expect(reportSnapshot).toMatchObject({
      closeMetadata: {
        completedAt: Date.UTC(2026, 4, 7, 22),
        completedByStaffProfileId: "staff-manager-1",
        completedByUserId: "user-1",
        notes: "Close reviewed.",
        operatingDate: "2026-05-07",
        organizationId: "org-1",
        storeId: "store-1",
      },
      readiness: {
        carryForwardCount: 2,
        status: "ready",
      },
      summary: {
        carryForwardWorkItemCount: 2,
        salesTotal: 12000,
        transactionCount: 1,
      },
    });
    expect(reportSnapshot?.readyItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "pos_transaction:txn-1:completed",
          metadata: expect.objectContaining({
            total: 12000,
            transaction: "TXN-1",
          }),
        }),
      ]),
    );
    expect(reportSnapshot?.carryForwardItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "operational_work_item:work-existing:carry_forward",
          title: "Existing follow-up",
        }),
        expect.objectContaining({
          key: "operational_work_item:operationalWorkItem-2:carry_forward",
          title: "Count front display",
        }),
      ]),
    );
    await db.patch("posTransaction", "txn-1", {
      total: 99000,
      transactionNumber: "MUTATED",
    });
    const detail = await getCompletedDailyCloseHistoryDetailWithCtx(
      { db } as unknown as QueryCtx,
      {
        dailyCloseId:
          result.kind === "ok"
            ? (result.data.dailyClose._id as Id<"dailyClose">)
            : ("missing" as Id<"dailyClose">),
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(detail?.reportSnapshot.readyItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "pos_transaction:txn-1:completed",
          metadata: expect.objectContaining({
            total: 12000,
            transaction: "TXN-1",
          }),
        }),
      ]),
    );
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
      actorStaffProfileId: "staff-manager-1",
      eventType: "daily_close_completed",
      subjectType: "daily_close",
      metadata: {
        approvalProofId: "approval-proof-1",
        approvedByStaffProfileId: "staff-manager-1",
      },
    });
  });

  it("requires manager approval and a reason before reopening a completed daily close", async () => {
    const { db, inserts } = createDb({
      dailyClose: [completedDailyCloseRow()],
    });

    await expect(
      reopenDailyCloseWithCtx({ db } as unknown as MutationCtx, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        reason: "  ",
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "A reopen reason is required.",
      },
    });

    const result = await reopenDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        reason: "Late cash sale was missed.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "approval_required",
      approval: {
        action: {
          key: "operations.daily_close.reopen",
          label: "Reopen End-of-Day Review",
        },
        copy: {
          message:
            "A manager needs to approve reopening this End-of-Day Review before the operating day can be revised.",
          primaryActionLabel: "Approve and reopen",
          secondaryActionLabel: "Cancel",
          title: "Manager approval required",
        },
        metadata: {
          dailyCloseId: "daily-close-1",
          operatingDate: "2026-05-07",
        },
        reason: "Manager approval is required to reopen End-of-Day Review.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        selfApproval: "allowed",
        subject: {
          id: "daily-close-1",
          label: "End-of-Day Review 2026-05-07",
          type: "daily_close",
        },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("reopens a completed close without mutating its report snapshot and makes live readiness active", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 10));
    const originalSnapshot = completedDailyCloseSnapshot();
    const { db, inserts, tables } = createDb({
      approvalProof: [dailyCloseReopenApprovalProof()],
      dailyClose: [
        completedDailyCloseRow({ reportSnapshot: originalSnapshot }),
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
          _id: "txn-late",
          completedAt: Date.UTC(2026, 4, 7, 19),
          payments: [{ amount: 5000, method: "cash", timestamp: 1 }],
          status: "completed",
          storeId: "store-1",
          subtotal: 5000,
          tax: 0,
          total: 5000,
          totalPaid: 5000,
          transactionNumber: "TXN-LATE",
        },
      ],
      store: [store],
    });

    const result = await reopenDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId: "approval-proof-reopen-1" as Id<"approvalProof">,
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        reason: "Late cash sale was missed.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "reopened",
        originalDailyClose: {
          _id: "daily-close-1",
          isCurrent: false,
          lifecycleStatus: "reopened",
          reportSnapshot: originalSnapshot,
          reopenReason: "Late cash sale was missed.",
          status: "completed",
        },
        reopenedDailyClose: {
          isCurrent: true,
          lifecycleStatus: "active",
          reopenedFromDailyCloseId: "daily-close-1",
          status: "open",
          supersedesDailyCloseId: "daily-close-1",
        },
      },
    });
    expect(
      tables.get("dailyClose")?.get("daily-close-1")?.reportSnapshot,
    ).toEqual(originalSnapshot);

    await db.patch("posTransaction", "txn-1", {
      total: 99000,
      transactionNumber: "MUTATED",
    });
    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(snapshot.status).toBe("ready");
    expect(snapshot.existingClose?.status).toBe("open");
    expect(snapshot.completedClose).toBeNull();
    expect(snapshot.readyItems.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "pos_transaction:txn-1:completed",
        "pos_transaction:txn-late:completed",
      ]),
    );

    const detail = await getCompletedDailyCloseHistoryDetailWithCtx(
      { db } as unknown as QueryCtx,
      {
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(detail?.reportSnapshot).toEqual(originalSnapshot);
    expect(inserts.map((insert) => insert.table)).toEqual([
      "operationalEvent",
      "dailyClose",
      "operationalEvent",
    ]);
    expect(
      inserts.find(
        (insert) =>
          insert.table === "operationalEvent" &&
          insert.value.eventType === "daily_close_reopened",
      )?.value,
    ).toMatchObject({
      actorStaffProfileId: "staff-manager-1",
      metadata: {
        approvalProofId: "approval-proof-reopen-1",
        reason: "Late cash sale was missed.",
        reopenedDailyCloseId: "dailyClose-2",
      },
    });
  });

  it("returns the existing reopened close when reopen is retried", async () => {
    const { db, inserts } = createDb({
      dailyClose: [
        completedDailyCloseRow({
          isCurrent: false,
          lifecycleStatus: "reopened",
          reopenedAt: Date.UTC(2026, 4, 8, 10),
          supersededByDailyCloseId: "daily-close-reopened",
        }),
        {
          ...completedDailyCloseRow({
            _id: "daily-close-reopened",
            completedAt: undefined,
            completedByStaffProfileId: undefined,
            completedByUserId: undefined,
            isCurrent: true,
            lifecycleStatus: "active",
            reopenedFromDailyCloseId: "daily-close-1",
            reportSnapshot: undefined,
            status: "open",
            supersedesDailyCloseId: "daily-close-1",
          }),
        },
      ],
    });

    const result = await reopenDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-reopen-1" as Id<"approvalProof">,
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        reason: "Late cash sale was missed.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "already_reopened",
        originalDailyClose: {
          _id: "daily-close-1",
          lifecycleStatus: "reopened",
          status: "completed",
        },
        reopenedDailyClose: {
          _id: "daily-close-reopened",
          lifecycleStatus: "active",
          reopenedFromDailyCloseId: "daily-close-1",
          status: "open",
        },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("supersedes the original completed close when a reopened close is completed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 11));
    const { db, tables } = createDb({
      approvalProof: [
        dailyCloseApprovalProof({
          _id: "approval-proof-complete-reopened",
          expiresAt: Date.UTC(2026, 4, 8, 12),
        }),
      ],
      dailyClose: [
        completedDailyCloseRow({
          isCurrent: false,
          lifecycleStatus: "reopened",
          supersededByDailyCloseId: "daily-close-reopened",
        }),
        {
          ...completedDailyCloseRow({
            _id: "daily-close-reopened",
            completedAt: undefined,
            completedByStaffProfileId: undefined,
            completedByUserId: undefined,
            isCurrent: true,
            lifecycleStatus: "active",
            reopenedFromDailyCloseId: "daily-close-1",
            reportSnapshot: undefined,
            status: "open",
            supersedesDailyCloseId: "daily-close-1",
          }),
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
        approvalProofId:
          "approval-proof-complete-reopened" as Id<"approvalProof">,
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        dailyClose: {
          _id: "daily-close-reopened",
          lifecycleStatus: "active",
          status: "completed",
          supersedesDailyCloseId: "daily-close-1",
        },
      },
    });
    expect(tables.get("dailyClose")?.get("daily-close-1")).toMatchObject({
      lifecycleStatus: "superseded",
      isCurrent: false,
      supersededByDailyCloseId: "daily-close-reopened",
      reportSnapshot: completedDailyCloseSnapshot(),
      status: "completed",
    });
  });

  it("lists completed daily close history for a store newest first and returns snapshot-backed detail", async () => {
    const completedSnapshot = {
      closeMetadata: {
        completedAt: Date.UTC(2026, 4, 8, 22),
        completedByStaffProfileId: "staff-1",
        completedByUserId: "user-1",
        notes: "May 8 reviewed.",
        operatingDate: "2026-05-08",
        organizationId: "org-1",
        storeId: "store-1",
      },
      readiness: {
        blockerCount: 0,
        carryForwardCount: 1,
        readyCount: 2,
        reviewCount: 0,
        status: "ready",
      },
      summary: {
        expenseTotal: 5000,
        netCashVariance: 0,
        salesTotal: 24000,
        transactionCount: 3,
      },
      reviewedItems: [],
      carryForwardItems: [
        {
          key: "operational_work_item:work-1:carry_forward",
          severity: "carry_forward",
          category: "open_work",
          title: "Carry forward",
          message:
            "Open operational work will carry forward after End-of-Day Review.",
          subject: {
            id: "work-1",
            label: "Carry forward",
            type: "operational_work_item",
          },
        },
      ],
      readyItems: [
        {
          key: "pos_transaction:txn-2:completed",
          severity: "ready",
          category: "sales",
          title: "Completed transaction",
          message: "Transaction included in End-of-Day Review.",
          subject: {
            id: "txn-2",
            label: "TXN-2",
            type: "pos_transaction",
          },
          metadata: {
            total: 24000,
            transaction: "TXN-2",
          },
        },
      ],
      sourceSubjects: [
        {
          id: "txn-2",
          label: "TXN-2",
          type: "pos_transaction",
        },
      ],
    };
    const { db } = createDb({
      dailyClose: [
        {
          _id: "daily-close-new",
          carryForwardWorkItemIds: ["work-1"],
          completedAt: Date.UTC(2026, 4, 8, 22),
          completedByStaffProfileId: "staff-1",
          completedByUserId: "user-1",
          createdAt: Date.UTC(2026, 4, 8, 22),
          isCurrent: true,
          operatingDate: "2026-05-08",
          organizationId: "org-1",
          readiness: completedSnapshot.readiness,
          reportSnapshot: completedSnapshot,
          sourceSubjects: completedSnapshot.sourceSubjects,
          status: "completed",
          storeId: "store-1",
          summary: completedSnapshot.summary,
          updatedAt: Date.UTC(2026, 4, 8, 22),
        },
        {
          _id: "daily-close-old",
          carryForwardWorkItemIds: [],
          completedAt: Date.UTC(2026, 4, 7, 22),
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
          reportSnapshot: {
            ...completedSnapshot,
            closeMetadata: {
              ...completedSnapshot.closeMetadata,
              completedAt: Date.UTC(2026, 4, 7, 22),
              operatingDate: "2026-05-07",
            },
            summary: { salesTotal: 10000, transactionCount: 1 },
          },
          sourceSubjects: [],
          status: "completed",
          storeId: "store-1",
          summary: { salesTotal: 10000, transactionCount: 1 },
          updatedAt: Date.UTC(2026, 4, 7, 22),
        },
        {
          _id: "daily-close-open",
          carryForwardWorkItemIds: [],
          createdAt: Date.UTC(2026, 4, 9, 22),
          isCurrent: true,
          operatingDate: "2026-05-09",
          organizationId: "org-1",
          readiness: {
            blockerCount: 0,
            carryForwardCount: 0,
            readyCount: 0,
            reviewCount: 0,
            status: "ready",
          },
          sourceSubjects: [],
          status: "open",
          storeId: "store-1",
          summary: {},
          updatedAt: Date.UTC(2026, 4, 9, 22),
        },
        {
          _id: "daily-close-other-store",
          carryForwardWorkItemIds: [],
          completedAt: Date.UTC(2026, 4, 9, 22),
          createdAt: Date.UTC(2026, 4, 9, 22),
          isCurrent: true,
          operatingDate: "2026-05-09",
          organizationId: "org-1",
          readiness: completedSnapshot.readiness,
          reportSnapshot: {
            ...completedSnapshot,
            closeMetadata: {
              ...completedSnapshot.closeMetadata,
              operatingDate: "2026-05-09",
              storeId: "store-2",
            },
          },
          sourceSubjects: [],
          status: "completed",
          storeId: "store-2",
          summary: { salesTotal: 99999 },
          updatedAt: Date.UTC(2026, 4, 9, 22),
        },
      ],
      operationalEvent: [
        {
          _id: "event-old-complete",
          createdAt: Date.UTC(2026, 4, 7, 22),
          eventType: "daily_close_completed",
          message: "End-of-Day Review completed for 2026-05-07.",
          metadata: {
            approvedByStaffProfileId: "staff-manager-1",
          },
          organizationId: "org-1",
          storeId: "store-1",
          subjectId: "daily-close-old",
          subjectLabel: "End-of-Day Review 2026-05-07",
          subjectType: "daily_close",
        },
      ],
      staffProfile: [
        {
          _id: "staff-1",
          firstName: "Ama",
          fullName: "Ama Mensah",
          lastName: "Mensah",
          organizationId: "org-1",
          status: "active",
          storeId: "store-1",
        },
        {
          _id: "staff-manager-1",
          firstName: "Kwamina",
          fullName: "Kwamina Mensah",
          lastName: "Mensah",
          organizationId: "org-1",
          status: "active",
          storeId: "store-1",
        },
      ],
    });

    const history = await listCompletedDailyCloseHistoryWithCtx(
      { db } as unknown as QueryCtx,
      { limit: 10, storeId: "store-1" as Id<"store"> },
    );

    expect(history.map((record) => record.dailyCloseId)).toEqual([
      "daily-close-new",
      "daily-close-old",
    ]);
    expect(history[0]).toMatchObject({
      carryForwardCount: 1,
      completedAt: Date.UTC(2026, 4, 8, 22),
      completedByStaffName: "Ama Mensah",
      completedByStaffProfileId: "staff-1",
      operatingDate: "2026-05-08",
      readinessStatus: "ready",
      summary: {
        expenseTotal: 5000,
        netCashVariance: 0,
        salesTotal: 24000,
        transactionCount: 3,
      },
    });
    expect(history[1]).toMatchObject({
      completedByStaffName: "Kwamina Mensah",
      completedByStaffProfileId: "staff-manager-1",
      operatingDate: "2026-05-07",
    });

    const detail = await getCompletedDailyCloseHistoryDetailWithCtx(
      { db } as unknown as QueryCtx,
      {
        dailyCloseId: "daily-close-new" as Id<"dailyClose">,
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(detail).toMatchObject({
      completedByStaffName: "Ama Mensah",
      completedByStaffProfileId: "staff-1",
      dailyCloseId: "daily-close-new",
      operatingDate: "2026-05-08",
      reportSnapshot: completedSnapshot,
    });
    await expect(
      getCompletedDailyCloseHistoryDetailWithCtx(
        { db } as unknown as QueryCtx,
        {
          dailyCloseId: "daily-close-old" as Id<"dailyClose">,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).resolves.toMatchObject({
      completedByStaffName: "Kwamina Mensah",
      completedByStaffProfileId: "staff-manager-1",
    });
    await expect(
      getCompletedDailyCloseHistoryDetailWithCtx(
        { db } as unknown as QueryCtx,
        {
          dailyCloseId: "daily-close-open" as Id<"dailyClose">,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).resolves.toBeNull();
    await expect(
      getCompletedDailyCloseHistoryDetailWithCtx(
        { db } as unknown as QueryCtx,
        {
          dailyCloseId: "daily-close-other-store" as Id<"dailyClose">,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).resolves.toBeNull();
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
