import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  buildDailyOpeningSnapshotWithCtx,
  startStoreDay,
  startStoreDayWithCtx,
} from "./dailyOpening";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

type TableName =
  | "approvalRequest"
  | "approvalProof"
  | "automationRun"
  | "dailyClose"
  | "dailyOpening"
  | "operationalEvent"
  | "operationalWorkItem"
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
        const leftValue = String(left.operatingDate ?? left.createdAt ?? "");
        const rightValue = String(right.operatingDate ?? right.createdAt ?? "");

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

const activeStaffProfile = {
  _id: "staff-1",
  createdAt: Date.UTC(2026, 4, 1),
  firstName: "Store",
  fullName: "Store Manager",
  lastName: "Manager",
  linkedUserId: "user-1",
  organizationId: "org-1",
  status: "active",
  storeId: "store-1",
  updatedAt: Date.UTC(2026, 4, 1),
};

function openingApprovalProof(overrides: Partial<Row> = {}): Row {
  return {
    _id: "proof-1",
    actionKey: "operations.daily_opening.start_day",
    approvedByCredentialId: "credential-1",
    approvedByStaffProfileId: "staff-1",
    createdAt: Date.UTC(2026, 4, 8, 7, 55),
    expiresAt: Date.UTC(2026, 4, 8, 8, 5),
    organizationId: "org-1",
    requiredRole: "manager",
    storeId: "store-1",
    subjectId: "store-1:2026-05-08",
    subjectType: "daily_opening",
    ...overrides,
  };
}

function completedDailyClose(overrides: Partial<Row> = {}): Row {
  return {
    _id: "daily-close-1",
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
    sourceSubjects: [{ type: "pos_transaction", id: "txn-1", label: "TXN-1" }],
    status: "completed",
    storeId: "store-1",
    summary: { salesTotal: 12000 },
    updatedAt: Date.UTC(2026, 4, 7, 22),
    ...overrides,
  };
}

describe("daily opening backend foundation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps daily opening command results aligned with exported return validators", () => {
    expect(() =>
      assertConformsToExportedReturns(startStoreDay, {
        kind: "user_error",
        error: {
          code: "precondition_failed",
          message:
            "Opening Handoff cannot start while items still need attention.",
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertConformsToExportedReturns(startStoreDay, {
        kind: "ok",
        data: {
          action: "started",
          dailyOpening: {
            _id: "daily-opening-1",
            storeId: "store-1",
            operatingDate: "2026-05-08",
            status: "started",
          },
          operationalEventId: "operational-event-1",
        },
      }),
    ).not.toThrow();
  });

  it("returns a ready snapshot when the prior EOD Review completed cleanly", async () => {
    const { db } = createDb({
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.status).toBe("ready");
    expect(snapshot.startAt).toBe(Date.UTC(2026, 4, 8));
    expect(snapshot.endAt).toBe(Date.UTC(2026, 4, 9));
    expect(snapshot.readiness).toEqual({
      status: "ready",
      blockerCount: 0,
      reviewCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
    });
    expect(snapshot.priorClose?._id).toBe("daily-close-1");
    expect(snapshot.readyItems.map((item) => item.key)).toEqual([
      "daily_close:daily-close-1:completed",
    ]);
    expect(snapshot.readyItems[0]?.link).toMatchObject({
      search: {
        operatingDate: "2026-05-07",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    });
    expect(snapshot.sourceSubjects).toEqual([
      {
        id: "daily-close-1",
        label: "EOD Review 2026-05-07",
        type: "daily_close",
      },
    ]);
  });

  it("redacts prior close carry-forward work for broad opening snapshot readers", async () => {
    const { db } = createDb({
      dailyClose: [
        completedDailyClose({
          carryForwardWorkItemIds: ["work-1"],
          readiness: {
            blockerCount: 0,
            carryForwardCount: 1,
            readyCount: 1,
            reviewCount: 0,
            status: "ready",
          },
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
          title: "Call customer tomorrow",
          type: "customer_follow_up",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        includeManagerReviewEvidence: false,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.carryForwardItems).toEqual([
      {
        key: "carry_forward:0",
        severity: "carry_forward",
        category: "carry_forward",
        title: "Call customer tomorrow",
        message:
          "This unresolved carry-forward item remains open and must be acknowledged for Opening.",
        subject: {
          type: "operational_work_item",
          id: "redacted",
          label: "Call customer tomorrow",
        },
      },
    ]);
    expect(snapshot.sourceSubjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "redacted",
          type: "operational_work_item",
        }),
      ]),
    );
    expect(snapshot.carryForwardItems[0]).not.toHaveProperty("link");
    expect(snapshot.carryForwardItems[0]).not.toHaveProperty("metadata");
    expect(snapshot.readyItems).toEqual([
      expect.objectContaining({
        key: "prior_close:completed",
        subject: {
          type: "daily_close",
          id: "redacted",
          label: "EOD Review 2026-05-07",
        },
      }),
    ]);
    expect(snapshot.readyItems[0]).not.toHaveProperty("metadata");
    expect(snapshot.priorClose).toMatchObject({
      completedAt: Date.UTC(2026, 4, 7, 22),
      operatingDate: "2026-05-07",
      status: "completed",
    });
    expect(snapshot.priorClose).not.toHaveProperty("_id");
    expect(snapshot.priorClose).not.toHaveProperty("carryForwardWorkItemIds");
    expect(snapshot.priorClose).not.toHaveProperty("organizationId");
    expect(snapshot.priorClose).not.toHaveProperty("reportSnapshot");
    expect(snapshot.priorClose).not.toHaveProperty("sourceSubjects");
    expect(snapshot.priorClose).not.toHaveProperty("storeId");
  });

  it("keeps prior close carry-forward evidence for trusted opening snapshot readers", async () => {
    const { db } = createDb({
      dailyClose: [
        completedDailyClose({
          carryForwardWorkItemIds: ["work-1"],
          readiness: {
            blockerCount: 0,
            carryForwardCount: 1,
            readyCount: 1,
            reviewCount: 0,
            status: "ready",
          },
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
          title: "Call customer tomorrow",
          type: "customer_follow_up",
        },
      ],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        includeManagerReviewEvidence: true,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.carryForwardItems[0]).toMatchObject({
      key: "operational_work_item:work-1:carry_forward",
      subject: {
        id: "work-1",
        type: "operational_work_item",
      },
      link: {
        label: "View open work",
      },
      metadata: {
        priority: "normal",
        status: "open",
        type: "customer_follow_up",
      },
    });
  });

  it("redacts missing carry-forward blockers for broad opening snapshot readers", async () => {
    const { db } = createDb({
      dailyClose: [
        completedDailyClose({
          carryForwardWorkItemIds: ["work-missing"],
          readiness: {
            blockerCount: 0,
            carryForwardCount: 1,
            readyCount: 1,
            reviewCount: 0,
            status: "ready",
          },
        }),
      ],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      {
        includeManagerReviewEvidence: false,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.blockers).toEqual([
      expect.objectContaining({
        key: "carry_forward:missing",
        subject: {
          type: "operational_work_item",
          id: "redacted",
          label: "Missing carry-forward work",
        },
      }),
    ]);
    expect(snapshot.blockers[0]).not.toHaveProperty("metadata");
    expect(snapshot.sourceSubjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "redacted",
          type: "operational_work_item",
        }),
      ]),
    );
  });

  it("includes the latest Opening automation status when present", async () => {
    const { db } = createDb({
      automationRun: [
        {
          _id: "automation-run-old",
          action: "opening.auto_start",
          createdAt: 1,
          domain: "daily_operations",
          idempotencyKey: "old",
          mutationBoundary: "daily_opening",
          operatingDate: "2026-05-08",
          outcome: "dry_run",
          policyMode: "dry_run",
          policyVersion: "automation-foundation.v1",
          snapshotCounts: {},
          sourceSubjects: [{ id: "daily-close-1", type: "daily_close" }],
          storeId: "store-1",
          triggerType: "scheduled",
          updatedAt: 1,
        },
        {
          _id: "automation-run-latest",
          action: "opening.auto_start",
          appliedAt: Date.UTC(2026, 4, 8, 8),
          createdAt: 2,
          decisionReason: "Opening Handoff was clean.",
          domain: "daily_operations",
          idempotencyKey: "latest",
          mutationBoundary: "daily_opening",
          operatingDate: "2026-05-08",
          outcome: "applied",
          policyMode: "enabled",
          policyVersion: "automation-foundation.v1",
          snapshotCounts: {},
          sourceSubjects: [{ id: "daily-close-1", type: "daily_close" }],
          storeId: "store-1",
          triggerType: "scheduled",
          updatedAt: 2,
        },
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.automationStatus).toEqual({
      decisionReason: "Opening Handoff was clean.",
      id: "automation-run-latest",
      occurredAt: Date.UTC(2026, 4, 8, 8),
      outcome: "applied",
      policyMode: "enabled",
    });
  });

  it("does not treat a reopened prior close as clean", async () => {
    const { db } = createDb({
      dailyClose: [
        completedDailyClose({
          lifecycleStatus: "reopened",
          reopenedAt: Date.UTC(2026, 4, 8, 7),
          reopenReason: "Cash deposit was corrected.",
        }),
      ],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.status).toBe("needs_attention");
    expect(snapshot.readyItems).toEqual([]);
    expect(snapshot.reviewItems).toContainEqual(
      expect.objectContaining({
        key: "daily_close:daily-close-1:reopened",
        title: "Prior EOD Review reopened",
        message:
          "The prior store day was reopened. Complete the revised end of day review before treating the prior close as clean.",
      }),
    );
  });

  it("summarizes pending approval blockers with operator-facing metadata", async () => {
    const { db } = createDb({
      approvalRequest: [
        {
          _id: "approval-1",
          createdAt: Date.UTC(2026, 4, 8, 7),
          notes: "Customer paid cash, not mobile money.",
          reason:
            "Manager approval is required to correct a completed transaction payment method.",
          registerSessionId: "register-1",
          requestType: "payment_method_correction",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-1",
          subjectType: "pos_transaction",
          metadata: {
            amount: 171500,
            paymentMethod: "cash",
            previousPaymentMethod: "mobile_money",
            transactionId: "txn-1",
            transactionNumber: "298944",
          },
        },
      ],
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.blockers[0]).toMatchObject({
      key: "approval_request:approval-1:pending",
      title: "Payment correction approval pending",
      link: {
        label: "View approvals",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      metadata: [
        {
          label: "Request",
          value: "Payment correction",
        },
        {
          label: "Transaction",
          value: "298944",
        },
        {
          label: "transactionId",
          value: "txn-1",
        },
        {
          label: "Current method",
          value: "Mobile Money",
        },
        {
          label: "Requested method",
          value: "Cash",
        },
        {
          label: "Amount",
          value: 171500,
        },
        {
          label: "Requester note",
          value: "Customer paid cash, not mobile money.",
        },
      ],
    });
    expect(JSON.stringify(snapshot.blockers[0]?.metadata)).not.toContain(
      "payment_method_correction",
    );
    expect(JSON.stringify(snapshot.blockers[0]?.metadata)).not.toContain(
      "pos_transaction",
    );
  });

  it("hydrates the started opening staff profile name", async () => {
    const { db } = createDb({
      dailyClose: [completedDailyClose()],
      dailyOpening: [
        {
          _id: "daily-opening-1",
          acknowledgedItemKeys: [],
          actorStaffProfileId: "staff-1",
          carryForwardWorkItemIds: [],
          createdAt: Date.UTC(2026, 4, 8, 8),
          operatingDate: "2026-05-08",
          organizationId: "org-1",
          priorDailyCloseId: "daily-close-1",
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
        },
      ],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.status).toBe("started");
    expect(snapshot.startedOpening).toMatchObject({
      _id: "daily-opening-1",
      actorStaffProfileId: "staff-1",
      startedByStaffName: "Store Manager",
    });
  });

  it("blocks calendar-invalid operating dates instead of normalizing them", async () => {
    const { db, inserts } = createDb({
      dailyClose: [completedDailyClose()],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-02-31", storeId: "store-1" as Id<"store"> },
    );
    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        operatingDate: "2026-02-31",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.startAt).toBe(0);
    expect(snapshot.endAt).toBe(0);
    expect(snapshot.blockers.map((item) => item.key)).toEqual([
      "daily_opening:operating_date:invalid",
    ]);
    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: { blockerCount: 1 },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("requires carry-forward acknowledgement before starting and keeps the work item open", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));

    const { db, inserts, tables } = createDb({
      approvalProof: [openingApprovalProof()],
      dailyClose: [
        completedDailyClose({
          carryForwardWorkItemIds: ["work-1"],
          readiness: {
            blockerCount: 0,
            carryForwardCount: 1,
            readyCount: 1,
            reviewCount: 0,
            status: "ready",
          },
        }),
      ],
      operationalWorkItem: [
        {
          _id: "work-1",
          approvalState: "not_required",
          createdAt: Date.UTC(2026, 4, 7, 20),
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Call customer tomorrow",
          type: "daily_close_carry_forward",
        },
      ],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const blockedResult = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(blockedResult).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: {
          unacknowledgedItemKeys: [
            "operational_work_item:work-1:carry_forward",
          ],
        },
      },
    });
    expect(inserts).toEqual([]);

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        acknowledgedItemKeys: ["operational_work_item:work-1:carry_forward"],
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        notes: "Opening handoff acknowledged.",
        operatingDate: "2026-05-08",
        organizationId: "org-1" as Id<"organization">,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "started",
        dailyOpening: {
          acknowledgedItemKeys: ["operational_work_item:work-1:carry_forward"],
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
          carryForwardWorkItemIds: ["work-1"],
          endAt: Date.UTC(2026, 4, 9),
          notes: "Opening handoff acknowledged.",
          operatingDate: "2026-05-08",
          organizationId: "org-1",
          priorDailyCloseId: "daily-close-1",
          readiness: {
            carryForwardCount: 1,
            status: "needs_attention",
          },
          startAt: Date.UTC(2026, 4, 8),
          status: "started",
          storeId: "store-1",
        },
      },
    });
    expect(tables.get("operationalWorkItem")?.get("work-1")?.status).toBe(
      "open",
    );
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyOpening",
      "operationalEvent",
    ]);
    expect(inserts[1].value).toMatchObject({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      eventType: "daily_opening_acknowledged",
      subjectType: "daily_opening",
      metadata: {
        acknowledgedItemKeys: ["operational_work_item:work-1:carry_forward"],
        endAt: Date.UTC(2026, 4, 9),
        operatingDate: "2026-05-08",
        priorDailyCloseId: "daily-close-1",
        startAt: Date.UTC(2026, 4, 8),
      },
    });
  });

  it("starts opening and records review evidence when a carry-forward reference is missing", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));
    const { db, inserts } = createDb({
      dailyClose: [
        completedDailyClose({
          carryForwardWorkItemIds: ["work-missing"],
        }),
      ],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );
    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.blockers.map((item) => item.key)).toContain(
      "operational_work_item:work-missing:missing",
    );
    expect(snapshot.sourceSubjects).toContainEqual({
      id: "work-missing",
      label: "Missing carry-forward work",
      type: "operational_work_item",
    });
    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyOpening: {
          managerReviewEvidence: [
            expect.objectContaining({
              key: "operational_work_item:work-missing:missing",
              severity: "blocker",
            }),
          ],
        },
      },
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyOpening",
      "operationalEvent",
    ]);
    expect(inserts[1].value).toMatchObject({
      eventType: "daily_opening_acknowledged",
      metadata: {
        managerReviewEvidenceCount: 1,
      },
    });
  });

  it("requires acknowledgement when there is no prior completed EOD Review", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));

    const { db, inserts } = createDb({
      approvalProof: [openingApprovalProof()],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );
    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.status).toBe("needs_attention");
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.reviewItems.map((item) => item.key)).toEqual([
      "daily_close:prior:missing",
    ]);
    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: { unacknowledgedItemKeys: ["daily_close:prior:missing"] },
      },
    });
    expect(inserts).toEqual([]);

    const acknowledgedResult = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        acknowledgedItemKeys: ["daily_close:prior:missing"],
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(acknowledgedResult).toMatchObject({
      kind: "ok",
      data: {
        action: "started",
        dailyOpening: {
          acknowledgedItemKeys: ["daily_close:prior:missing"],
          readiness: {
            blockerCount: 0,
            reviewCount: 1,
            status: "needs_attention",
          },
        },
      },
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyOpening",
      "operationalEvent",
    ]);
  });

  it("rechecks command-time readiness and records blockers as review evidence", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));
    const { db, inserts, tables } = createDb({
      dailyClose: [completedDailyClose()],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const snapshot = await buildDailyOpeningSnapshotWithCtx(
      { db } as unknown as QueryCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );
    tables.get("approvalRequest")?.set("approval-1", {
      _id: "approval-1",
      createdAt: Date.UTC(2026, 4, 8, 7),
      reason: "Variance needs manager review.",
      registerSessionId: "register-1",
      requestType: "variance_review",
      status: "pending",
      storeId: "store-1",
      subjectId: "register-1",
      subjectType: "register_session",
    });

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(snapshot.status).toBe("ready");
    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyOpening: {
          managerReviewEvidence: [
            expect.objectContaining({
              key: "approval_request:approval-1:pending",
              severity: "blocker",
            }),
          ],
        },
      },
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyOpening",
      "operationalEvent",
    ]);
  });

  it("allows manual and automation blocked opening start with manager-review evidence", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));

    const { db, inserts } = createDb({
      approvalRequest: [
        {
          _id: "approval-1",
          createdAt: Date.UTC(2026, 4, 8, 7),
          reason: "Variance needs manager review.",
          registerSessionId: "register-1",
          requestType: "variance_review",
          status: "pending",
          storeId: "store-1",
          subjectId: "register-1",
          subjectType: "register_session",
        },
      ],
      dailyClose: [completedDailyClose()],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const manualResult = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(manualResult).toMatchObject({
      kind: "ok",
      data: {
        dailyOpening: {
          actorStaffProfileId: "staff-1",
          managerReviewEvidence: [
            expect.objectContaining({
              key: "approval_request:approval-1:pending",
              severity: "blocker",
            }),
          ],
        },
      },
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyOpening",
      "operationalEvent",
    ]);

    const automationResult = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorType: "automation",
        automationBlockerHandling: "manager_review",
        automationDecisionReason:
          "Opening Handoff started with manager review evidence from automation policy.",
        automationPolicyVersion: "daily-operations.v1",
        automationRunId: "automation-run-1" as Id<"automationRun">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(automationResult).toMatchObject({
      kind: "ok",
      data: {
        action: "already_started",
        dailyOpening: {
          managerReviewEvidence: [
            expect.objectContaining({
              category: "approval",
              key: "approval_request:approval-1:pending",
              severity: "blocker",
            }),
          ],
          readiness: {
            blockerCount: 1,
            status: "blocked",
          },
        },
      },
    });
    expect(inserts[1].value).toMatchObject({
      eventType: "daily_opening_acknowledged",
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

  it("returns an existing opening without duplicating the operational event", async () => {
    const { db, inserts } = createDb({
      dailyClose: [completedDailyClose()],
      dailyOpening: [
        {
          _id: "daily-opening-1",
          acknowledgedItemKeys: [],
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
          carryForwardWorkItemIds: [],
          createdAt: Date.UTC(2026, 4, 8, 8),
          operatingDate: "2026-05-08",
          organizationId: "org-1",
          priorDailyCloseId: "daily-close-1",
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
        },
      ],
      operationalEvent: [
        {
          _id: "event-1",
          createdAt: Date.UTC(2026, 4, 8, 8),
          eventType: "daily_opening_acknowledged",
          message: "Store day acknowledged for 2026-05-08.",
          storeId: "store-1",
          subjectId: "daily-opening-1",
          subjectType: "daily_opening",
        },
      ],
      store: [store],
    });

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "already_started",
        dailyOpening: {
          _id: "daily-opening-1",
        },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("rejects organization mismatches before persisting opening state", async () => {
    const { db, inserts } = createDb({
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-05-08",
        organizationId: "org-other" as Id<"organization">,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Opening store does not belong to this organization.",
      },
    });
    expect(inserts).toEqual([]);
  });

  it("requires an active staff actor before persisting opening state", async () => {
    const { db, inserts } = createDb({
      dailyClose: [completedDailyClose()],
      store: [store],
    });

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Full admin access is required to acknowledge Opening.",
      },
    });
    expect(inserts).toEqual([]);
  });

  it("allows a staff-profile start without manager approval proof", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));
    const { db, inserts } = createDb({
      dailyClose: [completedDailyClose()],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyOpening: {
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
        },
      },
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyOpening",
      "operationalEvent",
    ]);
  });

  it("accepts an optional manager approval proof without requiring it to match the starting staff profile", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));
    const { db, inserts } = createDb({
      approvalProof: [
        openingApprovalProof({
          approvedByStaffProfileId: "staff-other",
        }),
      ],
      dailyClose: [completedDailyClose()],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "proof-1" as Id<"approvalProof">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyOpening: {
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
        },
      },
    });
    expect(inserts[2].value).toMatchObject({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      eventType: "daily_opening_acknowledged",
    });
  });

  it("does not mutate register-session state when acknowledging opening", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));

    const { db, inserts, patches, tables } = createDb({
      approvalProof: [openingApprovalProof()],
      dailyClose: [completedDailyClose()],
      staffProfile: [activeStaffProfile],
      registerSession: [
        {
          _id: "register-1",
          expectedCash: 10000,
          openedAt: Date.UTC(2026, 4, 8, 9),
          openingFloat: 10000,
          status: "open",
          storeId: "store-1",
        },
      ],
      store: [store],
    });

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "user-1" as Id<"athenaUser">,
        approvalProofId: "proof-1" as Id<"approvalProof">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: { action: "started" },
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "operationalEvent",
      "dailyOpening",
      "operationalEvent",
    ]);
    expect(patches).toContainEqual({
      id: "proof-1",
      table: "approvalProof",
      value: { consumedAt: Date.UTC(2026, 4, 8, 8) },
    });
    expect(patches.some((patch) => patch.table === "registerSession")).toBe(
      false,
    );
    expect(tables.get("registerSession")?.get("register-1")).toMatchObject({
      openingFloat: 10000,
      status: "open",
    });
  });

  it("derives approval-backed opening actor user from the approved staff profile", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));

    const { db, inserts } = createDb({
      approvalProof: [openingApprovalProof()],
      dailyClose: [completedDailyClose()],
      staffProfile: [activeStaffProfile],
      store: [store],
    });

    const result = await startStoreDayWithCtx(
      { db } as unknown as MutationCtx,
      {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "spoofed-user" as Id<"athenaUser">,
        approvalProofId: "proof-1" as Id<"approvalProof">,
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        dailyOpening: {
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
        },
      },
    });
    expect(inserts[2].value).toMatchObject({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      eventType: "daily_opening_acknowledged",
    });
  });
});
