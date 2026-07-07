import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  getEodAutoCompletePolicyConfigWithCtx,
  upsertEodAutoCompletePolicyConfigWithCtx,
} from "../automation/runLedger";
import {
  getEodAutoCompletePolicy,
  getOpeningAutoStartPolicy,
  getRegisterCloseoutApprovalPolicy,
  prepareDailyCloseAutomationWithCtx,
  runHistoricEodAutoCloseBatchWithCtx,
  runDailyCloseAutoCompleteEligibilityWithCtx,
  runConfiguredDailyOperationsAutomationWithCtx,
  runDailyOpeningAutomationWithCtx,
  runScheduledDailyOperationsAutomationWithCtx,
  sendDailyManagerReportsForAppliedEodAutomationWithCtx,
  updateEodAutoCompletePolicy,
  updateOpeningAutoStartPolicy,
  updateRegisterCloseoutApprovalPolicy,
} from "./dailyOperationsAutomation";

const accessMocks = vi.hoisted(() => ({
  requireStoreFullAdminAccess: vi.fn(),
}));

vi.mock("../stockOps/access", () => ({
  requireStoreFullAdminAccess: accessMocks.requireStoreFullAdminAccess,
}));

type TableName =
  | "approvalRequest"
  | "automationPolicy"
  | "automationRun"
  | "dailyClose"
  | "dailyOpening"
  | "expenseSession"
  | "expenseTransaction"
  | "operationalEvent"
  | "operationalWorkItem"
  | "paymentAllocation"
  | "posSession"
  | "posTerminal"
  | "posTransaction"
  | "posTransactionAdjustment"
  | "registerSession"
  | "staffProfile"
  | "store"
  | "storeSchedule";

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
      [string, unknown | { gte?: unknown; lt?: unknown; lte?: unknown }]
    > = [];
    let sortDirection: "asc" | "desc" = "asc";
    const compareValues = (left: unknown, right: unknown) =>
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left ?? "").localeCompare(String(right ?? ""));
    const filteredRows = () => {
      const rows = Array.from(tableFor(table).values()).filter((row) =>
        filters.every(([field, value]) => {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            if ("gte" in value && compareValues(row[field], value.gte) < 0) {
              return false;
            }

            if ("lt" in value && compareValues(row[field], value.lt) >= 0) {
              return false;
            }

            if ("lte" in value && compareValues(row[field], value.lte) > 0) {
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
      async *[Symbol.asyncIterator]() {
        yield* filteredRows();
      },
      order(direction: "asc" | "desc") {
        sortDirection = direction;
        return chain;
      },
      take: async (limit: number) => filteredRows().slice(0, limit),
      withIndex(
        _index: string,
        applyIndex: (builder: {
          eq: (field: string, value: unknown) => typeof builder;
          gte: (field: string, value: unknown) => typeof builder;
          lt: (field: string, value: unknown) => typeof builder;
          lte: (field: string, value: unknown) => typeof builder;
        }) => unknown,
      ) {
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return builder;
          },
          gte(field: string, value: unknown) {
            filters.push([field, { gte: value }]);
            return builder;
          },
          lt(field: string, value: unknown) {
            filters.push([field, { lt: value }]);
            return builder;
          },
          lte(field: string, value: unknown) {
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
      tableOrId: TableName | string,
      idOrPatch: string | Record<string, unknown>,
      maybePatch?: Record<string, unknown>,
    ) {
      const explicitTable =
        typeof idOrPatch === "string" ? (tableOrId as TableName) : null;
      const id = typeof idOrPatch === "string" ? idOrPatch : tableOrId;
      const patch = typeof idOrPatch === "string" ? maybePatch : idOrPatch;
      const tableEntries = explicitTable
        ? [[explicitTable, tableFor(explicitTable)] as const]
        : [...tables.entries()];

      if (!patch) {
        throw new Error(`Missing patch for row ${id}`);
      }

      for (const [table, rows] of tableEntries) {
        const row = rows.get(id);

        if (row) {
          Object.assign(row, patch);
          patches.push({ id, table, value: patch });
          return;
        }
      }

      throw new Error(`Missing row ${id}`);
    },
    query,
  };

  return { db, inserts, patches, tables };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

const store = {
  _id: "store-1",
  createdByUserId: "user-1",
  currency: "GHS",
  name: "Accra",
  organizationId: "org-1",
  slug: "accra",
};

function policy(
  action: "opening.auto_start" | "eod.prepare" | "eod.auto_complete",
  mode: "disabled" | "dry_run" | "enabled",
  overrides: Partial<Row> = {},
) {
  return {
    _id: `policy-${action}-${mode}-${overrides.storeId ?? "store-1"}`,
    action,
    createdAt: 1,
    domain: "daily_operations",
    mode,
    policyVersion: "daily-operations.v1",
    storeId: "store-1",
    updatedAt: 1,
    ...overrides,
  };
}

function closedRegisterSession(overrides: Partial<Row> = {}): Row {
  return {
    _id: "register-1",
    closedAt: Date.UTC(2026, 5, 8, 21),
    countedCash: 25000,
    expectedCash: 25000,
    openedAt: Date.UTC(2026, 5, 8, 8),
    registerNumber: "1",
    status: "closed",
    storeId: "store-1",
    ...overrides,
  };
}

function completedTransaction(overrides: Partial<Row> = {}): Row {
  return {
    _id: "txn-1",
    completedAt: Date.UTC(2026, 5, 8, 14),
    payments: [{ amount: 12000, method: "cash", timestamp: 1 }],
    status: "completed",
    storeId: "store-1",
    subtotal: 12000,
    tax: 0,
    total: 12000,
    totalPaid: 12000,
    transactionNumber: "TXN-1",
    ...overrides,
  };
}

function storeSchedule(overrides: Partial<Row> = {}): Row {
  return {
    _id: "storeSchedule-1",
    createdAt: 1,
    dateExceptions: [],
    effectiveFrom: Date.UTC(2026, 0, 1),
    organizationId: "org-1",
    source: "admin",
    status: "active",
    storeId: "store-1",
    timezone: "UTC",
    updatedAt: 1,
    weeklyClosedDays: [],
    weeklyWindows: [
      {
        dayOfWeek: 1,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      },
    ],
    ...overrides,
  };
}

function completedDailyClose(overrides: Partial<Row> = {}): Row {
  return {
    _id: "daily-close-1",
    carryForwardWorkItemIds: [],
    completedAt: Date.UTC(2026, 5, 7, 22),
    completedByStaffProfileId: "staff-1",
    completedByUserId: "user-1",
    createdAt: Date.UTC(2026, 5, 7, 22),
    isCurrent: false,
    lifecycleStatus: "active",
    operatingDate: "2026-06-07",
    organizationId: "org-1",
    readiness: {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
      reviewCount: 0,
      status: "ready",
    },
    sourceSubjects: [{ type: "pos_transaction", id: "txn-1", label: "TXN-1" }],
    status: "completed",
    storeId: "store-1",
    summary: { salesTotal: 12000 },
    updatedAt: Date.UTC(2026, 5, 7, 22),
    ...overrides,
  };
}

function restoreStageEnv(originalStage: string | undefined) {
  if (originalStage === undefined) {
    delete process.env.STAGE;
  } else {
    process.env.STAGE = originalStage;
  }
}

describe("daily operations automation adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    accessMocks.requireStoreFullAdminAccess.mockReset();
  });

  it("requires full-admin access for Opening auto-start policy reads", async () => {
    const { db } = createDb({ store: [store] });
    accessMocks.requireStoreFullAdminAccess.mockRejectedValue(
      new Error("Only full admins can access stock operations."),
    );

    await expect(
      getHandler(getOpeningAutoStartPolicy)({ db } as unknown as MutationCtx, {
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Only full admins can access stock operations.");
  });

  it("requires full-admin access for Opening auto-start policy writes", async () => {
    const { db } = createDb({ store: [store] });
    accessMocks.requireStoreFullAdminAccess.mockRejectedValue(
      new Error("Only full admins can access stock operations."),
    );

    await expect(
      getHandler(updateOpeningAutoStartPolicy)(
        { db } as unknown as MutationCtx,
        {
          localStartMinutes: 480,
          mode: "enabled",
          openingBlockerHandling: "start_with_manager_review",
          operatingTimezoneOffsetMinutes: 0,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).rejects.toThrow("Only full admins can access stock operations.");
  });

  it("requires full-admin access for EOD auto-complete policy reads", async () => {
    const { db } = createDb({ store: [store] });
    accessMocks.requireStoreFullAdminAccess.mockRejectedValue(
      new Error("Only full admins can access stock operations."),
    );

    await expect(
      getHandler(getEodAutoCompletePolicy)({ db } as unknown as MutationCtx, {
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Only full admins can access stock operations.");
  });

  it("requires full-admin access for EOD auto-complete policy writes", async () => {
    const { db, inserts, patches } = createDb({ store: [store] });
    accessMocks.requireStoreFullAdminAccess.mockRejectedValue(
      new Error("Only full admins can access stock operations."),
    );

    await expect(
      getHandler(updateEodAutoCompletePolicy)(
        { db } as unknown as MutationCtx,
        {
          cleanDayAutoCompleteEnabled: true,
          localCompletionWindowMinutes: 1260,
          maxAbsoluteCashVariance: 5000,
          maxVoidedSaleCount: 2,
          maxVoidedSaleTotal: 50000,
          mode: "enabled",
          operatingTimezoneOffsetMinutes: 0,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).rejects.toThrow("Only full admins can access stock operations.");
    expect(inserts).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("requires full-admin access for register closeout approval policy reads", async () => {
    const { db } = createDb({ store: [store] });
    accessMocks.requireStoreFullAdminAccess.mockRejectedValue(
      new Error("Only full admins can access stock operations."),
    );

    await expect(
      getHandler(getRegisterCloseoutApprovalPolicy)(
        { db } as unknown as MutationCtx,
        {
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).rejects.toThrow("Only full admins can access stock operations.");
  });

  it("updates the register closeout approval threshold in store config", async () => {
    const configuredStore = {
      ...store,
      config: {
        operations: {
          cashControls: {
            requireManagerSignoffForShorts: true,
            varianceApprovalThreshold: 5000,
          },
        },
      },
    };
    const { db, patches } = createDb({ store: [configuredStore] });
    accessMocks.requireStoreFullAdminAccess.mockResolvedValue({
      athenaUser: { _id: "user-1" },
      store: configuredStore,
    });

    const readResult = await getHandler(getRegisterCloseoutApprovalPolicy)(
      { db } as unknown as MutationCtx,
      {
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(readResult).toMatchObject({
      requireManagerSignoffForShorts: true,
      varianceApprovalThreshold: 5000,
    });

    const updateResult = await getHandler(updateRegisterCloseoutApprovalPolicy)(
      { db } as unknown as MutationCtx,
      {
        storeId: "store-1" as Id<"store">,
        varianceApprovalThreshold: 7500,
      },
    );

    expect(updateResult).toMatchObject({
      requireManagerSignoffForShorts: true,
      varianceApprovalThreshold: 7500,
    });
    expect(patches).toContainEqual({
      id: "store-1",
      table: "store",
      value: {
        config: {
          operations: {
            cashControls: {
              requireManagerSignoffForShorts: true,
              varianceApprovalThreshold: 7500,
            },
          },
        },
      },
    });
  });

  it("rejects invalid register closeout approval thresholds", async () => {
    const { db } = createDb({ store: [store] });
    accessMocks.requireStoreFullAdminAccess.mockResolvedValue({
      athenaUser: { _id: "user-1" },
      store,
    });

    await expect(
      getHandler(updateRegisterCloseoutApprovalPolicy)(
        { db } as unknown as MutationCtx,
        {
          storeId: "store-1" as Id<"store">,
          varianceApprovalThreshold: -1,
        },
      ),
    ).rejects.toThrow("Variance approval threshold must be non-negative.");
  });

  it("maps Opening auto-start policy API values at the public handler boundary", async () => {
    const { db, tables } = createDb({ store: [store] });
    accessMocks.requireStoreFullAdminAccess.mockResolvedValue({
      athenaUser: { _id: "user-1" },
      store,
    });

    const updateResult = await getHandler(updateOpeningAutoStartPolicy)(
      { db } as unknown as MutationCtx,
      {
        localStartMinutes: 465,
        mode: "enabled",
        openingBlockerHandling: "start_with_manager_review",
        operatingTimezoneOffsetMinutes: 0,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(updateResult).toMatchObject({
      configured: true,
      localStartMinutes: 465,
      mode: "enabled",
      openingBlockerHandling: "start_with_manager_review",
      operatingTimezoneOffsetMinutes: 0,
    });
    expect(
      Array.from(tables.get("automationPolicy")?.values() ?? []),
    ).toContainEqual(
      expect.objectContaining({
        openingBlockerHandling: "manager_review",
        openingLocalStartMinutes: 465,
      }),
    );

    const skipResult = await getHandler(updateOpeningAutoStartPolicy)(
      { db } as unknown as MutationCtx,
      {
        localStartMinutes: 510,
        mode: "dry_run",
        openingBlockerHandling: "skip_when_blocked",
        operatingTimezoneOffsetMinutes: 0,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(skipResult).toMatchObject({
      configured: true,
      localStartMinutes: 510,
      mode: "dry_run",
      openingBlockerHandling: "skip_when_blocked",
    });
    const readResult = await getHandler(getOpeningAutoStartPolicy)(
      { db } as unknown as MutationCtx,
      {
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(readResult).toMatchObject({
      configured: true,
      localStartMinutes: 510,
      mode: "dry_run",
      openingBlockerHandling: "skip_when_blocked",
      operatingTimezoneOffsetMinutes: 0,
    });
  });

  it("rejects invalid Opening auto-start timezone offsets at the API boundary", async () => {
    const { db } = createDb({ store: [store] });
    accessMocks.requireStoreFullAdminAccess.mockResolvedValue({
      athenaUser: { _id: "user-1" },
      store,
    });

    await expect(
      getHandler(updateOpeningAutoStartPolicy)(
        { db } as unknown as MutationCtx,
        {
          localStartMinutes: 480,
          mode: "enabled",
          openingBlockerHandling: "start_with_manager_review",
          operatingTimezoneOffsetMinutes: 15 * 60,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).rejects.toThrow(
      "Operating timezone offset must be within UTC-14 to UTC+14.",
    );
  });

  it("auto-starts only clean Opening Handoff snapshots under enabled policy", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 5, 8, 8));
    const { db, inserts, patches } = createDb({
      automationPolicy: [policy("opening.auto_start", "enabled")],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await runDailyOpeningAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.action).toBe("applied");
    expect(result.run).toMatchObject({
      action: "opening.auto_start",
      domain: "daily_operations",
      outcome: "applied",
      policyMode: "enabled",
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "automationRun",
      "dailyOpening",
      "operationalEvent",
    ]);
    expect(inserts[1].value).toMatchObject({
      actorType: "automation",
      automationDecisionReason: "Opening Handoff snapshot is clean.",
      automationPolicyVersion: "daily-operations.v1",
      automationRunId: "automationRun-1",
      operatingDate: "2026-06-08",
      status: "started",
    });
    expect(inserts[2].value).toMatchObject({
      actorType: "automation",
      automationRunId: "automationRun-1",
      eventType: "daily_opening_auto_started",
      message: "Athena started Opening Handoff for 2026-06-08.",
    });
    expect(patches).toContainEqual(
      expect.objectContaining({
        id: "automationRun-1",
        value: expect.objectContaining({
          eventIds: ["operationalEvent-1"],
          outcome: "applied",
        }),
      }),
    );
  });

  it("records dry-run Opening decisions without inserting dailyOpening", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [policy("opening.auto_start", "dry_run")],
      dailyClose: [
        completedDailyClose({
          isCurrent: true,
          reportSnapshot: {
            closeMetadata: {
              carryForwardWorkItemIds: [],
              completedAt: Date.UTC(2026, 5, 7, 22),
              completedByUserId: "user-1",
              endAt: Date.UTC(2026, 5, 8),
              operatingDate: "2026-06-07",
              organizationId: "org-1",
              startAt: Date.UTC(2026, 5, 7),
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
            summary: { salesTotal: 12000 },
          },
        }),
      ],
      store: [store],
      storeSchedule: [
        storeSchedule({
          weeklyWindows: [
            { dayOfWeek: 6, startMinute: 9 * 60, endMinute: 17 * 60 },
            { dayOfWeek: 0, startMinute: 9 * 60, endMinute: 17 * 60 },
          ],
        }),
      ],
    });

    const result = await runDailyOpeningAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      outcome: "dry_run",
      policyMode: "dry_run",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("skips Opening automation when review or carry-forward acknowledgement is required", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [policy("opening.auto_start", "enabled")],
      dailyClose: [
        completedDailyClose({
          lifecycleStatus: "reopened",
          reopenedAt: Date.UTC(2026, 5, 8, 7),
          reopenReason: "Cash deposit was corrected.",
        }),
      ],
      store: [store],
      storeSchedule: [
        storeSchedule({
          weeklyWindows: [
            { dayOfWeek: 6, startMinute: 9 * 60, endMinute: 17 * 60 },
            { dayOfWeek: 0, startMinute: 9 * 60, endMinute: 17 * 60 },
          ],
        }),
      ],
    });

    const result = await runDailyOpeningAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionReason:
        "Opening Handoff requires human review or carry-forward acknowledgement.",
      outcome: "skipped",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("records skipped Opening decisions when Opening Handoff is already started", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [policy("opening.auto_start", "enabled")],
      dailyClose: [completedDailyClose()],
      dailyOpening: [
        {
          _id: "daily-opening-1",
          actorType: "human",
          createdAt: Date.UTC(2026, 5, 8, 8),
          operatingDate: "2026-06-08",
          organizationId: "org-1",
          readiness: {
            blockerCount: 0,
            carryForwardCount: 0,
            readyCount: 1,
            reviewCount: 0,
            status: "ready",
          },
          sourceSubjects: [],
          status: "started",
          storeId: "store-1",
          updatedAt: Date.UTC(2026, 5, 8, 8),
        },
      ],
      store: [store],
    });

    const result = await runDailyOpeningAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionReason: "Opening Handoff is already started for this store day.",
      outcome: "skipped",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("prepares EOD Review without completing close or writing reviewed item keys", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [policy("eod.prepare", "enabled")],
      posTransaction: [
        {
          _id: "txn-1",
          completedAt: Date.UTC(2026, 5, 8, 14),
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

    const result = await prepareDailyCloseAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      action: "eod.prepare",
      decisionReason:
        "EOD Review is ready for manager approval; automation will not complete it.",
      outcome: "prepared",
      snapshotCounts: {
        blockerCount: 0,
        carryForwardCount: 0,
        readyCount: 1,
        reviewCount: 0,
      },
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
    expect(inserts[0].value).not.toHaveProperty("reviewedItemKeys");
  });

  it("skips EOD preparation when the review is already completed", async () => {
    const reportSnapshot = {
      carryForwardItems: [],
      carryForwardWorkItemIds: [],
      closeMetadata: {
        completedAt: Date.UTC(2026, 5, 8, 22),
        completedByUserId: "user-1",
        endAt: Date.UTC(2026, 5, 9),
        operatingDate: "2026-06-08",
        organizationId: "org-1",
        startAt: Date.UTC(2026, 5, 8),
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
      reviewedItemKeys: ["pos_transaction:txn-1"],
      reviewedItems: [],
      sourceSubjects: [{ type: "pos_transaction", id: "txn-1" }],
      summary: { salesTotal: 12000 },
    };
    const { db, inserts } = createDb({
      automationPolicy: [policy("eod.prepare", "enabled")],
      dailyClose: [
        completedDailyClose({
          operatingDate: "2026-06-08",
          reportSnapshot,
        }),
      ],
      store: [store],
    });

    const result = await prepareDailyCloseAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionReason: "EOD Review is already completed for this store day.",
      outcome: "skipped",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("defaults absent EOD auto-complete policy to disabled", async () => {
    const { db } = createDb({ store: [store] });

    await expect(
      getEodAutoCompletePolicyConfigWithCtx({ db } as unknown as MutationCtx, {
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      cleanDayAutoCompleteEnabled: false,
      configured: false,
      localCompletionWindowMinutes: 0,
      maxAbsoluteCashVariance: 0,
      maxVoidedSaleCount: 0,
      maxVoidedSaleTotal: 0,
      mode: "disabled",
      paused: false,
      policy: null,
    });
  });

  it("rejects invalid EOD auto-complete policy thresholds and completion window", async () => {
    const { db } = createDb({ store: [store] });

    await expect(
      upsertEodAutoCompletePolicyConfigWithCtx(
        { db } as unknown as MutationCtx,
        {
          cleanDayAutoCompleteEnabled: true,
          localCompletionWindowMinutes: 24 * 60,
          maxAbsoluteCashVariance: 0,
          maxVoidedSaleCount: 0,
          maxVoidedSaleTotal: 0,
          mode: "enabled",
          operatingTimezoneOffsetMinutes: 0,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).rejects.toThrow(
      "EOD local completion window must be within one local day.",
    );

    await expect(
      upsertEodAutoCompletePolicyConfigWithCtx(
        { db } as unknown as MutationCtx,
        {
          cleanDayAutoCompleteEnabled: true,
          localCompletionWindowMinutes: 0,
          maxAbsoluteCashVariance: -1,
          maxVoidedSaleCount: 0,
          maxVoidedSaleTotal: 0,
          mode: "enabled",
          operatingTimezoneOffsetMinutes: 0,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).rejects.toThrow("EOD auto-complete thresholds must be non-negative.");
  });

  it("records structured evidence when EOD auto-complete is disabled by absent policy", async () => {
    const { db, inserts } = createDb({
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      action: "eod.auto_complete",
      decisionEvidence: {
        kind: "eod_auto_complete",
        observed: {
          absoluteCashVariance: 0,
          blockerCount: 0,
          carryForwardCount: 0,
          reviewCount: 0,
          voidedSaleCount: 0,
          voidedSaleTotal: 0,
        },
        policy: {
          cleanDayAutoCompleteEnabled: false,
          localCompletionWindowMinutes: 0,
          maxAbsoluteCashVariance: 0,
          maxVoidedSaleCount: 0,
          maxVoidedSaleTotal: 0,
          mode: "disabled",
        },
      },
      outcome: "disabled",
      policyMode: "disabled",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("auto-completes clean EOD review days when clean-day policy is enabled", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          eodMaxAbsoluteCashVariance: 0,
          eodMaxVoidedSaleCount: 0,
          eodMaxVoidedSaleTotal: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      action: "eod.auto_complete",
      decisionEvidence: {
        classification: "clean_day",
        eligible: true,
      },
      decisionReason: "EOD Review is clean and eligible for auto-complete.",
      eventIds: ["operationalEvent-1"],
      outcome: "applied",
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "automationRun",
      "dailyClose",
      "operationalEvent",
    ]);
    expect(inserts.at(-1)?.value).toMatchObject({
      actorType: "automation",
      automationRunId: "automationRun-1",
      eventType: "daily_close_completed",
      metadata: {
        policyReviewedItemKeys: [],
      },
    });
  });

  it("sends manager reports for freshly applied or prepared EOD automation outcomes", async () => {
    const originalStage = process.env.STAGE;
    process.env.STAGE = "prod";
    const runAction = vi.fn(async (_functionRef: unknown, args: unknown) => {
      const operatingDate = (args as { operatingDate: string }).operatingDate;

      return [
        {
          ...(operatingDate === "2026-06-08"
            ? { dailyCloseId: "daily-close-1" }
            : {}),
          operatingDate,
          recipientEmail: "manager@example.com",
          status: 202,
          storeName: "Accra",
        },
      ];
    });

    try {
      const result = await sendDailyManagerReportsForAppliedEodAutomationWithCtx(
        { runAction } as never,
        {
          results: [
            {
              action: "applied",
              run: {
                _id: "automation-run-applied",
                operatingDate: "2026-06-08",
                outcome: "applied",
                storeId: "store-1",
              },
            },
            {
              action: "already_recorded",
              run: {
                _id: "automation-run-existing",
                operatingDate: "2026-06-07",
                outcome: "applied",
                storeId: "store-1",
              },
            },
            {
              action: "recorded",
              run: {
                _id: "automation-run-skipped",
                operatingDate: "2026-06-06",
                outcome: "skipped",
                storeId: "store-1",
              },
            },
            {
              action: "recorded",
              run: {
                _id: "automation-run-prepared",
                operatingDate: "2026-06-05",
                outcome: "prepared",
                storeId: "store-1",
              },
            },
          ] as never,
        },
      );

      expect(runAction).toHaveBeenCalledTimes(2);
      expect(runAction.mock.calls[0]?.[1]).toEqual({
        operatingDate: "2026-06-08",
        status: "applied",
        storeId: "store-1",
      });
      expect(runAction.mock.calls[1]?.[1]).toEqual({
        operatingDate: "2026-06-05",
        status: "prepared",
        storeId: "store-1",
      });
      expect(result).toEqual([
        {
          operatingDate: "2026-06-08",
          reports: [
            {
              dailyCloseId: "daily-close-1",
              operatingDate: "2026-06-08",
              recipientEmail: "manager@example.com",
              status: 202,
              storeName: "Accra",
            },
          ],
          runId: "automation-run-applied",
          storeId: "store-1",
        },
        {
          operatingDate: "2026-06-05",
          reports: [
            {
              operatingDate: "2026-06-05",
              recipientEmail: "manager@example.com",
              status: 202,
              storeName: "Accra",
            },
          ],
          runId: "automation-run-prepared",
          storeId: "store-1",
        },
      ]);
    } finally {
      restoreStageEnv(originalStage);
    }
  });

  it("skips scheduled manager report sends outside production", async () => {
    const originalStage = process.env.STAGE;
    process.env.STAGE = "";
    const runAction = vi.fn();

    try {
      const result = await sendDailyManagerReportsForAppliedEodAutomationWithCtx(
        { runAction } as never,
        {
          results: [
            {
              action: "applied",
              run: {
                _id: "automation-run-applied",
                operatingDate: "2026-06-08",
                outcome: "applied",
                storeId: "store-1",
              },
            },
            {
              action: "recorded",
              run: {
                _id: "automation-run-prepared",
                operatingDate: "2026-06-05",
                outcome: "prepared",
                storeId: "store-1",
              },
            },
          ] as never,
        },
      );

      expect(runAction).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    } finally {
      restoreStageEnv(originalStage);
    }
  });

  it("persists canonical store schedule context in EOD auto-complete evidence", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          eodMaxAbsoluteCashVariance: 0,
          eodMaxVoidedSaleCount: 0,
          eodMaxVoidedSaleTotal: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 22, 15),
        operatingDate: "2026-06-08",
        storeDayContext: {
          closedAt: Date.UTC(2026, 5, 8, 22),
          eodEvaluationAt: Date.UTC(2026, 5, 8, 22),
          openedAt: Date.UTC(2026, 5, 8, 8),
          operatingDate: "2026-06-08",
          scheduleVersion: "store-schedule.v3",
          source: "canonical_schedule",
          storeScheduleId: "storeSchedule-1",
        },
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      action: "eod.auto_complete",
      decisionEvidence: {
        observed: {
          scheduleClosedAt: Date.UTC(2026, 5, 8, 22),
          scheduleEvaluationAt: Date.UTC(2026, 5, 8, 22),
          scheduleEvidenceSource: "canonical_schedule",
          scheduleOpenedAt: Date.UTC(2026, 5, 8, 8),
          scheduleVersion: "store-schedule.v3",
          storeScheduleId: "storeSchedule-1",
        },
      },
      outcome: "applied",
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "automationRun",
      "dailyClose",
      "operationalEvent",
    ]);
  });

  it("skips clean EOD review days when clean-day auto-complete is disabled", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: false,
          eodLocalCompletionWindowMinutes: 0,
          eodMaxAbsoluteCashVariance: 0,
          eodMaxVoidedSaleCount: 0,
          eodMaxVoidedSaleTotal: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionEvidence: {
        classification: "clean_day",
        eligible: false,
      },
      decisionReason:
        "EOD Review is clean, but clean-day auto-complete is disabled by policy.",
      outcome: "skipped",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("auto-completes low-risk EOD review days when review evidence stays within policy thresholds", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: false,
          eodLocalCompletionWindowMinutes: 0,
          eodMaxAbsoluteCashVariance: 500,
          eodMaxVoidedSaleCount: 1,
          eodMaxVoidedSaleTotal: 300,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [
        completedTransaction(),
        completedTransaction({
          _id: "txn-void",
          status: "void",
          total: 300,
          totalPaid: 300,
          transactionNumber: "TXN-VOID",
          voidedAt: Date.UTC(2026, 5, 8, 16),
        }),
      ],
      registerSession: [
        closedRegisterSession({
          countedCash: 25300,
          expectedCash: 25000,
          variance: 300,
        }),
      ],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionEvidence: {
        classification: "low_risk_review",
        eligible: true,
        observed: {
          absoluteCashVariance: 300,
          reviewCount: 2,
          voidedSaleCount: 1,
          voidedSaleTotal: 300,
        },
      },
      decisionReason:
        "EOD Review has only low-risk review evidence within policy thresholds.",
      eventIds: ["operationalEvent-1"],
      outcome: "applied",
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "automationRun",
      "dailyClose",
      "operationalEvent",
    ]);
    expect(
      inserts.find((insert) => insert.table === "dailyClose")?.value,
    ).toMatchObject({
      actorType: "automation",
      automationRunId: "automationRun-1",
      policyReviewedItemKeys: expect.arrayContaining([
        "register_session:register-1:variance",
        "pos_transaction:txn-void:void",
      ]),
    });
  });

  it("skips low-risk EOD review days when policy thresholds are exceeded", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: false,
          eodLocalCompletionWindowMinutes: 0,
          eodMaxAbsoluteCashVariance: 100,
          eodMaxVoidedSaleCount: 1,
          eodMaxVoidedSaleTotal: 300,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [
        completedTransaction(),
        completedTransaction({
          _id: "txn-void",
          status: "void",
          total: 300,
          totalPaid: 300,
          transactionNumber: "TXN-VOID",
          voidedAt: Date.UTC(2026, 5, 8, 16),
        }),
      ],
      registerSession: [
        closedRegisterSession({
          countedCash: 25300,
          expectedCash: 25000,
          variance: 300,
        }),
      ],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionEvidence: {
        classification: "review_threshold_exceeded",
        eligible: false,
        gates: expect.arrayContaining([
          {
            key: "absolute_cash_variance",
            passed: false,
            reason: "300 <= 100",
          },
        ]),
      },
      decisionReason:
        "EOD Review review evidence exceeds auto-complete policy thresholds.",
      outcome: "skipped",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("skips EOD auto-complete when the review is already completed", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      dailyClose: [
        completedDailyClose({
          isCurrent: true,
          reportSnapshot: {
            closeMetadata: {
              carryForwardWorkItemIds: [],
              completedAt: Date.UTC(2026, 5, 7, 22),
              completedByUserId: "user-1",
              endAt: Date.UTC(2026, 5, 8),
              operatingDate: "2026-06-07",
              organizationId: "org-1",
              startAt: Date.UTC(2026, 5, 7),
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
            summary: { salesTotal: 12000 },
          },
        }),
      ],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-07",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionEvidence: {
        classification: "completed",
        eligible: false,
      },
      decisionReason: "EOD Review is already completed for this store day.",
      outcome: "skipped",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("does not record configured EOD auto-complete runs before the local completion window", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 17 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 16, 59),
      },
    );

    expect(result.eodAutoCompleteResults).toHaveLength(0);
    expect(inserts.map((insert) => insert.table)).toEqual([]);
  });

  it("records explicit scheduled EOD auto-complete skips before the local completion window", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 17 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runScheduledDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 16, 59),
        operatingDate: "2026-06-08",
      },
    );

    expect(result.eodAutoCompleteResults).toHaveLength(1);
    expect(result.eodAutoCompleteResults[0]?.run).toMatchObject({
      action: "eod.auto_complete",
      decisionEvidence: {
        classification: "outside_completion_window",
        eligible: false,
      },
      outcome: "skipped",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
  });

  it("runs configured EOD auto-complete before customer-facing close when the policy offset is earlier", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 16 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [
        closedRegisterSession({
          closedAt: Date.UTC(2026, 5, 8, 15),
        }),
      ],
      store: [store],
      storeSchedule: [
        storeSchedule({
          timezone: "UTC",
          weeklyWindows: [
            {
              dayOfWeek: 1,
              endMinute: 19 * 60,
              startMinute: 9 * 60,
            },
          ],
        }),
      ],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 16),
      },
    );

    expect(result.eodAutoCompleteResults).toHaveLength(1);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          action: "eod.auto_complete",
          decisionEvidence: expect.objectContaining({
            observed: expect.objectContaining({
              scheduleEvidenceSource: "canonical_schedule",
              storeScheduleId: "storeSchedule-1",
            }),
          }),
          operatingDate: "2026-06-08",
          outcome: "applied",
        }),
      }),
    );
  });

  it("waits after customer-facing close when the EOD policy offset is later", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 18 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
      storeSchedule: [
        storeSchedule({
          timezone: "UTC",
          weeklyWindows: [
            {
              dayOfWeek: 1,
              endMinute: 17 * 60,
              startMinute: 9 * 60,
            },
          ],
        }),
      ],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 17, 30),
      },
    );

    expect(result.eodAutoCompleteResults).toHaveLength(0);
    expect(
      inserts.filter((insert) => insert.table === "automationRun"),
    ).toEqual([]);
  });

  it("derives configured EOD auto-complete operating dates from policy local timezone", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 16 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [
        closedRegisterSession({
          closedAt: Date.UTC(2026, 5, 8, 15),
        }),
      ],
      store: [store],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 9, 1),
      },
    );

    expect(result.eodAutoCompleteResults).toHaveLength(1);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          action: "eod.auto_complete",
          operatingDate: "2026-06-08",
          outcome: "applied",
        }),
      }),
    );
  });

  it("catches up configured EOD auto-complete for the previous day before the local completion window", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 21 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [
        completedTransaction({
          completedAt: Date.UTC(2026, 5, 8, 14),
        }),
      ],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 9, 1),
      },
    );

    expect(result.eodAutoCompleteResults).toHaveLength(1);
    expect(result.eodAutoCompleteResults[0]?.run).toMatchObject({
      action: "eod.auto_complete",
      operatingDate: "2026-06-08",
      outcome: "applied",
    });
    expect(
      inserts.find((insert) => insert.table === "dailyClose")?.value,
    ).toMatchObject({
      actorType: "automation",
      operatingDate: "2026-06-08",
    });
  });

  it("auto-completes blocker-free EOD reviews while preserving carry-forward work", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          eodMaxAbsoluteCashVariance: 500,
          eodMaxVoidedSaleCount: 2,
          eodMaxVoidedSaleTotal: 1000,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 5, 8, 12),
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          subjectId: "cycle-count-1",
          subjectType: "stock_adjustment",
          title: "Cycle count follow-up",
          type: "stock_adjustment_follow_up",
        },
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionEvidence: {
        classification: "clean_day",
        eligible: true,
        observed: {
          carryForwardCount: 1,
          carryForwardItemKeys: ["operational_work_item:work-1:carry_forward"],
          carryForwardPreserved: true,
        },
      },
      outcome: "applied",
    });
    const dailyClose = inserts.find(
      (insert) => insert.table === "dailyClose",
    )?.value;
    expect(dailyClose).toMatchObject({
      actorType: "automation",
      carryForwardWorkItemIds: ["work-1"],
      readiness: {
        carryForwardCount: 1,
      },
      status: "completed",
      summary: {
        carryForwardWorkItemCount: 1,
      },
    });
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
        carryForwardWorkItemIds: ["work-1"],
      },
    });
  });

  it("dry-runs bounded historic EOD auto-close dates oldest-first without closing days", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [
        completedTransaction({
          completedAt: Date.UTC(2026, 5, 6, 14),
        }),
        completedTransaction({
          _id: "txn-2",
          completedAt: Date.UTC(2026, 5, 7, 14),
          payments: [{ amount: 12000, method: "cash", timestamp: 1 }],
          status: "completed",
          storeId: "store-1",
          subtotal: 12000,
          tax: 0,
          total: 12000,
          totalPaid: 12000,
          transactionNumber: "TXN-2",
        }),
      ],
      registerSession: [
        closedRegisterSession({
          closedAt: Date.UTC(2026, 5, 6, 21),
          openedAt: Date.UTC(2026, 5, 6, 8),
        }),
        closedRegisterSession({
          _id: "register-2",
          closedAt: Date.UTC(2026, 5, 7, 21),
          countedCash: 25000,
          expectedCash: 25000,
          openedAt: Date.UTC(2026, 5, 7, 8),
          registerNumber: "2",
          status: "closed",
          storeId: "store-1",
        }),
      ],
      store: [store],
      storeSchedule: [
        storeSchedule({
          weeklyWindows: [
            { dayOfWeek: 6, startMinute: 9 * 60, endMinute: 17 * 60 },
            { dayOfWeek: 0, startMinute: 9 * 60, endMinute: 17 * 60 },
          ],
        }),
      ],
    });

    const result = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 2,
        mode: "dry_run",
        startOperatingDate: "2026-06-06",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      applied: 0,
      candidates: 2,
      failed: 0,
      mode: "dry_run",
      nextOperatingDate: "2026-06-08",
      skipped: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        action: "dry_run",
        classification: "clean_day",
        operatingDate: "2026-06-06",
      }),
      expect.objectContaining({
        action: "dry_run",
        classification: "clean_day",
        operatingDate: "2026-06-07",
      }),
    ]);
    expect(
      inserts.filter((insert) => insert.table !== "automationRun"),
    ).toEqual([]);
    expect(inserts.map((insert) => insert.table)).toEqual([
      "automationRun",
      "automationRun",
    ]);
    expect(inserts.map((insert) => insert.value)).toEqual([
      expect.objectContaining({
        outcome: "dry_run",
        policyMode: "dry_run",
        decisionEvidence: expect.objectContaining({
          classification: "clean_day",
          observed: expect.objectContaining({
            scheduleEvidenceSource: "canonical_schedule",
            storeScheduleId: "storeSchedule-1",
          }),
        }),
      }),
      expect.objectContaining({
        outcome: "dry_run",
        policyMode: "dry_run",
        decisionEvidence: expect.objectContaining({
          classification: "clean_day",
          observed: expect.objectContaining({
            scheduleEvidenceSource: "canonical_schedule",
            storeScheduleId: "storeSchedule-1",
          }),
        }),
      }),
    ]);
    expect(
      inserts.map((insert) => insert.value).map((run) => run.idempotencyKey),
    ).toEqual([
      "daily_operations:eod.auto_complete:historic:store-1:2026-06-06",
      "daily_operations:eod.auto_complete:historic:store-1:2026-06-07",
    ]);
  });

  it("quarantines current or future historic EOD dates with stable run evidence", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      store: [store],
    });

    const result = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-08",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      applied: 0,
      candidates: 1,
      quarantined: 1,
    });
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          action: "eod.auto_complete",
          decisionEvidence: expect.objectContaining({
            classification: "quarantine_current_or_future_date",
            eligible: false,
            observed: expect.objectContaining({
              quarantineReason: "current_or_future_date",
            }),
          }),
          idempotencyKey:
            "daily_operations:eod.auto_complete:historic:store-1:2026-06-08",
          outcome: "skipped",
          triggerType: "support_batch",
        }),
      }),
    );
  });

  it("quarantines a past UTC date while the store-local operating day is still open", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 5, 9, 0, 30));
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: -4 * 60,
        }),
      ],
      store: [store],
      storeSchedule: [
        storeSchedule({
          timezone: "America/New_York",
          weeklyWindows: [
            { dayOfWeek: 1, startMinute: 10 * 60, endMinute: 22 * 60 },
          ],
        }),
      ],
    });

    const result = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-09",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      applied: 0,
      candidates: 1,
      quarantined: 1,
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
    expect(inserts[0].value).toMatchObject({
      decisionEvidence: {
        classification: "quarantine_store_day_still_open",
        eligible: false,
        observed: {
          quarantineReason: "store_day_still_open",
          scheduleEvidenceSource: "canonical_schedule",
          storeScheduleId: "storeSchedule-1",
        },
      },
      outcome: "skipped",
      triggerType: "support_batch",
    });
  });

  it("quarantines historic apply dates when Store Schedule evidence is missing", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      store: [store],
    });

    const result = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      applied: 0,
      candidates: 1,
      quarantined: 1,
      results: [
        expect.objectContaining({
          action: "quarantined",
          classification: "quarantine_missing_store_schedule",
          operatingDate: "2026-06-08",
        }),
      ],
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
    expect(inserts[0].value).toMatchObject({
      decisionEvidence: {
        classification: "quarantine_missing_store_schedule",
        eligible: false,
        observed: expect.objectContaining({
          quarantineReason: "missing_store_schedule",
        }),
      },
      outcome: "skipped",
      policyMode: "enabled",
      triggerType: "support_batch",
    });
  });

  it("applies historic EOD auto-close with full canonical Store Schedule range evidence", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [
        completedTransaction({
          _id: "txn-morning",
          completedAt: Date.UTC(2026, 5, 8, 10),
          transactionNumber: "TXN-MORNING",
        }),
        completedTransaction({
          _id: "txn-evening",
          completedAt: Date.UTC(2026, 5, 8, 18),
          transactionNumber: "TXN-EVENING",
        }),
      ],
      registerSession: [
        closedRegisterSession({
          _id: "register-morning",
          closedAt: Date.UTC(2026, 5, 8, 11),
          closeoutOperatingDate: "2026-06-08",
          openedAt: Date.UTC(2026, 5, 8, 9),
        }),
        closedRegisterSession({
          _id: "register-evening",
          closedAt: Date.UTC(2026, 5, 8, 19),
          closeoutOperatingDate: "2026-06-08",
          openedAt: Date.UTC(2026, 5, 8, 16),
        }),
      ],
      store: [store],
      storeSchedule: [
        storeSchedule({
          weeklyWindows: [
            { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
            { dayOfWeek: 1, startMinute: 16 * 60, endMinute: 20 * 60 },
          ],
        }),
      ],
    });

    const result = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      applied: 1,
      candidates: 1,
      failed: 0,
      quarantined: 0,
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "automationRun",
      "dailyClose",
      "operationalEvent",
    ]);
    expect(
      inserts.find((insert) => insert.table === "dailyClose")?.value,
    ).toMatchObject({
      actorType: "automation",
      automationRunId: "automationRun-1",
      isCurrent: false,
      operatingDate: "2026-06-08",
      reportSnapshot: {
        closeMetadata: {
          endAt: Date.UTC(2026, 5, 8, 20),
          startAt: Date.UTC(2026, 5, 8, 9),
        },
      },
      summary: {
        salesTotal: 24000,
        transactionCount: 2,
      },
    });
    expect(inserts[0].value).toMatchObject({
      decisionEvidence: {
        observed: {
          scheduleEvidenceSource: "canonical_schedule",
          storeScheduleId: "storeSchedule-1",
        },
      },
      triggerType: "support_batch",
    });
  });

  it("quarantines historic apply dates when Store Schedule marks the date closed", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      store: [store],
      storeSchedule: [
        storeSchedule({
          weeklyClosedDays: [1],
          weeklyWindows: [],
        }),
      ],
    });

    const result = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      applied: 0,
      quarantined: 1,
    });
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          decisionEvidence: expect.objectContaining({
            classification: "quarantine_store_schedule_closed",
            observed: expect.objectContaining({
              quarantineReason: "store_schedule_closed",
              scheduleEvidenceSource: "canonical_schedule",
              storeScheduleId: "storeSchedule-1",
            }),
          }),
          outcome: "skipped",
        }),
      }),
    );
  });

  it("quarantines historic apply when Daily Close source reads are incomplete", async () => {
    const cappedTransactions = Array.from({ length: 200 }, (_, index) =>
      completedTransaction({
        _id: `txn-cap-${index + 1}`,
        completedAt: Date.UTC(2026, 5, 8, 14, index % 60),
        transactionNumber: `TXN-CAP-${index + 1}`,
      }),
    );
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: cappedTransactions,
      store: [store],
      storeSchedule: [storeSchedule()],
    });
    const dryRunDb = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: cappedTransactions,
      store: [store],
      storeSchedule: [storeSchedule()],
    });

    const result = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );
    const dryRunResult = await runHistoricEodAutoCloseBatchWithCtx(
      { db: dryRunDb.db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "dry_run",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      applied: 0,
      candidates: 1,
      quarantined: 1,
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
    expect(inserts[0].value).toMatchObject({
      decisionEvidence: {
        classification: "quarantine_incomplete_source_reads",
        eligible: false,
        observed: expect.objectContaining({
          quarantineReason: "incomplete_source_reads",
          scheduleEvidenceSource: "canonical_schedule",
          storeScheduleId: "storeSchedule-1",
        }),
      },
      outcome: "skipped",
      triggerType: "support_batch",
    });
    expect(dryRunResult).toMatchObject({
      applied: 0,
      candidates: 1,
      quarantined: 1,
      results: [
        {
          action: "quarantined",
          classification: "quarantine_incomplete_source_reads",
        },
      ],
    });
    expect(dryRunDb.inserts.map((insert) => insert.table)).toEqual([
      "automationRun",
    ]);
    expect(dryRunDb.inserts[0].value).toMatchObject({
      decisionEvidence: {
        classification: "quarantine_incomplete_source_reads",
        observed: expect.objectContaining({
          quarantineReason: "incomplete_source_reads",
        }),
      },
    });
  });

  it("preserves applied historic automation run evidence on apply and dry-run reruns", async () => {
    const appliedRun = {
      _id: "automation-run-applied",
      action: "eod.auto_complete",
      appliedAt: Date.UTC(2026, 5, 8, 22),
      createdAt: Date.UTC(2026, 5, 8, 22),
      decisionEvidence: {
        classification: "clean_day",
        eligible: true,
        observed: {},
      },
      decisionReason: "Historic EOD Review completed by automation policy.",
      domain: "daily_operations",
      eventIds: ["event-applied"],
      idempotencyKey:
        "daily_operations:eod.auto_complete:historic:store-1:2026-06-08",
      mutationBoundary: "Daily Close completion record and audit event only",
      operatingDate: "2026-06-08",
      outcome: "applied",
      policyMode: "enabled",
      policyVersion: "daily-operations.v1",
      snapshotCounts: {},
      sourceSubjects: [],
      storeId: "store-1",
      triggerType: "support_batch",
      updatedAt: Date.UTC(2026, 5, 8, 22),
    };
    const { db, inserts, patches } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      automationRun: [appliedRun],
      dailyClose: [
        completedDailyClose({
          _id: "daily-close-applied",
          automationRunId: "automation-run-applied",
          completedAt: Date.UTC(2026, 5, 8, 22),
          operatingDate: "2026-06-08",
          updatedAt: Date.UTC(2026, 5, 8, 22),
        }),
      ],
      store: [store],
      storeSchedule: [storeSchedule()],
    });

    const applyResult = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );
    const dryRunResult = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "dry_run",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );
    const currentDateResult = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-08",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(applyResult.results[0]).toMatchObject({
      action: "already_completed",
      runId: "automation-run-applied",
    });
    expect(dryRunResult.results[0]).toMatchObject({
      action: "already_completed",
      runId: "automation-run-applied",
    });
    expect(currentDateResult.results[0]).toMatchObject({
      action: "already_completed",
      runId: "automation-run-applied",
    });
    expect(inserts).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("does not report an applied historic run as completed after the linked close is reopened", async () => {
    const appliedRun = {
      _id: "automation-run-applied",
      action: "eod.auto_complete",
      appliedAt: Date.UTC(2026, 5, 8, 22),
      createdAt: Date.UTC(2026, 5, 8, 22),
      decisionEvidence: {
        classification: "completed",
        eligible: true,
        observed: {},
      },
      decisionReason: "Historic EOD Review completed by automation policy.",
      domain: "daily_operations",
      eventIds: ["event-applied"],
      idempotencyKey:
        "daily_operations:eod.auto_complete:historic:store-1:2026-06-08",
      mutationBoundary: "Daily Close completion record and audit event only",
      operatingDate: "2026-06-08",
      outcome: "applied",
      policyMode: "enabled",
      policyVersion: "daily-operations.v1",
      snapshotCounts: {},
      sourceSubjects: [],
      storeId: "store-1",
      triggerType: "support_batch",
      updatedAt: Date.UTC(2026, 5, 8, 22),
    };
    const { db, patches } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      automationRun: [appliedRun],
      dailyClose: [
        completedDailyClose({
          _id: "daily-close-applied",
          automationRunId: "automation-run-applied",
          completedAt: Date.UTC(2026, 5, 8, 22),
          lifecycleStatus: "reopened",
          operatingDate: "2026-06-08",
          supersededByDailyCloseId: "daily-close-reopened",
          updatedAt: Date.UTC(2026, 5, 9, 10),
        }),
        completedDailyClose({
          _id: "daily-close-reopened",
          automationRunId: undefined,
          completedAt: undefined,
          lifecycleStatus: "active",
          operatingDate: "2026-06-08",
          reopenedFromDailyCloseId: "daily-close-applied",
          status: "open",
          updatedAt: Date.UTC(2026, 5, 9, 10),
        }),
      ],
      store: [store],
      storeSchedule: [storeSchedule()],
    });

    const rerunResult = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(rerunResult.results[0]).toMatchObject({
      action: "skipped",
      runId: "automation-run-applied",
    });
    expect(rerunResult.results[0]).not.toMatchObject({
      action: "already_completed",
    });
    expect(patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "automation-run-applied",
          table: "automationRun",
          value: expect.objectContaining({
            outcome: "skipped",
          }),
        }),
      ]),
    );
  });

  it("clears applied evidence when an invalidated historic run is downgraded by a replacement close", async () => {
    const appliedRun = {
      _id: "automation-run-applied",
      action: "eod.auto_complete",
      appliedAt: Date.UTC(2026, 5, 8, 22),
      createdAt: Date.UTC(2026, 5, 8, 22),
      decisionEvidence: {
        classification: "completed",
        eligible: true,
        observed: {},
      },
      decisionReason: "Historic EOD Review completed by automation policy.",
      domain: "daily_operations",
      error: {
        code: "stale-error",
        message: "Previous stale error evidence.",
      },
      eventIds: ["event-applied"],
      idempotencyKey:
        "daily_operations:eod.auto_complete:historic:store-1:2026-06-08",
      mutationBoundary: "Daily Close completion record and audit event only",
      operatingDate: "2026-06-08",
      outcome: "applied",
      policyMode: "enabled",
      policyVersion: "daily-operations.v1",
      snapshotCounts: {},
      sourceSubjects: [],
      storeId: "store-1",
      triggerType: "support_batch",
      updatedAt: Date.UTC(2026, 5, 8, 22),
    };
    const { db, patches } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      automationRun: [appliedRun],
      dailyClose: [
        completedDailyClose({
          _id: "daily-close-applied",
          automationRunId: "automation-run-applied",
          completedAt: Date.UTC(2026, 5, 8, 22),
          lifecycleStatus: "reopened",
          operatingDate: "2026-06-08",
          supersededByDailyCloseId: "daily-close-replacement",
          updatedAt: Date.UTC(2026, 5, 9, 10),
        }),
        completedDailyClose({
          _id: "daily-close-replacement",
          automationRunId: undefined,
          completedAt: Date.UTC(2026, 5, 9, 11),
          lifecycleStatus: "active",
          operatingDate: "2026-06-08",
          reopenedFromDailyCloseId: "daily-close-applied",
          status: "completed",
          updatedAt: Date.UTC(2026, 5, 9, 11),
        }),
      ],
      store: [store],
      storeSchedule: [storeSchedule()],
    });

    const rerunResult = await runHistoricEodAutoCloseBatchWithCtx(
      { db } as unknown as MutationCtx,
      {
        asOfOperatingDate: "2026-06-10",
        endOperatingDate: "2026-06-08",
        maxDays: 1,
        mode: "apply",
        startOperatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(rerunResult.results[0]).toMatchObject({
      action: "already_completed",
      runId: "automation-run-applied",
    });

    const runPatch = patches.find(
      (patch) =>
        patch.table === "automationRun" &&
        patch.id === "automation-run-applied",
    )?.value;

    expect(runPatch).toMatchObject({
      outcome: "skipped",
    });
    expect(runPatch).toHaveProperty("appliedAt", undefined);
    expect(runPatch).toHaveProperty("error", undefined);
  });

  it("skips EOD auto-complete for review categories outside the low-risk policy", async () => {
    const { db } = createDb({
      approvalRequest: [
        {
          _id: "approval-1",
          createdAt: Date.UTC(2026, 5, 8, 15),
          reason: "Manager review required.",
          requestType: "variance_review",
          status: "pending",
          storeId: "store-1",
          subjectId: "register-1",
          subjectType: "register_session",
        },
      ],
      automationPolicy: [
        policy("eod.auto_complete", "enabled", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 0,
          eodMaxAbsoluteCashVariance: 500,
          eodMaxVoidedSaleCount: 2,
          eodMaxVoidedSaleTotal: 1000,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
    });

    const result = await runDailyCloseAutoCompleteEligibilityWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionEvidence: {
        classification: "blocked",
        eligible: false,
        observed: {
          blockerCount: 1,
          disqualifyingCategories: ["approval"],
        },
      },
      decisionReason:
        "EOD Review has blockers or unsupported review evidence and requires human review.",
      outcome: "skipped",
    });
  });

  it("discovers dry-run and enabled policies for an explicit operating date", async () => {
    const store2 = {
      ...store,
      _id: "store-2",
      name: "Airport",
      slug: "airport",
    };
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled"),
        policy("opening.auto_start", "dry_run", { storeId: "store-2" }),
        policy("opening.auto_start", "enabled", {
          _id: "policy-opening-paused",
          paused: true,
          storeId: "store-3",
        }),
        policy("opening.auto_start", "disabled", {
          _id: "policy-opening-disabled",
          storeId: "store-4",
        }),
        policy("eod.prepare", "enabled"),
      ],
      dailyClose: [
        completedDailyClose(),
        completedDailyClose({
          _id: "daily-close-2",
          storeId: "store-2",
        }),
      ],
      posTransaction: [
        {
          _id: "txn-1",
          completedAt: Date.UTC(2026, 5, 8, 14),
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
      store: [store, store2],
    });

    const result = await runScheduledDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
      },
    );

    expect(result.openingResults).toHaveLength(2);
    expect(result.eodResults).toHaveLength(1);
    expect(
      inserts
        .filter((insert) => insert.table === "automationRun")
        .map((insert) => insert.value)
        .map((run) => ({
          action: run.action,
          outcome: run.outcome,
          policyMode: run.policyMode,
          storeId: run.storeId,
        })),
    ).toEqual(
      expect.arrayContaining([
        {
          action: "opening.auto_start",
          outcome: "applied",
          policyMode: "enabled",
          storeId: "store-1",
        },
        {
          action: "opening.auto_start",
          outcome: "dry_run",
          policyMode: "dry_run",
          storeId: "store-2",
        },
        {
          action: "eod.prepare",
          outcome: "prepared",
          policyMode: "enabled",
          storeId: "store-1",
        },
      ]),
    );
  });

  it("derives cron operating dates per configured policy timezone offset", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 5, 8, 1));
    const store2 = {
      ...store,
      _id: "store-2",
      name: "Airport",
      slug: "airport",
    };
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "dry_run", {
          operatingTimezoneOffsetMinutes: 240,
        }),
        policy("opening.auto_start", "dry_run", {
          operatingTimezoneOffsetMinutes: -180,
          storeId: "store-2",
        }),
        policy("opening.auto_start", "dry_run", {
          _id: "policy-opening-missing-offset",
          storeId: "store-3",
        }),
        policy("eod.prepare", "dry_run", {
          operatingTimezoneOffsetMinutes: 240,
        }),
        policy("eod.prepare", "dry_run", {
          _id: "policy-eod-missing-offset",
          storeId: "store-2",
        }),
      ],
      dailyClose: [
        completedDailyClose(),
        completedDailyClose({
          _id: "daily-close-2",
          operatingDate: "2026-06-08",
          storeId: "store-2",
        }),
      ],
      store: [store, store2],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx({
      db,
    } as unknown as MutationCtx);

    expect(result.openingResults).toHaveLength(2);
    expect(result.eodResults).toHaveLength(1);
    expect(
      inserts
        .filter((insert) => insert.table === "automationRun")
        .map((insert) => insert.value)
        .map((run) => ({
          action: run.action,
          operatingDate: run.operatingDate,
          storeId: run.storeId,
        })),
    ).toEqual(
      expect.arrayContaining([
        {
          action: "opening.auto_start",
          operatingDate: "2026-06-07",
          storeId: "store-1",
        },
        {
          action: "opening.auto_start",
          operatingDate: "2026-06-08",
          storeId: "store-2",
        },
        {
          action: "eod.prepare",
          operatingDate: "2026-06-07",
          storeId: "store-1",
        },
      ]),
    );
    expect(
      inserts
        .filter((insert) => insert.table === "automationRun")
        .map((insert) => insert.value)
        .filter((run) => run.action === "eod.prepare"),
    ).toHaveLength(1);
  });

  it("skips configured Opening cron before the policy local start time without recording a run", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          openingLocalStartMinutes: 480,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 7, 59),
      },
    );

    expect(result.openingResults).toEqual([]);
    expect(
      inserts.filter((insert) => insert.table === "automationRun"),
    ).toEqual([]);
  });

  it("skips configured automation policies with invalid persisted timezone offsets", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          operatingTimezoneOffsetMinutes: 15 * 60,
        }),
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 8),
      },
    );

    expect(result.openingResults).toEqual([]);
    expect(
      inserts.filter((insert) => insert.table === "automationRun"),
    ).toEqual([]);
  });

  it("catches up a late-day Opening start when the next hourly tick crosses midnight", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          openingLocalStartMinutes: 23 * 60 + 45,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 9, 0, 0),
      },
    );

    expect(result.openingResults).toHaveLength(1);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          action: "opening.auto_start",
          operatingDate: "2026-06-08",
          outcome: "applied",
        }),
      }),
    );
  });

  it("catches up a late-day Opening start when a quieter non-prod tick crosses midnight", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          openingLocalStartMinutes: 22 * 60 + 30,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 9, 0, 0),
      },
    );

    expect(result.openingResults).toHaveLength(1);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          action: "opening.auto_start",
          operatingDate: "2026-06-08",
          outcome: "applied",
        }),
      }),
    );
  });

  it("runs configured Opening cron at the first tick after the policy local start time", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          openingLocalStartMinutes: 480,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 8),
      },
    );

    expect(result.openingResults).toHaveLength(1);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          action: "opening.auto_start",
          operatingDate: "2026-06-08",
          outcome: "applied",
        }),
      }),
    );
  });

  it("runs configured Opening cron before customer-facing hours when the policy offset is earlier", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          openingBlockerHandling: "manager_review",
          openingLocalStartMinutes: 8 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
      storeSchedule: [
        storeSchedule({
          timezone: "UTC",
          weeklyWindows: [
            {
              dayOfWeek: 1,
              endMinute: 19 * 60,
              startMinute: 9 * 60,
            },
          ],
        }),
      ],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 8),
      },
    );

    expect(result.openingResults).toHaveLength(1);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          action: "opening.auto_start",
          operatingDate: "2026-06-08",
          outcome: "applied",
        }),
      }),
    );
  });

  it("waits during customer-facing hours when the policy offset is later than opening", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          openingBlockerHandling: "manager_review",
          openingLocalStartMinutes: 10 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
      storeSchedule: [
        storeSchedule({
          timezone: "UTC",
          weeklyWindows: [
            {
              dayOfWeek: 1,
              endMinute: 19 * 60,
              startMinute: 9 * 60,
            },
          ],
        }),
      ],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 9),
      },
    );

    expect(result.openingResults).toEqual([]);
    expect(
      inserts.filter((insert) => insert.table === "automationRun"),
    ).toEqual([]);
  });

  it("continues configured automation when one policy throws", async () => {
    const store2 = {
      ...store,
      _id: "store-2",
      name: "Airport",
      slug: "airport",
    };
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          operatingTimezoneOffsetMinutes: 0,
        }),
        policy("opening.auto_start", "enabled", {
          _id: "policy-opening-duplicate",
          operatingTimezoneOffsetMinutes: 0,
          storeId: "store-1",
        }),
        policy("opening.auto_start", "enabled", {
          _id: "policy-opening-store-2",
          operatingTimezoneOffsetMinutes: 0,
          storeId: "store-2",
        }),
      ],
      dailyClose: [
        completedDailyClose(),
        completedDailyClose({
          _id: "daily-close-2",
          storeId: "store-2",
        }),
      ],
      store: [store, store2],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 8),
      },
    );

    expect(result.openingResults).toHaveLength(2);
    expect(
      inserts
        .filter((insert) => insert.table === "automationRun")
        .map((insert) => insert.value),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "opening.auto_start",
          outcome: "failed",
          storeId: "store-1",
        }),
        expect.objectContaining({
          action: "opening.auto_start",
          outcome: "applied",
          storeId: "store-2",
        }),
      ]),
    );
  });

  it("auto-starts Opening with blockers when policy routes blockers to manager review", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 5, 8, 8));
    const { db, inserts } = createDb({
      approvalRequest: [
        {
          _id: "approval-1",
          createdAt: Date.UTC(2026, 5, 8, 7),
          reason: "Cash variance needs review.",
          registerSessionId: "register-1",
          requestType: "variance_review",
          status: "pending",
          storeId: "store-1",
          subjectId: "register-1",
          subjectType: "register_session",
        },
      ],
      automationPolicy: [
        policy("opening.auto_start", "enabled", {
          openingBlockerHandling: "manager_review",
        }),
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await runDailyOpeningAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      decisionReason:
        "Opening Handoff started with manager review evidence from automation policy.",
      outcome: "applied",
      snapshotCounts: {
        blockerCount: 1,
        carryForwardCount: 0,
        readyCount: 1,
        reviewCount: 0,
      },
    });
    expect(inserts[1].value).toMatchObject({
      actorType: "automation",
      managerReviewEvidence: [
        expect.objectContaining({
          category: "approval",
          key: "approval_request:approval-1:pending",
          severity: "blocker",
          subject: expect.objectContaining({
            id: "approval-1",
            type: "approval_request",
          }),
        }),
      ],
      readiness: {
        blockerCount: 1,
        carryForwardCount: 0,
        readyCount: 1,
        reviewCount: 0,
        status: "blocked",
      },
    });
    expect(inserts[2].value).toMatchObject({
      eventType: "daily_opening_auto_started",
      metadata: {
        managerReviewEvidence: [
          expect.objectContaining({
            key: "approval_request:approval-1:pending",
            severity: "blocker",
          }),
        ],
        managerReviewEvidenceCount: 1,
      },
    });
  });

  it("records failed Opening automation when the start command rejects the apply", async () => {
    const { db, inserts, patches } = createDb({
      automationPolicy: [policy("opening.auto_start", "enabled")],
      dailyClose: [completedDailyClose()],
    });

    const result = await runDailyOpeningAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      outcome: "failed",
    });
    expect(inserts.map((insert) => insert.table)).toEqual(["automationRun"]);
    expect(patches).toContainEqual(
      expect.objectContaining({
        id: "automationRun-1",
        value: expect.objectContaining({
          error: {
            code: "not_found",
            message: "Store not found.",
          },
          outcome: "failed",
        }),
      }),
    );
  });
});
