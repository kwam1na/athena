import { describe, expect, it } from "vitest";

import { formatExpenseStaffProfileName } from "./expenseTransactions";

describe("formatExpenseStaffProfileName", () => {
  it("abbreviates the last name when structured staff names are available", () => {
    expect(
      formatExpenseStaffProfileName({
        firstName: "Kwamina",
        lastName: "Nuh",
        fullName: "Kwamina Nuh",
      }),
    ).toBe("Kwamina N.");
  });

  it("abbreviates the last name from full name when structured names are missing", () => {
    expect(
      formatExpenseStaffProfileName({
        fullName: "Kwamina Mensah",
      }),
    ).toBe("Kwamina M.");
  });

  it("keeps single-part full names readable", () => {
    expect(
      formatExpenseStaffProfileName({
        fullName: "Operations",
      }),
    ).toBe("Operations");
  });
});
