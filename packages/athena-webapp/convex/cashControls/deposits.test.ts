import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Id } from "../_generated/dataModel";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

import {
  buildCashControlsDashboardSnapshot,
  buildRegisterSessionDepositTargetId,
  getDashboardSnapshot,
  getRegisterSessionSnapshot,
  listOpenLocalSyncConflictsByRegisterSession,
  recordRegisterSessionDeposit,
} from "./deposits";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createQueryCtx(seed: Record<string, Array<Record<string, unknown>>>) {
  const rowsByTable = new Map(
    Object.entries(seed).map(([tableName, rows]) => [
      tableName,
      rows.map((row) => ({ ...row })),
    ]),
  );
  const getRows = (tableName: string) => {
    let rows = rowsByTable.get(tableName);
    if (!rows) {
      rows = [];
      rowsByTable.set(tableName, rows);
    }
    return rows;
  };

  return {
    tables: rowsByTable,
    db: {
      get: async (tableName: string, id: string) =>
        getRows(tableName).find((row) => row._id === id) ?? null,
      insert: async (tableName: string, value: Record<string, unknown>) => {
        const rows = getRows(tableName);
        const id = (value._id as string | undefined) ?? `${tableName}_${rows.length + 1}`;
        rows.push({ ...value, _id: id });
        return id;
      },
      normalizeId: (tableName: string, id: string) =>
        getRows(tableName).some((row) => row._id === id) ? id : null,
      patch: async (
        tableName: string,
        id: string,
        value: Record<string, unknown>,
      ) => {
        const row = getRows(tableName).find((candidate) => candidate._id === id);
        if (!row) {
          throw new Error(`Missing ${tableName} row ${id}`);
        }
        Object.assign(row, value);
      },
      query: (tableName: string) => {
        const filters: Array<[string, unknown]> = [];
        const predicateFilters: Array<(row: Record<string, unknown>) => boolean> = [];
        const matches = (row: Record<string, unknown>) =>
          filters.every(([field, value]) => row[field] === value) &&
          predicateFilters.every((predicate) => predicate(row));
        const filterQuery = {
          and: (...conditions: boolean[]) => conditions.every(Boolean),
          eq: (left: unknown, right: unknown) => left === right,
          field: (field: string) => ({
            __field: field,
          }),
        };
        const resolveFilterValue = (
          value: unknown,
          row: Record<string, unknown>,
        ) =>
          value &&
          typeof value === "object" &&
          "__field" in value &&
          typeof value.__field === "string"
            ? row[value.__field]
            : value;
        const query = {
          filter: (build: (q: any) => boolean) => {
            predicateFilters.push((row) =>
              build({
                ...filterQuery,
                eq: (left: unknown, right: unknown) =>
                  resolveFilterValue(left, row) === resolveFilterValue(right, row),
              }),
            );
            return query;
          },
          withIndex: (_indexName: string, build: (q: any) => unknown) => {
            const indexQuery = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return indexQuery;
              },
            };
            build(indexQuery);
            return query;
          },
          order: () => query,
          async unique() {
            return (
              getRows(tableName).find((row) => matches(row)) ?? null
            );
          },
          async first() {
            return getRows(tableName).find((row) => matches(row)) ?? null;
          },
          async take(limit: number) {
            return getRows(tableName)
              .filter((row) => matches(row))
              .slice(0, limit);
          },
          async collect() {
            return getRows(tableName).filter((row) => matches(row));
          },
        };
        return query;
      },
    },
    auth: {},
  };
}

function createAuthorizedRegisterDepositCtx(
  overrides: Record<string, Array<Record<string, unknown>>> = {},
) {
  return createQueryCtx({
    athenaUser: [{ _id: "athena_user_1", email: "operator@example.com" }],
    organizationMember: [
      {
        _id: "member_1",
        organizationId: "org_1",
        role: "pos_only",
        userId: "athena_user_1",
      },
    ],
    registerSession: [
      {
        _id: "session_open",
        expectedCash: 50000,
        openedAt: 1,
        openingFloat: 10000,
        organizationId: "org_1",
        registerNumber: "1",
        status: "active",
        storeId: "store_1",
      },
    ],
    staffProfile: [
      {
        _id: "staff_1",
        linkedUserId: "athena_user_1",
        status: "active",
        storeId: "store_1",
      },
    ],
    store: [{ _id: "store_1", currency: "GHS", organizationId: "org_1" }],
    users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    ...overrides,
  });
}

describe("cash control deposits", () => {
  beforeEach(() => {
    mockedAuthServer.getAuthUserId.mockResolvedValue("auth_user_1");
  });

  it("builds a stable session-scoped submission target for idempotent deposit writes", () => {
    expect(
      buildRegisterSessionDepositTargetId({
        registerSessionId: "session_1" as Id<"registerSession">,
        submissionKey: "submission_1",
      })
    ).toBe("session_1:submission_1");
  });

  it("builds dashboard sections from register sessions and recorded deposits", () => {
    const snapshot = buildCashControlsDashboardSnapshot({
      approvalRequestsBySessionId: new Map([
        [
          "session_closing" as Id<"registerSession">,
          {
            _id: "approval_1" as Id<"approvalRequest">,
            notes: "Counted twice before manager review.",
            reason: "Variance review required.",
            status: "pending",
          },
        ],
      ]),
      deposits: [
        {
          _id: "deposit_1" as Id<"paymentAllocation">,
          amount: 1200,
          externalReference: "BANK-001",
          notes: "Midday bank drop",
          recordedAt: 30,
          registerSessionId: "session_open" as Id<"registerSession">,
        },
        {
          _id: "deposit_2" as Id<"paymentAllocation">,
          amount: 500,
          recordedAt: 40,
          registerSessionId: "session_closing" as Id<"registerSession">,
        },
      ],
      syncConflictsBySessionId: new Map([
        [
          "session_open" as Id<"registerSession">,
          [
            {
              _id: "sync_conflict_1" as Id<"posLocalSyncConflict">,
              conflictType: "permission",
              status: "needs_review",
              summary:
                "Register closeout variance requires manager review before synced closeout can be applied.",
            },
          ],
        ],
      ]),
      registerSessions: [
        {
          _id: "session_open" as Id<"registerSession">,
          countedCash: undefined,
          expectedCash: 13800,
          openedAt: 10,
          openingFloat: 5000,
          registerNumber: "A1",
          status: "active",
          terminalId: "terminal_1" as Id<"posTerminal">,
          variance: undefined,
        },
        {
          _id: "session_closing" as Id<"registerSession">,
          countedCash: 9000,
          expectedCash: 9500,
          managerApprovalRequestId: "approval_1" as Id<"approvalRequest">,
          openedAt: 20,
          openingFloat: 5000,
          registerNumber: "B2",
          status: "closing",
          terminalId: "terminal_2" as Id<"posTerminal">,
          variance: -500,
        },
        {
          _id: "session_closed" as Id<"registerSession">,
          countedCash: 5000,
          expectedCash: 5000,
          openedAt: 5,
          openingFloat: 5000,
          registerNumber: "C3",
          status: "closed",
          variance: 0,
        },
      ],
      staffNamesById: new Map(),
      terminalNamesById: new Map([
        ["terminal_1" as Id<"posTerminal">, "Front counter"],
        ["terminal_2" as Id<"posTerminal">, "Back counter"],
      ]),
    });

    expect(snapshot.registerSessions).toHaveLength(3);
    expect(snapshot.registerSessions.map((session) => session._id)).toEqual([
      "session_closing",
      "session_open",
      "session_closed",
    ]);

    expect(snapshot.openSessions).toHaveLength(1);
    expect(snapshot.openSessions[0]).toMatchObject({
      _id: "session_open",
      registerNumber: "A1",
      terminalName: "Front counter",
      totalDeposited: 1200,
    });

    expect(snapshot.pendingCloseouts).toHaveLength(1);
    expect(snapshot.pendingCloseouts[0]).toMatchObject({
      _id: "session_closing",
      pendingApprovalRequest: {
        _id: "approval_1",
        notes: "Counted twice before manager review.",
        status: "pending",
      },
      terminalName: "Back counter",
      totalDeposited: 500,
    });

    expect(snapshot.openSessions[0]).toMatchObject({
      localSyncStatus: {
        status: "needs_review",
        reconciliationItems: [
          {
            id: "sync_conflict_1",
            status: "needs_review",
            summary:
              "Register closeout variance requires manager review before synced closeout can be applied.",
            type: "permission",
          },
        ],
      },
    });

    expect(snapshot.unresolvedVariances).toHaveLength(2);
    expect(snapshot.unresolvedVariances[0]).toMatchObject({
      _id: "session_closing",
      variance: -500,
    });

    expect(snapshot.recentDeposits).toEqual([
      expect.objectContaining({
        _id: "deposit_2",
        amount: 500,
        registerNumber: "B2",
      }),
      expect.objectContaining({
        _id: "deposit_1",
        amount: 1200,
        reference: "BANK-001",
        registerNumber: "A1",
      }),
    ]);
  });

  it("maps open sync conflicts when an unmapped local id is the cloud session id", async () => {
    const conflict = {
      _id: "sync_conflict_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "session_open",
      localEventId: "event_1",
      sequence: 1,
      conflictType: "payment",
      status: "needs_review",
      summary: "Payment needs manager review.",
      details: {},
      createdAt: 1,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncMapping: [],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(
      new Map([["session_open", [expect.objectContaining({ _id: "sync_conflict_1" })]]]),
    );
  });

  it("maps open sync conflicts through local register-session sync mappings", async () => {
    const conflict = {
      _id: "sync_conflict_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event_1",
      sequence: 1,
      conflictType: "payment",
      status: "needs_review",
      summary: "Payment needs manager review.",
      details: {},
      createdAt: 1,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(
      new Map([["session_open", [expect.objectContaining({ _id: "sync_conflict_1" })]]]),
    );
  });

  it("excludes resolved sync conflicts from register-session reconciliation", async () => {
    const ctx = createQueryCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_resolved",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_1",
          sequence: 1,
          conflictType: "payment",
          status: "resolved",
          summary: "Payment was reviewed.",
          details: {},
          createdAt: 1,
          resolvedAt: 2,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [{ _id: "session_open" }],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(new Map());
  });

  it("ignores unmapped local register ids that are not valid cloud session ids", async () => {
    const conflict = {
      _id: "sync_conflict_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event_1",
      sequence: 1,
      conflictType: "payment",
      status: "needs_review",
      summary: "Payment needs manager review.",
      details: {},
      createdAt: 1,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncMapping: [],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(new Map());
  });

  it("resolves mapped sync conflicts beyond the dashboard session display limit", async () => {
    const olderConflicts = Array.from({ length: 100 }, (_, index) => ({
      _id: `sync_conflict_${index}`,
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: `local-register-${index}`,
      localEventId: `event_${index}`,
      sequence: index + 1,
      conflictType: "payment",
      status: "needs_review",
      summary: "Payment needs manager review.",
      details: {},
      createdAt: index,
    }));
    const targetConflict = {
      _id: "sync_conflict_target",
      storeId: "store_1",
      terminalId: "terminal_2",
      localRegisterSessionId: "local-register-target",
      localEventId: "event_target",
      sequence: 101,
      conflictType: "permission",
      status: "needs_review",
      summary: "Staff access changed.",
      details: {},
      createdAt: 101,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [...olderConflicts, targetConflict],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_target",
          storeId: "store_1",
          terminalId: "terminal_2",
          localRegisterSessionId: "local-register-target",
          localIdKind: "registerSession",
          localId: "local-register-target",
          cloudTable: "registerSession",
          cloudId: "session_target",
        },
      ],
      registerSession: [
        {
          _id: "session_target",
          storeId: "store_1",
          terminalId: "terminal_2",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(
      new Map([
        [
          "session_target",
          [expect.objectContaining({ _id: "sync_conflict_target" })],
        ],
      ]),
    );
  });

  it("includes register sessions with mapped sync conflicts outside the first dashboard page", async () => {
    const initialSessions = Array.from({ length: 100 }, (_, index) => ({
      _id: `session_${index}`,
      storeId: "store_1",
      terminalId: "terminal_1",
      registerNumber: `${index}`,
      status: "closed",
      openedAt: index,
      expectedCash: 0,
    }));
    const conflictedSession = {
      _id: "session_target",
      storeId: "store_1",
      terminalId: "terminal_2",
      registerNumber: "target",
      status: "active",
      openedAt: 101,
      expectedCash: 0,
    };
    const ctx = createQueryCtx({
      approvalRequest: [],
      athenaUser: [
        {
          _id: "athena_user_1",
          email: "operator@example.com",
        },
      ],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "full_admin",
          userId: "athena_user_1",
        },
      ],
      paymentAllocation: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_target",
          storeId: "store_1",
          terminalId: "terminal_2",
          localRegisterSessionId: "local-register-target",
          localEventId: "event_target",
          sequence: 101,
          conflictType: "permission",
          status: "needs_review",
          summary: "Staff access changed.",
          details: {},
          createdAt: 101,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_target",
          storeId: "store_1",
          terminalId: "terminal_2",
          localRegisterSessionId: "local-register-target",
          localIdKind: "registerSession",
          localId: "local-register-target",
          cloudTable: "registerSession",
          cloudId: "session_target",
        },
      ],
      posTerminal: [],
      registerSession: [...initialSessions, conflictedSession],
      staffProfile: [],
      store: [{ _id: "store_1", organizationId: "org_1" }],
      users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    });

    await expect(
      getHandler(getDashboardSnapshot)(ctx as never, {
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        openSessions: expect.arrayContaining([
          expect.objectContaining({
            _id: "session_target",
            localSyncStatus: expect.objectContaining({
              status: "needs_review",
            }),
          }),
        ]),
      }),
    );
  });

  it("rejects dashboard snapshots when the caller is unauthenticated", async () => {
    mockedAuthServer.getAuthUserId.mockResolvedValue(null);
    const ctx = createQueryCtx({
      store: [{ _id: "store_1", organizationId: "org_1" }],
    });

    await expect(
      getHandler(getDashboardSnapshot)(ctx as never, {
        storeId: "store_1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("rejects dashboard snapshots when the caller lacks cash-control roles", async () => {
    const ctx = createQueryCtx({
      athenaUser: [{ _id: "athena_user_1", email: "operator@example.com" }],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "staff",
          userId: "athena_user_1",
        },
      ],
      store: [{ _id: "store_1", organizationId: "org_1" }],
      users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    });

    await expect(
      getHandler(getDashboardSnapshot)(ctx as never, {
        storeId: "store_1" as Id<"store">,
      }),
    ).rejects.toThrow("You do not have access to cash controls.");
  });

  it("rejects register-session snapshots when the caller is unauthenticated", async () => {
    mockedAuthServer.getAuthUserId.mockResolvedValue(null);
    const ctx = createQueryCtx({
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
        },
      ],
      store: [{ _id: "store_1", organizationId: "org_1" }],
    });

    await expect(
      getHandler(getRegisterSessionSnapshot)(ctx as never, {
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("rejects register-session snapshots when the caller lacks cash-control roles", async () => {
    const ctx = createQueryCtx({
      athenaUser: [{ _id: "athena_user_1", email: "operator@example.com" }],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "staff",
          userId: "athena_user_1",
        },
      ],
      registerSession: [{ _id: "session_open", storeId: "store_1" }],
      store: [{ _id: "store_1", organizationId: "org_1" }],
      users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    });

    await expect(
      getHandler(getRegisterSessionSnapshot)(ctx as never, {
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).rejects.toThrow("You do not have access to cash controls.");
  });

  it("rejects register-session deposits when the caller is unauthenticated", async () => {
    mockedAuthServer.getAuthUserId.mockResolvedValue(null);
    const ctx = createQueryCtx({
      store: [{ _id: "store_1", organizationId: "org_1" }],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when the caller lacks cash-control roles", async () => {
    const ctx = createQueryCtx({
      athenaUser: [{ _id: "athena_user_1", email: "operator@example.com" }],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "staff",
          userId: "athena_user_1",
        },
      ],
      store: [{ _id: "store_1", organizationId: "org_1" }],
      users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when the staff actor is from another store", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      staffProfile: [
        {
          _id: "staff_1",
          linkedUserId: "athena_user_1",
          status: "active",
          storeId: "store_2",
        },
      ],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when the staff actor is inactive", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      staffProfile: [
        {
          _id: "staff_1",
          linkedUserId: "athena_user_1",
          status: "inactive",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when the staff actor belongs to another user", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      staffProfile: [
        {
          _id: "staff_1",
          linkedUserId: "athena_user_2",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when actor user is spoofed", async () => {
    const ctx = createAuthorizedRegisterDepositCtx();

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        actorUserId: "athena_user_2" as Id<"athenaUser">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits without a staff actor", async () => {
    const ctx = createAuthorizedRegisterDepositCtx();

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("records register-session deposits with authenticated actor refs", async () => {
    const ctx = createAuthorizedRegisterDepositCtx();

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ action: "recorded" }),
        kind: "ok",
      }),
    );

    expect(ctx.tables.get("paymentAllocation")).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff_1",
        actorUserId: "athena_user_1",
        amount: 10000,
      }),
    ]);
    expect(ctx.tables.get("operationalEvent")).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff_1",
        actorUserId: "athena_user_1",
        eventType: "register_session_cash_deposit_recorded",
      }),
    ]);
    expect(ctx.tables.get("workflowTraceEvent")).toEqual([
      expect.objectContaining({
        actorRefs: {
          actorStaffProfileId: "staff_1",
          actorUserId: "athena_user_1",
        },
        step: "register_session_deposit_recorded",
      }),
    ]);
  });

  it("writes through payment allocations, register-session math, and operational events", () => {
    const source = getSource("./deposits.ts");

    expect(source).toContain("recordPaymentAllocationWithCtx");
    expect(source).toContain("recordRegisterSessionDeposit");
    expect(source).toContain("recordOperationalEventWithCtx");
  });
});
