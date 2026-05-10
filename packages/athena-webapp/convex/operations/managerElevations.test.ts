import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  endManagerElevationWithCtx,
  getActiveManagerElevationWithCtx,
  MANAGER_ELEVATION_TTL_MS,
  startManagerElevationWithCtx,
} from "./managerElevations";

type TableName =
  | "athenaUser"
  | "managerElevation"
  | "operationalEvent"
  | "posTerminal"
  | "staffCredential"
  | "staffProfile"
  | "staffRoleAssignment";
type Row = Record<string, unknown> & { _id: string };

const STORE_ID = "store-1" as Id<"store">;
const ORGANIZATION_ID = "org-1" as Id<"organization">;
const TERMINAL_ID = "terminal-1" as Id<"posTerminal">;
const ACCOUNT_ID = "user-1" as Id<"athenaUser">;

function createManagerElevationsCtx(seed?: {
  accounts?: Row[];
  credentials?: Row[];
  elevations?: Row[];
  events?: Row[];
  profiles?: Row[];
  roles?: Row[];
  terminals?: Row[];
}) {
  const tables: Record<TableName, Map<string, Row>> = {
    athenaUser: new Map(
      (
        seed?.accounts ?? [
          {
            _id: ACCOUNT_ID,
            email: "operator@example.com",
          },
        ]
      ).map((row) => [row._id, row]),
    ),
    managerElevation: new Map(
      (seed?.elevations ?? []).map((row) => [row._id, row]),
    ),
    operationalEvent: new Map(
      (seed?.events ?? []).map((row) => [row._id, row]),
    ),
    posTerminal: new Map(
      (
        seed?.terminals ?? [
          {
            _id: TERMINAL_ID,
            storeId: STORE_ID,
            status: "active",
            displayName: "Front register",
          },
        ]
      ).map((row) => [row._id, row]),
    ),
    staffCredential: new Map(
      (
        seed?.credentials ?? [
          {
            _id: "credential-1",
            staffProfileId: "manager-1",
            organizationId: ORGANIZATION_ID,
            storeId: STORE_ID,
            username: "manager",
            pinHash: "pin-manager",
            status: "active",
          },
        ]
      ).map((row) => [row._id, row]),
    ),
    staffProfile: new Map(
      (
        seed?.profiles ?? [
          {
            _id: "manager-1",
            storeId: STORE_ID,
            organizationId: ORGANIZATION_ID,
            status: "active",
            fullName: "Mara Mensah",
          },
        ]
      ).map((row) => [row._id, row]),
    ),
    staffRoleAssignment: new Map(
      (
        seed?.roles ?? [
          {
            _id: "role-1",
            staffProfileId: "manager-1",
            organizationId: ORGANIZATION_ID,
            storeId: STORE_ID,
            role: "manager",
            isPrimary: true,
            status: "active",
            assignedAt: 1,
          },
        ]
      ).map((row) => [row._id, row]),
    ),
  };
  const insertCounters: Record<TableName, number> = {
    athenaUser: 0,
    managerElevation: 0,
    operationalEvent: 0,
    posTerminal: 0,
    staffCredential: 0,
    staffProfile: 0,
    staffRoleAssignment: 0,
  };

  function createIndexedQuery(table: TableName, filters: Array<[string, unknown]>) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );

    return {
      first: async () => matches[0] ?? null,
      take: async (count: number) => matches.slice(0, count),
      collect: async () => matches,
    };
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        insertCounters[table] += 1;
        const id = `${table}-${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(table: TableName, id: string, value: Record<string, unknown>) {
        const existing = tables[table].get(id);
        if (!existing) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existing, ...value });
      },
      query(table: TableName) {
        return {
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) {
            const filters: Array<[string, unknown]> = [];
            const queryBuilder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return queryBuilder;
              },
            };

            applyIndex(queryBuilder);
            return createIndexedQuery(table, filters);
          },
        };
      },
    },
  } as unknown as MutationCtx & QueryCtx;

  return { ctx, tables };
}

function startArgs(overrides?: Partial<Parameters<typeof startManagerElevationWithCtx>[1]>) {
  return {
    accountId: ACCOUNT_ID,
    pinHash: "pin-manager",
    reason: "Review store day",
    storeId: STORE_ID,
    terminalId: TERMINAL_ID,
    username: "manager",
    ...overrides,
  };
}

describe("manager elevations", () => {
  it("starts a temporary account, store, organization, and terminal-scoped elevation for an active manager credential", async () => {
    const { ctx, tables } = createManagerElevationsCtx();
    const before = Date.now();

    const result = await startManagerElevationWithCtx(ctx, startArgs());

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        accountId: ACCOUNT_ID,
        elevationId: "managerElevation-1",
        managerCredentialId: "credential-1",
        managerStaffProfileId: "manager-1",
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
      }),
    });
    if (result.kind !== "ok") {
      throw new Error("Expected manager elevation to start.");
    }
    expect(result.data.expiresAt).toBeGreaterThanOrEqual(
      before + MANAGER_ELEVATION_TTL_MS,
    );
    expect(result.data.expiresAt).toBeLessThanOrEqual(
      Date.now() + MANAGER_ELEVATION_TTL_MS,
    );
    expect(tables.managerElevation.get("managerElevation-1")).toMatchObject({
      accountId: ACCOUNT_ID,
      managerCredentialId: "credential-1",
      managerStaffProfileId: "manager-1",
      organizationId: ORGANIZATION_ID,
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
    });
    expect(tables.managerElevation.get("managerElevation-1")?.endedAt).toBeUndefined();
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "manager-1",
        actorUserId: ACCOUNT_ID,
        eventType: "manager_elevation.started",
        subjectId: "managerElevation-1",
      }),
    ]);
  });

  it("returns the active elevation only for the same store, terminal, and account before expiry", async () => {
    const now = Date.now();
    const { ctx } = createManagerElevationsCtx({
      elevations: [
        {
          _id: "elevation-1",
          accountId: ACCOUNT_ID,
          createdAt: now - 1_000,
          expiresAt: now + 60_000,
          managerCredentialId: "credential-1",
          managerStaffProfileId: "manager-1",
          organizationId: ORGANIZATION_ID,
          reason: "Review store day",
          storeId: STORE_ID,
          terminalId: TERMINAL_ID,
        },
      ],
    });

    await expect(
      getActiveManagerElevationWithCtx(ctx, {
        accountId: ACCOUNT_ID,
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
      }),
    ).resolves.toMatchObject({
      elevationId: "elevation-1",
      accountId: ACCOUNT_ID,
      terminalId: TERMINAL_ID,
    });

    await expect(
      getActiveManagerElevationWithCtx(ctx, {
        accountId: "user-2" as Id<"athenaUser">,
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
      }),
    ).resolves.toBeNull();
    await expect(
      getActiveManagerElevationWithCtx(ctx, {
        accountId: ACCOUNT_ID,
        storeId: STORE_ID,
        terminalId: "terminal-2" as Id<"posTerminal">,
      }),
    ).resolves.toBeNull();
    await expect(
      getActiveManagerElevationWithCtx(ctx, {
        accountId: ACCOUNT_ID,
        storeId: "store-2" as Id<"store">,
        terminalId: TERMINAL_ID,
      }),
    ).resolves.toBeNull();
  });

  it("hides ended and expired elevation records from the active query", async () => {
    const now = Date.now();
    const { ctx } = createManagerElevationsCtx({
      elevations: [
        {
          _id: "ended-elevation",
          accountId: ACCOUNT_ID,
          createdAt: now - 10_000,
          endedAt: now - 5_000,
          endReason: "manager_ended",
          expiresAt: now + 60_000,
          managerCredentialId: "credential-1",
          managerStaffProfileId: "manager-1",
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          terminalId: TERMINAL_ID,
        },
        {
          _id: "expired-elevation",
          accountId: ACCOUNT_ID,
          createdAt: now - 120_000,
          expiresAt: now - 1_000,
          managerCredentialId: "credential-1",
          managerStaffProfileId: "manager-1",
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          terminalId: TERMINAL_ID,
        },
      ],
    });

    await expect(
      getActiveManagerElevationWithCtx(ctx, {
        accountId: ACCOUNT_ID,
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
      }),
    ).resolves.toBeNull();
  });

  it("hides active-looking elevations when the manager credential or role is no longer active", async () => {
    const now = Date.now();

    await expect(
      getActiveManagerElevationWithCtx(
        createManagerElevationsCtx({
          credentials: [
            {
              _id: "credential-1",
              staffProfileId: "manager-1",
              organizationId: ORGANIZATION_ID,
              storeId: STORE_ID,
              username: "manager",
              pinHash: "pin-manager",
              status: "revoked",
            },
          ],
          elevations: [
            {
              _id: "elevation-1",
              accountId: ACCOUNT_ID,
              createdAt: now - 1_000,
              expiresAt: now + 60_000,
              managerCredentialId: "credential-1",
              managerStaffProfileId: "manager-1",
              organizationId: ORGANIZATION_ID,
              storeId: STORE_ID,
              terminalId: TERMINAL_ID,
            },
          ],
        }).ctx,
        {
          accountId: ACCOUNT_ID,
          storeId: STORE_ID,
          terminalId: TERMINAL_ID,
        },
      ),
    ).resolves.toBeNull();

    await expect(
      getActiveManagerElevationWithCtx(
        createManagerElevationsCtx({
          elevations: [
            {
              _id: "elevation-1",
              accountId: ACCOUNT_ID,
              createdAt: now - 1_000,
              expiresAt: now + 60_000,
              managerCredentialId: "credential-1",
              managerStaffProfileId: "manager-1",
              organizationId: ORGANIZATION_ID,
              storeId: STORE_ID,
              terminalId: TERMINAL_ID,
            },
          ],
          roles: [
            {
              _id: "role-1",
              staffProfileId: "manager-1",
              organizationId: ORGANIZATION_ID,
              storeId: STORE_ID,
              role: "manager",
              isPrimary: true,
              status: "inactive",
              assignedAt: 1,
            },
          ],
        }).ctx,
        {
          accountId: ACCOUNT_ID,
          storeId: STORE_ID,
          terminalId: TERMINAL_ID,
        },
      ),
    ).resolves.toBeNull();
  });

  it("ends an active elevation and records the lifecycle event", async () => {
    const now = Date.now();
    const { ctx, tables } = createManagerElevationsCtx({
      elevations: [
        {
          _id: "elevation-1",
          accountId: ACCOUNT_ID,
          createdAt: now - 1_000,
          expiresAt: now + 60_000,
          managerCredentialId: "credential-1",
          managerStaffProfileId: "manager-1",
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          terminalId: TERMINAL_ID,
        },
      ],
    });

    await expect(
      endManagerElevationWithCtx(ctx, {
        accountId: ACCOUNT_ID,
        elevationId: "elevation-1" as Id<"managerElevation">,
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        elevationId: "elevation-1",
        ended: true,
      },
    });
    expect(tables.managerElevation.get("elevation-1")).toMatchObject({
      endedAt: expect.any(Number),
      endReason: "manager_ended",
    });
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "manager-1",
        actorUserId: ACCOUNT_ID,
        eventType: "manager_elevation.ended",
        subjectId: "elevation-1",
      }),
    ]);
  });

  it("rejects cashier, inactive, wrong-store, wrong-terminal, and wrong-account start attempts", async () => {
    await expect(
      startManagerElevationWithCtx(
        createManagerElevationsCtx({
          roles: [
            {
              _id: "role-1",
              staffProfileId: "manager-1",
              organizationId: ORGANIZATION_ID,
              storeId: STORE_ID,
              role: "cashier",
              isPrimary: true,
              status: "active",
              assignedAt: 1,
            },
          ],
        }).ctx,
        startArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { code: "authorization_failed" },
    });

    await expect(
      startManagerElevationWithCtx(
        createManagerElevationsCtx({
          profiles: [
            {
              _id: "manager-1",
              storeId: STORE_ID,
              organizationId: ORGANIZATION_ID,
              status: "inactive",
              fullName: "Mara Mensah",
            },
          ],
        }).ctx,
        startArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { code: "authorization_failed" },
    });

    await expect(
      startManagerElevationWithCtx(
        createManagerElevationsCtx({
          credentials: [
            {
              _id: "credential-1",
              staffProfileId: "manager-1",
              organizationId: ORGANIZATION_ID,
              storeId: "store-2",
              username: "manager",
              pinHash: "pin-manager",
              status: "active",
            },
          ],
        }).ctx,
        startArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { code: "authentication_failed" },
    });

    await expect(
      startManagerElevationWithCtx(
        createManagerElevationsCtx({
          terminals: [
            {
              _id: TERMINAL_ID,
              storeId: "store-2",
              status: "active",
              displayName: "Other register",
            },
          ],
        }).ctx,
        startArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { code: "precondition_failed" },
    });

    await expect(
      startManagerElevationWithCtx(
        createManagerElevationsCtx({ accounts: [] }).ctx,
        startArgs(),
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { code: "precondition_failed" },
    });
  });
});
