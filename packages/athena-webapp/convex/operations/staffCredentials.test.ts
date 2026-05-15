import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const authMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    authMocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    authMocks.requireOrganizationMemberRoleWithCtx,
}));

import {
  authenticateStaffCredential,
  authenticateStaffCredentialForApproval,
  authenticateStaffCredentialForApprovalWithCtx,
  authenticateStaffCredentialForTerminal,
  authenticateStaffCredentialWithCtx,
  authenticateStaffCredentialForTerminalWithCtx,
  createStaffCredential,
  createStaffCredentialWithCtx,
  getStaffCredentialUsernameAvailabilityWithCtx,
  listStaffCredentialsByStoreWithCtx,
  refreshTerminalStaffAuthority,
  updateStaffCredential,
  updateStaffCredentialWithCtx,
} from "./staffCredentials";
import { hashPosLocalStaffProofToken } from "../pos/application/sync/staffProof";

type TableName =
  | "approvalProof"
  | "expenseSession"
  | "operationalEvent"
  | "posTerminal"
  | "posLocalStaffProof"
  | "posSession"
  | "store"
  | "staffCredential"
  | "staffProfile"
  | "staffRoleAssignment";
type Row = Record<string, unknown> & { _id: string };

const localPinVerifier = {
  algorithm: "PBKDF2-SHA256",
  hash: "local-hash",
  iterations: 120000,
  salt: "salt",
  version: 1,
};

function createStaffCredentialsMutationCtx(seed?: {
  approvalProofs?: Row[];
  expenseSessions?: Row[];
  operationalEvents?: Row[];
  posTerminals?: Row[];
  posLocalStaffProofs?: Row[];
  posSessions?: Row[];
  stores?: Row[];
  credentials?: Row[];
  profiles?: Row[];
  roles?: Row[];
}) {
  const tables: Record<TableName, Map<string, Row>> = {
    approvalProof: new Map(
      (seed?.approvalProofs ?? []).map((row) => [row._id, row])
    ),
    expenseSession: new Map(
      (seed?.expenseSessions ?? []).map((row) => [row._id, row])
    ),
    operationalEvent: new Map(
      (seed?.operationalEvents ?? []).map((row) => [row._id, row])
    ),
    posTerminal: new Map(
      (
        seed?.posTerminals ?? [
          {
            _id: "terminal-1",
            storeId: "store_1",
            organizationId: "org_1",
            status: "active",
            registeredByUserId: "athena-user-1",
          },
          {
            _id: "terminal-2",
            storeId: "store_1",
            organizationId: "org_1",
            status: "active",
            registeredByUserId: "athena-user-1",
          },
        ]
      ).map((row) => [row._id, row])
    ),
    posLocalStaffProof: new Map(
      (seed?.posLocalStaffProofs ?? []).map((row) => [row._id, row])
    ),
    posSession: new Map((seed?.posSessions ?? []).map((row) => [row._id, row])),
    store: new Map(
      (
        seed?.stores ?? [
          {
            _id: "store_1",
            organizationId: "org_1",
          },
        ]
      ).map((row) => [row._id, row])
    ),
    staffCredential: new Map(
      (seed?.credentials ?? []).map((row) => [row._id, row])
    ),
    staffProfile: new Map((seed?.profiles ?? []).map((row) => [row._id, row])),
    staffRoleAssignment: new Map(
      (seed?.roles ?? []).map((row) => [row._id, row])
    ),
  };
  const insertCounters: Record<TableName, number> = {
    approvalProof: 0,
    expenseSession: 0,
    operationalEvent: 0,
    posTerminal: 0,
    posLocalStaffProof: 0,
    posSession: 0,
    store: 0,
    staffCredential: 0,
    staffProfile: 0,
    staffRoleAssignment: 0,
  };

  function createIndexedQuery(table: TableName, filters: Array<[string, unknown]>) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every(([field, value]) => row[field] === value)
    );

    return {
      first: async () => matches[0] ?? null,
      take: async (count: number) => matches.slice(0, count),
      collect: async () => matches,
    };
  }

  const ctx = {
    auth: {},
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
          withIndex(_index: string, applyIndex: (queryBuilder: { eq: (field: string, value: unknown) => unknown }) => unknown) {
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
  } as unknown as MutationCtx;

  return { ctx, tables };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("staff credential operations", () => {
  beforeEach(() => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    authMocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
  });

  it("reports store-scoped username availability", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1" as Id<"staffProfile">,
          organizationId: "org_1" as Id<"organization">,
          storeId: "store_1" as Id<"store">,
          username: "frontdesk",
          localPinVerifier,
          localVerifierVersion: 1,
          pinHash: "hash-1",
          status: "active",
        },
      ],
    });

    await expect(
      getStaffCredentialUsernameAvailabilityWithCtx(ctx, {
        storeId: "store_1" as Id<"store">,
        username: " frontdesk ",
      })
    ).resolves.toEqual({
      available: false,
      normalizedUsername: "frontdesk",
    });

    await expect(
      getStaffCredentialUsernameAvailabilityWithCtx(ctx, {
        storeId: "store_1" as Id<"store">,
        username: "new-user",
      })
    ).resolves.toEqual({
      available: true,
      normalizedUsername: "new-user",
    });
  });

  it("requires store access before public staff authentication can affect lockout state", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValueOnce(
      new Error("Sign in again to continue."),
    );

    const result = await getHandler(authenticateStaffCredential)(ctx, {
      allowedRoles: ["cashier"],
      storeId: "store_1" as Id<"store">,
      username: "frontdesk",
      pinHash: "wrong-hash",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to authenticate staff for this store.",
      },
    });
    expect(tables.staffCredential.get("credential-1")).not.toHaveProperty(
      "failedAuthenticationAttempts",
    );
    expect(tables.staffCredential.get("credential-1")).not.toHaveProperty(
      "authenticationLockedUntil",
    );
  });

  it("requires store access before public manager approval authentication can mint proofs", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "manager-1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "manager",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "manager-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "manager-1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "manager",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });
    authMocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("You do not have access to authenticate staff for this store."),
    );

    const result = await getHandler(authenticateStaffCredentialForApproval)(
      ctx,
      {
        actionKey: "pos.transaction.payment_method.correct",
        pinHash: "hash-1",
        reason: "Completed transactions require manager approval.",
        requiredRole: "manager",
        requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
        subject: {
          type: "pos_transaction",
          id: "transaction-1",
          label: "Receipt 1001",
        },
        username: "manager",
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to authenticate staff for this store.",
      },
    });
    expect(tables.approvalProof.size).toBe(0);
    expect(tables.staffCredential.get("credential-1")).not.toHaveProperty(
      "lastAuthenticatedAt",
    );
  });

  it("requires full admin access before creating staff credentials through the public mutation", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });
    authMocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("You do not have access to manage staff credentials."),
    );

    await expect(
      getHandler(createStaffCredential)(ctx, {
        organizationId: "org_1" as Id<"organization">,
        pinHash: "hash-1",
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to manage staff credentials.",
      },
    });
    expect(tables.staffCredential.size).toBe(0);
    expect(authMocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin"],
        failureMessage: "You do not have access to manage staff credentials.",
        organizationId: "org_1",
        userId: "athena-user-1",
      },
    );
  });

  it("requires full admin access before public credential updates can reset PINs or clear lockout", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          authenticationLockedUntil: Date.now() + 300_000,
          failedAuthenticationAttempts: 5,
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });
    authMocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("You do not have access to manage staff credentials."),
    );

    await expect(
      getHandler(updateStaffCredential)(ctx, {
        organizationId: "org_1" as Id<"organization">,
        pinHash: "hash-2",
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to manage staff credentials.",
      },
    });
    expect(tables.staffCredential.get("credential-1")).toMatchObject({
      authenticationLockedUntil: expect.any(Number),
      failedAuthenticationAttempts: 5,
      pinHash: "hash-1",
    });
  });

  it("lists credentials for a single store, including pending records", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1" as Id<"staffProfile">,
          organizationId: "org_1" as Id<"organization">,
          storeId: "store_1" as Id<"store">,
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
        {
          _id: "credential-2",
          staffProfileId: "staff_profile_2" as Id<"staffProfile">,
          organizationId: "org_1" as Id<"organization">,
          storeId: "store_1" as Id<"store">,
          username: "pending-user",
          pinHash: "pending-hash",
          status: "pending",
        },
        {
          _id: "credential-3",
          staffProfileId: "staff_profile_2" as Id<"staffProfile">,
          organizationId: "org_1" as Id<"organization">,
          storeId: "store_2" as Id<"store">,
          username: "stockroom",
          pinHash: "hash-2",
          status: "suspended",
        },
      ],
    });

    const credentials = await listStaffCredentialsByStoreWithCtx(ctx, {
      storeId: "store_1" as Id<"store">,
    });

    expect(credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          username: "frontdesk",
          status: "active",
        }),
        expect.objectContaining({
          _id: "credential-2",
          staffProfileId: "staff_profile_2",
          username: "pending-user",
          status: "pending",
        }),
      ]),
    );
    for (const credential of credentials) {
      expect(credential).not.toHaveProperty("pinHash");
      expect(credential).not.toHaveProperty("localPinVerifier");
      expect(credential).not.toHaveProperty("localVerifierVersion");
    }
  });

  it("keeps pending credentials from authenticating until PIN setup activates them", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          status: "pending",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialWithCtx(ctx, {
        allowedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
        pinHash: "hash-1",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      },
    });

    await expect(
      getHandler(authenticateStaffCredential)(ctx, {
        allowedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
        pinHash: "hash-1",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      },
    });

    const activated = await updateStaffCredentialWithCtx(ctx, {
      organizationId: "org_1" as Id<"organization">,
      pinHash: "hash-1",
      staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      storeId: "store_1" as Id<"store">,
    });

    expect(activated).toMatchObject({
      status: "active",
    });
    expect(activated).not.toHaveProperty("pinHash");
    expect(activated).not.toHaveProperty("localPinVerifier");
    expect(activated).not.toHaveProperty("localVerifierVersion");
    expect(tables.staffCredential.get("credential-1")).toMatchObject({
      pinHash: "hash-1",
      status: "active",
    });

    await expect(
      authenticateStaffCredentialWithCtx(ctx, {
        allowedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
        pinHash: "hash-1",
      })
    ).resolves.toEqual({
      kind: "ok",
      data: expect.objectContaining({
        activeRoles: ["cashier"],
        staffProfileId: "staff_profile_1",
      }),
    });
  });

  it("creates an active credential for an active staff profile with active roles", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "front_desk",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    const result = await createStaffCredentialWithCtx(ctx, {
      staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      organizationId: "org_1" as Id<"organization">,
      storeId: "store_1" as Id<"store">,
      username: " FrontDesk ",
      pinHash: "hash-1",
      localPinVerifier,
    });

    expect(result).toMatchObject({
      staffProfileId: "staff_profile_1",
      organizationId: "org_1",
      storeId: "store_1",
      username: "frontdesk",
      status: "active",
    });
    expect(result).not.toHaveProperty("pinHash");
    expect(result).not.toHaveProperty("localPinVerifier");
    expect(result).not.toHaveProperty("localVerifierVersion");
    expect(result?.lastAuthenticatedAt).toBeUndefined();
    expect(tables.staffCredential.size).toBe(1);
    expect(Array.from(tables.staffCredential.values())[0]).toMatchObject({
      pinHash: "hash-1",
      localPinVerifier,
      localVerifierVersion: 1,
    });
  });

  it("rejects credential creation when the username is already taken", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_2",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
        {
          _id: "staff_profile_2",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Mansa Osei",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "front_desk",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
        {
          _id: "role_2",
          staffProfileId: "staff_profile_2",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 2,
        },
      ],
    });

    await expect(
      createStaffCredentialWithCtx(ctx, {
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        organizationId: "org_1" as Id<"organization">,
        storeId: "store_1" as Id<"store">,
        username: " FrontDesk ",
        pinHash: "hash-2",
      })
    ).rejects.toThrow("Username is already in use for this store.");
  });

  it("rejects credential creation when the staff profile already has a credential", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      createStaffCredentialWithCtx(ctx, {
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        organizationId: "org_1" as Id<"organization">,
        storeId: "store_1" as Id<"store">,
        username: "desk-2",
        pinHash: "hash-2",
      })
    ).rejects.toThrow("Staff credential already exists for this staff profile.");
  });

  it("rotates the username and PIN hash or suspends the credential", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    const rotated = await updateStaffCredentialWithCtx(ctx, {
      staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      organizationId: "org_1" as Id<"organization">,
      storeId: "store_1" as Id<"store">,
      username: "desk-2",
      pinHash: "hash-2",
      localPinVerifier,
    });

    expect(rotated).toMatchObject({
      username: "desk-2",
      status: "active",
    });
    expect(rotated).not.toHaveProperty("pinHash");
    expect(rotated).not.toHaveProperty("localPinVerifier");
    expect(rotated).not.toHaveProperty("localVerifierVersion");
    expect(tables.staffCredential.get("credential-1")).toMatchObject({
      username: "desk-2",
      pinHash: "hash-2",
      localPinVerifier,
      localVerifierVersion: 1,
      status: "active",
    });

    const suspended = await updateStaffCredentialWithCtx(ctx, {
      staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      organizationId: "org_1" as Id<"organization">,
      storeId: "store_1" as Id<"store">,
      status: "suspended",
    });

    expect(suspended).toMatchObject({
      status: "suspended",
    });
    expect(tables.staffCredential.get("credential-1")?.status).toBe("suspended");
  });

  it("increments the local verifier version when a credential PIN is reset", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          localPinVerifier,
          localVerifierVersion: 3,
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });
    const nextVerifier = { ...localPinVerifier, hash: "next-local-hash" };

    await expect(
      updateStaffCredentialWithCtx(ctx, {
        organizationId: "org_1" as Id<"organization">,
        pinHash: "hash-2",
        localPinVerifier: nextVerifier,
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      status: "active",
    });
    expect(tables.staffCredential.get("credential-1")).toMatchObject({
      localPinVerifier: nextVerifier,
      localVerifierVersion: 4,
      pinHash: "hash-2",
    });
  });

  it("clears stale local verifier metadata when a PIN reset omits a verifier", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          localPinVerifier,
          localVerifierVersion: 3,
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      updateStaffCredentialWithCtx(ctx, {
        organizationId: "org_1" as Id<"organization">,
        pinHash: "hash-2",
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      status: "active",
    });
    expect(tables.staffCredential.get("credential-1")).toMatchObject({
      localPinVerifier: undefined,
      localVerifierVersion: 4,
      pinHash: "hash-2",
    });
  });

  it("authenticates only active credentials with active profiles and allowed roles", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
        {
          _id: "role_2",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: false,
          status: "inactive",
          assignedAt: 2,
        },
      ],
    });

    const result = await authenticateStaffCredentialWithCtx(ctx, {
      allowedRoles: ["cashier", "manager"],
      storeId: "store_1" as Id<"store">,
      username: " FrontDesk ",
      pinHash: "hash-1",
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        credentialId: "credential-1",
        staffProfileId: "staff_profile_1",
        staffProfile: {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
        activeRoles: ["cashier"],
      },
    });
    expect(tables.staffCredential.get("credential-1")?.lastAuthenticatedAt).toEqual(
      expect.any(Number)
    );
  });

  it("locks staff authentication after repeated failed PIN attempts and resets on PIN reset", async () => {
    const beforeAttempts = Date.now();
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        authenticateStaffCredentialWithCtx(ctx, {
          allowedRoles: ["cashier"],
          storeId: "store_1" as Id<"store">,
          username: "frontdesk",
          pinHash: `wrong-${attempt}`,
        }),
      ).resolves.toEqual({
        kind: "user_error",
        error: {
          code: "authentication_failed",
          message: "Invalid staff credentials.",
        },
      });
    }

    expect(tables.staffCredential.get("credential-1")).toMatchObject({
      failedAuthenticationAttempts: 5,
    });
    expect(
      tables.staffCredential.get("credential-1")?.authenticationLockedUntil,
    ).toBeGreaterThan(beforeAttempts);

    await expect(
      authenticateStaffCredentialWithCtx(ctx, {
        allowedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
        pinHash: "hash-1",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "rate_limited",
        message: "Too many failed staff PIN attempts. Try again later.",
      },
    });

    await expect(
      updateStaffCredentialWithCtx(ctx, {
        organizationId: "org_1" as Id<"organization">,
        pinHash: "hash-2",
        localPinVerifier,
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      status: "active",
    });

    expect(tables.staffCredential.get("credential-1")).toMatchObject({
      authenticationLockedUntil: undefined,
      failedAuthenticationAttempts: 0,
      pinHash: "hash-2",
    });
  });

  it("resets failed staff authentication attempts after a successful login", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          authenticationLockedUntil: 1,
          failedAuthenticationAttempts: 4,
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialWithCtx(ctx, {
        allowedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
        pinHash: "hash-1",
      }),
    ).resolves.toMatchObject({
      kind: "ok",
    });

    expect(tables.staffCredential.get("credential-1")).toMatchObject({
      authenticationLockedUntil: undefined,
      failedAuthenticationAttempts: 0,
      lastAuthenticatedAt: expect.any(Number),
    });
  });

  it("prevents approval proof minting while staff authentication is locked", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          authenticationLockedUntil: Date.now() + 300_000,
          failedAuthenticationAttempts: 5,
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "manager",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "manager",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialForApprovalWithCtx(ctx, {
        actionKey: "operations.approval_request.decide",
        pinHash: "hash-1",
        requiredRole: "manager",
        storeId: "store_1" as Id<"store">,
        subject: {
          id: "approval-1",
          type: "approval_request",
        },
        username: "manager",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "rate_limited",
        message: "Too many failed staff PIN attempts. Try again later.",
      },
    });
  });

  it("mints and persists a scoped local staff proof after terminal authentication", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    const result = await authenticateStaffCredentialForTerminalWithCtx(ctx, {
      allowedRoles: ["cashier"],
      pinHash: "hash-1",
      storeId: "store_1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      username: "frontdesk",
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        posLocalStaffProof: {
          expiresAt: expect.any(Number),
          token: expect.any(String),
        },
        staffProfileId: "staff_profile_1",
      }),
    });
    if (result.kind !== "ok") throw new Error("Expected ok result");

    const proofRows = Array.from(tables.posLocalStaffProof.values());
    expect(proofRows).toEqual([
      expect.objectContaining({
        credentialId: "credential-1",
        expiresAt: result.data.posLocalStaffProof?.expiresAt,
        staffProfileId: "staff_profile_1",
        status: "active",
        storeId: "store_1",
        terminalId: "terminal-1",
        tokenHash: expect.any(String),
      }),
    ]);
    expect(proofRows[0]?.tokenHash).not.toBe(
      result.data.posLocalStaffProof?.token,
    );
    expect(result.data.posLocalStaffProof).toBeDefined();
    if (!result.data.posLocalStaffProof) {
      throw new Error("Expected local staff proof");
    }
    await expect(
      hashPosLocalStaffProofToken(result.data.posLocalStaffProof.token),
    ).resolves.toBe(proofRows[0]?.tokenHash);
  });

  it("rejects public terminal authentication when the signed-in user does not own the terminal", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      posTerminals: [
        {
          _id: "terminal-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          registeredByUserId: "athena-user-2",
        },
      ],
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      getHandler(authenticateStaffCredentialForTerminal)(ctx, {
        allowedRoles: ["cashier"],
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        username: "frontdesk",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "This terminal is not available for staff authentication.",
      },
    });
  });

  it("requires the terminal owner to have POS access before public terminal authentication", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });
    authMocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("No POS access"),
    );

    await expect(
      getHandler(authenticateStaffCredentialForTerminal)(ctx, {
        allowedRoles: ["cashier"],
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        username: "frontdesk",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "This terminal is not available for staff authentication.",
      },
    });
    expect(authMocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You do not have access to this POS terminal.",
        organizationId: "org_1",
        userId: "athena-user-1",
      },
    );
  });

  it("checks the terminal owner's POS access before minting a public local staff proof", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      getHandler(authenticateStaffCredentialForTerminal)(ctx, {
        allowedRoles: ["cashier"],
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        username: "frontdesk",
      }),
    ).resolves.toEqual({
      kind: "ok",
      data: expect.objectContaining({
        posLocalStaffProof: {
          expiresAt: expect.any(Number),
          token: expect.any(String),
        },
        staffProfileId: "staff_profile_1",
      }),
    });
    expect(authMocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You do not have access to this POS terminal.",
        organizationId: "org_1",
        userId: "athena-user-1",
      },
    );
  });

  it("refreshes terminal-scoped local staff authority without exposing legacy credentials", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          localPinVerifier,
          localVerifierVersion: 2,
          status: "active",
        },
        {
          _id: "credential-2",
          staffProfileId: "staff_profile_2",
          organizationId: "org_1",
          storeId: "store_1",
          username: "legacy",
          pinHash: "hash-2",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          firstName: "Ari",
          fullName: "Ari Mensah",
          lastName: "Mensah",
        },
        {
          _id: "staff_profile_2",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Legacy Staff",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
        {
          _id: "role_2",
          staffProfileId: "staff_profile_2",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      getHandler(refreshTerminalStaffAuthority)(ctx, {
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toEqual({
      kind: "ok",
      data: [
        expect.objectContaining({
          activeRoles: ["cashier"],
          credentialId: "credential-1",
          credentialVersion: 2,
          displayName: "Ari Mensah",
          staffProfileId: "staff_profile_1",
          username: "frontdesk",
          verifier: localPinVerifier,
        }),
      ],
    });
    expect(tables.posLocalStaffProof.size).toBe(0);
  });

  it("fails staff authority refresh instead of returning a truncated snapshot", async () => {
    const credentials = Array.from({ length: 1001 }, (_, index) => ({
      _id: `credential-${index}`,
      staffProfileId: `staff_profile_${index}`,
      organizationId: "org_1",
      storeId: "store_1",
      username: `staff${index}`,
      pinHash: `hash-${index}`,
      localPinVerifier,
      localVerifierVersion: 1,
      status: "active",
    }));
    const profiles = credentials.map((credential, index) => ({
      _id: credential.staffProfileId,
      storeId: "store_1",
      organizationId: "org_1",
      status: "active",
      fullName: `Staff ${index}`,
    }));
    const roles = credentials.map((credential, index) => ({
      _id: `role_${index}`,
      staffProfileId: credential.staffProfileId,
      organizationId: "org_1",
      storeId: "store_1",
      role: "cashier",
      isPrimary: true,
      status: "active",
      assignedAt: 1,
    }));
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials,
      profiles,
      roles,
    });

    await expect(
      getHandler(refreshTerminalStaffAuthority)(ctx, {
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Staff sign-in list is too large to refresh safely. Contact support before using offline sign-in.",
      },
    });
    expect(tables.posLocalStaffProof.size).toBe(0);
  });

  it("returns a precondition_failed result when the staff member is active on another terminal", async () => {
    const now = Date.now();
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
      posSessions: [
        {
          _id: "session-1",
          staffProfileId: "staff_profile_1",
          terminalId: "terminal-2" as Id<"posTerminal">,
          status: "active",
          expiresAt: now + 60_000,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialForTerminalWithCtx(ctx, {
        allowedRoles: ["cashier"],
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        username: "frontdesk",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "This staff member has an active session on another terminal.",
      },
    });

    await expect(
      getHandler(authenticateStaffCredentialForTerminal)(ctx, {
        allowedRoles: ["cashier"],
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        username: "frontdesk",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "This staff member has an active session on another terminal.",
      },
    });

    await expect(
      authenticateStaffCredentialForTerminalWithCtx(ctx, {
        allowedRoles: ["cashier"],
        allowActiveSessionsOnOtherTerminals: true,
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        username: "frontdesk",
      })
    ).resolves.toEqual({
      kind: "ok",
      data: expect.objectContaining({
        staffProfileId: "staff_profile_1",
        activeRoles: ["cashier"],
      }),
    });

    await expect(
      authenticateStaffCredentialForTerminalWithCtx(ctx, {
        allowedRoles: ["cashier"],
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-2" as Id<"posTerminal">,
        username: "frontdesk",
      })
    ).resolves.toEqual({
      kind: "ok",
      data: expect.objectContaining({
        staffProfileId: "staff_profile_1",
        activeRoles: ["cashier"],
      }),
    });
  });

  it("returns a precondition_failed result when the staff member has an active expense session on another terminal", async () => {
    const now = Date.now();
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
      expenseSessions: [
        {
          _id: "expense-session-1",
          staffProfileId: "staff_profile_1",
          terminalId: "terminal-2" as Id<"posTerminal">,
          status: "active",
          expiresAt: now + 60_000,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialForTerminalWithCtx(ctx, {
        allowedRoles: ["cashier"],
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        username: "frontdesk",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "This staff member has an active session on another terminal.",
      },
    });
  });

  it("returns an authorization_failed result when the staff profile is inactive", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "inactive",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "front_desk",
          isPrimary: true,
          status: "inactive",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialWithCtx(ctx, {
        allowedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
        pinHash: "hash-1",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Staff profile is not active.",
      },
    });
  });

  it("returns an authorization_failed result when none of the active roles are allowed", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "front_desk",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialWithCtx(ctx, {
        allowedRoles: ["cashier", "manager"],
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
        pinHash: "hash-1",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Staff profile is not authorized for this subsystem.",
      },
    });
  });

  it("creates an approval proof after fresh manager credential authentication", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "manager-1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "manager",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "manager-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "manager-1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "manager",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    const result = await authenticateStaffCredentialForApprovalWithCtx(ctx, {
      actionKey: "pos.transaction.payment_method.correct",
      pinHash: "hash-1",
      reason: "Completed transactions require manager approval.",
      requiredRole: "manager",
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      storeId: "store_1" as Id<"store">,
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
        label: "Receipt 1001",
      },
      username: "manager",
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        approvalProofId: "approvalProof-1",
        approvedByStaffProfileId: "manager-1",
      }),
    });
    expect(tables.staffCredential.get("credential-1")?.lastAuthenticatedAt).toEqual(
      expect.any(Number)
    );
    expect(tables.approvalProof.get("approvalProof-1")).toMatchObject({
      actionKey: "pos.transaction.payment_method.correct",
      approvedByCredentialId: "credential-1",
      approvedByStaffProfileId: "manager-1",
      requiredRole: "manager",
      requestedByStaffProfileId: "cashier-1",
      storeId: "store_1",
      subjectId: "transaction-1",
      subjectType: "pos_transaction",
    });
  });

  it("does not create an approval proof for cashier-only credentials", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "cashier-1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "cashier",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "cashier-1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialForApprovalWithCtx(ctx, {
        actionKey: "pos.transaction.payment_method.correct",
        pinHash: "hash-1",
        reason: "Completed transactions require manager approval.",
        requiredRole: "manager",
        storeId: "store_1" as Id<"store">,
        subject: {
          type: "pos_transaction",
          id: "transaction-1",
        },
        username: "cashier",
      })
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Staff profile is not authorized for this subsystem.",
      },
    });
    expect(tables.approvalProof.size).toBe(0);
  });

  it("still throws when multiple active credentials match the same username", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
        {
          _id: "credential-2",
          staffProfileId: "staff_profile_2",
          organizationId: "org_1",
          storeId: "store_1",
          username: "frontdesk",
          pinHash: "hash-1",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "staff_profile_1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Ari Mensah",
        },
        {
          _id: "staff_profile_2",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Mansa Osei",
        },
      ],
      roles: [
        {
          _id: "role_1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 1,
        },
        {
          _id: "role_2",
          staffProfileId: "staff_profile_2",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: true,
          status: "active",
          assignedAt: 2,
        },
      ],
    });

    await expect(
      authenticateStaffCredentialWithCtx(ctx, {
        allowedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "frontdesk",
        pinHash: "hash-1",
      })
    ).rejects.toThrow("Multiple staff credentials match this username.");
  });
});
