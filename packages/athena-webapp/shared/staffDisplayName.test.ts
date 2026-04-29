import { describe, expect, it } from "vitest";

import { formatStaffDisplayName } from "./staffDisplayName";

describe("formatStaffDisplayName", () => {
  it("abbreviates the last name when structured staff names are available", () => {
    expect(
      formatStaffDisplayName({
        firstName: "Kwamina",
        lastName: "Mensah",
        fullName: "Kwamina Mensah",
      }),
    ).toBe("Kwamina M.");
  });

  it("abbreviates the last name from full name when structured names are missing", () => {
    expect(
      formatStaffDisplayName({
        fullName: "Adjoa Tetteh",
      }),
    ).toBe("Adjoa T.");
  });

  it("keeps single-part staff names readable", () => {
    expect(formatStaffDisplayName({ fullName: "Operations" })).toBe(
      "Operations",
    );
  });

  it("normalizes extra whitespace", () => {
    expect(
      formatStaffDisplayName({
        firstName: "  Ama  ",
        lastName: "  Serwaa  ",
      }),
    ).toBe("Ama S.");
  });
});
