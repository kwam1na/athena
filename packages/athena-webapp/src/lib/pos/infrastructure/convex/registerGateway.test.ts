import { describe, expect, it } from "vitest";

import { mapRegisterStateDto } from "./registerGateway";

describe("mapRegisterStateDto", () => {
  it("maps the server dto into the browser register state shape", () => {
    const state = mapRegisterStateDto({
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "cashier-1", firstName: "Ama", lastName: "K" },
      activeSession: null,
      resumableSession: null,
    });

    expect(state.phase).toBe("readyToStart");
    expect(state.terminal?.displayName).toBe("Front Counter");
  });
});
