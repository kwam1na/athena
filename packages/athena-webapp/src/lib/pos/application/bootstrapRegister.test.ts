import { describe, expect, it } from "vitest";

import { bootstrapRegister } from "./useCases/bootstrapRegister";

describe("bootstrapRegister", () => {
  it("returns requiresCashier when terminal exists but no cashier is authenticated", () => {
    const state = bootstrapRegister({
      registerState: {
        phase: "requiresCashier",
        terminal: { _id: "terminal-1", displayName: "Front Counter" },
        cashier: null,
        activeSession: null,
        resumableSession: null,
      },
    });

    expect(state).toBeDefined();
    expect(
      state?.phase,
    ).toBe("requiresCashier");
  });
});
