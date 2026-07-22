import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

import type { Id } from "../_generated/dataModel";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { getAuthUserId } from "@convex-dev/auth/server";
import { deriveDefaultOperationalRoles } from "./helpers/linking";
import {
  buildRoleAssignmentDrafts,
  createStaffProfile,
  createStaffProfileWithCtx,
  getStaffProfileByIdWithCtx,
  listStaffProfiles,
  listStaffProfilesWithCtx,
  updateStaffProfile,
  updateStaffProfileWithCtx,
} from "./staffProfiles";

type TableName =
  | "athenaUser"
  | "organizationMember"
  | "sharedDemoPrincipal"
  | "staffCredential"
  | "staffProfile"
  | "staffRoleAssignment"
  | "store"
  | "users";
type Row = Record<string, unknown> & { _id: string };

function createStaffProfilesMutationCtx(seed?: {
  athenaUsers?: Row[];
  credentials?: Row[];
  members?: Row[];
  profiles?: Row[];
  roles?: Row[];
  sharedDemoPrincipals?: Row[];
  stores?: Row[];
  users?: Row[];
}) {
  const tables: Record<TableName, Map<string, Row>> = {
    athenaUser: new Map((seed?.athenaUsers ?? []).map((row) => [row._id, row])),
    organizationMember: new Map(
      (seed?.members ?? []).map((row) => [row._id, row]),
    ),
    sharedDemoPrincipal: new Map(
      (seed?.sharedDemoPrincipals ?? []).map((row) => [row._id, row]),
    ),
    staffCredential: new Map(
      (seed?.credentials ?? []).map((row) => [row._id, row]),
    ),
    staffProfile: new Map((seed?.profiles ?? []).map((row) => [row._id, row])),
    staffRoleAssignment: new Map(
      (seed?.roles ?? []).map((row) => [row._id, row]),
    ),
    store: new Map((seed?.stores ?? []).map((row) => [row._id, row])),
    users: new Map((seed?.users ?? []).map((row) => [row._id, row])),
  };
  const insertCounters: Record<TableName, number> = {
    athenaUser: 0,
    organizationMember: 0,
    sharedDemoPrincipal: 0,
    staffCredential: 0,
    staffProfile: 0,
    staffRoleAssignment: 0,
    store: 0,
    users: 0,
  };

  function createIndexedQuery(
    table: TableName,
    filters: Array<[string, unknown]>,
  ) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );

    return {
      collect: async () => matches,
      first: async () => matches[0] ?? null,
      take: async (count: number) => matches.slice(0, count),
      unique: async () => {
        if (matches.length > 1) throw new Error("Expected a unique row");
        return matches[0] ?? null;
      },
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
      async patch(
        table: TableName,
        id: string,
        value: Record<string, unknown>,
      ) {
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
  } as const;

  return { ctx: ctx as never, tables };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("staff profile helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps public mutation command results inside their declared contracts", () => {
    assertConformsToExportedReturns(createStaffProfile, {
      kind: "user_error",
      error: { code: "conflict", message: "Username is already in use." },
    });
    assertConformsToExportedReturns(updateStaffProfile, {
      kind: "user_error",
      error: { code: "not_found", message: "Staff profile not found." },
    });
  });

  it("admits same-store shared-demo POS staff roster reads without normal auth fallback", async () => {
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
    vi.mocked(getAuthUserId).mockResolvedValue("auth-demo" as never);
    const { ctx } = createStaffProfilesMutationCtx({
      athenaUsers: [
        {
          _id: "demo-owner",
          email: "demo@example.com",
          normalizedEmail: "demo@example.com",
        },
      ],
      members: [
        {
          _id: "member-1",
          organizationId: "org-1",
          role: "pos_only",
          userId: "demo-owner",
        },
      ],
      profiles: [
        {
          _id: "staff-1",
          firstName: "Store",
          lastName: "Cashier",
          status: "active",
          storeId: "store-1",
        },
      ],
      sharedDemoPrincipals: [
        {
          _id: "principal-1",
          admissionExpiresAt: Date.now() + 60_000,
          athenaUserId: "demo-owner",
          authUserId: "auth-demo",
          organizationId: "org-1",
          storeId: "store-1",
        },
      ],
      stores: [
        {
          _id: "store-1",
          organizationId: "org-1",
        },
      ],
    });

    const rows = await getHandler(listStaffProfiles)(
      {
        auth: { getUserIdentity: vi.fn() },
        db: (ctx as unknown as { db: unknown }).db,
      } as never,
      { status: "active", storeId: "store-1" as Id<"store"> },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        _id: "staff-1",
        firstName: "Store",
        lastName: "Cashier",
      }),
    ]);
  });

  it("denies cross-store shared-demo POS staff roster reads before reading staff rows", async () => {
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
    vi.mocked(getAuthUserId).mockResolvedValue("auth-demo" as never);
    const { ctx } = createStaffProfilesMutationCtx({
      athenaUsers: [{ _id: "demo-owner" }],
      members: [
        {
          _id: "member-1",
          organizationId: "org-1",
          role: "pos_only",
          userId: "demo-owner",
        },
      ],
      profiles: [
        {
          _id: "staff-other",
          firstName: "Other",
          lastName: "Cashier",
          status: "active",
          storeId: "store-2",
        },
      ],
      sharedDemoPrincipals: [
        {
          _id: "principal-1",
          admissionExpiresAt: Date.now() + 60_000,
          athenaUserId: "demo-owner",
          authUserId: "auth-demo",
          organizationId: "org-1",
          storeId: "store-1",
        },
      ],
      stores: [
        {
          _id: "store-2",
          organizationId: "org-2",
        },
      ],
    });

    await expect(
      getHandler(listStaffProfiles)(
        {
          auth: { getUserIdentity: vi.fn() },
          db: (ctx as unknown as { db: unknown }).db,
        } as never,
        { status: "active", storeId: "store-2" as Id<"store"> },
      ),
    ).rejects.toThrow("This action isn't allowed in the demo.");
  });

  it("does not return same-store POS staff roster rows when store membership is denied", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const { ctx } = createStaffProfilesMutationCtx({
      athenaUsers: [
        {
          _id: "athena-user-1",
          email: "user@example.com",
          normalizedEmail: "user@example.com",
        },
      ],
      profiles: [
        {
          _id: "staff-1",
          firstName: "Store",
          lastName: "Cashier",
          status: "active",
          storeId: "store-1",
        },
      ],
      stores: [
        {
          _id: "store-1",
          organizationId: "org-1",
        },
      ],
      users: [
        {
          _id: "auth-user",
          email: "user@example.com",
        },
      ],
    });

    await expect(
      getHandler(listStaffProfiles)(
        {
          auth: { getUserIdentity: vi.fn() },
          db: (ctx as unknown as { db: unknown }).db,
        } as never,
        { status: "active", storeId: "store-1" as Id<"store"> },
      ),
    ).rejects.toThrow("You cannot view staff profiles for this store.");
  });

  it("derives manager defaults for full admins", () => {
    expect(deriveDefaultOperationalRoles("full_admin")).toEqual(["manager"]);
  });

  it("merges requested roles without duplicating defaults", () => {
    const assignments = buildRoleAssignmentDrafts({
      staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      storeId: "store_1" as Id<"store">,
      organizationId: "org_1" as Id<"organization">,
      memberRole: "pos_only",
      requestedRoles: ["cashier", "technician"],
    });

    expect(assignments.map((assignment) => assignment.role)).toEqual([
      "front_desk",
      "cashier",
      "technician",
    ]);
    expect(assignments[0]?.isPrimary).toBe(true);
  });

  it("creates a lightweight staff profile with normalized fields and active roles", async () => {
    const { ctx, tables } = createStaffProfilesMutationCtx();

    const result = await createStaffProfileWithCtx(ctx, {
      createdByUserId: "user_1" as Id<"athenaUser">,
      firstName: " Adjoa ",
      hiredAt: 1710000000000,
      jobTitle: " Senior Stylist ",
      lastName: " Tetteh ",
      organizationId: "org_1" as Id<"organization">,
      phoneNumber: " +233200000000 ",
      requestedRoles: ["stylist", "technician"],
      staffCode: " ST-17 ",
      storeId: "store_1" as Id<"store">,
      username: " adjoa ",
    });

    expect(result).toMatchObject({
      credentialStatus: "pending",
      createdByUserId: "user_1",
      firstName: "Adjoa",
      fullName: "Adjoa Tetteh",
      hiredAt: 1710000000000,
      jobTitle: "Senior Stylist",
      lastName: "Tetteh",
      phoneNumber: "+233200000000",
      primaryRole: "stylist",
      roles: ["stylist", "technician"],
      staffCode: "ST-17",
      status: "active",
      storeId: "store_1",
      username: "adjoa",
    });
    expect(tables.staffCredential.size).toBe(1);
    expect(tables.staffRoleAssignment.size).toBe(2);
  });

  it("rejects linked users that already belong to another staff profile in the store", async () => {
    const { ctx } = createStaffProfilesMutationCtx({
      profiles: [
        {
          _id: "staff_profile_existing",
          firstName: "Existing",
          fullName: "Existing Staff",
          lastName: "Staff",
          linkedUserId: "user_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      createStaffProfileWithCtx(ctx, {
        firstName: "Second",
        lastName: "Staff",
        linkedUserId: "user_1" as Id<"athenaUser">,
        organizationId: "org_1" as Id<"organization">,
        requestedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "second",
      }),
    ).rejects.toThrow(
      "A staff profile already links this Athena user in the store.",
    );
  });

  it("updates the staff profile fields and resynchronizes roles", async () => {
    const { ctx, tables } = createStaffProfilesMutationCtx({
      profiles: [
        {
          _id: "staff_profile_1",
          createdByUserId: "user_1",
          firstName: "Adjoa",
          fullName: "Adjoa Tetteh",
          lastName: "Tetteh",
          organizationId: "org_1",
          phoneNumber: "+233200000000",
          status: "active",
          storeId: "store_1",
          updatedByUserId: "user_1",
        },
      ],
      credentials: [
        {
          _id: "credential_1",
          organizationId: "org_1",
          staffProfileId: "staff_profile_1",
          status: "pending",
          storeId: "store_1",
          username: "adjoa",
        },
      ],
      roles: [
        {
          _id: "role_1",
          assignedAt: 1,
          isPrimary: true,
          organizationId: "org_1",
          role: "stylist",
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "role_2",
          assignedAt: 2,
          isPrimary: false,
          organizationId: "org_1",
          role: "technician",
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await updateStaffProfileWithCtx(ctx, {
      firstName: "Lead Adjoa",
      jobTitle: "Lead Stylist",
      organizationId: "org_1" as Id<"organization">,
      requestedRoles: ["manager", "stylist"],
      staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      storeId: "store_1" as Id<"store">,
      updatedByUserId: "user_2" as Id<"athenaUser">,
      username: "leadadjoa",
    });

    expect(result).toMatchObject({
      fullName: "Lead Adjoa Tetteh",
      jobTitle: "Lead Stylist",
      primaryRole: "manager",
      roles: ["stylist", "manager"],
      updatedByUserId: "user_2",
      username: "leadadjoa",
    });
    expect(tables.staffRoleAssignment.get("role_2")?.status).toBe("inactive");
    expect(tables.staffCredential.get("credential_1")?.username).toBe(
      "leadadjoa",
    );
    const managerRole = Array.from(tables.staffRoleAssignment.values()).find(
      (role) => role.role === "manager",
    );
    expect(managerRole).toMatchObject({
      isPrimary: true,
      status: "active",
    });
  });

  it("returns a user_error when a new staff profile would duplicate a store username", async () => {
    const { ctx } = createStaffProfilesMutationCtx({
      profiles: [
        {
          _id: "staff_profile_1",
          firstName: "Adjoa",
          fullName: "Adjoa Tetteh",
          lastName: "Tetteh",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      credentials: [
        {
          _id: "credential_1",
          organizationId: "org_1",
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
          username: "amens",
        },
      ],
    });

    await expect(
      getHandler(createStaffProfile)(ctx, {
        firstName: "Ama",
        lastName: "Mensah",
        organizationId: "org_1" as Id<"organization">,
        requestedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
        username: "amens",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "conflict",
        message: "Username is already in use for this store.",
      },
    });
  });

  it("lists store staff with roster credential fields and active roles", async () => {
    const { ctx } = createStaffProfilesMutationCtx({
      profiles: [
        {
          _id: "staff_profile_1",
          firstName: "Adjoa",
          fullName: "Adjoa Tetteh",
          hiredAt: 1710000000000,
          lastName: "Tetteh",
          organizationId: "org_1",
          phoneNumber: "+233200000000",
          status: "active",
          storeId: "store_1",
        },
      ],
      roles: [
        {
          _id: "role_1",
          assignedAt: 1,
          isPrimary: true,
          organizationId: "org_1",
          role: "stylist",
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      credentials: [
        {
          _id: "credential_1",
          organizationId: "org_1",
          staffProfileId: "staff_profile_1",
          status: "active",
          storeId: "store_1",
          username: "adjoa",
        },
      ],
    });

    await expect(
      getStaffProfileByIdWithCtx(ctx, {
        staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        _id: "staff_profile_1",
        credentialStatus: "active",
        firstName: "Adjoa",
        fullName: "Adjoa Tetteh",
        hiredAt: 1710000000000,
        lastName: "Tetteh",
        primaryRole: "stylist",
        roles: ["stylist"],
        username: "adjoa",
      }),
    );

    await expect(
      listStaffProfilesWithCtx(ctx, {
        status: "active",
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        _id: "staff_profile_1",
        credentialStatus: "active",
        firstName: "Adjoa",
        fullName: "Adjoa Tetteh",
        hiredAt: 1710000000000,
        lastName: "Tetteh",
        phoneNumber: "+233200000000",
        primaryRole: "stylist",
        roles: ["stylist"],
        username: "adjoa",
      }),
    ]);
  });
});
