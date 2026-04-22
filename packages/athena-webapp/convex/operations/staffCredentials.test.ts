import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  authenticateStaffCredentialWithCtx,
  createStaffCredentialWithCtx,
  getStaffCredentialUsernameAvailabilityWithCtx,
  updateStaffCredentialWithCtx,
} from "./staffCredentials";

type TableName = "staffCredential" | "staffProfile" | "staffRoleAssignment";
type Row = Record<string, unknown> & { _id: string };

function createStaffCredentialsMutationCtx(seed?: {
  credentials?: Row[];
  profiles?: Row[];
  roles?: Row[];
}) {
  const tables: Record<TableName, Map<string, Row>> = {
    staffCredential: new Map(
      (seed?.credentials ?? []).map((row) => [row._id, row])
    ),
    staffProfile: new Map((seed?.profiles ?? []).map((row) => [row._id, row])),
    staffRoleAssignment: new Map(
      (seed?.roles ?? []).map((row) => [row._id, row])
    ),
  };
  const insertCounters: Record<TableName, number> = {
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

describe("staff credential operations", () => {
  it("reports store-scoped username availability", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
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
    });

    expect(result).toMatchObject({
      staffProfileId: "staff_profile_1",
      organizationId: "org_1",
      storeId: "store_1",
      username: "frontdesk",
      pinHash: "hash-1",
      status: "active",
    });
    expect(result?.lastAuthenticatedAt).toBeUndefined();
    expect(tables.staffCredential.size).toBe(1);
  });

  it("rejects credential creation when the username is already taken", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
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
    });

    expect(rotated).toMatchObject({
      username: "desk-2",
      pinHash: "hash-2",
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

    expect(result).toMatchObject({
      credentialId: "credential-1",
      staffProfileId: "staff_profile_1",
      staffProfile: {
        _id: "staff_profile_1",
        status: "active",
      },
      activeRoles: ["cashier"],
    });
    expect(tables.staffCredential.get("credential-1")?.lastAuthenticatedAt).toEqual(
      expect.any(Number)
    );
  });

  it("rejects authentication when the staff profile or roles are inactive", async () => {
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
    ).rejects.toThrow("Staff profile is not active.");
  });

  it("rejects authentication when none of the active roles are allowed", async () => {
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
    ).rejects.toThrow("Staff profile is not authorized for this subsystem.");
  });
});
