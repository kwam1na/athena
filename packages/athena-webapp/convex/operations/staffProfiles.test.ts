import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { deriveDefaultOperationalRoles } from "./helpers/linking";
import {
  buildRoleAssignmentDrafts,
  createStaffProfileWithCtx,
  listStaffProfilesWithCtx,
  updateStaffProfileWithCtx,
} from "./staffProfiles";

type TableName = "staffProfile" | "staffRoleAssignment";
type Row = Record<string, unknown> & { _id: string };

function createStaffProfilesMutationCtx(seed?: {
  profiles?: Row[];
  roles?: Row[];
}) {
  const tables: Record<TableName, Map<string, Row>> = {
    staffProfile: new Map((seed?.profiles ?? []).map((row) => [row._id, row])),
    staffRoleAssignment: new Map((seed?.roles ?? []).map((row) => [row._id, row])),
  };
  const insertCounters: Record<TableName, number> = {
    staffProfile: 0,
    staffRoleAssignment: 0,
  };

  function createIndexedQuery(table: TableName, filters: Array<[string, unknown]>) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every(([field, value]) => row[field] === value)
    );

    return {
      collect: async () => matches,
      first: async () => matches[0] ?? null,
      take: async (count: number) => matches.slice(0, count),
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
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown
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

describe("staff profile helpers", () => {
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
      fullName: "  Adjoa Tetteh  ",
      jobTitle: " Senior Stylist ",
      organizationId: "org_1" as Id<"organization">,
      phoneNumber: " +233200000000 ",
      requestedRoles: ["stylist", "technician"],
      staffCode: " ST-17 ",
      storeId: "store_1" as Id<"store">,
    });

    expect(result).toMatchObject({
      createdByUserId: "user_1",
      fullName: "Adjoa Tetteh",
      jobTitle: "Senior Stylist",
      phoneNumber: "+233200000000",
      roles: ["stylist", "technician"],
      staffCode: "ST-17",
      status: "active",
      storeId: "store_1",
    });
    expect(tables.staffRoleAssignment.size).toBe(2);
  });

  it("rejects linked users that already belong to another staff profile in the store", async () => {
    const { ctx } = createStaffProfilesMutationCtx({
      profiles: [
        {
          _id: "staff_profile_existing",
          fullName: "Existing Staff",
          linkedUserId: "user_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      createStaffProfileWithCtx(ctx, {
        fullName: "Second Staff",
        linkedUserId: "user_1" as Id<"athenaUser">,
        organizationId: "org_1" as Id<"organization">,
        requestedRoles: ["cashier"],
        storeId: "store_1" as Id<"store">,
      })
    ).rejects.toThrow(
      "A staff profile already links this Athena user in the store."
    );
  });

  it("updates the staff profile fields and resynchronizes roles", async () => {
    const { ctx, tables } = createStaffProfilesMutationCtx({
      profiles: [
        {
          _id: "staff_profile_1",
          createdByUserId: "user_1",
          fullName: "Adjoa Tetteh",
          organizationId: "org_1",
          phoneNumber: "+233200000000",
          status: "active",
          storeId: "store_1",
          updatedByUserId: "user_1",
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
      fullName: "Lead Adjoa Tetteh",
      jobTitle: "Lead Stylist",
      organizationId: "org_1" as Id<"organization">,
      requestedRoles: ["manager", "stylist"],
      staffProfileId: "staff_profile_1" as Id<"staffProfile">,
      storeId: "store_1" as Id<"store">,
      updatedByUserId: "user_2" as Id<"athenaUser">,
    });

    expect(result).toMatchObject({
      fullName: "Lead Adjoa Tetteh",
      jobTitle: "Lead Stylist",
      roles: ["stylist", "manager"],
      updatedByUserId: "user_2",
    });
    expect(tables.staffRoleAssignment.get("role_2")?.status).toBe("inactive");
    const managerRole = Array.from(tables.staffRoleAssignment.values()).find(
      (role) => role.role === "manager"
    );
    expect(managerRole).toMatchObject({
      isPrimary: true,
      status: "active",
    });
  });

  it("lists store staff without assuming email and includes active roles", async () => {
    const { ctx } = createStaffProfilesMutationCtx({
      profiles: [
        {
          _id: "staff_profile_1",
          fullName: "Adjoa Tetteh",
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
    });

    await expect(
      listStaffProfilesWithCtx(ctx, {
        status: "active",
        storeId: "store_1" as Id<"store">,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        _id: "staff_profile_1",
        fullName: "Adjoa Tetteh",
        phoneNumber: "+233200000000",
        roles: ["stylist"],
      }),
    ]);
  });
});
