import { describe, expect, it } from "vitest";

import { isInMaintenanceMode } from "./maintenanceUtils";

describe("maintenanceUtils", () => {
  it("returns true for active V2 maintenance windows", () => {
    const config = {
      operations: {
        availability: {
          inMaintenanceMode: true,
        },
        maintenance: {
          countdownEndsAt: Date.now() + 120_000,
        },
      },
    };

    expect(isInMaintenanceMode(config)).toBe(true);
  });

  it("returns false when V2 maintenance is disabled", () => {
    const config = {
      operations: {
        availability: {
          inMaintenanceMode: false,
        },
        maintenance: {
          countdownEndsAt: Date.now() + 120_000,
        },
      },
    };

    expect(isInMaintenanceMode(config)).toBe(false);
  });
});
