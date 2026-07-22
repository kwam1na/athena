import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared-demo denial preserves credential command result envelopes.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

const authMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));
const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireSharedDemoCapabilityIfApplicable: vi.fn(),
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
  requireSharedDemoStoreReadIfApplicable: vi.fn(),
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    authMocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    authMocks.requireOrganizationMemberRoleWithCtx,
}));
vi.mock("../sharedDemo/actor", () => ({
  getSharedDemoActorWithCtx: sharedDemoMocks.getSharedDemoActorWithCtx,
  requireSharedDemoCapabilityIfApplicable:
    sharedDemoMocks.requireSharedDemoCapabilityIfApplicable,
  requireSharedDemoStoreCapabilityIfApplicable:
    sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable,
  requireSharedDemoStoreReadIfApplicable:
    sharedDemoMocks.requireSharedDemoStoreReadIfApplicable,
}));

vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx:
    sharedDemoMocks.requireReadySharedDemoWriteWithCtx,
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
  validateRestoredPosLocalStaffProof,
  validateRestoredPosLocalStaffProofWithCtx,
} from "./staffCredentials";
import { createApprovalRequesterChallengeWithCtx } from "./approvalRequesterChallenges";
import { hashPosLocalStaffProofToken } from "../pos/application/sync/staffProof";

type TableName =
  | "approvalProof"
  | "approvalRequesterChallenge"
  | "athenaUser"
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
  approvalRequesterChallenges?: Row[];
  athenaUsers?: Row[];
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
    approvalRequesterChallenge: new Map(
      (seed?.approvalRequesterChallenges ?? []).map((row) => [row._id, row])
    ),
    athenaUser: new Map(
      (seed?.athenaUsers ?? []).map((row) => [row._id, row])
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
    approvalRequesterChallenge: 0,
    athenaUser: 0,
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
      unique: async () => {
        if (matches.length > 1) {
          throw new Error(`Expected unique ${table} query result`);
        }
        return matches[0] ?? null;
      },
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

async function createRestoredProofValidationCtx(overrides: {
  credential?: Partial<Row> | null;
  proof?: Partial<Row> | null;
  profile?: Partial<Row> | null;
  role?: Partial<Row> | null;
  token?: string;
} = {}) {
  const token = overrides.token ?? "proof-token-1";
  const tokenHash = await hashPosLocalStaffProofToken(token);

  return createStaffCredentialsMutationCtx({
    posLocalStaffProofs:
      overrides.proof === null
        ? []
        : [
            {
              _id: "proof-1",
              credentialId: "credential-1",
              credentialVersion: 2,
              createdAt: 50,
              expiresAt: 200,
              staffProfileId: "staff_profile_1",
              status: "active",
              storeId: "store_1",
              terminalId: "terminal-1",
              tokenHash,
              ...overrides.proof,
            },
          ],
    credentials:
      overrides.credential === null
        ? []
        : [
            {
              _id: "credential-1",
              staffProfileId: "staff_profile_1",
              organizationId: "org_1",
              storeId: "store_1",
              username: "frontdesk",
              pinHash: "hash-1",
              localVerifierVersion: 2,
              status: "active",
              ...overrides.credential,
            },
          ],
    profiles:
      overrides.profile === null
        ? []
        : [
            {
              _id: "staff_profile_1",
              storeId: "store_1",
              organizationId: "org_1",
              status: "active",
              fullName: "Ari Mensah",
              ...overrides.profile,
            },
          ],
    roles:
      overrides.role === null
        ? []
        : [
            {
              _id: "role_1",
              staffProfileId: "staff_profile_1",
              organizationId: "org_1",
              storeId: "store_1",
              role: "cashier",
              isPrimary: true,
              status: "active",
              assignedAt: 1,
              ...overrides.role,
            },
          ],
  });
}

describe("staff credential operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    sharedDemoMocks.requireReadySharedDemoWriteWithCtx.mockResolvedValue(
      undefined
    );
    sharedDemoMocks.requireSharedDemoCapabilityIfApplicable.mockResolvedValue(
      null
    );
    sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable.mockResolvedValue(
      null
    );
    sharedDemoMocks.requireSharedDemoStoreReadIfApplicable.mockResolvedValue(
      null
    );
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    authMocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
  });

  it("validates public staff credential mutation return contracts", () => {
    const credential = {
      _id: "credential-1" as Id<"staffCredential">,
      staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      organizationId: "org_1" as Id<"organization">,
      storeId: "store_1" as Id<"store">,
      username: "frontdesk",
      status: "active",
    };

    assertConformsToExportedReturns(createStaffCredential, {
      kind: "ok",
      data: credential,
    });
    assertConformsToExportedReturns(updateStaffCredential, {
      kind: "ok",
      data: credential,
    });
    assertConformsToExportedReturns(refreshTerminalStaffAuthority, {
      kind: "ok",
      data: [
        {
          activeRoles: ["cashier"],
          credentialId: "credential-1" as Id<"staffCredential">,
          credentialVersion: 1,
          displayName: "Ari Mensah",
          expiresAt: 200,
          issuedAt: 100,
          organizationId: "org_1" as Id<"organization">,
          refreshedAt: 100,
          staffProfileId: "staff_profile_1" as Id<"staffProfile">,
          status: "active",
          storeId: "store_1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
          username: "frontdesk",
          verifier: localPinVerifier,
        },
      ],
    });
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

  it("authenticates seeded operational staff through the shared demo store boundary", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      athenaUsers: [{ _id: "demo-user" }],
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "manager-1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "kofi",
          pinHash: "hash-1111",
          status: "active",
        },
      ],
      profiles: [
        {
          _id: "manager-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Kofi Mensah",
        },
      ],
      roles: [
        {
          _id: "role-1",
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
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user",
      kind: "shared_demo",
      organizationId: "org_1",
      storeId: "store_1",
    });
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("Sign in again to continue."),
    );

    await expect(
      getHandler(authenticateStaffCredential)(ctx, {
        allowedRoles: ["manager"],
        storeId: "store_1" as Id<"store">,
        username: "kofi",
        pinHash: "hash-1111",
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        staffProfileId: "manager-1",
      },
    });
    expect(sharedDemoMocks.requireSharedDemoStoreReadIfApplicable).not.toHaveBeenCalled();
    expect(
      authMocks.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
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
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          linkedUserId: "athena-user-1",
          status: "active",
          fullName: "Cashier One",
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

  it("allows public terminal authentication when the signed-in POS user did not register the terminal", async () => {
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
      kind: "ok",
      data: expect.objectContaining({
        staffProfileId: "staff_profile_1",
      }),
    });
  });

  it("authenticates demo managers through the terminal's store-scoped read boundary", async () => {
    sharedDemoMocks.requireSharedDemoStoreReadIfApplicable.mockResolvedValue({
      athenaUserId: "athena-user-1",
      storeId: "store_1",
    });
    const { ctx } = createStaffCredentialsMutationCtx({
      athenaUsers: [{ _id: "athena-user-1" }],
      credentials: [
        {
          _id: "credential-1",
          staffProfileId: "staff_profile_1",
          organizationId: "org_1",
          storeId: "store_1",
          username: "kofi",
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
          fullName: "Kofi Mensah",
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
      getHandler(authenticateStaffCredentialForTerminal)(ctx, {
        allowedRoles: ["manager"],
        pinHash: "hash-1",
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        username: "kofi",
      }),
    ).resolves.toEqual({
      kind: "ok",
      data: expect.objectContaining({
        activeRoles: ["manager"],
        staffProfileId: "staff_profile_1",
      }),
    });
    expect(
      sharedDemoMocks.requireSharedDemoStoreReadIfApplicable,
    ).toHaveBeenCalledWith(ctx, "store_1");
    expect(authMocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
  });

  it("requires the signed-in user to have POS access before public terminal authentication", async () => {
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

  it("checks the signed-in user's POS access before minting a public local staff proof", async () => {
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

  it("validates a restored POS local staff proof without minting a renewed proof", async () => {
    const tokenHash = await hashPosLocalStaffProofToken("proof-token-1");
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      posLocalStaffProofs: [
        {
          _id: "proof-1",
          credentialId: "credential-1",
          credentialVersion: 2,
          createdAt: 50,
          expiresAt: 200,
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal-1",
          tokenHash,
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
          localVerifierVersion: 2,
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
      validateRestoredPosLocalStaffProofWithCtx(ctx, {
        allowedRoles: ["cashier"],
        now: 100,
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        token: "proof-token-1",
      }),
    ).resolves.toEqual({
      kind: "ok",
      data: expect.objectContaining({
        activeRoles: ["cashier"],
        credentialId: "credential-1",
        credentialVersion: 2,
        posLocalStaffProof: {
          expiresAt: 200,
          token: "proof-token-1",
        },
        staffProfileId: "staff_profile_1",
      }),
    });
    expect(tables.posLocalStaffProof.size).toBe(1);
    expect(tables.posLocalStaffProof.get("proof-1")).toEqual(
      expect.objectContaining({ lastUsedAt: 100 }),
    );
  });

  it("returns explicit restored POS local staff proof failure reasons", async () => {
    const tokenHash = await hashPosLocalStaffProofToken("proof-token-1");
    const { ctx } = createStaffCredentialsMutationCtx({
      posLocalStaffProofs: [
        {
          _id: "proof-1",
          credentialId: "credential-1",
          credentialVersion: 2,
          createdAt: 50,
          expiresAt: 200,
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal-1",
          tokenHash,
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
      validateRestoredPosLocalStaffProofWithCtx(ctx, {
        allowedRoles: ["cashier"],
        now: 100,
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        token: "proof-token-1",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Stored staff proof is no longer valid. Sign in again.",
        metadata: {
          reason: "credential_version_mismatch",
        },
      },
    });
  });

  it("returns proof and credential failure reasons without touching proof usage", async () => {
    const cases: Array<{
      name: string;
      overrides: Parameters<typeof createRestoredProofValidationCtx>[0];
      reason: string;
      token?: string;
    }> = [
      {
        name: "missing proof",
        overrides: { proof: null },
        reason: "proof_not_found",
      },
      {
        name: "inactive proof",
        overrides: { proof: { status: "revoked" } },
        reason: "proof_inactive",
      },
      {
        name: "wrong proof terminal",
        overrides: { proof: { terminalId: "terminal-2" } },
        reason: "proof_scope_mismatch",
      },
      {
        name: "expired proof",
        overrides: { proof: { expiresAt: 99 } },
        reason: "proof_expired",
      },
      {
        name: "missing credential",
        overrides: { credential: null },
        reason: "credential_not_found",
      },
      {
        name: "inactive credential",
        overrides: { credential: { status: "suspended" } },
        reason: "credential_inactive",
      },
      {
        name: "wrong credential store",
        overrides: { credential: { storeId: "store_2" } },
        reason: "credential_scope_mismatch",
      },
    ];

    for (const testCase of cases) {
      const { ctx, tables } = await createRestoredProofValidationCtx(
        testCase.overrides,
      );

      await expect(
        validateRestoredPosLocalStaffProofWithCtx(ctx, {
          allowedRoles: ["cashier"],
          now: 100,
          staffProfileId: "staff_profile_1" as Id<"staffProfile">,
          storeId: "store_1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
          token: testCase.token ?? "proof-token-1",
        }),
      ).resolves.toEqual({
        kind: "user_error",
        error: {
          code: "precondition_failed",
          message: "Stored staff proof is no longer valid. Sign in again.",
          metadata: {
            reason: testCase.reason,
          },
        },
      });

      expect(
        tables.posLocalStaffProof.get("proof-1")?.lastUsedAt,
        testCase.name,
      ).toBeUndefined();
    }
  });

  it("fails closed when restored proof token hash matches multiple rows", async () => {
    const tokenHash = await hashPosLocalStaffProofToken("proof-token-1");
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      posLocalStaffProofs: [
        {
          _id: "proof-1",
          credentialId: "credential-1",
          credentialVersion: 2,
          createdAt: 50,
          expiresAt: 200,
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal-1",
          tokenHash,
        },
        {
          _id: "proof-2",
          credentialId: "credential-1",
          credentialVersion: 2,
          createdAt: 60,
          expiresAt: 200,
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal-1",
          tokenHash,
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
          localVerifierVersion: 2,
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
      validateRestoredPosLocalStaffProofWithCtx(ctx, {
        allowedRoles: ["cashier"],
        now: 100,
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        token: "proof-token-1",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Stored staff proof is no longer valid. Sign in again.",
        metadata: {
          reason: "proof_not_found",
        },
      },
    });

    expect(tables.posLocalStaffProof.get("proof-1")?.lastUsedAt).toBeUndefined();
    expect(tables.posLocalStaffProof.get("proof-2")?.lastUsedAt).toBeUndefined();
  });

  it("returns staff profile failure reasons without touching proof usage", async () => {
    const cases: Array<{
      name: string;
      overrides: Parameters<typeof createRestoredProofValidationCtx>[0];
      reason: string;
      allowedRoles?: Array<"cashier" | "manager">;
    }> = [
      {
        name: "missing staff profile",
        overrides: { profile: null },
        reason: "staff_profile_not_found",
      },
      {
        name: "wrong staff profile store",
        overrides: { profile: { storeId: "store_2" } },
        reason: "staff_profile_scope_mismatch",
      },
      {
        name: "inactive staff profile",
        overrides: { profile: { status: "inactive" } },
        reason: "staff_profile_inactive",
      },
      {
        name: "no active roles",
        overrides: { role: null },
        reason: "staff_profile_no_active_roles",
      },
      {
        name: "role not allowed",
        overrides: {},
        allowedRoles: ["manager"],
        reason: "staff_profile_role_not_allowed",
      },
    ];

    for (const testCase of cases) {
      const { ctx, tables } = await createRestoredProofValidationCtx(
        testCase.overrides,
      );

      await expect(
        validateRestoredPosLocalStaffProofWithCtx(ctx, {
          allowedRoles: testCase.allowedRoles ?? ["cashier"],
          now: 100,
          staffProfileId: "staff_profile_1" as Id<"staffProfile">,
          storeId: "store_1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
          token: "proof-token-1",
        }),
      ).resolves.toEqual({
        kind: "user_error",
        error: {
          code: "precondition_failed",
          message: "Stored staff proof is no longer valid. Sign in again.",
          metadata: {
            reason: testCase.reason,
          },
        },
      });

      expect(
        tables.posLocalStaffProof.get("proof-1")?.lastUsedAt,
        testCase.name,
      ).toBeUndefined();
    }
  });

  it("requires POS terminal access before public restored proof validation", async () => {
    const { ctx } = createStaffCredentialsMutationCtx();
    authMocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("No POS access"),
    );

    await expect(
      getHandler(validateRestoredPosLocalStaffProof)(ctx, {
        allowedRoles: ["cashier"],
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
        storeId: "store_1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        token: "proof-token-1",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "This terminal is not available for staff authentication.",
      },
    });
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
        activeRoles: ["cashier"],
        posLocalStaffProof: {
          expiresAt: expect.any(Number),
          token: expect.any(String),
        },
        staffProfileId: "staff_profile_1",
      }),
    });
    expect(tables.posLocalStaffProof.size).toBe(1);

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
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          linkedUserId: "athena-user-1",
          status: "active",
          fullName: "Cashier One",
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
    assertConformsToExportedReturns(authenticateStaffCredentialForApproval, result);
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

  it("creates an approval proof for an unlinked operational requester through a server challenge", async () => {
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
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Cashier One",
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

    const subject = {
      type: "pos_transaction",
      id: "transaction-1",
      label: "Receipt 1001",
    };
    const challenge = await createApprovalRequesterChallengeWithCtx(ctx, {
      actionKey: "pos.transaction.payment_method.correct",
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      requiredRole: "manager",
      storeId: "store_1" as Id<"store">,
      subject,
    });

    expect(challenge).toEqual({
      kind: "ok",
      data: {
        requesterBinding: {
          kind: "operational_staff_challenge",
          challengeId: "approvalRequesterChallenge-1",
          requestedByStaffProfileId: "cashier-1",
        },
      },
    });

    if (challenge.kind !== "ok") {
      throw new Error("Expected requester challenge to be created.");
    }

    const result = await authenticateStaffCredentialForApprovalWithCtx(ctx, {
      actionKey: "pos.transaction.payment_method.correct",
      pinHash: "hash-1",
      reason: "Completed transactions require manager approval.",
      requiredRole: "manager",
      requesterBinding: challenge.data.requesterBinding as {
        challengeId: Id<"approvalRequesterChallenge">;
        kind: "operational_staff_challenge";
        requestedByStaffProfileId: Id<"staffProfile">;
      },
      storeId: "store_1" as Id<"store">,
      subject,
      username: "manager",
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        approvalProofId: "approvalProof-1",
        approvedByStaffProfileId: "manager-1",
        requestedByStaffProfileId: "cashier-1",
      }),
    });
    assertConformsToExportedReturns(authenticateStaffCredentialForApproval, result);
    expect(tables.approvalRequesterChallenge.get("approvalRequesterChallenge-1"))
      .toMatchObject({
        actionKey: "pos.transaction.payment_method.correct",
        consumedAt: expect.any(Number),
        requestedByStaffProfileId: "cashier-1",
        storeId: "store_1",
        subjectId: "transaction-1",
        subjectType: "pos_transaction",
      });
    expect(tables.approvalProof.get("approvalProof-1")).toMatchObject({
      actionKey: "pos.transaction.payment_method.correct",
      approvedByStaffProfileId: "manager-1",
      requestedByStaffProfileId: "cashier-1",
      storeId: "store_1",
      subjectId: "transaction-1",
      subjectType: "pos_transaction",
    });
  });

  it.each([
    {
      name: "missing requester profile",
      profiles: [],
    },
    {
      name: "inactive requester profile",
      profiles: [
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "inactive",
          fullName: "Cashier One",
        },
      ],
    },
    {
      name: "wrong-store requester profile",
      profiles: [
        {
          _id: "cashier-1",
          storeId: "store_2",
          organizationId: "org_1",
          status: "active",
          fullName: "Cashier One",
        },
      ],
    },
  ])("rejects requester challenge creation for $name", async (scenario) => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      profiles: scenario.profiles,
    });

    const result = await createApprovalRequesterChallengeWithCtx(ctx, {
      actionKey: "pos.transaction.payment_method.correct",
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      requiredRole: "manager",
      storeId: "store_1" as Id<"store">,
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
      },
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Requested staff profile is not valid for this approval.",
      },
    });
    expect(tables.approvalRequesterChallenge.size).toBe(0);
  });

  it.each([
    {
      name: "missing requester profile",
      requesterProfile: null,
    },
    {
      name: "inactive requester profile",
      requesterProfile: {
        _id: "cashier-1",
        storeId: "store_1",
        organizationId: "org_1",
        status: "inactive",
        fullName: "Cashier One",
      },
    },
    {
      name: "wrong-store requester profile",
      requesterProfile: {
        _id: "cashier-1",
        storeId: "store_2",
        organizationId: "org_1",
        status: "active",
        fullName: "Cashier One",
      },
    },
  ])("rejects requester challenge consumption for $name", async (scenario) => {
    const requesterProfiles =
      scenario.requesterProfile === null ? [] : [scenario.requesterProfile];
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      approvalRequesterChallenges: [
        {
          _id: "challenge-1",
          actionKey: "pos.transaction.payment_method.correct",
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
          requestedByStaffProfileId: "cashier-1",
          requiredRole: "manager",
          storeId: "store_1",
          subjectId: "transaction-1",
          subjectType: "pos_transaction",
        },
      ],
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
        ...requesterProfiles,
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
      requiredRole: "manager",
      requesterBinding: {
        challengeId: "challenge-1" as Id<"approvalRequesterChallenge">,
        kind: "operational_staff_challenge",
        requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      },
      storeId: "store_1" as Id<"store">,
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
      },
      username: "manager",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Requested staff profile is not valid for this approval.",
      },
    });
    expect(tables.approvalRequesterChallenge.get("challenge-1")).not.toHaveProperty(
      "consumedAt",
    );
    expect(tables.approvalProof.size).toBe(0);
  });

  it("rejects approval proof requester attribution for unlinked staff profiles", async () => {
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
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Cashier One",
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
      },
      username: "manager",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Requested staff profile does not match the signed-in user.",
      },
    });
    expect(tables.approvalProof.size).toBe(0);
  });

  it("rejects replayed operational requester challenges", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      approvalRequesterChallenges: [
        {
          _id: "challenge-1",
          actionKey: "pos.transaction.payment_method.correct",
          consumedAt: 100,
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
          requestedByStaffProfileId: "cashier-1",
          requiredRole: "manager",
          storeId: "store_1",
          subjectId: "transaction-1",
          subjectType: "pos_transaction",
        },
      ],
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
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Cashier One",
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
      requiredRole: "manager",
      requesterBinding: {
        challengeId: "challenge-1" as Id<"approvalRequesterChallenge">,
        kind: "operational_staff_challenge",
        requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      },
      storeId: "store_1" as Id<"store">,
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
      },
      username: "manager",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Approval requester challenge has already been used.",
      },
    });
    expect(tables.approvalProof.size).toBe(0);
  });

  it("rejects mixed direct requester and operational requester binding evidence", async () => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      approvalRequesterChallenges: [
        {
          _id: "challenge-1",
          actionKey: "pos.transaction.payment_method.correct",
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
          requestedByStaffProfileId: "cashier-1",
          requiredRole: "manager",
          storeId: "store_1",
          subjectId: "transaction-1",
          subjectType: "pos_transaction",
        },
      ],
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
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          linkedUserId: "athena-user-1",
          status: "active",
          fullName: "Cashier One",
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
      requiredRole: "manager",
      requesterBinding: {
        challengeId: "challenge-1" as Id<"approvalRequesterChallenge">,
        kind: "operational_staff_challenge",
        requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      },
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      storeId: "store_1" as Id<"store">,
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
      },
      username: "manager",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "Approval requester must use either a direct staff profile or a requester binding.",
      },
    });
    const storedChallenge = tables.approvalRequesterChallenge.get("challenge-1");
    if (storedChallenge) {
      expect(storedChallenge).not.toHaveProperty("consumedAt");
    }
    expect(tables.approvalProof.size).toBe(0);
  });

  it.each([
    {
      name: "missing challenge",
      challenges: [],
      binding: {
        challengeId: "challenge-1" as Id<"approvalRequesterChallenge">,
        kind: "operational_staff_challenge" as const,
        requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      },
      message: "Approval requester challenge was not found.",
    },
    {
      name: "wrong requester",
      binding: {
        challengeId: "challenge-1" as Id<"approvalRequesterChallenge">,
        kind: "operational_staff_challenge" as const,
        requestedByStaffProfileId: "cashier-2" as Id<"staffProfile">,
      },
      message: "Approval requester challenge does not match this approval.",
    },
    {
      name: "wrong action",
      args: { actionKey: "pos.transaction.void" },
      message: "Approval requester challenge does not match this approval.",
    },
    {
      name: "wrong subject id",
      args: { subject: { type: "pos_transaction", id: "transaction-2" } },
      message: "Approval requester challenge does not match this approval.",
    },
    {
      name: "wrong subject type",
      args: { subject: { type: "register_session", id: "transaction-1" } },
      message: "Approval requester challenge does not match this approval.",
    },
    {
      name: "wrong store",
      challenge: { storeId: "store_2" as Id<"store"> },
      message: "Approval requester challenge does not match this approval.",
    },
    {
      name: "wrong required role",
      args: { requiredRole: "cashier" as const },
      message: "Approval requester challenge does not match this approval.",
    },
    {
      name: "expired challenge",
      challenge: { expiresAt: Date.now() - 1 },
      message: "Approval requester challenge has expired.",
    },
  ])("rejects forged operational requester binding evidence: $name", async (scenario) => {
    const { ctx, tables } = createStaffCredentialsMutationCtx({
      approvalRequesterChallenges:
        scenario.challenges ??
        [
          {
            _id: "challenge-1",
            actionKey: "pos.transaction.payment_method.correct",
            createdAt: 1,
            expiresAt: Date.now() + 60_000,
            requestedByStaffProfileId: "cashier-1",
            requiredRole: "manager",
            storeId: "store_1",
            subjectId: "transaction-1",
            subjectType: "pos_transaction",
            ...scenario.challenge,
          },
        ],
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
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Cashier One",
        },
        {
          _id: "cashier-2",
          storeId: "store_1",
          organizationId: "org_1",
          status: "active",
          fullName: "Cashier Two",
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
        {
          _id: "role_2",
          staffProfileId: "manager-1",
          organizationId: "org_1",
          storeId: "store_1",
          role: "cashier",
          isPrimary: false,
          status: "active",
          assignedAt: 1,
        },
      ],
    });

    const result = await authenticateStaffCredentialForApprovalWithCtx(ctx, {
      actionKey: "pos.transaction.payment_method.correct",
      pinHash: "hash-1",
      requiredRole: "manager",
      requesterBinding:
        scenario.binding ?? {
          challengeId: "challenge-1" as Id<"approvalRequesterChallenge">,
          kind: "operational_staff_challenge",
          requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
        },
      storeId: "store_1" as Id<"store">,
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
      },
      username: "manager",
      ...scenario.args,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: scenario.message,
      },
    });
    const storedChallenge = tables.approvalRequesterChallenge.get("challenge-1");
    if (storedChallenge) {
      expect(storedChallenge).not.toHaveProperty("consumedAt");
    }
    expect(tables.approvalProof.size).toBe(0);
  });

  it("rejects approval proof requester attribution for another linked Athena user", async () => {
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
        {
          _id: "cashier-1",
          storeId: "store_1",
          organizationId: "org_1",
          linkedUserId: "athena-user-2",
          status: "active",
          fullName: "Cashier One",
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
      },
      username: "manager",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Requested staff profile does not match the signed-in user.",
      },
    });
    expect(tables.approvalProof.size).toBe(0);
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
