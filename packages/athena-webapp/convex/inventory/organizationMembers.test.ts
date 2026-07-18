import { describe, it } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  canAccessAdmin,
  canAccessPOS,
  getAll,
  getUserPermissions,
  getUserRole,
} from "./organizationMembers";

describe("organization members", () => {
  it("returns only the member shape exposed by getAll", () => {
    assertConformsToExportedReturns(getAll, [
      {
        _id: "athena-user-1",
        _creationTime: 1,
        email: "manager@example.com",
        firstName: "Manager",
        lastName: "Example",
        organizationId: "organization-1",
      },
    ]);
  });

  it("preserves the membership permission return contracts", () => {
    assertConformsToExportedReturns(getUserRole, "full_admin");
    assertConformsToExportedReturns(getUserRole, null);
    assertConformsToExportedReturns(getUserPermissions, {
      canAccessAdmin: true,
      canAccessPOS: true,
      role: "full_admin",
    });
    assertConformsToExportedReturns(canAccessPOS, true);
    assertConformsToExportedReturns(canAccessAdmin, false);
  });
});
