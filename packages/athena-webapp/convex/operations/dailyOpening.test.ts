import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  buildDailyOpeningSnapshotWithCtx,
  startStoreDayWithCtx,
} from "./dailyOpening";

type TableName =
  | "approvalRequest"
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
    const filters: Array<[string, unknown]> = [];
    let sortDirection: "asc" | "desc" = "asc";
    const filteredRows = () => {
      const rows = Array.from(tableFor(table).values()).filter((row) =>
        filters.every(([field, value]) => row[field] === value),
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
      order(direction: "asc" | "desc") {
        sortDirection = direction;
        return chain;
      },
      take: async (limit: number) => filteredRows().slice(0, limit),
      withIndex(
        _index: string,
        applyIndex: (builder: {
          eq: (field: string, value: unknown) => typeof builder;
        }) => unknown,
      ) {
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
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
  organizationId: "org-1",
  status: "active",
  storeId: "store-1",
  updatedAt: Date.UTC(2026, 4, 1),
};

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
    sourceSubjects: [
      { type: "pos_transaction", id: "txn-1", label: "TXN-1" },
    ],
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

  it("returns a ready snapshot when the prior Daily Close completed cleanly", async () => {
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
    expect(snapshot.sourceSubjects).toEqual([
      {
        id: "daily-close-1",
        label: "Daily Close 2026-05-07",
        type: "daily_close",
      },
    ]);
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
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
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

  it("blocks opening when a prior close carry-forward reference is missing", async () => {
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
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: { blockerCount: 1 },
      },
    });
    expect(inserts).toEqual([]);
  });

  it("blocks opening when there is no prior completed Daily Close", async () => {
    const { db, inserts } = createDb({
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

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.blockers.map((item) => item.key)).toEqual([
      "daily_close:prior:missing",
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

  it("rechecks command-time readiness so stale ready snapshots cannot start a blocked day", async () => {
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
      { operatingDate: "2026-05-08", storeId: "store-1" as Id<"store"> },
    );

    expect(snapshot.status).toBe("ready");
    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        metadata: { blockerCount: 1 },
      },
    });
    expect(inserts).toEqual([]);
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

  it("does not mutate register-session state when acknowledging opening", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 8, 8));

    const { db, inserts, patches, tables } = createDb({
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
        operatingDate: "2026-05-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: { action: "started" },
    });
    expect(inserts.map((insert) => insert.table)).toEqual([
      "dailyOpening",
      "operationalEvent",
    ]);
    expect(patches).toEqual([]);
    expect(tables.get("registerSession")?.get("register-1")).toMatchObject({
      openingFloat: 10000,
      status: "open",
    });
  });
});
