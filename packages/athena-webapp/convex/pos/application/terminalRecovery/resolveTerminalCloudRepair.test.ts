import { describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import { REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY } from "../../../../shared/registerSessionLifecyclePolicy";
import { buildTerminalCloudRepairPreconditionHash } from "./cloudRepairPolicy";
import { resolveTerminalCloudRepair } from "./resolveTerminalCloudRepair";

const now = 3_000_000;
const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

describe("resolveTerminalCloudRepair", () => {
  it("resolves only conflicts whose safe preview precondition still matches", async () => {
    const conflict = buildConflict();
    const ctx = buildCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncEvent: [buildEvent()],
    });

    const result = await resolveTerminalCloudRepair(ctx as never, {
      expectedPreconditionHash: buildTerminalCloudRepairPreconditionHash({
        safeConflictIds: [conflict._id],
        storeId,
        terminalId,
      }),
      now,
      resolvedByUserId: "user-1" as Id<"athenaUser">,
      storeId,
      terminalId,
    });
    expect(result).toEqual({
      kind: "ok",
      data: {
        preconditionHash: expect.any(String),
        resolvedConflictIds: [conflict._id],
        skippedConflictIds: [],
      },
    });
    expect(ctx.db.patch).toHaveBeenCalledWith("posLocalSyncConflict", conflict._id, {
      resolvedAt: now,
      resolvedByStaffProfileId: undefined,
      resolvedByUserId: "user-1",
      status: "resolved",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith("posLocalSyncEvent", "event-1-id", {
      projectedAt: now,
      status: "projected",
    });
    expect(ctx.tables.posLocalSyncMapping).toContainEqual(
      expect.objectContaining({
        localEventId: "event-1",
        localId: "register-1",
        localIdKind: "registerSession",
      }),
    );
  });

  it("projects the replacement drawer without resolving the prior closeout variance conflict", async () => {
    const duplicateOpenConflict = buildConflict({
      _id: "duplicate-open-conflict" as Id<"posLocalSyncConflict">,
      localEventId: "event-open-replacement",
      localRegisterSessionId: "register-replacement",
      sequence: 3,
    });
    const closeoutVarianceConflict = buildConflict({
      _id: "closeout-conflict" as Id<"posLocalSyncConflict">,
      conflictType: "permission",
      details: {
        closeoutOccurredAt: now - 21 * 60 * 1000,
        countedCash: 95,
        expectedCash: 100,
        variance: -5,
      },
      localEventId: "event-register-closed",
      localRegisterSessionId: "registerSession-prior",
      sequence: 2,
      summary: REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
    });
    const ctx = buildCtx({
      posLocalSyncConflict: [closeoutVarianceConflict, duplicateOpenConflict],
      posLocalSyncEvent: [
        buildEvent({
          _id: "event-open-replacement-id" as Id<"posLocalSyncEvent">,
          localEventId: "event-open-replacement",
          localRegisterSessionId: "register-replacement",
          sequence: 3,
        }),
      ],
      registerSession: [
        {
          _id: "registerSession-prior" as Id<"registerSession">,
          _creationTime: now - 30 * 60 * 1000,
          storeId,
          terminalId,
          registerNumber: "A1",
          status: "closing",
          openedByStaffProfileId: "staff-1" as Id<"staffProfile">,
          openedAt: now - 40 * 60 * 1000,
          openingFloat: 100,
          expectedCash: 100,
        } as Doc<"registerSession">,
      ],
    });

    const result = await resolveTerminalCloudRepair(ctx as never, {
      expectedPreconditionHash: buildTerminalCloudRepairPreconditionHash({
        safeConflictIds: [duplicateOpenConflict._id],
        storeId,
        terminalId,
      }),
      now,
      resolvedByUserId: "user-1" as Id<"athenaUser">,
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        resolvedConflictIds: [duplicateOpenConflict._id],
        skippedConflictIds: [closeoutVarianceConflict._id],
      },
    });
    expect(ctx.tables.registerSession).toContainEqual(
      expect.objectContaining({
        _id: expect.not.stringMatching(/^registerSession-prior$/),
        registerNumber: "A1",
        status: "active",
        terminalId,
      }),
    );
    const replacementSession = ctx.tables.registerSession.find(
      (session) => session._id !== "registerSession-prior",
    );
    expect(replacementSession).toBeTruthy();
    expect(ctx.tables.posLocalSyncMapping).toContainEqual(
      expect.objectContaining({
        cloudId: replacementSession?._id,
        cloudTable: "registerSession",
        localEventId: "event-open-replacement",
        localId: "register-replacement",
        localIdKind: "registerSession",
      }),
    );
    expect(ctx.tables.posLocalSyncEvent).toContainEqual(
      expect.objectContaining({
        _id: "event-open-replacement-id",
        projectedAt: now,
        status: "projected",
      }),
    );
    expect(ctx.tables.posLocalSyncConflict).toContainEqual(
      expect.objectContaining({
        _id: duplicateOpenConflict._id,
        status: "resolved",
      }),
    );
    expect(ctx.tables.posLocalSyncConflict).toContainEqual(
      expect.objectContaining({
        _id: closeoutVarianceConflict._id,
        status: "needs_review",
      }),
    );
  });

  it("repairs only the latest safe duplicate register-open conflict", async () => {
    const olderConflict = buildConflict({
      _id: "older-conflict" as Id<"posLocalSyncConflict">,
      localEventId: "event-open-older",
      localRegisterSessionId: "register-older",
      sequence: 2,
    });
    const latestConflict = buildConflict({
      _id: "latest-conflict" as Id<"posLocalSyncConflict">,
      localEventId: "event-open-latest",
      localRegisterSessionId: "register-latest",
      sequence: 3,
    });
    const ctx = buildCtx({
      posLocalSyncConflict: [olderConflict, latestConflict],
      posLocalSyncEvent: [
        buildEvent({
          _id: "event-open-older-id" as Id<"posLocalSyncEvent">,
          localEventId: "event-open-older",
          localRegisterSessionId: "register-older",
          sequence: 2,
        }),
        buildEvent({
          _id: "event-open-latest-id" as Id<"posLocalSyncEvent">,
          localEventId: "event-open-latest",
          localRegisterSessionId: "register-latest",
          sequence: 3,
        }),
      ],
    });

    const result = await resolveTerminalCloudRepair(ctx as never, {
      expectedPreconditionHash: buildTerminalCloudRepairPreconditionHash({
        safeConflictIds: [latestConflict._id, olderConflict._id],
        storeId,
        terminalId,
      }),
      now,
      resolvedByUserId: "user-1" as Id<"athenaUser">,
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        resolvedConflictIds: [latestConflict._id, olderConflict._id],
        skippedConflictIds: [],
      },
    });
    expect(ctx.tables.posLocalSyncEvent).toContainEqual(
      expect.objectContaining({
        _id: "event-open-latest-id",
        status: "projected",
      }),
    );
    expect(ctx.tables.posLocalSyncEvent).toContainEqual(
      expect.objectContaining({
        _id: "event-open-older-id",
        status: "conflicted",
      }),
    );
    expect(ctx.tables.posLocalSyncConflict).toContainEqual(
      expect.objectContaining({
        _id: olderConflict._id,
        status: "resolved",
      }),
    );

    const repeat = await resolveTerminalCloudRepair(ctx as never, {
      expectedPreconditionHash: buildTerminalCloudRepairPreconditionHash({
        safeConflictIds: [],
        storeId,
        terminalId,
      }),
      now: now + 1,
      resolvedByUserId: "user-1" as Id<"athenaUser">,
      storeId,
      terminalId,
    });

    expect(repeat).toMatchObject({
      kind: "ok",
      data: {
        resolvedConflictIds: [],
        skippedConflictIds: [],
      },
    });
    expect(
      ctx.tables.registerSession.filter(
        (session) => session.status === "active",
      ),
    ).toHaveLength(1);
  });

  it("stops without patching when repair projection is no longer safe", async () => {
    const duplicateOpenConflict = buildConflict({
      localEventId: "event-open-replacement",
      localRegisterSessionId: "register-replacement",
      sequence: 1,
    });
    const closeoutVarianceConflict = buildConflict({
      _id: "closeout-conflict" as Id<"posLocalSyncConflict">,
      conflictType: "permission",
      details: {
        countedCash: 95,
        expectedCash: 100,
        variance: -5,
      },
      localEventId: "event-register-closed",
      localRegisterSessionId: "registerSession-prior",
      sequence: 2,
      summary: REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
    });
    const ctx = buildCtx({
      posLocalSyncConflict: [closeoutVarianceConflict, duplicateOpenConflict],
      posLocalSyncEvent: [
        buildEvent({
          _id: "event-open-replacement-id" as Id<"posLocalSyncEvent">,
          localEventId: "event-open-replacement",
          localRegisterSessionId: "register-replacement",
          sequence: 1,
        }),
      ],
      registerSession: [
        {
          _id: "registerSession-prior" as Id<"registerSession">,
          _creationTime: now - 30 * 60 * 1000,
          storeId,
          terminalId,
          registerNumber: "A1",
          status: "closing",
          openedByStaffProfileId: "staff-1" as Id<"staffProfile">,
          openedAt: now - 40 * 60 * 1000,
          openingFloat: 100,
          expectedCash: 100,
        } as Doc<"registerSession">,
      ],
    });

    const result = await resolveTerminalCloudRepair(ctx as never, {
      expectedPreconditionHash: buildTerminalCloudRepairPreconditionHash({
        safeConflictIds: [duplicateOpenConflict._id],
        storeId,
        terminalId,
      }),
      now,
      resolvedByUserId: "user-1" as Id<"athenaUser">,
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      error: {
        code: "precondition_failed",
        metadata: {
          preconditionDrift: true,
        },
      },
      kind: "user_error",
    });
    expect(ctx.tables.posLocalSyncConflict).toContainEqual(
      expect.objectContaining({
        _id: duplicateOpenConflict._id,
        status: "needs_review",
      }),
    );
    expect(ctx.tables.posLocalSyncEvent).toContainEqual(
      expect.objectContaining({
        _id: "event-open-replacement-id",
        status: "conflicted",
      }),
    );
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "posLocalSyncConflict",
      duplicateOpenConflict._id,
      expect.anything(),
    );
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "posLocalSyncEvent",
      "event-open-replacement-id",
      expect.anything(),
    );
  });

  it("stops without patching when the preview precondition drifted", async () => {
    const ctx = buildCtx({
      posLocalSyncConflict: [buildConflict()],
      posLocalSyncEvent: [buildEvent()],
    });

    const result = await resolveTerminalCloudRepair(ctx as never, {
      expectedPreconditionHash: "terminal-cloud-repair:stale",
      now,
      resolvedByUserId: "user-1" as Id<"athenaUser">,
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      error: {
        code: "precondition_failed",
        metadata: {
          preconditionDrift: true,
        },
      },
      kind: "user_error",
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

type TestTables = {
  operationalEvent: Array<Record<string, unknown>>;
  posLocalSyncConflict: Array<Doc<"posLocalSyncConflict">>;
  posLocalSyncEvent: Array<Doc<"posLocalSyncEvent">>;
  posLocalSyncMapping: Array<Record<string, unknown>>;
  posTerminal: Array<Doc<"posTerminal">>;
  registerSession: Array<Doc<"registerSession">>;
  staffProfile: Array<Doc<"staffProfile">>;
  staffRoleAssignment: Array<Record<string, unknown>>;
  store: Array<Doc<"store">>;
};

function buildCtx(seed: Partial<TestTables>) {
  const tables: TestTables = {
    operationalEvent: [],
    posLocalSyncConflict: seed.posLocalSyncConflict ?? [],
    posLocalSyncEvent: seed.posLocalSyncEvent ?? [],
    posLocalSyncMapping: seed.posLocalSyncMapping ?? [],
    posTerminal: seed.posTerminal ?? [buildTerminal()],
    registerSession: seed.registerSession ?? [],
    staffProfile: seed.staffProfile ?? [buildStaffProfile()],
    staffRoleAssignment: seed.staffRoleAssignment ?? [
      {
        _id: "role-1",
        staffProfileId: "staff-1",
        storeId,
        role: "cashier",
        status: "active",
      },
    ],
    store: seed.store ?? [buildStore()],
  };
  const insertCounts = new Map<string, number>();
  const patch = vi.fn(
    async (tableName: keyof TestTables, id: string, patchValue: Record<string, unknown>) => {
      const row = tables[tableName].find((item) => item._id === id);
      if (row) Object.assign(row, patchValue);
    },
  );

  return {
    tables,
    db: {
      get: vi.fn(async (tableName: keyof TestTables, id: string) => {
        return tables[tableName].find((item) => item._id === id) ?? null;
      }),
      insert: vi.fn(async (tableName: keyof TestTables, input: Record<string, unknown>) => {
        const nextCount = (insertCounts.get(tableName) ?? 0) + 1;
        insertCounts.set(tableName, nextCount);
        const id = `${tableName}-${nextCount}`;
        if (!tables[tableName]) {
          tables[tableName] = [] as never;
        }
        tables[tableName].push({
          _id: id,
          _creationTime: now,
          ...input,
        } as never);
        return id;
      }),
      normalizeId: vi.fn((tableName: keyof TestTables, value: string) => {
        return tables[tableName].some((item) => item._id === value) ? value : null;
      }),
      patch,
      query: vi.fn((tableName: keyof TestTables) =>
        buildQuery((tables[tableName] ?? []) as Array<Record<string, unknown>>),
      ),
    },
  };
}

function buildQuery(rows: Array<Record<string, unknown>>) {
  let currentRows = [...rows];
  const applyEq = (field: string, value: unknown) => {
    currentRows = currentRows.filter((row) => row[field] === value);
  };
  const chain = {
    filter: vi.fn((_build: unknown) => {
      return chain;
    }),
    first: vi.fn(async () => currentRows[0] ?? null),
    order: vi.fn((direction: "asc" | "desc") => {
      currentRows = [...currentRows].sort((left, right) => {
        const leftTime = Number(left._creationTime ?? 0);
        const rightTime = Number(right._creationTime ?? 0);
        return direction === "desc" ? rightTime - leftTime : leftTime - rightTime;
      });
      return chain;
    }),
    take: vi.fn(async (count: number) => currentRows.slice(0, count)),
    unique: vi.fn(async () => currentRows[0] ?? null),
  };
  return {
    withIndex: vi.fn((_indexName: string, build: (q: {
      eq: (field: string, value: unknown) => unknown;
      gt: (field: string, value: unknown) => unknown;
    }) => unknown) => {
      const q = {
        eq: vi.fn((field: string, value: unknown) => {
          applyEq(field, value);
          return q;
        }),
        gt: vi.fn((field: string, value: unknown) => {
          currentRows = currentRows.filter((row) => Number(row[field]) > Number(value));
          return q;
        }),
      };
      build(q);
      return chain;
    }),
    filter: chain.filter,
    first: chain.first,
    order: chain.order,
    take: chain.take,
    unique: chain.unique,
  };
}

function buildTerminal(
  overrides: Partial<Doc<"posTerminal">> = {},
): Doc<"posTerminal"> {
  return {
    _id: terminalId,
    _creationTime: now - 30 * 60 * 1000,
    storeId,
    registerNumber: "A1",
    status: "active",
    ...overrides,
  } as Doc<"posTerminal">;
}

function buildStaffProfile(
  overrides: Partial<Doc<"staffProfile">> = {},
): Doc<"staffProfile"> {
  return {
    _id: "staff-1" as Id<"staffProfile">,
    _creationTime: now - 30 * 60 * 1000,
    storeId,
    status: "active",
    ...overrides,
  } as Doc<"staffProfile">;
}

function buildStore(overrides: Partial<Doc<"store">> = {}): Doc<"store"> {
  return {
    _id: storeId,
    _creationTime: now - 30 * 60 * 1000,
    organizationId: "org-1" as Id<"organization">,
    ...overrides,
  } as Doc<"store">;
}

function buildConflict(
  overrides: Partial<Doc<"posLocalSyncConflict">> = {},
): Doc<"posLocalSyncConflict"> {
  return {
    _id: "conflict-1" as Id<"posLocalSyncConflict">,
    _creationTime: now - 20 * 60 * 1000,
    storeId,
    terminalId,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    sequence: 1,
    conflictType: "duplicate_local_id",
    status: "needs_review",
    summary: "Duplicate register-open attempt for an already opened drawer.",
    details: { reason: "duplicate_register_opened" },
    createdAt: now - 20 * 60 * 1000,
    ...overrides,
  } as Doc<"posLocalSyncConflict">;
}

function buildEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _id: "event-1-id" as Id<"posLocalSyncEvent">,
    _creationTime: now - 20 * 60 * 1000,
    storeId,
    terminalId,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    eventType: "register_opened",
    sequence: 1,
    occurredAt: now - 20 * 60 * 1000,
    staffProfileId: "staff-1" as Id<"staffProfile">,
    payload: {
      openingFloat: 100,
      registerNumber: "A1",
    },
    status: "conflicted",
    submittedAt: now - 19 * 60 * 1000,
    ...overrides,
  } as Doc<"posLocalSyncEvent">;
}
