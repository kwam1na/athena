import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import * as sharedDemoActor from "../sharedDemo/actor";
const reportingIngressMocks = vi.hoisted(() => ({
  appendReportingIngressWithCtx: vi.fn(),
}));

vi.mock("../reporting/ingress", () => ({
  appendReportingIngressWithCtx:
    reportingIngressMocks.appendReportingIngressWithCtx,
}));
import {
  buildDailyCloseSnapshotWithCtx,
  buildDailyCloseLifecycleGateWithCtx,
  completeDailyClose,
  completeDailyCloseForAutomationWithCtx,
  completeDailyCloseWithCtx,
  getCompletedDailyCloseHistoryDetailWithCtx,
  getDailyCloseSnapshot,
  getDailyCloseOpeningContext,
  getDailyCloseOpeningContextWithCtx,
  getDailyCloseLifecycleGate,
  listCompletedDailyCloseHistoryWithCtx,
  resolveDailyCloseCarryForward,
  resolveDailyCloseCarryForwardWithCtx,
  reopenDailyClose,
  reopenDailyCloseWithCtx,
} from "./dailyClose";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));
vi.mock("../sharedDemo/actor", () => ({
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
  requireSharedDemoStoreReadIfApplicable: vi.fn(),
}));

type TableName =
  | "approvalProof"
  | "approvalRequest"
  | "athenaUser"
  | "automationRun"
  | "dailyClose"
  | "dailyOpening"
  | "expenseSession"
  | "expenseTransaction"
  | "expenseTransactionItem"
  | "operationalEvent"
  | "operationalWorkItem"
  | "oversizedOperationalWorkRepair"
  | "paymentAllocation"
  | "posSession"
  | "posTerminal"
  | "posTransactionAdjustment"
  | "posTransaction"
  | "posTransactionItem"
  | "registerSession"
  | "staffProfile"
  | "store";

type Row = Record<string, unknown> & { _id: string };

function getHandler<TArgs, TResult>(definition: unknown) {
  return (definition as { _handler: (ctx: unknown, args: TArgs) => TResult })
    ._handler;
}

function compareIndexedValue(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

function createDb(seed: Partial<Record<TableName, Row[]>> = {}) {
  const tables = new Map<TableName, Map<string, Row>>();
  const inserts: Array<{ table: TableName; value: Row }> = [];
  const patches: Array<{
    id: string;
    table: TableName;
    value: Record<string, unknown>;
  }> = [];
  const queryLog: Array<{
    filters: Array<
      [string, unknown | { gte?: unknown; lt?: unknown; lte?: unknown }]
    >;
    index: string;
    table: TableName;
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
      [string, unknown | { gte?: unknown; lt?: unknown; lte?: unknown }]
    > = [];
    let sortDirection: "asc" | "desc" = "asc";
    const filteredRows = () => {
      const rows = Array.from(tableFor(table).values()).filter((row) =>
        filters.every(([field, value]) => {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            if (
              "gte" in value &&
              value.gte !== undefined &&
              compareIndexedValue(row[field], value.gte) < 0
            ) {
              return false;
            }

            if (
              "lt" in value &&
              value.lt !== undefined &&
              compareIndexedValue(row[field], value.lt) >= 0
            ) {
              return false;
            }

            if (
              "lte" in value &&
              value.lte !== undefined &&
              compareIndexedValue(row[field], value.lte) > 0
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
      async *[Symbol.asyncIterator]() {
        for (const row of filteredRows()) {
          yield row;
        }
      },
      withIndex(
        index: string,
        applyIndex: (builder: {
          eq: (field: string, value: unknown) => typeof builder;
          gte: (field: string, value: unknown) => typeof builder;
          lt: (field: string, value: unknown) => typeof builder;
          lte: (field: string, value: unknown) => typeof builder;
        }) => unknown,
      ) {
        const indexFilters: Array<
          [string, unknown | { gte?: unknown; lt?: unknown; lte?: unknown }]
        > = [];
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            indexFilters.push([field, value]);
            return builder;
          },
          gte(field: string, value: unknown) {
            filters.push([field, { gte: value }]);
            indexFilters.push([field, { gte: value }]);
            return builder;
          },
          lt(field: string, value: unknown) {
            filters.push([field, { lt: value }]);
            indexFilters.push([field, { lt: value }]);
            return builder;
          },
          lte(field: string, value: unknown) {
            filters.push([field, { lte: value }]);
            indexFilters.push([field, { lte: value }]);
            return builder;
          },
        };

        applyIndex(builder);
        queryLog.push({ filters: indexFilters, index, table });
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

  return { db, inserts, patches, queryLog, tables };
}

const store = {
  _id: "store-1",
  createdByUserId: "user-1",
  currency: "GHS",
  name: "Accra",
  organizationId: "org-1",
  slug: "accra",
};

const eodAutoCompletePolicy = {
  cleanDayAutoCompleteEnabled: true,
  maxAbsoluteCashVariance: 500,
  maxVoidedSaleCount: 2,
  maxVoidedSaleTotal: 1000,
};

function openOperationalWorkItems(
  count: number,
  status: "open" | "in_progress",
) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `work-source-boundary-${status}-${index + 1}`,
    approvalState: "not_required",
    createdAt: Date.UTC(2026, 4, 7, 12, index % 60),
    metadata: { serviceCaseId: `case-${status}-${index + 1}` },
    organizationId: "org-1",
    priority: "normal",
    status,
    storeId: "store-1",
    title: `Follow up ${index + 1}`,
    type: "service_case",
  }));
}

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
    subjectLabel: "EOD Review 2026-05-07",
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
    subjectLabel: "EOD Review 2026-05-07",
    subjectType: "daily_close",
    ...overrides,
  };
}

function dailyCloseCarryForwardApprovalProof(
  overrides: Partial<Row> = {},
): Row {
  return {
    _id: "approval-proof-carry-forward-1",
    actionKey: "operations.daily_close.resolve_carry_forward",
    approvedByCredentialId: "credential-manager-1",
    approvedByStaffProfileId: "staff-manager-1",
    createdAt: Date.UTC(2026, 4, 8, 10),
    expiresAt: Date.UTC(2026, 4, 8, 12),
    requiredRole: "manager",
    requestedByStaffProfileId: "staff-1",
    storeId: "store-1",
    subjectId: "daily-close-1:customer-follow-up:completed",
    subjectLabel: "Carry-forward follow-up for EOD Review 2026-05-07",
    subjectType: "daily_close_carry_forward",
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
        message: "Completed sale is included in the end of day review.",
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

function mockDailyCloseSnapshotAccess(role: "full_admin" | "pos_only") {
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
    _id: `member-${role}` as Id<"organizationMember">,
    organizationId: "org-1" as Id<"organization">,
    role,
    userId: "user-1" as Id<"athenaUser">,
  });
}

describe("end-of-day review backend foundation", () => {
  beforeEach(() => {
    reportingIngressMocks.appendReportingIngressWithCtx.mockResolvedValue({
      ingressId: "reporting-ingress-1",
      kind: "appended",
    });
  });

  afterEach(() => {
    reportingIngressMocks.appendReportingIngressWithCtx.mockClear();
    vi.restoreAllMocks();
  });

  it("reads only the current store-day close lifecycle for the POS gate", async () => {
    const { db, queryLog } = createDb({
      dailyClose: [
        completedDailyCloseRow({
          operatingDate: "2026-05-08",
        }),
      ],
      store: [store],
    });

    const gate = await buildDailyCloseLifecycleGateWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(gate).toEqual({
      existingClose: { lifecycleStatus: "active" },
      operatingDate: "2026-05-08",
      status: "completed",
      storeId: "store-1",
    });
    expect(queryLog).toEqual([
      expect.objectContaining({
        index: "by_storeId_operatingDate_lifecycleStatus",
        table: "dailyClose",
      }),
    ]);
  });

  it("treats an active reopened close as open without consulting superseded history", async () => {
    const { db, queryLog } = createDb({
      dailyClose: [
        completedDailyCloseRow({
          lifecycleStatus: "reopened",
          operatingDate: "2026-05-08",
          supersededByDailyCloseId: "daily-close-reopened",
        }),
        {
          ...completedDailyCloseRow({
            _id: "daily-close-reopened",
            operatingDate: "2026-05-08",
          }),
          lifecycleStatus: "active",
          reopenedFromDailyCloseId: "daily-close-1",
          status: "open",
        },
      ],
      store: [store],
    });

    const gate = await buildDailyCloseLifecycleGateWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(gate).toEqual({
      existingClose: { lifecycleStatus: "reopened" },
      operatingDate: "2026-05-08",
      status: "ready",
      storeId: "store-1",
    });
    expect(queryLog).toHaveLength(1);
  });

  it("preserves POS-only authorization on the narrow lifecycle query", async () => {
    mockDailyCloseSnapshotAccess("pos_only");
    const { db } = createDb({ store: [store] });

    const gate = await getHandler(getDailyCloseLifecycleGate)(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(gate).toEqual({
      existingClose: null,
      operatingDate: "2026-05-08",
      status: "ready",
      storeId: "store-1",
    });
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowedRoles: ["full_admin", "pos_only"] }),
    );
  });

  it("loads the lifecycle gate through the demo daily-operations boundary", async () => {
    mockDailyCloseSnapshotAccess("full_admin");
    vi.mocked(
      sharedDemoActor.requireSharedDemoStoreReadIfApplicable,
    ).mockResolvedValueOnce({
      athenaUserId: "user-1",
      kind: "shared_demo",
      storeId: "store-1",
    } as never);
    const { db } = createDb({
      athenaUser: [{ _id: "user-1", email: "demo@athena.invalid" }],
      store: [store],
    });
    const ctx = { db } as unknown as QueryCtx;

    await getHandler(getDailyCloseLifecycleGate)(ctx, {
      operatingDate: "2026-05-08",
      storeId: "store-1" as Id<"store">,
    });

    expect(
      sharedDemoActor.requireSharedDemoStoreReadIfApplicable,
    ).toHaveBeenCalledWith(ctx, "store-1");
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
  });

  it("keeps daily close command results aligned with exported return validators", () => {
    expect(() =>
      assertConformsToExportedReturns(completeDailyClose, {
        kind: "user_error",
        error: {
          code: "precondition_failed",
          message: "EOD Review cannot be completed while blocker items remain.",
          metadata: { blockerCount: 1 },
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertConformsToExportedReturns(completeDailyClose, {
        kind: "ok",
        data: {
          dailyCloseId: "daily-close-1",
          operatingDate: "2026-05-07",
          status: "completed",
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertConformsToExportedReturns(reopenDailyClose, {
        kind: "approval_required",
        approval: {
          action: {
            key: "operations.daily_close.reopen",
            label: "Reopen EOD Review",
          },
          copy: {
            message:
              "A manager needs to approve reopening this EOD Review before the operating day can be revised.",
            primaryActionLabel: "Approve and reopen",
            secondaryActionLabel: "Cancel",
            title: "Manager approval required",
          },
          metadata: {
            dailyCloseId: "daily-close-1",
            operatingDate: "2026-05-07",
          },
          reason: "Manager approval is required to reopen EOD Review.",
          requiredRole: "manager",
          resolutionModes: [{ kind: "inline_manager_proof" }],
          selfApproval: "allowed",
          subject: {
            id: "daily-close-1",
            label: "EOD Review 2026-05-07",
            type: "daily_close",
          },
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertConformsToExportedReturns(reopenDailyClose, {
        kind: "ok",
        data: {
          dailyCloseId: "daily-close-1",
          operatingDate: "2026-05-07",
          status: "reopened",
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertConformsToExportedReturns(resolveDailyCloseCarryForward, {
        kind: "ok",
        data: {
          action: "completed",
          operationalEventId: "event-1",
          workItem: {
            _creationTime: 1,
            _id: "work-item-1",
            organizationId: "org-1",
            status: "completed",
            storeId: "store-1",
            title: "Follow up with customer",
            type: "daily_close_carry_forward",
          },
        },
      }),
    ).not.toThrow();
  });

  it("derives public daily close completion requester user from auth instead of caller args", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "auth-user-1" as Id<"athenaUser">,
      email: "auth@wigclub.store",
    });
    const { db } = createDb({
      approvalProof: [dailyCloseApprovalProof()],
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

    const result = await getHandler(completeDailyClose)(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "spoofed-user" as Id<"athenaUser">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      } as never,
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyClose: {
          completedByUserId: "auth-user-1",
          completionRequestedByUserId: "auth-user-1",
        },
      },
    });
  });

  it("derives public daily close reopen requester user from auth instead of caller args", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 10));
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "auth-user-1" as Id<"athenaUser">,
      email: "auth@wigclub.store",
    });
    const { db } = createDb({
      approvalProof: [dailyCloseReopenApprovalProof()],
      dailyClose: [completedDailyCloseRow()],
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

    const result = await getHandler(reopenDailyClose)(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "spoofed-user" as Id<"athenaUser">,
        approvalProofId: "approval-proof-reopen-1" as Id<"approvalProof">,
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        reason: "Late cash sale was missed.",
        storeId: "store-1" as Id<"store">,
      } as never,
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        originalDailyClose: {
          reopenRequestedByUserId: "auth-user-1",
        },
        reopenedDailyClose: {
          reopenRequestedByUserId: "auth-user-1",
        },
      },
    });
  });

  it("includes the latest EOD automation preparation status when present", async () => {
    const { db } = createDb({
      automationRun: [
        {
          _id: "automation-run-eod",
          action: "eod.prepare",
          createdAt: Date.UTC(2026, 4, 7, 20),
          decisionReason: "EOD Review is ready for manager review.",
          domain: "daily_operations",
          idempotencyKey: "eod",
          mutationBoundary: "daily_close_review",
          operatingDate: "2026-05-07",
          outcome: "prepared",
          policyMode: "enabled",
          policyVersion: "automation-foundation.v1",
          snapshotCounts: {},
          sourceSubjects: [{ id: "store-1:2026-05-07", type: "daily_close" }],
          storeId: "store-1",
          triggerType: "scheduled",
          updatedAt: Date.UTC(2026, 4, 7, 20),
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.automationStatus).toEqual({
      decisionReason: "EOD Review is ready for manager review.",
      id: "automation-run-eod",
      occurredAt: Date.UTC(2026, 4, 7, 20),
      outcome: "prepared",
      policyMode: "enabled",
    });
    expect(snapshot.completedClose).toBeNull();
  });

  it("includes all closed register sessions for the day and records complete register source evidence", async () => {
    const registerSessions = Array.from({ length: 205 }, (_, index) => ({
      _id: `register-closed-${index + 1}`,
      closedAt: Date.UTC(2026, 4, 7, 18, index % 60),
      closeoutRecords: [
        {
          expectedCash: 10000 + index,
          occurredAt: Date.UTC(2026, 4, 7, 18, index % 60),
          type: "closed",
        },
      ],
      countedCash: 10000 + index,
      expectedCash: 10000 + index,
      openedAt: Date.UTC(2026, 4, 7, 9, index % 60),
      openingFloat: 10000,
      status: "closed",
      storeId: "store-1",
    }));
    const { db } = createDb({
      registerSession: registerSessions,
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.summary.closedRegisterSessionCount).toBe(205);
    expect(snapshot.readyItems).toHaveLength(205);
    expect(snapshot.sourceCompleteness.complete).toBe(true);
    expect(snapshot.sourceCompleteness.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          complete: true,
          readMode: "by_storeId_status_closeoutOperatingDate_missing",
          recordCount: 205,
          source: "register_session",
          statuses: ["closed"],
        }),
      ]),
    );
  });

  it("includes closed register sessions opened on the operating date even when closeout is assigned to the next day", async () => {
    const { db } = createDb({
      registerSession: [
        {
          _id: "same-day-closeout-register",
          closedAt: Date.UTC(2026, 5, 30, 18),
          closeoutOperatingDate: "2026-06-30",
          countedCash: 10500,
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 5, 30, 10),
          openedOperatingDate: "2026-06-30",
          openingFloat: 10000,
          status: "closed",
          storeId: "store-1",
          variance: 500,
        },
        {
          _id: "late-closeout-register",
          closedAt: Date.UTC(2026, 6, 1, 1),
          closeoutOperatingDate: "2026-07-01",
          countedCash: 24000,
          expectedCash: 22000,
          openedAt: Date.UTC(2026, 5, 30, 11),
          openedOperatingDate: "2026-06-30",
          openingFloat: 10000,
          status: "closed",
          storeId: "store-1",
          variance: 2000,
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-06-30", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.readyItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "register_session:same-day-closeout-register:closed",
        }),
        expect.objectContaining({
          key: "register_session:late-closeout-register:closed",
        }),
      ]),
    );
    expect(snapshot.summary).toMatchObject({
      closedRegisterSessionCount: 2,
      countedCashTotal: 34500,
      expectedCashTotal: 32000,
      netCashVariance: 2500,
      registerCount: 2,
      registerVarianceCount: 2,
    });
  });

  it("finds active register blockers after more than 1000 indexed historic register sessions", async () => {
    const historicSessions = Array.from({ length: 1000 }, (_, index) => ({
      _id: `historic-register-${index + 1}`,
      closedAt: Date.UTC(2026, 4, 6, 18, index % 60),
      closeoutOperatingDate: "2026-05-06",
      closeoutRecords: [
        {
          closedAt: Date.UTC(2026, 4, 6, 18, index % 60),
          countedCash: 10000,
          expectedCash: 10000,
          occurredAt: Date.UTC(2026, 4, 6, 18, index % 60),
          type: "closed",
        },
      ],
      countedCash: 10000,
      expectedCash: 10000,
      openedAt: Date.UTC(2026, 4, 6, 9, index % 60),
      openingFloat: 10000,
      status: "closed",
      storeId: "store-1",
    }));
    const { db } = createDb({
      registerSession: [
        ...historicSessions,
        {
          _id: "active-register-after-history",
          openedAt: Date.UTC(2026, 4, 7, 9),
          openedOperatingDate: "2026-05-07",
          openingFloat: 10000,
          status: "active",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.sourceCompleteness.complete).toBe(true);
    expect(snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "register_session:active-register-after-history:active",
        }),
      ]),
    );
  });

  it("keeps prior-day active register sessions blocking the target day until resolved", async () => {
    const { db } = createDb({
      registerSession: [
        {
          _id: "carried-active-register",
          openedAt: Date.UTC(2026, 4, 6, 20),
          openedOperatingDate: "2026-05-06",
          openingFloat: 10000,
          status: "active",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.sourceCompleteness.complete).toBe(true);
    expect(snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "register_session:carried-active-register:active",
        }),
      ]),
    );
  });

  it("does not mark source incomplete for many future active register sessions", async () => {
    const activeOtherDateSessions = Array.from(
      { length: 1000 },
      (_, index) => ({
        _id: `active-other-date-${index + 1}`,
        openedAt: Date.UTC(2026, 4, 8, 9, index % 60),
        openedOperatingDate: "2026-05-08",
        openingFloat: 10000,
        status: "active",
        storeId: "store-1",
      }),
    );
    const { db } = createDb({
      registerSession: [
        ...activeOtherDateSessions,
        {
          _id: "target-date-closed-register",
          closedAt: Date.UTC(2026, 4, 7, 18),
          closeoutOperatingDate: "2026-05-07",
          closeoutRecords: [
            {
              closedAt: Date.UTC(2026, 4, 7, 18),
              countedCash: 10000,
              expectedCash: 10000,
              occurredAt: Date.UTC(2026, 4, 7, 18),
              type: "closed",
            },
          ],
          countedCash: 10000,
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 7, 9),
          openedOperatingDate: "2026-05-07",
          openingFloat: 10000,
          status: "closed",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.sourceCompleteness.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          complete: true,
          readMode: "by_storeId_status_openedOperatingDate",
          recordCount: 0,
          statuses: ["active"],
        }),
      ]),
    );
    expect(snapshot.sourceCompleteness.complete).toBe(true);
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.summary.closedRegisterSessionCount).toBe(1);
  });

  it("finds review-only closeouts by closeout operating date when the drawer opened on a prior day", async () => {
    const { db } = createDb({
      registerSession: [
        {
          _id: "carried-rejected-closeout",
          closedAt: Date.UTC(2026, 4, 7, 18),
          closeoutOperatingDate: "2026-05-07",
          closeoutRecords: [
            {
              closedAt: Date.UTC(2026, 4, 7, 18),
              countedCash: 9000,
              expectedCash: 10000,
              occurredAt: Date.UTC(2026, 4, 7, 18),
              type: "closed",
            },
          ],
          countedCash: 9000,
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 6, 20),
          openedOperatingDate: "2026-05-06",
          openingFloat: 10000,
          status: "closeout_rejected",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "register_session:carried-rejected-closeout:closeout_rejected",
        }),
      ]),
    );
    expect(snapshot.sourceCompleteness.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          readMode: "by_storeId_status_closeoutOperatingDate",
          recordCount: 1,
          statuses: ["closeout_rejected"],
        }),
      ]),
    );
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
        {
          _id: "approval-prior-closeout",
          createdAt: Date.UTC(2026, 4, 6, 21),
          metadata: {
            countedCash: 1535,
            expectedCash: 1535,
            variance: 0,
          },
          notes: "Closeout submitted on its operating day.",
          registerSessionId: "register-prior-closeout",
          requestType: "variance_review",
          status: "pending",
          storeId: "store-1",
          subjectId: "register-prior-closeout",
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
      expenseTransactionItem: [
        {
          _id: "expense-1-item-1",
          costPrice: 1000,
          productId: "expense-product-1",
          productName: "Packing Paper",
          productSku: "PP-1",
          productSkuId: "expense-sku-1",
          quantity: 4,
          transactionId: "expense-1",
        },
        {
          _id: "expense-2-item-1",
          costPrice: 2500,
          productId: "expense-product-2",
          productName: "Carrier Bags",
          productSku: "CB-1",
          productSkuId: "expense-sku-2",
          quantity: 1,
          transactionId: "expense-2",
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
      posTransactionItem: [
        {
          _id: "txn-1-item-1",
          productId: "product-1",
          productName: "Lace Wig",
          productSku: "LW-1",
          productSkuId: "sku-1",
          quantity: 1,
          totalPrice: 7000,
          transactionId: "txn-1",
          unitPrice: 7000,
        },
        {
          _id: "txn-1-item-2",
          productId: "product-2",
          productName: "Wig Cap",
          productSku: "WC-1",
          productSkuId: "sku-2",
          quantity: 2,
          totalPrice: 5000,
          transactionId: "txn-1",
          unitPrice: 2500,
        },
        {
          _id: "txn-void-item-1",
          productId: "product-3",
          productName: "Closure Wig",
          productSku: "CW-1",
          productSkuId: "sku-3",
          quantity: 2,
          totalPrice: 5000,
          transactionId: "txn-void",
          unitPrice: 2500,
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
          _id: "register-prior-closeout",
          countedCash: 1535,
          expectedCash: 1535,
          managerApprovalRequestId: "approval-prior-closeout",
          openedAt: Date.UTC(2026, 4, 6, 10),
          openingFloat: 1535,
          registerNumber: "A0",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
          variance: 0,
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
    expect(snapshot.blockers.map((item) => item.key)).not.toContain(
      "approval_request:approval-prior-closeout:pending",
    );
    expect(snapshot.blockers.map((item) => item.key)).not.toContain(
      "register_session:register-prior-closeout:closing",
    );
    expect(snapshot.blockers[2].metadata).toMatchObject({
      openedAt: Date.UTC(2026, 4, 6, 20),
      openedForOperatingDate: false,
      operatingScope: "Carried over from prior day",
      register: "Register A1",
      terminal: "Front counter terminal",
    });
    expect(snapshot.blockers[1].metadata).toMatchObject({
      countedCash: 8000,
      expectedCash: 10000,
      openedAt: Date.UTC(2026, 4, 7, 10),
      openedBy: "Kofi Mensah",
      openedForOperatingDate: true,
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
      itemCount: 2,
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
      itemCount: 3,
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
        itemCount: 4,
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
      adjustedSalesTotal: 12000,
      adjustmentCashSettlementTotal: 0,
      adjustmentCollectionTotal: 0,
      adjustmentNetSettlementTotal: 0,
      adjustmentPaymentTotals: [],
      adjustmentRefundTotal: 0,
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
      paymentTotals: expect.arrayContaining([
        {
          amount: 9500,
          method: "cash",
          transactionCount: 1,
        },
        {
          amount: 2500,
          method: "mobile_money",
          transactionCount: 1,
        },
      ]),
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

  it("preserves active register blocker context on the exported snapshot query", async () => {
    mockDailyCloseSnapshotAccess("pos_only");
    const { db } = createDb({
      posTerminal: [
        {
          _id: "terminal-1",
          name: "Front counter terminal",
          storeId: "store-1",
        },
      ],
      registerSession: [
        {
          _id: "register-open",
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 7, 10),
          openingFloat: 10000,
          registerNumber: "A1",
          status: "open",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      ],
      store: [store],
    });
    const handler = getHandler<
      {
        operatingDate: string;
        storeId: Id<"store">;
      },
      Promise<Awaited<ReturnType<typeof buildDailyCloseSnapshotWithCtx>>>
    >(getDailyCloseSnapshot);

    const snapshot = await handler({ db } as unknown as QueryCtx, {
      operatingDate: "2026-05-07",
      storeId: "store-1" as Id<"store">,
    });

    expect(snapshot.blockers).toHaveLength(1);
    expect(snapshot.blockers[0]).toMatchObject({
      category: "register_session",
      key: "blocker:register_session:0",
      link: {
        label: "View session",
        params: { sessionId: "register-open" },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      metadata: {
        openedAt: Date.UTC(2026, 4, 7, 10),
        operatingScope: "Opened today",
        register: "Register A1",
        status: "open",
        terminal: "terminal-1",
      },
      subject: {
        id: "redacted",
        label: "Register A1",
        type: "register_session",
      },
      title: "Register session is still open",
    });
    expect(snapshot.blockers[0].metadata).not.toHaveProperty("expectedCash");
    expect(snapshot.blockers[0].metadata).not.toHaveProperty("countedCash");
    expect(snapshot.blockers[0].metadata).not.toHaveProperty("variance");
  });

  it("projects same-SKU inventory reviews as one EOD carry-forward group with complete alias membership", async () => {
    const syncedReview = (
      id: string,
      localTransactionId: string,
      createdAt: number,
    ) => ({
      _id: id,
      approvalState: "not_required",
      createdAt,
      metadata: {
        localRegisterSessionId: "register-local-1",
        localTransactionId,
        terminalId: "terminal-1",
      },
      organizationId: "org-1",
      priority: "high",
      productSkuId: "sku-1",
      status: "open",
      storeId: "store-1",
      title: "Review inventory for SKU 1",
      type: "synced_sale_inventory_review",
    });
    const { db } = createDb({
      operationalWorkItem: [
        syncedReview("work-1", "sale-1", 1),
        syncedReview("work-1-alias", "sale-1", 2),
        syncedReview("work-2", "sale-2", 3),
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.summary.openWorkItemCount).toBe(1);
    expect(snapshot.readiness.carryForwardCount).toBe(1);
    expect(snapshot.carryForwardItems).toEqual([
      expect.objectContaining({
        carryForwardWorkItemIds: ["work-1", "work-1-alias", "work-2"],
        metadata: expect.objectContaining({
          memberCount: 3,
          sourceCount: 2,
          type: "synced_sale_inventory_review",
        }),
        subject: expect.objectContaining({
          type: "logical_operational_work_group",
        }),
      }),
    ]);
  });

  it("keeps later same-SKU sales separate from frozen active-repair membership at EOD", async () => {
    const syncedReview = (id: string, localTransactionId: string) => ({
      _id: id,
      approvalState: "not_required",
      createdAt: 1,
      metadata: {
        localRegisterSessionId: "register-local-1",
        localTransactionId,
        terminalId: "terminal-1",
      },
      organizationId: "org-1",
      priority: "high",
      productSkuId: "sku-1",
      status: "open",
      storeId: "store-1",
      title: "Review inventory for SKU 1",
      type: "synced_sale_inventory_review",
    });
    const { db } = createDb({
      operationalWorkItem: [
        syncedReview("work-frozen", "sale-frozen"),
        syncedReview("work-frozen-alias", "sale-frozen"),
        syncedReview("work-later", "sale-later"),
      ],
      oversizedOperationalWorkRepair: [
        {
          _id: "repair-1",
          groupKey: "synced_sale_inventory_review:store-1:sku-1",
          sourceIdentities: [
            "synced_sale_inventory_review:store-1:terminal-1:register-local-1:sale-frozen",
          ],
          status: "running",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.summary.openWorkItemCount).toBe(2);
    expect(
      snapshot.carryForwardItems.map((item) => ({
        ids: item.carryForwardWorkItemIds,
        subjectId: item.subject.id,
      })),
    ).toEqual([
      {
        ids: ["work-frozen", "work-frozen-alias"],
        subjectId: "synced_sale_inventory_review:store-1:sku-1",
      },
      {
        ids: ["work-later"],
        subjectId: "synced_sale_inventory_review:store-1:sku-1:post_repair",
      },
    ]);
  });

  it("loads the EOD snapshot through the demo read boundary", async () => {
    mockDailyCloseSnapshotAccess("full_admin");
    vi.mocked(
      sharedDemoActor.requireSharedDemoStoreReadIfApplicable,
    ).mockResolvedValueOnce({
      athenaUserId: "user-1",
      kind: "shared_demo",
      storeId: "store-1",
    } as never);
    const { db } = createDb({
      athenaUser: [{ _id: "user-1", email: "demo@athena.invalid" }],
      store: [store],
    });
    const ctx = { db } as unknown as QueryCtx;

    await getHandler(getDailyCloseSnapshot)(ctx, {
      operatingDate: "2026-05-08",
      storeId: "store-1" as Id<"store">,
    });

    expect(
      sharedDemoActor.requireSharedDemoStoreReadIfApplicable,
    ).toHaveBeenCalledWith(ctx, "store-1");
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
  });

  it("returns financial metric amounts on the exported snapshot query for full admins", async () => {
    mockDailyCloseSnapshotAccess("full_admin");
    const completedAt = Date.UTC(2026, 5, 27, 14);
    const transactions = Array.from({ length: 7 }, (_, index) => {
      const isCash = index < 5;
      const total = (index + 1) * 1000;

      return {
        _id: `txn-${index + 1}`,
        completedAt: completedAt + index,
        payments: [
          {
            amount: total,
            method: isCash ? "cash" : "mobile_money",
            timestamp: completedAt + index,
          },
        ],
        status: "completed",
        storeId: "store-1",
        subtotal: total,
        tax: 0,
        total,
        totalPaid: total,
        transactionNumber: `TXN-${index + 1}`,
      };
    });
    const { db } = createDb({
      posTransaction: transactions,
      store: [store],
    });
    const handler = getHandler<
      {
        operatingDate: string;
        storeId: Id<"store">;
      },
      Promise<Awaited<ReturnType<typeof buildDailyCloseSnapshotWithCtx>>>
    >(getDailyCloseSnapshot);

    const snapshot = await handler({ db } as unknown as QueryCtx, {
      operatingDate: "2026-06-27",
      storeId: "store-1" as Id<"store">,
    });

    expect(snapshot.summary).toMatchObject({
      currentDayCashTotal: 15000,
      currentDayCashTransactionCount: 5,
      salesTotal: 28000,
      transactionCount: 7,
    });
    expect(snapshot.summary.paymentTotals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 15000,
          method: "cash",
          transactionCount: 5,
        }),
        expect.objectContaining({
          amount: 13000,
          method: "mobile_money",
          transactionCount: 2,
        }),
      ]),
    );
  });

  it("redacts completed automation review evidence on the exported snapshot query", async () => {
    mockDailyCloseSnapshotAccess("pos_only");
    const reportSnapshot = completedDailyCloseSnapshot({
      closeMetadata: {
        ...completedDailyCloseSnapshot().closeMetadata,
        actorType: "automation",
        automationDecisionReason: "Policy reviewed low-risk review evidence.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-1",
        carryForwardWorkItemIds: ["work-1"],
        policyReviewedItemKeys: ["pos_transaction:txn-void:void"],
      },
      readiness: {
        blockerCount: 0,
        carryForwardCount: 1,
        readyCount: 0,
        reviewCount: 1,
        status: "ready",
      },
      reviewedItems: [
        {
          key: "pos_transaction:txn-void:void",
          severity: "review",
          category: "voided_sale",
          title: "Voided sale",
          message: "Voided transaction reviewed by policy.",
          subject: {
            id: "txn-void",
            label: "TXN-VOID",
            type: "pos_transaction",
          },
          metadata: {
            total: 500,
            voidedAt: Date.UTC(2026, 4, 7, 15),
          },
        },
      ],
      carryForwardItems: [
        {
          key: "operational_work_item:work-1:carry_forward",
          severity: "carry_forward",
          category: "operational_work_item",
          title: "Call customer tomorrow",
          message: "Carry-forward work remains open.",
          subject: {
            id: "work-1",
            label: "Call customer tomorrow",
            type: "operational_work_item",
          },
          metadata: {
            workItemId: "work-1",
          },
        },
      ],
      readyItems: [],
      sourceSubjects: [
        {
          id: "txn-void",
          label: "TXN-VOID",
          type: "pos_transaction",
        },
      ],
    });
    const { db } = createDb({
      dailyClose: [
        completedDailyCloseRow({
          actorType: "automation",
          automationDecisionReason: "Policy reviewed low-risk review evidence.",
          automationPolicyVersion: "daily-close-auto-complete.v1",
          automationRunId: "automation-run-1",
          carryForwardWorkItemIds: ["work-1"],
          policyReviewedItemKeys: ["pos_transaction:txn-void:void"],
          readiness: reportSnapshot.readiness,
          reportSnapshot,
          sourceSubjects: reportSnapshot.sourceSubjects,
          summary: reportSnapshot.summary,
        }),
      ],
      store: [store],
    });
    const handler = getHandler<
      {
        operatingDate: string;
        storeId: Id<"store">;
      },
      Promise<Awaited<ReturnType<typeof buildDailyCloseSnapshotWithCtx>>>
    >(getDailyCloseSnapshot);

    const snapshot = await handler({ db } as unknown as QueryCtx, {
      operatingDate: "2026-05-07",
      storeId: "store-1" as Id<"store">,
    });

    expect(snapshot.completedClose).toMatchObject({
      actorType: "automation",
      restrictedDetailsRedacted: true,
    });
    expect(snapshot.completedClose).not.toHaveProperty(
      "policyReviewedItemKeys",
    );
    expect(snapshot.reviewItems).toEqual([
      expect.objectContaining({
        key: "review:voided_sale:0",
        metadata: {
          voidedAt: Date.UTC(2026, 4, 7, 15),
        },
        subject: expect.objectContaining({ id: "redacted" }),
      }),
    ]);
    expect(snapshot.reviewItems[0].metadata).not.toHaveProperty("total");
    expect(snapshot.carryForwardItems).toEqual([
      expect.objectContaining({
        key: "carry_forward:operational_work_item:0",
        metadata: {
          workItemId: "work-1",
        },
        subject: expect.objectContaining({ id: "redacted" }),
      }),
    ]);
    expect(snapshot.sourceSubjects).toEqual([]);
  });

  it("surfaces review-only closeouts as blockers without active or closed totals", async () => {
    const { db } = createDb({
      approvalRequest: [
        {
          _id: "approval-submitted",
          createdAt: Date.UTC(2026, 4, 7, 19),
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
      registerSession: [
        {
          _id: "register-rejected",
          countedCash: 8500,
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 7, 9),
          openingFloat: 10000,
          registerNumber: "A1",
          status: "closeout_rejected",
          storeId: "store-1",
          variance: -1500,
        },
        {
          _id: "register-submitted",
          countedCash: 9200,
          expectedCash: 10000,
          managerApprovalRequestId: "approval-submitted",
          openedAt: Date.UTC(2026, 4, 7, 10),
          openingFloat: 10000,
          registerNumber: "A2",
          status: "closing",
          storeId: "store-1",
          variance: -800,
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
      "approval_request:approval-submitted:pending",
      "register_session:register-rejected:closeout_rejected",
      "register_session:register-submitted:variance_review",
    ]);
    expect(snapshot.blockers.map((item) => item.key)).not.toContain(
      "register_session:register-submitted:closing",
    );
    expect(
      snapshot.blockers.find(
        (item) =>
          item.key === "register_session:register-rejected:closeout_rejected",
      ),
    ).toMatchObject({
      message:
        "Review or reopen the rejected register closeout before completing the end of day review.",
      metadata: {
        countedCash: 8500,
        expectedCash: 10000,
        status: "closeout_rejected",
        variance: -1500,
      },
      title: "Register closeout needs review",
    });
    expect(
      snapshot.blockers.find(
        (item) =>
          item.key === "register_session:register-submitted:variance_review",
      ),
    ).toMatchObject({
      message:
        "Resolve the submitted register closeout variance review before completing the end of day review.",
      metadata: {
        countedCash: 9200,
        expectedCash: 10000,
        status: "closing",
        variance: -800,
      },
      title: "Register closeout variance needs review",
    });
    expect(snapshot.summary).toMatchObject({
      closedRegisterSessionCount: 0,
      expectedCashTotal: 0,
      netCashVariance: 0,
      registerCount: 0,
      registerVarianceCount: 0,
    });
    expect(snapshot.readyItems.map((item) => item.key)).not.toContain(
      "register_session:register-rejected:closed",
    );
    expect(snapshot.readyItems.map((item) => item.key)).not.toContain(
      "register_session:register-submitted:closed",
    );
  });

  it("adds explicit applied item-adjustment settlement totals without changing original sale totals", async () => {
    const { db } = createDb({
      posTransaction: [
        {
          _id: "txn-1",
          changeGiven: 0,
          completedAt: Date.UTC(2026, 4, 7, 14),
          payments: [{ amount: 12000, method: "cash", timestamp: 1 }],
          registerSessionId: "register-1",
          status: "completed",
          storeId: "store-1",
          subtotal: 12000,
          tax: 0,
          total: 12000,
          totalPaid: 12000,
          transactionNumber: "TXN-1",
        },
        {
          _id: "txn-2",
          changeGiven: 0,
          completedAt: Date.UTC(2026, 4, 7, 15),
          payments: [{ amount: 10000, method: "card", timestamp: 1 }],
          registerSessionId: "register-1",
          status: "completed",
          storeId: "store-1",
          subtotal: 10000,
          tax: 0,
          total: 10000,
          totalPaid: 10000,
          transactionNumber: "TXN-2",
        },
      ],
      posTransactionAdjustment: [
        {
          _id: "adjustment-applied-refund",
          appliedAt: Date.UTC(2026, 4, 7, 16),
          correctedTotal: 9000,
          deltaTotal: -3000,
          originalTotal: 12000,
          transactionId: "txn-1",
          settlementAmount: 3000,
          settlementDirection: "refund",
          settlementMethod: "cash",
          status: "applied",
          storeId: "store-1",
          transactionNumber: "TXN-1",
        },
        {
          _id: "adjustment-applied-collection",
          appliedAt: Date.UTC(2026, 4, 7, 17),
          correctedTotal: 12500,
          deltaTotal: 2500,
          originalTotal: 10000,
          transactionId: "txn-2",
          settlementAmount: 2500,
          settlementDirection: "collect",
          settlementMethod: "mobile_money",
          status: "applied",
          storeId: "store-1",
          transactionNumber: "TXN-2",
        },
        {
          _id: "adjustment-pending",
          appliedAt: Date.UTC(2026, 4, 7, 18),
          correctedTotal: 15000,
          deltaTotal: 3000,
          originalTotal: 12000,
          transactionId: "txn-1",
          settlementAmount: 3000,
          settlementDirection: "collect",
          settlementMethod: "cash",
          status: "pending",
          storeId: "store-1",
          transactionNumber: "TXN-1",
        },
        {
          _id: "adjustment-rejected",
          appliedAt: Date.UTC(2026, 4, 7, 19),
          correctedTotal: 8000,
          deltaTotal: -2000,
          originalTotal: 10000,
          transactionId: "txn-2",
          settlementAmount: 2000,
          settlementDirection: "refund",
          settlementMethod: "card",
          status: "rejected",
          storeId: "store-1",
          transactionNumber: "TXN-2",
        },
        {
          _id: "adjustment-other-store",
          appliedAt: Date.UTC(2026, 4, 7, 16),
          correctedTotal: 1000,
          deltaTotal: -1000,
          originalTotal: 2000,
          transactionId: "txn-other-store",
          settlementAmount: 1000,
          settlementDirection: "refund",
          settlementMethod: "cash",
          status: "applied",
          storeId: "store-2",
          transactionNumber: "TXN-OTHER",
        },
        {
          _id: "adjustment-out-of-range",
          appliedAt: Date.UTC(2026, 4, 8, 2),
          correctedTotal: 1000,
          deltaTotal: -1000,
          originalTotal: 2000,
          transactionId: "txn-out-of-range",
          settlementAmount: 1000,
          settlementDirection: "refund",
          settlementMethod: "cash",
          status: "applied",
          storeId: "store-1",
          transactionNumber: "TXN-LATE",
        },
      ],
      registerSession: [
        {
          _id: "register-1",
          closedAt: Date.UTC(2026, 4, 7, 20),
          expectedCash: 19000,
          openedAt: Date.UTC(2026, 4, 7, 8),
          openingFloat: 10000,
          registerNumber: "A1",
          status: "closed",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.summary.salesTotal).toBe(22000);
    expect(snapshot.summary.paymentTotals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 12000, method: "cash" }),
        expect.objectContaining({ amount: 10000, method: "card" }),
      ]),
    );
    expect(snapshot.summary).toMatchObject({
      adjustedSalesTotal: 21500,
      adjustmentCashSettlementTotal: -3000,
      adjustmentCollectionTotal: 2500,
      adjustmentNetSettlementTotal: -500,
      adjustmentRefundTotal: 3000,
      itemAdjustmentCount: 2,
      netCashMovementTotal: 9000,
    });
    expect(snapshot.summary.adjustmentPaymentTotals).toEqual(
      expect.arrayContaining([
        {
          amount: -3000,
          method: "cash",
          transactionCount: 1,
        },
        {
          amount: 2500,
          method: "mobile_money",
          transactionCount: 1,
        },
      ]),
    );
    expect(snapshot.readyItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "pos_transaction_adjustment:adjustment-applied-refund:applied",
          metadata: expect.objectContaining({
            adjustedTotal: 9000,
            originalTotal: 12000,
            settlementAmount: -3000,
            settlementMethod: "Cash",
            transaction: "TXN-1",
          }),
          title: "Completed item adjustment",
        }),
        expect.objectContaining({
          key: "pos_transaction_adjustment:adjustment-applied-collection:applied",
          metadata: expect.objectContaining({
            adjustedTotal: 12500,
            originalTotal: 10000,
            settlementAmount: 2500,
            settlementMethod: "Mobile Money",
            transaction: "TXN-2",
          }),
        }),
      ]),
    );
    expect(snapshot.readyItems.map((item) => item.key)).not.toContain(
      "pos_transaction_adjustment:adjustment-pending:applied",
    );
    expect(snapshot.readyItems.map((item) => item.key)).not.toContain(
      "pos_transaction_adjustment:adjustment-rejected:applied",
    );
    expect(snapshot.readyItems.map((item) => item.key)).not.toContain(
      "pos_transaction_adjustment:adjustment-other-store:applied",
    );
    expect(snapshot.readyItems.map((item) => item.key)).not.toContain(
      "pos_transaction_adjustment:adjustment-out-of-range:applied",
    );
  });

  it("serves the persisted report snapshot for completed EOD Reviews", async () => {
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
                message: "Completed sale is included in the end of day review.",
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
          message: "EOD Review completed for 2026-05-08.",
          metadata: {
            approvedByStaffProfileId: "staff-manager-1",
          },
          organizationId: "org-1",
          storeId: "store-1",
          subjectId: "daily-close-1",
          subjectLabel: "EOD Review 2026-05-08",
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
        message: "EOD Review cannot be completed while blocker items remain.",
        metadata: { blockerCount: 1 },
      },
    });
    expect(() =>
      assertConformsToExportedReturns(completeDailyClose, result),
    ).not.toThrow();
    expect(inserts).toEqual([]);
    expect(
      reportingIngressMocks.appendReportingIngressWithCtx,
    ).not.toHaveBeenCalled();
  });

  it("requires manager approval before completing a review-only day", async () => {
    const { db, inserts } = createDb({
      posTransaction: [
        {
          _id: "txn-void",
          completedAt: Date.UTC(2026, 4, 7, 15),
          payments: [],
          status: "void",
          storeId: "store-1",
          subtotal: 500,
          tax: 0,
          total: 500,
          totalPaid: 500,
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
      kind: "approval_required",
      approval: {
        action: {
          key: "operations.daily_close.complete",
          label: "Complete EOD Review",
        },
      },
    });
    expect(inserts).toEqual([]);
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
          label: "Complete EOD Review",
        },
        copy: {
          message:
            "A manager needs to approve this end of day review before the operating day is saved.",
          primaryActionLabel: "Approve and complete",
          secondaryActionLabel: "Cancel",
          title: "Manager approval required",
        },
        metadata: {
          operatingDate: "2026-05-07",
        },
        reason: "Manager approval is required to complete EOD Review.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        selfApproval: "allowed",
        subject: {
          id: "store-1:2026-05-07",
          label: "EOD Review 2026-05-07",
          type: "daily_close",
        },
      },
    });
    expect(() =>
      assertConformsToExportedReturns(completeDailyClose, result),
    ).not.toThrow();
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
          completionApprovalProofId: "approval-proof-1",
          completionApprovedByStaffProfileId: "staff-manager-1",
          completionRequestedByStaffProfileId: "staff-1",
          completionRequestedByUserId: "user-1",
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
        completionApprovalProofId: "approval-proof-1",
        completionApprovedByStaffProfileId: "staff-manager-1",
        completionRequestedByStaffProfileId: "staff-1",
        completionRequestedByUserId: "user-1",
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
    const completedDailyCloseId =
      result.kind === "ok" ? result.data.dailyClose._id : null;
    expect(
      reportingIngressMocks.appendReportingIngressWithCtx,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acceptedAt: Date.UTC(2026, 4, 7, 22),
        adapterVersion: 1,
        businessEventKey: `daily_close:${completedDailyCloseId}:completed:v1`,
        closeSnapshot: {
          acceptedDeficitAdjustmentMinor: 0,
          acceptedNetSalesMinor: 12000,
          acceptedRefundsMinor: 0,
          completeness: "complete",
          snapshotVersion: 1,
        },
        contentFingerprint: expect.stringContaining('"salesTotal":12000'),
        currencyCode: "GHS",
        currencyMinorUnitScale: 2,
        netAmountMinor: 12000,
        occurredAt: Date.UTC(2026, 4, 8) - 1,
        sourceDomain: "daily_close",
        sourceEventType: "daily_close_completed",
        sourceReferences: [
          {
            relation: "owns",
            sourceId: completedDailyCloseId,
            sourceType: "daily_close",
          },
        ],
      }),
    );
    expect(
      vi.mocked(reportingIngressMocks.appendReportingIngressWithCtx).mock
        .calls[0]?.[1]?.contentFingerprint,
    ).toContain('"sourceCompleteness":{"complete":true');
    expect(
      inserts.find(
        (insert) =>
          insert.table === "operationalEvent" &&
          insert.value.eventType === "daily_close_completed",
      )?.value,
    ).toMatchObject({
      actorStaffProfileId: "staff-1",
      eventType: "daily_close_completed",
      subjectType: "daily_close",
      metadata: {
        approvalProofId: "approval-proof-1",
        approvedByStaffProfileId: "staff-manager-1",
        requestedByStaffProfileId: "staff-1",
        requestedByUserId: "user-1",
      },
    });
  });

  it("completes review-only days and records command-time review evidence", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const { db } = createDb({
      approvalProof: [dailyCloseApprovalProof()],
      posTransaction: [
        {
          _id: "txn-void",
          completedAt: Date.UTC(2026, 4, 7, 15),
          payments: [],
          status: "void",
          storeId: "store-1",
          subtotal: 500,
          tax: 0,
          total: 500,
          totalPaid: 500,
          transactionNumber: "TXN-2",
        },
      ],
      store: [store],
    });

    const result = await completeDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        operatingDate: "2026-05-07",
        reviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        dailyClose: {
          readiness: {
            reviewCount: 1,
            status: "needs_review",
          },
          reportSnapshot: {
            closeMetadata: {
              reviewedItemKeys: ["pos_transaction:txn-void:void"],
            },
            reviewedItems: [
              {
                key: "pos_transaction:txn-void:void",
              },
            ],
          },
          reviewedItemKeys: ["pos_transaction:txn-void:void"],
          status: "completed",
        },
      },
    });
    expect(() =>
      assertConformsToExportedReturns(completeDailyClose, result),
    ).not.toThrow();
  });

  it("freezes one versioned EOD group with every raw member and rejects partial selection", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const syncedReview = (id: string, localTransactionId: string) => ({
      _id: id,
      approvalState: "not_required",
      createdAt: id === "work-1" ? 1 : 2,
      metadata: {
        localRegisterSessionId: "register-local-1",
        localTransactionId,
        terminalId: "terminal-1",
      },
      organizationId: "org-1",
      priority: "high",
      productSkuId: "sku-1",
      status: "open",
      storeId: "store-1",
      title: "Review inventory for SKU 1",
      type: "synced_sale_inventory_review",
    });
    const { db, inserts } = createDb({
      approvalProof: [dailyCloseApprovalProof()],
      operationalWorkItem: [
        syncedReview("work-1", "sale-1"),
        syncedReview("work-2", "sale-2"),
      ],
      store: [store],
    });

    const partial = await completeDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        carryForwardWorkItemIds: ["work-1" as Id<"operationalWorkItem">],
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(partial).toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "Carry-forward work groups must be selected as one complete unit.",
      },
    });
    expect(inserts).toEqual([]);

    const result = await completeDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        carryForwardWorkItemIds: [
          "work-1" as Id<"operationalWorkItem">,
          "work-2" as Id<"operationalWorkItem">,
        ],
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyClose: {
          carryForwardWorkItemIds: ["work-1", "work-2"],
          readiness: { carryForwardCount: 1 },
          reportSnapshot: {
            snapshotContractVersion: 2,
            carryForwardGroups: [
              expect.objectContaining({
                memberCount: 2,
                memberWorkItemIds: ["work-1", "work-2"],
                type: "synced_sale_inventory_review",
              }),
            ],
            carryForwardItems: [
              expect.objectContaining({
                subject: expect.objectContaining({
                  type: "logical_operational_work_group",
                }),
              }),
            ],
          },
          summary: { openWorkItemCount: 1 },
        },
      },
    });

    if (result.kind !== "ok") throw new Error("Expected completed EOD Review");
    const broadDetail = await getCompletedDailyCloseHistoryDetailWithCtx(
      { db } as unknown as QueryCtx,
      {
        dailyCloseId: result.data.dailyClose._id,
        includeManagerReviewEvidence: false,
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(broadDetail?.reportSnapshot).not.toHaveProperty(
      "carryForwardGroups",
    );
    expect(
      broadDetail?.reportSnapshot.closeMetadata.carryForwardWorkItemIds,
    ).toEqual([]);
  });

  it("completes an open carry-forward close without duplicating preserved work", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const { db } = createDb({
      approvalProof: [dailyCloseApprovalProof()],
      dailyClose: [
        {
          _id: "daily-close-open",
          carryForwardWorkItemIds: ["work-existing"],
          createdAt: Date.UTC(2026, 4, 7, 20),
          isCurrent: true,
          operatingDate: "2026-05-07",
          organizationId: "org-1",
          readiness: {
            blockerCount: 0,
            carryForwardCount: 1,
            readyCount: 0,
            reviewCount: 0,
            status: "ready",
          },
          sourceSubjects: [],
          status: "open",
          storeId: "store-1",
          summary: {
            carryForwardWorkItemCount: 1,
          },
          updatedAt: Date.UTC(2026, 4, 7, 20),
        },
      ],
      operationalWorkItem: [
        {
          _id: "work-existing",
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
      store: [store],
    });

    const result = await completeDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        carryForwardWorkItemIds: [
          "work-existing" as Id<"operationalWorkItem">,
          "work-existing" as Id<"operationalWorkItem">,
        ],
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        carryForwardWorkItems: [
          {
            _id: "work-existing",
          },
        ],
        dailyClose: {
          _id: "daily-close-open",
          carryForwardWorkItemIds: ["work-existing"],
          readiness: {
            carryForwardCount: 1,
          },
          reportSnapshot: {
            carryForwardItems: [
              {
                key: "operational_work_item:work-existing:carry_forward",
              },
            ],
            closeMetadata: {
              carryForwardWorkItemIds: ["work-existing"],
            },
          },
          status: "completed",
          summary: {
            carryForwardWorkItemCount: 1,
          },
        },
      },
    });
    expect(() =>
      assertConformsToExportedReturns(completeDailyClose, result),
    ).not.toThrow();
  });

  it("requires source-bound manager proof before completing carry-forward work", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 10));
    const { db, inserts, patches, tables } = createDb({
      approvalProof: [dailyCloseCarryForwardApprovalProof()],
      dailyClose: [
        completedDailyCloseRow({
          carryForwardWorkItemIds: ["work-1"],
        }),
      ],
      dailyOpening: [
        {
          _id: "daily-opening-1",
          acknowledgedItemKeys: ["operational_work_item:work-1:carry_forward"],
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
          carryForwardWorkItemIds: ["work-1"],
          createdAt: Date.UTC(2026, 4, 8, 8),
          operatingDate: "2026-05-08",
          organizationId: "org-1",
          priorDailyCloseId: "daily-close-1",
          readiness: {
            blockerCount: 0,
            carryForwardCount: 1,
            readyCount: 1,
            reviewCount: 0,
            status: "needs_attention",
          },
          sourceSubjects: [
            {
              id: "work-1",
              label: "Call customer",
              type: "operational_work_item",
            },
          ],
          startedAt: Date.UTC(2026, 4, 8, 8),
          status: "started",
          storeId: "store-1",
          updatedAt: Date.UTC(2026, 4, 8, 8),
        },
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 4, 7, 20),
          metadata: {
            businessDate: "2026-05-07",
            carryForwardSourceId: "customer-follow-up",
            dailyCloseId: "daily-close-1",
            source: "daily_close",
          },
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer",
          type: "daily_close_carry_forward",
        },
      ],
      store: [store],
    });

    const proofRequired = await resolveDailyCloseCarryForwardWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        businessDate: "2026-05-07",
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        outcome: "completed",
        reason: "Customer follow-up completed.",
        sourceId: "customer-follow-up",
        storeId: "store-1" as Id<"store">,
        workItemId: "work-1" as Id<"operationalWorkItem">,
      },
    );

    expect(proofRequired).toMatchObject({
      kind: "approval_required",
      approval: {
        action: {
          key: "operations.daily_close.resolve_carry_forward",
        },
        subject: {
          id: "daily-close-1:customer-follow-up:completed",
          type: "daily_close_carry_forward",
        },
      },
    });
    expect(patches).toEqual([]);

    const result = await resolveDailyCloseCarryForwardWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId:
          "approval-proof-carry-forward-1" as Id<"approvalProof">,
        businessDate: "2026-05-07",
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        outcome: "completed",
        reason: "Customer follow-up completed.",
        sourceId: "customer-follow-up",
        storeId: "store-1" as Id<"store">,
        workItemId: "work-1" as Id<"operationalWorkItem">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        workItem: {
          _id: "work-1",
          status: "completed",
        },
      },
    });
    expect(() =>
      assertConformsToExportedReturns(resolveDailyCloseCarryForward, result),
    ).not.toThrow();
    expect(
      tables.get("approvalProof")?.get("approval-proof-carry-forward-1"),
    ).toMatchObject({
      consumedAt: Date.UTC(2026, 4, 8, 10),
    });
    expect(tables.get("operationalWorkItem")?.get("work-1")).toMatchObject({
      status: "completed",
      completedAt: Date.UTC(2026, 4, 8, 10),
      metadata: {
        carryForwardResolution: {
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
          approvalProofId: "approval-proof-carry-forward-1",
          approvedByStaffProfileId: "staff-manager-1",
          businessDate: "2026-05-07",
          dailyCloseId: "daily-close-1",
          handoff: {
            dailyOpeningIds: ["daily-opening-1"],
          },
          nextStatus: "completed",
          outcome: "completed",
          priorStatus: "open",
          reason: "Customer follow-up completed.",
          resolvedAt: Date.UTC(2026, 4, 8, 10),
          sourceId: "customer-follow-up",
        },
      },
    });
    expect(inserts.at(-1)).toMatchObject({
      table: "operationalEvent",
      value: {
        actorStaffProfileId: "staff-1",
        actorUserId: "user-1",
        eventType: "daily_close_carry_forward_completed",
        reason: "Customer follow-up completed.",
        subjectId: "work-1",
        subjectType: "daily_close_carry_forward",
        metadata: {
          approvalProofId: "approval-proof-carry-forward-1",
          approvedByStaffProfileId: "staff-manager-1",
          businessDate: "2026-05-07",
          dailyCloseId: "daily-close-1",
          handoff: {
            dailyOpeningIds: ["daily-opening-1"],
          },
          nextState: {
            status: "completed",
          },
          outcome: "completed",
          priorState: {
            status: "open",
          },
          sourceReference: {
            sourceId: "customer-follow-up",
            workItemId: "work-1",
          },
        },
      },
    });
  });

  it("resolves carry-forward work through the public mutation boundary", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 10));
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "user-1" as Id<"athenaUser">,
      email: "manager@wigclub.store",
    });
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({
      _creationTime: 0,
      _id: "member-1" as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role: "full_admin",
      userId: "user-1" as Id<"athenaUser">,
    });
    const { db, tables } = createDb({
      approvalProof: [
        dailyCloseCarryForwardApprovalProof({
          requestedByStaffProfileId: undefined,
        }),
      ],
      dailyClose: [
        completedDailyCloseRow({
          carryForwardWorkItemIds: ["work-1"],
        }),
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 4, 7, 20),
          metadata: {
            businessDate: "2026-05-07",
            carryForwardSourceId: "customer-follow-up",
            dailyCloseId: "daily-close-1",
            source: "daily_close",
          },
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer",
          type: "daily_close_carry_forward",
        },
      ],
      staffProfile: [
        {
          _id: "staff-1",
          linkedUserId: "user-1",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const result = await getHandler(resolveDailyCloseCarryForward)(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-spoof" as Id<"staffProfile">,
        approvalProofId:
          "approval-proof-carry-forward-1" as Id<"approvalProof">,
        businessDate: "2026-05-07",
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        outcome: "completed",
        reason: "Customer follow-up completed.",
        sourceId: "customer-follow-up",
        storeId: "store-1" as Id<"store">,
        workItemId: "work-1" as Id<"operationalWorkItem">,
      } as never,
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        workItem: {
          _id: "work-1",
          status: "completed",
        },
      },
    });
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "user-1",
      }),
    );
    expect(tables.get("operationalWorkItem")?.get("work-1")).toMatchObject({
      completedAt: Date.UTC(2026, 4, 8, 10),
      metadata: expect.objectContaining({
        carryForwardResolution: expect.objectContaining({
          actorStaffProfileId: "staff-1",
        }),
      }),
      status: "completed",
    });
  });

  it("rejects carry-forward resolution when manager proof is bound to another source", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 10));
    const { db, tables } = createDb({
      approvalProof: [
        dailyCloseCarryForwardApprovalProof({
          subjectId: "daily-close-1:other-source",
        }),
      ],
      dailyClose: [
        completedDailyCloseRow({
          carryForwardWorkItemIds: ["work-1"],
        }),
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 4, 7, 20),
          metadata: {
            businessDate: "2026-05-07",
            carryForwardSourceId: "customer-follow-up",
            dailyCloseId: "daily-close-1",
            source: "daily_close",
          },
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer",
          type: "daily_close_carry_forward",
        },
      ],
      store: [store],
    });

    const result = await resolveDailyCloseCarryForwardWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId:
          "approval-proof-carry-forward-1" as Id<"approvalProof">,
        businessDate: "2026-05-07",
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        outcome: "completed",
        reason: "Customer follow-up completed.",
        sourceId: "customer-follow-up",
        storeId: "store-1" as Id<"store">,
        workItemId: "work-1" as Id<"operationalWorkItem">,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Approval proof does not match this command.",
      },
    });
    expect(
      tables.get("approvalProof")?.get("approval-proof-carry-forward-1"),
    ).not.toHaveProperty("consumedAt");
    expect(tables.get("operationalWorkItem")?.get("work-1")).toMatchObject({
      status: "open",
    });
  });

  it("rejects carry-forward resolution when manager proof is bound to another outcome", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 10));
    const seed = {
      dailyClose: [
        completedDailyCloseRow({
          carryForwardWorkItemIds: ["work-1"],
        }),
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 4, 7, 20),
          metadata: {
            businessDate: "2026-05-07",
            carryForwardSourceId: "customer-follow-up",
            dailyCloseId: "daily-close-1",
            source: "daily_close",
          },
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer",
          type: "daily_close_carry_forward",
        },
      ],
      store: [store],
    };

    const completeProofDb = createDb({
      ...seed,
      approvalProof: [dailyCloseCarryForwardApprovalProof()],
    });
    const completeProofCancelResult =
      await resolveDailyCloseCarryForwardWithCtx(
        { db: completeProofDb.db } as unknown as MutationCtx,
        {
          actorStaffProfileId: "staff-1" as Id<"staffProfile">,
          actorUserId: "user-1" as Id<"athenaUser">,
          approvalProofId:
            "approval-proof-carry-forward-1" as Id<"approvalProof">,
          businessDate: "2026-05-07",
          dailyCloseId: "daily-close-1" as Id<"dailyClose">,
          outcome: "cancelled",
          reason: "Customer follow-up cancelled.",
          sourceId: "customer-follow-up",
          storeId: "store-1" as Id<"store">,
          workItemId: "work-1" as Id<"operationalWorkItem">,
        },
      );

    expect(completeProofCancelResult).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Approval proof does not match this command.",
      },
    });
    expect(
      completeProofDb.tables
        .get("approvalProof")
        ?.get("approval-proof-carry-forward-1"),
    ).not.toHaveProperty("consumedAt");
    expect(
      completeProofDb.tables.get("operationalWorkItem")?.get("work-1"),
    ).toMatchObject({
      status: "open",
    });

    const cancelProofDb = createDb({
      ...seed,
      approvalProof: [
        dailyCloseCarryForwardApprovalProof({
          _id: "approval-proof-cancel-1",
          subjectId: "daily-close-1:customer-follow-up:cancelled",
        }),
      ],
    });
    const cancelProofCompleteResult =
      await resolveDailyCloseCarryForwardWithCtx(
        { db: cancelProofDb.db } as unknown as MutationCtx,
        {
          actorStaffProfileId: "staff-1" as Id<"staffProfile">,
          actorUserId: "user-1" as Id<"athenaUser">,
          approvalProofId: "approval-proof-cancel-1" as Id<"approvalProof">,
          businessDate: "2026-05-07",
          dailyCloseId: "daily-close-1" as Id<"dailyClose">,
          outcome: "completed",
          reason: "Customer follow-up completed.",
          sourceId: "customer-follow-up",
          storeId: "store-1" as Id<"store">,
          workItemId: "work-1" as Id<"operationalWorkItem">,
        },
      );

    expect(cancelProofCompleteResult).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Approval proof does not match this command.",
      },
    });
    expect(
      cancelProofDb.tables.get("approvalProof")?.get("approval-proof-cancel-1"),
    ).not.toHaveProperty("consumedAt");
    expect(
      cancelProofDb.tables.get("operationalWorkItem")?.get("work-1"),
    ).toMatchObject({
      status: "open",
    });
  });

  it("cancels carry-forward work with a terminal reason and rejects replay", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 11));
    const { db, tables } = createDb({
      approvalProof: [
        dailyCloseCarryForwardApprovalProof({
          _id: "approval-proof-cancel-1",
          subjectId: "daily-close-1:customer-follow-up:cancelled",
        }),
      ],
      dailyClose: [
        completedDailyCloseRow({
          carryForwardWorkItemIds: ["work-1"],
        }),
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 4, 7, 20),
          metadata: {
            businessDate: "2026-05-07",
            carryForwardSourceId: "customer-follow-up",
            dailyCloseId: "daily-close-1",
            source: "daily_close",
          },
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer",
          type: "daily_close_carry_forward",
        },
      ],
      store: [store],
    });

    const result = await resolveDailyCloseCarryForwardWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId: "approval-proof-cancel-1" as Id<"approvalProof">,
        businessDate: "2026-05-07",
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        outcome: "cancelled",
        reason: "Follow-up is no longer applicable.",
        sourceId: "customer-follow-up",
        storeId: "store-1" as Id<"store">,
        workItemId: "work-1" as Id<"operationalWorkItem">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "cancelled",
        workItem: {
          status: "cancelled",
        },
      },
    });
    expect(tables.get("operationalWorkItem")?.get("work-1")).toMatchObject({
      status: "cancelled",
      metadata: {
        carryForwardResolution: {
          nextStatus: "cancelled",
          outcome: "cancelled",
          reason: "Follow-up is no longer applicable.",
        },
      },
    });

    const replay = await resolveDailyCloseCarryForwardWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId: "approval-proof-cancel-1" as Id<"approvalProof">,
        businessDate: "2026-05-07",
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        outcome: "cancelled",
        reason: "Follow-up is no longer applicable.",
        sourceId: "customer-follow-up",
        storeId: "store-1" as Id<"store">,
        workItemId: "work-1" as Id<"operationalWorkItem">,
      },
    );

    expect(replay).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Carry-forward work is already completed or cancelled.",
      },
    });
  });

  it("reuses the current carry-forward row for the same business date and source", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const { db, inserts } = createDb({
      approvalProof: [dailyCloseApprovalProof()],
      operationalWorkItem: [
        {
          _id: "work-existing",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 4, 7, 19),
          metadata: {
            businessDate: "2026-05-07",
            carryForwardSourceId: "customer-follow-up",
            source: "daily_close",
          },
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer",
          type: "daily_close_carry_forward",
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
        createCarryForwardWorkItems: [
          {
            title: "Call customer",
            metadata: {
              carryForwardSourceId: "customer-follow-up",
            },
          },
        ],
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        carryForwardWorkItems: [
          {
            _id: "work-existing",
          },
        ],
        dailyClose: {
          carryForwardWorkItemIds: ["work-existing"],
          readiness: {
            carryForwardCount: 1,
          },
        },
      },
    });
    expect(
      inserts.filter((insert) => insert.table === "operationalWorkItem"),
    ).toHaveLength(0);
    expect(
      inserts.filter(
        (insert) =>
          insert.table === "operationalEvent" &&
          insert.value.eventType === "daily_close_carry_forward_created",
      ),
    ).toHaveLength(0);
  });

  it("fails closed when carry-forward source evidence exceeds the EOD probe", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const nonMatchingCarryForwardItems = Array.from(
      { length: 200 },
      (_, index) => ({
        _id: `work-existing-${index}`,
        approvalState: "not_required",
        createdAt: Date.UTC(2026, 4, 7, 18, index % 60),
        metadata: {
          businessDate: "2026-05-07",
          carryForwardSourceId: `other-follow-up-${index}`,
          source: "daily_close",
        },
        organizationId: "org-1",
        priority: "normal",
        status: "open",
        storeId: "store-1",
        title: `Other follow-up ${index}`,
        type: "daily_close_carry_forward",
      }),
    );
    const { db, inserts } = createDb({
      approvalProof: [dailyCloseApprovalProof()],
      operationalWorkItem: [
        ...nonMatchingCarryForwardItems,
        {
          _id: "work-existing-target",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 4, 7, 19),
          metadata: {
            businessDate: "2026-05-07",
            carryForwardSourceId: "customer-follow-up",
            source: "daily_close",
          },
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer",
          type: "daily_close_carry_forward",
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
        createCarryForwardWorkItems: [
          {
            title: "Call customer",
            metadata: {
              carryForwardSourceId: "customer-follow-up",
            },
          },
        ],
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review cannot complete until all source evidence is loaded.",
      },
    });
    expect(
      inserts.filter((insert) => insert.table === "operationalWorkItem"),
    ).toHaveLength(0);
    expect(
      inserts.filter(
        (insert) =>
          insert.table === "operationalEvent" &&
          insert.value.eventType === "daily_close_carry_forward_created",
      ),
    ).toHaveLength(0);
  });

  it.each(["open", "in_progress"] as const)(
    "treats exactly 200 %s operational work rows as complete and a 201st row as an incomplete sentinel",
    async (status) => {
      const completeDb = createDb({
        operationalWorkItem: openOperationalWorkItems(200, status),
        store: [store],
      });
      const completeSnapshot = await buildDailyCloseSnapshotWithCtx(
        { db: completeDb.db } as unknown as QueryCtx,
        {
          operatingDate: "2026-05-07",
          storeId: "store-1" as Id<"store">,
        },
      );

      expect(completeSnapshot.sourceCompleteness.entries).toContainEqual(
        expect.objectContaining({
          complete: true,
          limit: 200,
          recordCount: 200,
          source: "operational_work_item",
        }),
      );
      expect(completeSnapshot.summary.openWorkItemCount).toBe(200);
      expect(completeSnapshot.openWorkMembership).toEqual({
        completeness: "complete",
        observedLogicalCount: 200,
      });
      expect(
        completeSnapshot.carryForwardItems.every(
          (item) => item.carryForwardWorkItemIds?.length === 1,
        ),
      ).toBe(true);

      const incompleteDb = createDb({
        operationalWorkItem: openOperationalWorkItems(201, status),
        store: [store],
      });
      const incompleteSnapshot = await buildDailyCloseSnapshotWithCtx(
        { db: incompleteDb.db } as unknown as QueryCtx,
        {
          operatingDate: "2026-05-07",
          storeId: "store-1" as Id<"store">,
        },
      );

      expect(incompleteSnapshot.sourceCompleteness.entries).toContainEqual(
        expect.objectContaining({
          complete: false,
          limit: 200,
          recordCount: 200,
          reason: "operational_work_item_source_cap_reached",
          source: "operational_work_item",
        }),
      );
      expect(incompleteSnapshot.summary.openWorkItemCount).toBe(200);
      expect(incompleteSnapshot.openWorkMembership).toEqual({
        completeness: "incomplete",
        observedLogicalCount: 200,
      });
      expect(
        incompleteSnapshot.carryForwardItems.every(
          (item) =>
            item.carryForwardWorkItemIds === undefined &&
            item.subject.type === "incomplete_logical_operational_work_group" &&
            item.metadata?.membershipCompleteness === "incomplete",
        ),
      ).toBe(true);
    },
  );

  it("fails human and automation completion closed when an operational-work lane has a 201st row", async () => {
    const humanDb = createDb({
      operationalWorkItem: openOperationalWorkItems(201, "open"),
      store: [store],
    });
    const humanResult = await completeDailyCloseWithCtx(
      { db: humanDb.db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(humanResult).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review cannot complete until all source evidence is loaded.",
        metadata: {
          incompleteSources: [
            expect.objectContaining({
              complete: false,
              source: "operational_work_item",
            }),
          ],
        },
      },
    });

    const automationDb = createDb({
      operationalWorkItem: openOperationalWorkItems(201, "in_progress"),
      store: [store],
    });
    const automationResult = await completeDailyCloseForAutomationWithCtx(
      { db: automationDb.db } as unknown as MutationCtx,
      {
        automationDecisionReason: "EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-work-cap" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(automationResult).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review automation cannot complete without complete source evidence.",
        metadata: {
          incompleteSources: [
            expect.objectContaining({
              complete: false,
              source: "operational_work_item",
            }),
          ],
        },
      },
    });
  });

  it("fails human and automation completion closed when an active-repair lane has a 201st row", async () => {
    const repairs = Array.from({ length: 201 }, (_, index) => ({
      _id: `repair-cap-${index + 1}`,
      groupKey: `synced_sale_inventory_review:store-1:sku-${index + 1}`,
      sourceIdentities: [`source-${index + 1}`],
      status: "pending",
      storeId: "store-1",
    }));
    const humanDb = createDb({
      oversizedOperationalWorkRepair: repairs,
      store: [store],
    });
    const humanResult = await completeDailyCloseWithCtx(
      { db: humanDb.db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(humanResult).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: {
          incompleteSources: [
            expect.objectContaining({
              complete: false,
              recordCount: 200,
              source: "oversized_operational_work_repair",
            }),
          ],
        },
      },
    });

    const automationDb = createDb({
      oversizedOperationalWorkRepair: repairs,
      store: [store],
    });
    const automationResult = await completeDailyCloseForAutomationWithCtx(
      { db: automationDb.db } as unknown as MutationCtx,
      {
        automationDecisionReason: "EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-repair-cap" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(automationResult).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: {
          incompleteSources: [
            expect.objectContaining({
              complete: false,
              recordCount: 200,
              source: "oversized_operational_work_repair",
            }),
          ],
        },
      },
    });
  });

  it("completes a ready day through automation with durable attribution and no approval proof metadata", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
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

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-1" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        dailyClose: {
          actorType: "automation",
          automationDecisionReason: "EOD Review passed policy checks.",
          automationPolicyVersion: "daily-close-auto-complete.v1",
          automationRunId: "automation-run-1",
          policyReviewedItemKeys: [],
          status: "completed",
        },
      },
    });
    const completedClose = result.kind === "ok" ? result.data.dailyClose : null;
    expect(completedClose).not.toHaveProperty("completedByStaffProfileId");
    expect(completedClose).not.toHaveProperty("completedByUserId");
    const reportSnapshot =
      result.kind === "ok" ? result.data.dailyClose.reportSnapshot : null;
    expect(reportSnapshot).toMatchObject({
      closeMetadata: {
        actorType: "automation",
        automationDecisionReason: "EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-1",
        policyReviewedItemKeys: [],
      },
    });
    expect(reportSnapshot?.closeMetadata).not.toHaveProperty("approvalProofId");
    expect(
      reportingIngressMocks.appendReportingIngressWithCtx,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        businessEventKey: expect.stringMatching(
          /^daily_close:dailyClose-\d+:completed:v1$/,
        ),
        netAmountMinor: 12000,
        sourceEventType: "daily_close_completed",
      }),
    );
    expect(reportSnapshot?.closeMetadata).not.toHaveProperty(
      "approvedByStaffProfileId",
    );
    const completionEvent = inserts.find(
      (insert) =>
        insert.table === "operationalEvent" &&
        insert.value.eventType === "daily_close_completed",
    )?.value;
    expect(completionEvent).toMatchObject({
      actorType: "automation",
      automationDecisionReason: "EOD Review passed policy checks.",
      automationPolicyVersion: "daily-close-auto-complete.v1",
      automationRunId: "automation-run-1",
      metadata: {
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
      },
    });
    expect(completionEvent?.metadata).not.toHaveProperty("approvalProofId");
    expect(completionEvent?.metadata).not.toHaveProperty(
      "approvedByStaffProfileId",
    );
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyClose",
      "operationalEvent",
    ]);
    expect(result.kind === "ok" ? result.data.operationalEventId : null).toBe(
      completionEvent?._id,
    );
  });

  it("keeps default automation completion current and demotes older current closes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const { db, tables } = createDb({
      dailyClose: [
        completedDailyCloseRow({
          _id: "daily-close-prior-current",
          completedAt: Date.UTC(2026, 4, 6, 22),
          createdAt: Date.UTC(2026, 4, 6, 22),
          operatingDate: "2026-05-06",
          updatedAt: Date.UTC(2026, 4, 6, 22),
        }),
      ],
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-current" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        dailyClose: {
          isCurrent: true,
          reportSnapshot: {
            closeMetadata: {
              currentnessMode: "mark_current",
            },
          },
        },
      },
    });
    expect(
      tables.get("dailyClose")?.get("daily-close-prior-current")?.isCurrent,
    ).toBe(false);
  });

  it("records historical automation completion without demoting the live current close", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 9, 22));
    const { db, tables } = createDb({
      dailyClose: [
        completedDailyCloseRow({
          _id: "daily-close-live-current",
          completedAt: Date.UTC(2026, 4, 8, 22),
          createdAt: Date.UTC(2026, 4, 8, 22),
          operatingDate: "2026-05-08",
          updatedAt: Date.UTC(2026, 4, 8, 22),
        }),
      ],
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "Historic EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-historical" as Id<"automationRun">,
        currentnessMode: "historical_record",
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        dailyClose: {
          actorType: "automation",
          isCurrent: false,
          reportSnapshot: {
            closeMetadata: {
              currentnessMode: "historical_record",
              operatingDate: "2026-05-07",
            },
            sourceCompleteness: {
              complete: true,
              entries: expect.arrayContaining([
                expect.objectContaining({
                  complete: true,
                  readMode: "by_storeId_status_closeoutOperatingDate_missing",
                  source: "register_session",
                }),
              ]),
            },
          },
        },
      },
    });
    expect(
      tables.get("dailyClose")?.get("daily-close-live-current")?.isCurrent,
    ).toBe(true);
  });

  it("rejects historical automation completion when register source evidence is incomplete", async () => {
    const registerSessions = Array.from({ length: 1000 }, (_, index) => ({
      _id: `register-cap-${index + 1}`,
      closedAt: Date.UTC(2026, 4, 7, 18, index % 60),
      countedCash: 10000,
      expectedCash: 10000,
      openedAt: Date.UTC(2026, 4, 7, 9, index % 60),
      openingFloat: 10000,
      status: "closed",
      storeId: "store-1",
    }));
    const { db, inserts } = createDb({
      registerSession: registerSessions,
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "Historic EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId:
          "automation-run-incomplete-source" as Id<"automationRun">,
        currentnessMode: "historical_record",
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: {
          incompleteSources: [
            {
              complete: false,
              limit: 1000,
              readMode: "by_storeId_status_closeoutOperatingDate_missing",
              reason: "register_session_legacy_closed_fallback_cap_reached",
              source: "register_session",
            },
          ],
        },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("rejects current and historical automation completion when source reads hit the cap", async () => {
    const transactions = Array.from({ length: 200 }, (_, index) => ({
      _id: `txn-cap-${index + 1}`,
      completedAt: Date.UTC(2026, 4, 7, 15, index % 60),
      payments: [{ amount: 100, method: "cash", timestamp: 1 }],
      status: "completed",
      storeId: "store-1",
      subtotal: 100,
      tax: 0,
      total: 100,
      totalPaid: 100,
      transactionNumber: `TXN-CAP-${index + 1}`,
    }));
    const { db, inserts } = createDb({
      posTransaction: transactions,
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "Historic EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId:
          "automation-run-incomplete-transactions" as Id<"automationRun">,
        currentnessMode: "historical_record",
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: {
          incompleteSources: [
            expect.objectContaining({
              complete: false,
              limit: 200,
              readMode: "by_storeId_status_completedAt",
              reason: "pos_transaction_source_cap_reached",
              source: "pos_transaction",
            }),
          ],
        },
      },
    });
    const currentResult = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "Current EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId:
          "automation-run-incomplete-current" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(currentResult).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review automation cannot complete without complete source evidence.",
      },
    });
    expect(inserts).toEqual([]);
  });

  it("records incomplete source evidence when pending approval reads hit the cap", async () => {
    const approvals = Array.from({ length: 200 }, (_, index) => ({
      _id: `approval-cap-${index + 1}`,
      createdAt: Date.UTC(2026, 4, 7, 16, index % 60),
      reason: "Manager review required.",
      requestType: "variance_review",
      status: "pending",
      storeId: "store-1",
      subjectId: `register-${index + 1}`,
      subjectType: "register_session",
    }));
    const { db } = createDb({
      approvalRequest: approvals,
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.sourceCompleteness).toEqual(
      expect.objectContaining({
        complete: false,
        entries: expect.arrayContaining([
          expect.objectContaining({
            complete: false,
            limit: 200,
            readMode: "by_storeId_status",
            reason: "approval_request_source_cap_reached",
            source: "approval_request",
            statuses: ["pending"],
          }),
        ]),
      }),
    );
  });

  it("scopes payment-allocation completeness to the operating day", async () => {
    const historicalAllocations = Array.from({ length: 201 }, (_, index) => ({
      _id: `historical-allocation-${index + 1}`,
      allocationType: "payment",
      amount: 100,
      createdAt: Date.UTC(2026, 4, 6, 12, index % 60),
      direction: "in",
      method: "cash",
      recordedAt: Date.UTC(2026, 4, 6, 12, index % 60),
      status: "recorded",
      storeId: "store-1",
      targetId: `historical-target-${index + 1}`,
      targetType: "pos_transaction",
    }));
    const { db, queryLog } = createDb({
      paymentAllocation: [
        ...historicalAllocations,
        {
          _id: "deposit-current-day",
          allocationType: "cash_deposit",
          amount: 3000,
          createdAt: Date.UTC(2026, 4, 7, 18),
          direction: "out",
          method: "cash",
          recordedAt: Date.UTC(2026, 4, 7, 18),
          status: "recorded",
          storeId: "store-1",
          targetId: "deposit-current-day-key",
          targetType: "register_cash_deposit",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.sourceCompleteness.entries).toContainEqual(
      expect.objectContaining({
        complete: true,
        readMode:
          "by_storeId_allocationType_direction_status_recordedAt",
        recordCount: 1,
        source: "payment_allocation",
      }),
    );
    expect(snapshot.summary.cashDepositTotal).toBe(3000);
    expect(queryLog).toContainEqual(
      expect.objectContaining({
        index: "by_storeId_allocationType_direction_status_recordedAt",
        table: "paymentAllocation",
      }),
    );
  });

  it("ignores unrelated daily allocations when evaluating cash-deposit completeness", async () => {
    const currentDayAllocations = Array.from({ length: 201 }, (_, index) => ({
      _id: `current-day-allocation-${index + 1}`,
      allocationType: "payment",
      amount: 100,
      createdAt: Date.UTC(2026, 4, 7, 12, index % 60),
      direction: "in",
      method: "cash",
      recordedAt: Date.UTC(2026, 4, 7, 12, index % 60),
      status: "recorded",
      storeId: "store-1",
      targetId: `current-day-target-${index + 1}`,
      targetType: "pos_transaction",
    }));
    const { db } = createDb({
      paymentAllocation: currentDayAllocations,
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.sourceCompleteness.entries).toContainEqual(
      expect.objectContaining({
        complete: true,
        readMode:
          "by_storeId_allocationType_direction_status_recordedAt",
        recordCount: 0,
        source: "payment_allocation",
      }),
    );
  });

  it("fails cash-deposit completeness closed when the operating day exceeds the probe", async () => {
    const currentDayDeposits = Array.from({ length: 201 }, (_, index) => ({
      _id: `current-day-deposit-${index + 1}`,
      allocationType: "cash_deposit",
      amount: 100,
      createdAt: Date.UTC(2026, 4, 7, 12, index % 60),
      direction: "out",
      method: "cash",
      recordedAt: Date.UTC(2026, 4, 7, 12, index % 60),
      status: "recorded",
      storeId: "store-1",
      targetId: `current-day-deposit-target-${index + 1}`,
      targetType: "register_cash_deposit",
    }));
    const { db } = createDb({
      paymentAllocation: currentDayDeposits,
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-07", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.sourceCompleteness.entries).toContainEqual(
      expect.objectContaining({
        complete: false,
        readMode:
          "by_storeId_allocationType_direction_status_recordedAt",
        reason: "payment_allocation_source_cap_reached",
        recordCount: 200,
        source: "payment_allocation",
      }),
    );
  });

  it("records policy-reviewed item keys when automation completes reviewed items", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const reviewKey = "pos_transaction:txn-void:void";
    const { db } = createDb({
      posTransaction: [
        {
          _id: "txn-void",
          completedAt: Date.UTC(2026, 4, 7, 15),
          payments: [],
          status: "void",
          storeId: "store-1",
          subtotal: 500,
          tax: 0,
          total: 500,
          totalPaid: 500,
          transactionNumber: "TXN-2",
        },
      ],
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "Policy reviewed voided-sale evidence.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-1" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [reviewKey],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyClose: {
          actorType: "automation",
          policyReviewedItemKeys: [reviewKey],
          reviewedItemKeys: [reviewKey],
        },
      },
    });
    const reportSnapshot =
      result.kind === "ok" ? result.data.dailyClose.reportSnapshot : null;
    expect(reportSnapshot?.closeMetadata).toMatchObject({
      policyReviewedItemKeys: [reviewKey],
      reviewedItemKeys: [reviewKey],
    });
    expect(reportSnapshot?.reviewedItems.map((item) => item.key)).toEqual([
      reviewKey,
    ]);
  });

  it("keeps human completion attribution when automation retries an already completed close", async () => {
    const { db, inserts, tables } = createDb({
      dailyClose: [completedDailyCloseRow()],
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "Retry after timeout.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-retry" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "already_completed",
        dailyClose: {
          completedByStaffProfileId: "staff-manager-1",
          completedByUserId: "user-1",
        },
      },
    });
    const completedClose = result.kind === "ok" ? result.data.dailyClose : null;
    expect(completedClose).not.toHaveProperty("actorType");
    expect(completedClose).not.toHaveProperty("automationRunId");
    expect(tables.get("dailyClose")?.get("daily-close-1")).toMatchObject({
      completedByStaffProfileId: "staff-manager-1",
      completedByUserId: "user-1",
    });
    expect(tables.get("dailyClose")?.get("daily-close-1")).not.toHaveProperty(
      "automationRunId",
    );
    expect(inserts).toEqual([]);
    expect(
      reportingIngressMocks.appendReportingIngressWithCtx,
    ).not.toHaveBeenCalled();
  });

  it("requires policy evidence before automation completes an open close", async () => {
    const { db, inserts } = createDb({
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "Policy evidence was not supplied.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-missing-policy" as Id<"automationRun">,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      } as unknown as Parameters<
        typeof completeDailyCloseForAutomationWithCtx
      >[1],
    );

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review automation requires policy evidence before completion.",
      },
    });
    expect(inserts).toEqual([]);
  });

  it("fails automation completion when command-time blockers or unreviewed items remain", async () => {
    const blockerDb = createDb({
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
    await expect(
      completeDailyCloseForAutomationWithCtx(
        { db: blockerDb.db } as unknown as MutationCtx,
        {
          automationDecisionReason: "Policy saw no blockers earlier.",
          automationPolicyVersion: "daily-close-auto-complete.v1",
          automationRunId: "automation-run-blocker" as Id<"automationRun">,
          eodAutoCompletePolicy,
          operatingDate: "2026-05-07",
          policyReviewedItemKeys: [],
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: { blockerCount: 1 },
      },
    });
    expect(blockerDb.inserts).toEqual([]);

    const reviewDb = createDb({
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
    await expect(
      completeDailyCloseForAutomationWithCtx(
        { db: reviewDb.db } as unknown as MutationCtx,
        {
          automationDecisionReason: "Policy saw no review items earlier.",
          automationPolicyVersion: "daily-close-auto-complete.v1",
          automationRunId: "automation-run-review" as Id<"automationRun">,
          eodAutoCompletePolicy,
          operatingDate: "2026-05-07",
          policyReviewedItemKeys: [],
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: {
          unreviewedItemKeys: ["pos_transaction:txn-void:void"],
        },
      },
    });
    expect(reviewDb.inserts).toEqual([]);

    const reopenedDb = createDb({
      dailyClose: [
        {
          _id: "daily-close-reopened",
          carryForwardWorkItemIds: [],
          createdAt: Date.UTC(2026, 4, 7, 22),
          isCurrent: true,
          lifecycleStatus: "active",
          operatingDate: "2026-05-07",
          organizationId: "org-1",
          readiness: {
            blockerCount: 0,
            carryForwardCount: 0,
            readyCount: 1,
            reviewCount: 0,
            status: "ready",
          },
          reopenedAt: Date.UTC(2026, 4, 8, 10),
          reopenedFromDailyCloseId: "daily-close-original",
          sourceSubjects: [],
          status: "open",
          storeId: "store-1",
          summary: dailyCloseSummary(),
          supersedesDailyCloseId: "daily-close-original",
          updatedAt: Date.UTC(2026, 4, 8, 10),
        },
      ],
      store: [store],
    });
    await expect(
      completeDailyCloseForAutomationWithCtx(
        { db: reopenedDb.db } as unknown as MutationCtx,
        {
          automationDecisionReason: "Policy saw a reopened day as ready.",
          automationPolicyVersion: "daily-close-auto-complete.v1",
          automationRunId: "automation-run-reopened" as Id<"automationRun">,
          eodAutoCompletePolicy,
          operatingDate: "2026-05-07",
          policyReviewedItemKeys: [],
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: {
          dailyCloseId: "daily-close-reopened",
        },
      },
    });
    expect(reopenedDb.inserts).toEqual([]);
  });

  it("fails automation completion when command-time review evidence exceeds policy thresholds", async () => {
    const reviewKey = "pos_transaction:txn-void:void";
    const { db, inserts } = createDb({
      posTransaction: [
        {
          _id: "txn-void",
          completedAt: Date.UTC(2026, 4, 7, 15),
          payments: [],
          status: "void",
          storeId: "store-1",
          subtotal: 1500,
          tax: 0,
          total: 1500,
          totalPaid: 1500,
          transactionNumber: "TXN-2",
        },
      ],
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "Policy reviewed voided-sale evidence.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-threshold" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [reviewKey],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: {
          thresholdFailures: ["voided_sale_total"],
          voidedSaleCount: 1,
          voidedSaleTotal: 1500,
        },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("rejects carry-forward work that cannot be safely mapped at command time", async () => {
    const openWorkItem = {
      _id: "work-1",
      approvalState: "not_required",
      createdAt: 4,
      organizationId: "org-1",
      priority: "normal",
      status: "open",
      storeId: "store-1",
      title: "Call customer tomorrow",
      type: "customer_follow_up",
    };
    const createCommandArgs = () => ({
      automationDecisionReason: "EOD Review passed policy checks.",
      automationPolicyVersion: "daily-close-auto-complete.v1",
      automationRunId: "automation-run-carry-forward" as Id<"automationRun">,
      eodAutoCompletePolicy,
      operatingDate: "2026-05-07",
      policyReviewedItemKeys: [],
      storeId: "store-1" as Id<"store">,
    });

    const missingDb = createDb({
      operationalWorkItem: [openWorkItem],
      store: [store],
    });
    const dbWithMissingWorkItem = {
      ...missingDb.db,
      async get(tableOrId: string, maybeId?: string) {
        if (
          (tableOrId === "operationalWorkItem" && maybeId === "work-1") ||
          tableOrId === "work-1"
        ) {
          return null;
        }

        return missingDb.db.get(tableOrId, maybeId);
      },
    };
    await expect(
      completeDailyCloseForAutomationWithCtx(
        { db: dbWithMissingWorkItem } as unknown as MutationCtx,
        createCommandArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review automation cannot preserve missing carry-forward work.",
        metadata: { workItemId: "work-1" },
      },
    });
    expect(missingDb.inserts).toEqual([]);

    const duplicateDb = createDb({
      operationalWorkItem: [openWorkItem],
      store: [store],
    });
    const dbWithDuplicatedWorkItem = {
      ...duplicateDb.db,
      query(table: TableName) {
        const chain = duplicateDb.db.query(table);

        if (table !== "operationalWorkItem") {
          return chain;
        }

        return {
          ...chain,
          withIndex(
            index: string,
            applyIndex: Parameters<typeof chain.withIndex>[1],
          ) {
            const indexedChain = chain.withIndex(index, applyIndex);

            return {
              ...indexedChain,
              take: async (limit: number) => {
                const rows = await indexedChain.take(limit);

                return rows.length > 0
                  ? [rows[0], rows[0], ...rows.slice(1)]
                  : rows;
              },
            };
          },
        };
      },
    };
    await expect(
      completeDailyCloseForAutomationWithCtx(
        { db: dbWithDuplicatedWorkItem } as unknown as MutationCtx,
        createCommandArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review automation cannot preserve unmapped or duplicated carry-forward work.",
        metadata: {
          carryForwardCount: 1,
          mappedWorkItemCount: 1,
        },
      },
    });
    expect(duplicateDb.inserts).toEqual([]);

    const wrongOrgDb = createDb({
      operationalWorkItem: [
        {
          ...openWorkItem,
          organizationId: "org-other",
        },
      ],
      store: [store],
    });
    await expect(
      completeDailyCloseForAutomationWithCtx(
        { db: wrongOrgDb.db } as unknown as MutationCtx,
        createCommandArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review automation cannot preserve carry-forward work outside this store.",
        metadata: { workItemId: "work-1" },
      },
    });
    expect(wrongOrgDb.inserts).toEqual([]);

    const terminalDb = createDb({
      operationalWorkItem: [openWorkItem],
      store: [store],
    });
    const dbWithTerminalWorkItem = {
      ...terminalDb.db,
      async get(tableOrId: string, maybeId?: string) {
        const row = await terminalDb.db.get(tableOrId, maybeId);

        if (
          row &&
          ((tableOrId === "operationalWorkItem" && maybeId === "work-1") ||
            tableOrId === "work-1")
        ) {
          return { ...row, status: "completed" };
        }

        return row;
      },
    };
    await expect(
      completeDailyCloseForAutomationWithCtx(
        { db: dbWithTerminalWorkItem } as unknown as MutationCtx,
        createCommandArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review automation cannot preserve terminal carry-forward work.",
        metadata: {
          status: "completed",
          workItemId: "work-1",
        },
      },
    });
    expect(terminalDb.inserts).toEqual([]);
  });

  it("preserves command-time carry-forward work when automation completes an otherwise ready day", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const { db, inserts } = createDb({
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
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-carry-forward" as Id<"automationRun">,
        eodAutoCompletePolicy: {
          cleanDayAutoCompleteEnabled: true,
          maxAbsoluteCashVariance: 500,
          maxVoidedSaleCount: 2,
          maxVoidedSaleTotal: 1000,
        },
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        automationDecisionEvidence: {
          classification: "clean_day",
          eligible: true,
          observed: {
            carryForwardCount: 1,
            carryForwardItemKeys: [
              "operational_work_item:work-1:carry_forward",
            ],
            carryForwardPreserved: true,
          },
        },
        carryForwardWorkItems: [
          {
            _id: "work-1",
            status: "open",
          },
        ],
        dailyClose: {
          actorType: "automation",
          carryForwardWorkItemIds: ["work-1"],
          readiness: {
            carryForwardCount: 1,
          },
          summary: {
            carryForwardWorkItemCount: 1,
          },
        },
      },
    });
    const dailyClose = result.kind === "ok" ? result.data.dailyClose : null;
    expect(dailyClose?.reportSnapshot).toMatchObject({
      carryForwardItems: [
        {
          key: "operational_work_item:work-1:carry_forward",
          subject: {
            id: "work-1",
            type: "operational_work_item",
          },
        },
      ],
      closeMetadata: {
        actorType: "automation",
        carryForwardWorkItemIds: ["work-1"],
      },
    });
    expect(dailyClose?.reportSnapshot?.carryForwardItems[0]).not.toHaveProperty(
      "carryForwardResolution",
    );
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyClose",
      "operationalEvent",
    ]);
    expect(
      inserts.find(
        (insert) =>
          insert.table === "operationalEvent" &&
          insert.value.eventType === "daily_close_completed",
      )?.value,
    ).toMatchObject({
      actorType: "automation",
      metadata: {
        readiness: {
          carryForwardCount: 1,
        },
      },
    });
  });

  it("stamps automation carry-forward work metadata when snapshot exposes resolution", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const { db, tables } = createDb({
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
          type: "daily_close_carry_forward",
        },
      ],
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason: "EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-carry-forward" as Id<"automationRun">,
        eodAutoCompletePolicy: {
          cleanDayAutoCompleteEnabled: true,
          maxAbsoluteCashVariance: 500,
          maxVoidedSaleCount: 2,
          maxVoidedSaleTotal: 1000,
        },
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyClose: {
          _id: "dailyClose-1",
          carryForwardWorkItemIds: ["work-1"],
        },
      },
    });
    expect(
      result.kind === "ok"
        ? result.data.dailyClose.reportSnapshot?.carryForwardItems[0]
        : null,
    ).toMatchObject({
      carryForwardResolution: {
        businessDate: "2026-05-07",
        dailyCloseId: "dailyClose-1",
        sourceId: "work-1",
        workItemId: "work-1",
      },
    });
    expect(tables.get("operationalWorkItem")?.get("work-1")).toMatchObject({
      metadata: {
        businessDate: "2026-05-07",
        carryForwardSourceId: "work-1",
        dailyCloseId: "dailyClose-1",
        source: "daily_close",
      },
    });
  });

  it("preserves carry-forward work for Opening when automation completes low-risk review evidence", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 7, 22));
    const reviewKey = "pos_transaction:txn-void:void";
    const { db } = createDb({
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
      posTransaction: [
        {
          _id: "txn-void",
          completedAt: Date.UTC(2026, 4, 7, 15),
          payments: [],
          status: "void",
          storeId: "store-1",
          subtotal: 500,
          tax: 0,
          total: 500,
          totalPaid: 500,
          transactionNumber: "TXN-2",
        },
      ],
      store: [store],
    });

    const result = await completeDailyCloseForAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        automationDecisionReason:
          "EOD Review has only low-risk review evidence within policy thresholds.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-low-risk-carry" as Id<"automationRun">,
        eodAutoCompletePolicy,
        operatingDate: "2026-05-07",
        policyReviewedItemKeys: [reviewKey],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "completed",
        automationDecisionEvidence: {
          classification: "low_risk_review",
          eligible: true,
          observed: {
            carryForwardCount: 1,
            carryForwardPreserved: true,
            reviewCount: 1,
            voidedSaleCount: 1,
            voidedSaleTotal: 500,
          },
          policy: eodAutoCompletePolicy,
        },
        dailyClose: {
          actorType: "automation",
          automationRunId: "automation-run-low-risk-carry",
          carryForwardWorkItemIds: ["work-1"],
          policyReviewedItemKeys: [reviewKey],
        },
      },
    });
    const dailyClose = result.kind === "ok" ? result.data.dailyClose : null;
    expect(dailyClose?.reportSnapshot).toMatchObject({
      carryForwardItems: [
        {
          key: "operational_work_item:work-1:carry_forward",
        },
      ],
      closeMetadata: {
        carryForwardWorkItemIds: ["work-1"],
        policyReviewedItemKeys: [reviewKey],
      },
      reviewedItems: [
        {
          key: reviewKey,
        },
      ],
    });

    const openingContext = await getDailyCloseOpeningContextWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(openingContext.priorClose?._id).toBe(dailyClose?._id);
    expect(
      openingContext.carryForwardWorkItems.map((item) => item._id),
    ).toEqual(["work-1"]);
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
          label: "Reopen EOD Review",
        },
        copy: {
          message:
            "A manager needs to approve reopening this EOD Review before the operating day can be revised.",
          primaryActionLabel: "Approve and reopen",
          secondaryActionLabel: "Cancel",
          title: "Manager approval required",
        },
        metadata: {
          dailyCloseId: "daily-close-1",
          operatingDate: "2026-05-07",
        },
        reason: "Manager approval is required to reopen EOD Review.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        selfApproval: "allowed",
        subject: {
          id: "daily-close-1",
          label: "EOD Review 2026-05-07",
          type: "daily_close",
        },
      },
    });
    expect(() =>
      assertConformsToExportedReturns(reopenDailyClose, result),
    ).not.toThrow();
    expect(inserts).toEqual([]);
  });

  it("reopens a completed close without mutating its report snapshot and makes live readiness active", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 10));
    const originalSnapshot = completedDailyCloseSnapshot({
      closeMetadata: {
        ...completedDailyCloseSnapshot().closeMetadata,
        actorType: "automation",
        automationDecisionReason: "EOD Review passed policy checks.",
        automationPolicyVersion: "daily-close-auto-complete.v1",
        automationRunId: "automation-run-1",
        completedByStaffProfileId: undefined,
        completedByUserId: undefined,
        policyReviewedItemKeys: [],
      },
    });
    const { db, inserts, tables } = createDb({
      approvalProof: [dailyCloseReopenApprovalProof()],
      dailyClose: [
        completedDailyCloseRow({
          actorType: "automation",
          automationDecisionReason: "EOD Review passed policy checks.",
          automationPolicyVersion: "daily-close-auto-complete.v1",
          automationRunId: "automation-run-1",
          completedByStaffProfileId: undefined,
          completedByUserId: undefined,
          policyReviewedItemKeys: [],
          reportSnapshot: originalSnapshot,
        }),
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
          reopenApprovalProofId: "approval-proof-reopen-1",
          reopenApprovedByStaffProfileId: "staff-manager-1",
          reopenRequestedByStaffProfileId: "staff-1",
          reopenRequestedByUserId: "user-1",
          reopenReason: "Late cash sale was missed.",
          status: "completed",
        },
        reopenedDailyClose: {
          isCurrent: true,
          lifecycleStatus: "active",
          reopenApprovalProofId: "approval-proof-reopen-1",
          reopenApprovedByStaffProfileId: "staff-manager-1",
          reopenRequestedByStaffProfileId: "staff-1",
          reopenRequestedByUserId: "user-1",
          reopenedFromDailyCloseId: "daily-close-1",
          status: "open",
          supersedesDailyCloseId: "daily-close-1",
        },
      },
    });
    expect(
      tables.get("dailyClose")?.get("daily-close-1")?.reportSnapshot,
    ).toEqual(originalSnapshot);
    expect(tables.get("dailyClose")?.get("daily-close-1")).toMatchObject({
      actorType: "automation",
      automationDecisionReason: "EOD Review passed policy checks.",
      automationPolicyVersion: "daily-close-auto-complete.v1",
      automationRunId: "automation-run-1",
      policyReviewedItemKeys: [],
    });

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
      actorStaffProfileId: "staff-1",
      metadata: {
        approvalProofId: "approval-proof-reopen-1",
        approvedByStaffProfileId: "staff-manager-1",
        reason: "Late cash sale was missed.",
        reopenedDailyCloseId: "dailyClose-2",
        requestedByStaffProfileId: "staff-1",
        requestedByUserId: "user-1",
      },
    });
  });

  it("reopens a historical close without demoting the live current close", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 9, 10));
    const historicalSnapshot = completedDailyCloseSnapshot({
      closeMetadata: {
        ...completedDailyCloseSnapshot().closeMetadata,
        currentnessMode: "historical_record",
      },
    });
    const liveCurrentClose = completedDailyCloseRow({
      _id: "daily-close-current",
      completedAt: Date.UTC(2026, 4, 8, 22),
      createdAt: Date.UTC(2026, 4, 8, 22),
      isCurrent: true,
      operatingDate: "2026-05-08",
      updatedAt: Date.UTC(2026, 4, 8, 22),
    });
    const { db, tables } = createDb({
      approvalProof: [
        dailyCloseReopenApprovalProof({
          createdAt: Date.UTC(2026, 4, 9, 9),
          expiresAt: Date.UTC(2026, 4, 9, 11),
        }),
      ],
      dailyClose: [
        completedDailyCloseRow({
          isCurrent: false,
          reportSnapshot: historicalSnapshot,
        }),
        liveCurrentClose,
      ],
    });

    const result = await reopenDailyCloseWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId: "approval-proof-reopen-1" as Id<"approvalProof">,
        dailyCloseId: "daily-close-1" as Id<"dailyClose">,
        reason: "Historic correction.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        originalDailyClose: {
          _id: "daily-close-1",
          isCurrent: false,
          lifecycleStatus: "reopened",
        },
        reopenedDailyClose: {
          isCurrent: false,
          lifecycleStatus: "active",
          reopenedFromDailyCloseId: "daily-close-1",
          status: "open",
        },
      },
    });
    expect(tables.get("dailyClose")?.get("daily-close-current")).toMatchObject({
      isCurrent: true,
      lifecycleStatus: "active",
    });
    expect(tables.get("dailyClose")?.get("daily-close-1")).toMatchObject({
      isCurrent: false,
      lifecycleStatus: "reopened",
      reportSnapshot: historicalSnapshot,
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
    expect(
      reportingIngressMocks.appendReportingIngressWithCtx,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        businessEventKey: "daily_close:daily-close-reopened:completed:v2",
        closeSnapshot: expect.objectContaining({
          snapshotVersion: 2,
          supersedesCloseId: "daily-close-1",
        }),
        sourceReferences: [
          {
            relation: "owns",
            sourceId: "daily-close-reopened",
            sourceType: "daily_close",
          },
          {
            relation: "supersedes",
            sourceId: "daily-close-1",
            sourceType: "daily_close",
          },
        ],
      }),
    );
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
            "Open operational work will carry forward after the end of day review.",
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
          message: "Transaction included in the end of day review.",
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
          message: "EOD Review completed for 2026-05-07.",
          metadata: {
            approvedByStaffProfileId: "staff-manager-1",
          },
          organizationId: "org-1",
          storeId: "store-1",
          subjectId: "daily-close-old",
          subjectLabel: "EOD Review 2026-05-07",
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

  it("exposes Athena completion attribution while redacting restricted history detail for broad readers", async () => {
    const automationSnapshot = completedDailyCloseSnapshot({
      closeMetadata: {
        actorType: "automation",
        automationDecisionReason:
          "EOD Review has only low-risk review evidence within policy thresholds.",
        automationPolicyVersion: "daily-operations.v1",
        automationRunId: "automation-run-1",
        carryForwardWorkItemIds: ["work-1" as Id<"operationalWorkItem">],
        completedAt: Date.UTC(2026, 4, 7, 22),
        operatingDate: "2026-05-07",
        organizationId: "org-1",
        policyReviewedItemKeys: ["pos_transaction:txn-void:void"],
        startAt: Date.UTC(2026, 4, 7),
        endAt: Date.UTC(2026, 4, 8),
        storeId: "store-1",
      },
      reviewedItems: [
        {
          key: "pos_transaction:txn-void:void",
          severity: "review",
          category: "voided_sale",
          title: "Voided sale needs review",
          message:
            "Review voided sales before completing the end of day review.",
          subject: {
            id: "txn-void",
            label: "TXN-VOID",
            type: "pos_transaction",
          },
          metadata: {
            paymentMethods: "cash",
            total: 42000,
            totalPaid: 42000,
          },
        },
      ],
      carryForwardItems: [
        {
          key: "operational_work_item:work-1:carry_forward",
          severity: "carry_forward",
          category: "open_work",
          title: "Call customer tomorrow",
          message:
            "Open operational work will carry forward after the end of day review.",
          subject: {
            id: "work-1",
            label: "Call customer tomorrow",
            type: "operational_work_item",
          },
          metadata: {
            priority: "normal",
            status: "open",
            type: "customer_follow_up",
          },
        },
      ],
      readiness: {
        blockerCount: 0,
        carryForwardCount: 1,
        readyCount: 1,
        reviewCount: 1,
        status: "needs_review",
      },
      sourceSubjects: [
        {
          id: "txn-void",
          label: "TXN-VOID",
          type: "pos_transaction",
        },
      ],
      summary: dailyCloseSummary({
        netCashVariance: -1200,
        salesTotal: 42000,
        transactionCount: 1,
        voidedTransactionCount: 1,
      }),
    });
    const { db, patches } = createDb({
      automationRun: [
        {
          _id: "automation-run-1",
          action: "eod.auto_complete",
          appliedAt: Date.UTC(2026, 4, 7, 22),
          createdAt: Date.UTC(2026, 4, 7, 21),
          decisionEvidence: {
            kind: "eod_auto_complete",
            observed: {
              absoluteCashVariance: 1200,
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
            "daily_operations:eod.auto_complete:store-1:2026-05-07",
          mutationBoundary: "daily_close",
          operatingDate: "2026-05-07",
          outcome: "applied",
          policyMode: "enabled",
          policyVersion: "daily-operations.v1",
          snapshotCounts: {},
          sourceSubjects: [{ id: "txn-void", type: "pos_transaction" }],
          storeId: "store-1",
          triggerType: "scheduled",
          updatedAt: Date.UTC(2026, 4, 7, 22),
        },
      ],
      dailyClose: [
        {
          _id: "daily-close-automation",
          actorType: "automation",
          automationDecisionReason:
            "EOD Review has only low-risk review evidence within policy thresholds.",
          automationPolicyVersion: "daily-operations.v1",
          automationRunId: "automation-run-1",
          carryForwardWorkItemIds: ["work-1"],
          completedAt: Date.UTC(2026, 4, 7, 22),
          createdAt: Date.UTC(2026, 4, 7, 22),
          isCurrent: true,
          lifecycleStatus: "active",
          operatingDate: "2026-05-07",
          organizationId: "org-1",
          policyReviewedItemKeys: ["pos_transaction:txn-void:void"],
          readiness: automationSnapshot.readiness,
          reportSnapshot: automationSnapshot,
          sourceSubjects: automationSnapshot.sourceSubjects,
          status: "completed",
          storeId: "store-1",
          summary: automationSnapshot.summary,
          updatedAt: Date.UTC(2026, 4, 7, 22),
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(snapshot.status).toBe("completed");
    expect(snapshot.completedClose).toMatchObject({
      actorType: "automation",
      automationRunId: "automation-run-1",
      policyReviewedItemKeys: ["pos_transaction:txn-void:void"],
    });

    const broadSnapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        includeManagerReviewEvidence: false,
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(broadSnapshot.completedClose).toMatchObject({
      actorType: "automation",
      automationRunId: "automation-run-1",
      dailyCloseId: "daily-close-automation",
      restrictedDetailsRedacted: true,
    });
    expect(broadSnapshot.completedClose).not.toHaveProperty(
      "policyReviewedItemKeys",
    );
    expect(broadSnapshot.existingClose).toBeNull();
    expect(broadSnapshot.priorClose).toBeNull();
    expect(broadSnapshot.sourceSubjects).toEqual([]);
    const redactedReviewedSale = broadSnapshot.reviewItems.find(
      (item) => item.category === "voided_sale",
    );
    expect(redactedReviewedSale?.metadata).toMatchObject({
      paymentMethods: "cash",
    });
    expect(redactedReviewedSale?.metadata).not.toHaveProperty("total");
    expect(redactedReviewedSale?.metadata).not.toHaveProperty("totalPaid");
    expect(broadSnapshot.carryForwardItems[0]).toMatchObject({
      key: "carry_forward:open_work:0",
      metadata: {
        priority: "normal",
        status: "open",
        type: "customer_follow_up",
      },
      subject: {
        id: "redacted",
        type: "operational_work_item",
      },
    });

    const trustedDetail = await getCompletedDailyCloseHistoryDetailWithCtx(
      { db } as unknown as QueryCtx,
      {
        dailyCloseId: "daily-close-automation" as Id<"dailyClose">,
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(trustedDetail).toMatchObject({
      actorType: "automation",
      automationRunId: "automation-run-1",
    });
    expect(
      trustedDetail?.reportSnapshot.reviewedItems[0].metadata,
    ).toMatchObject({
      total: 42000,
    });

    const broadDetail = await getCompletedDailyCloseHistoryDetailWithCtx(
      { db } as unknown as QueryCtx,
      {
        dailyCloseId: "daily-close-automation" as Id<"dailyClose">,
        includeManagerReviewEvidence: false,
        storeId: "store-1" as Id<"store">,
      },
    );
    expect(broadDetail).toMatchObject({
      actorType: "automation",
      automationDecisionReason:
        "EOD Review has only low-risk review evidence within policy thresholds.",
      automationRunId: "automation-run-1",
    });
    expect(broadDetail?.reportSnapshot.closeMetadata).not.toHaveProperty(
      "policyReviewedItemKeys",
    );
    expect(
      broadDetail?.reportSnapshot.closeMetadata.carryForwardWorkItemIds,
    ).toEqual([]);
    expect(broadDetail?.reportSnapshot.carryForwardItems[0]).toMatchObject({
      key: "carry_forward:open_work:0",
      metadata: {
        priority: "normal",
        status: "open",
        type: "customer_follow_up",
      },
      subject: {
        id: "redacted",
        type: "operational_work_item",
      },
    });
    expect(broadDetail?.reportSnapshot.summary).toMatchObject({
      registerVarianceCount: 0,
      transactionCount: 1,
    });
    expect(broadDetail?.reportSnapshot.summary).not.toHaveProperty(
      "netCashVariance",
    );
    expect(broadDetail?.reportSnapshot.summary).not.toHaveProperty(
      "salesTotal",
    );
    expect(broadDetail?.reportSnapshot.reviewedItems[0].metadata).toMatchObject(
      {
        paymentMethods: "cash",
      },
    );
    expect(
      broadDetail?.reportSnapshot.reviewedItems[0].metadata,
    ).not.toHaveProperty("total");
    expect(
      broadDetail?.reportSnapshot.reviewedItems[0].metadata,
    ).not.toHaveProperty("totalPaid");
    expect(broadDetail?.reportSnapshot.sourceSubjects).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("pushes the prior completed close date boundary into the daily close index", async () => {
    const newerCompletedCloses = Array.from({ length: 250 }, (_, index) => {
      const operatingDate = new Date(Date.UTC(2026, 6, 1 + index))
        .toISOString()
        .slice(0, 10);

      return {
        _id: `daily-close-newer-${index}`,
        carryForwardWorkItemIds: [],
        completedAt: Date.UTC(2026, 6, 1 + index, 22),
        createdAt: Date.UTC(2026, 6, 1 + index, 22),
        isCurrent: false,
        lifecycleStatus: "active",
        operatingDate,
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
        summary: dailyCloseSummary({ salesTotal: index + 1 }),
        updatedAt: Date.UTC(2026, 6, 1 + index, 22),
      };
    });
    const priorCompletedClose = {
      _id: "daily-close-prior-indexed",
      carryForwardWorkItemIds: [],
      completedAt: Date.UTC(2026, 4, 7, 22),
      createdAt: Date.UTC(2026, 4, 7, 22),
      isCurrent: false,
      lifecycleStatus: "active",
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
      summary: dailyCloseSummary({ salesTotal: 45_000 }),
      updatedAt: Date.UTC(2026, 4, 7, 22),
    };
    const { db, queryLog } = createDb({
      dailyClose: [priorCompletedClose, ...newerCompletedCloses],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.priorClose?._id).toBe("daily-close-prior-indexed");
    expect(snapshot.priorDaySummary).toMatchObject({
      salesTotal: 45_000,
    });
    const priorCloseQuery = queryLog.find(
      (entry) =>
        entry.table === "dailyClose" &&
        entry.index === "by_storeId_status_operatingDate",
    );
    expect(priorCloseQuery?.filters).toContainEqual([
      "operatingDate",
      { lt: "2026-05-08" },
    ]);
  });

  it("keeps human completion attribution when stale automation runs exist", async () => {
    const humanSnapshot = completedDailyCloseSnapshot();
    const { db } = createDb({
      automationRun: [
        {
          _id: "automation-run-skipped",
          action: "eod.auto_complete",
          createdAt: Date.UTC(2026, 4, 7, 23),
          decisionReason: "EOD Review is already completed for this store day.",
          domain: "daily_operations",
          idempotencyKey:
            "daily_operations:eod.auto_complete:store-1:2026-05-07",
          mutationBoundary: "daily_close",
          operatingDate: "2026-05-07",
          outcome: "skipped",
          policyMode: "dry_run",
          policyVersion: "daily-operations.v1",
          snapshotCounts: {},
          sourceSubjects: [],
          storeId: "store-1",
          triggerType: "scheduled",
          updatedAt: Date.UTC(2026, 4, 7, 23),
        },
      ],
      dailyClose: [completedDailyCloseRow({ reportSnapshot: humanSnapshot })],
      staffProfile: [
        {
          _id: "staff-manager-1",
          fullName: "Kwamina Mensah",
          organizationId: "org-1",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyCloseSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        operatingDate: "2026-05-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.status).toBe("completed");
    expect(snapshot.completedClose).toMatchObject({
      completedByStaffName: "Kwamina Mensah",
      completedByStaffProfileId: "staff-manager-1",
      completedByUserId: "user-1",
    });
    expect(snapshot.completedClose).not.toHaveProperty("actorType");
    expect(snapshot.completedClose).not.toHaveProperty("automationRunId");
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

  it("redacts prior close and carry-forward identifiers on the exported opening context query", async () => {
    const humanSnapshot = completedDailyCloseSnapshot({
      carryForwardItems: [
        {
          key: "operational_work_item:work-1:carry_forward",
          severity: "carry_forward",
          category: "open_work",
          title: "Carry forward",
          message: "Carry forward work remains open.",
          subject: {
            id: "work-1",
            label: "Carry forward",
            type: "operational_work_item",
          },
          metadata: {
            workItemId: "work-1",
          },
        },
      ],
      closeMetadata: {
        ...completedDailyCloseSnapshot().closeMetadata,
        carryForwardWorkItemIds: ["work-1"],
      },
      readiness: {
        blockerCount: 0,
        carryForwardCount: 1,
        readyCount: 1,
        reviewCount: 0,
        status: "ready",
      },
    });
    const { db } = createDb({
      dailyClose: [
        completedDailyCloseRow({
          carryForwardWorkItemIds: ["work-1"],
          readiness: humanSnapshot.readiness,
          reportSnapshot: humanSnapshot,
          sourceSubjects: humanSnapshot.sourceSubjects,
          summary: humanSnapshot.summary,
        }),
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: 4,
          metadata: {
            source: "manager_note",
          },
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
    const handler = getHandler<
      {
        operatingDate: string;
        storeId: Id<"store">;
      },
      Promise<{
        priorClose: Record<string, unknown> | null;
        carryForwardWorkItems: Array<Record<string, unknown>>;
      }>
    >(getDailyCloseOpeningContext);

    const context = await handler({ db } as unknown as QueryCtx, {
      operatingDate: "2026-05-08",
      storeId: "store-1" as Id<"store">,
    });

    expect(context.priorClose).toMatchObject({
      completedAt: Date.UTC(2026, 4, 7, 22),
      operatingDate: "2026-05-07",
      status: "completed",
    });
    expect(context.priorClose).not.toHaveProperty("_id");
    expect(context.priorClose).not.toHaveProperty("carryForwardWorkItemIds");
    expect(context.priorClose).not.toHaveProperty("organizationId");
    expect(context.priorClose).not.toHaveProperty("storeId");
    expect(context.carryForwardWorkItems).toEqual([
      {
        approvalState: "not_required",
        priority: "normal",
        status: "open",
        title: "Carry forward",
        type: "daily_close_carry_forward",
      },
    ]);
    expect(context.carryForwardWorkItems[0]).not.toHaveProperty("_id");
    expect(context.carryForwardWorkItems[0]).not.toHaveProperty("metadata");
    expect(context.carryForwardWorkItems[0]).not.toHaveProperty(
      "organizationId",
    );
    expect(context.carryForwardWorkItems[0]).not.toHaveProperty("storeId");
  });
});
