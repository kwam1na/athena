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
  prepareDailyCloseAutomationWithCtx,
  runDailyCloseAutoCompleteEligibilityWithCtx,
  runConfiguredDailyOperationsAutomationWithCtx,
  runDailyOpeningAutomationWithCtx,
  runScheduledDailyOperationsAutomationWithCtx,
  updateEodAutoCompletePolicy,
  updateOpeningAutoStartPolicy,
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
    sourceSubjects: [
      { type: "pos_transaction", id: "txn-1", label: "TXN-1" },
    ],
    status: "completed",
    storeId: "store-1",
    summary: { salesTotal: 12000 },
    updatedAt: Date.UTC(2026, 5, 7, 22),
    ...overrides,
  };
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
      getHandler(updateOpeningAutoStartPolicy)({ db } as unknown as MutationCtx, {
        localStartMinutes: 480,
        mode: "enabled",
        openingBlockerHandling: "start_with_manager_review",
        operatingTimezoneOffsetMinutes: 0,
        storeId: "store-1" as Id<"store">,
      }),
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
      getHandler(updateEodAutoCompletePolicy)({ db } as unknown as MutationCtx, {
        cleanDayAutoCompleteEnabled: true,
        localCompletionWindowMinutes: 1260,
        maxAbsoluteCashVariance: 5000,
        maxVoidedSaleCount: 2,
        maxVoidedSaleTotal: 50000,
        mode: "enabled",
        operatingTimezoneOffsetMinutes: 0,
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Only full admins can access stock operations.");
    expect(inserts).toEqual([]);
    expect(patches).toEqual([]);
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
      getHandler(updateOpeningAutoStartPolicy)({ db } as unknown as MutationCtx, {
        localStartMinutes: 480,
        mode: "enabled",
        openingBlockerHandling: "start_with_manager_review",
        operatingTimezoneOffsetMinutes: 15 * 60,
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Operating timezone offset must be within UTC-14 to UTC+14.");
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
      getEodAutoCompletePolicyConfigWithCtx(
        { db } as unknown as MutationCtx,
        {
          storeId: "store-1" as Id<"store">,
        },
      ),
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
    ).rejects.toThrow("EOD local completion window must be within one local day.");

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

  it("derives configured EOD auto-complete operating dates from policy local timezone", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "dry_run", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 21 * 60,
          operatingTimezoneOffsetMinutes: 240,
        }),
      ],
      posTransaction: [completedTransaction()],
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
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          action: "eod.auto_complete",
          operatingDate: "2026-06-08",
          outcome: "dry_run",
        }),
      }),
    );
  });

  it("uses stored canonical schedules for configured EOD auto-complete timing", async () => {
    const { db, inserts } = createDb({
      automationPolicy: [
        policy("eod.auto_complete", "dry_run", {
          eodCleanDayAutoCompleteEnabled: true,
          eodLocalCompletionWindowMinutes: 21 * 60,
          operatingTimezoneOffsetMinutes: 240,
        }),
      ],
      posTransaction: [completedTransaction()],
      registerSession: [closedRegisterSession()],
      store: [store],
      storeSchedule: [storeSchedule()],
    });

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
      {
        now: Date.UTC(2026, 5, 8, 18),
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
          outcome: "dry_run",
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
          carryForwardItemKeys: [
            "operational_work_item:work-1:carry_forward",
          ],
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

    const result = await runConfiguredDailyOperationsAutomationWithCtx(
      { db } as unknown as MutationCtx,
    );

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
    expect(inserts.filter((insert) => insert.table === "automationRun")).toEqual(
      [],
    );
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
    expect(inserts.filter((insert) => insert.table === "automationRun")).toEqual(
      [],
    );
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
