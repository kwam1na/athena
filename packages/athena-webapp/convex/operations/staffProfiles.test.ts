import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { deriveDefaultOperationalRoles } from "./helpers/linking";
import { buildRoleAssignmentDrafts } from "./staffProfiles";

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

  it("keeps the default manager role primary for admins even if it is requested again", () => {
    const assignments = buildRoleAssignmentDrafts({
      staffProfileId: "staff_profile_2" as Id<"staffProfile">,
      storeId: "store_1" as Id<"store">,
      organizationId: "org_1" as Id<"organization">,
      memberRole: "full_admin",
      requestedRoles: ["manager", "stylist"],
    });

    expect(assignments.map((assignment) => assignment.role)).toEqual([
      "manager",
      "stylist",
    ]);
    expect(assignments[0]?.isPrimary).toBe(true);
    expect(assignments[1]?.isPrimary).toBe(false);
  });
});
