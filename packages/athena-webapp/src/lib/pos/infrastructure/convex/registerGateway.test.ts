import { describe, expect, it } from "vitest";

import { mapRegisterStateDto } from "./registerGateway";

describe("mapRegisterStateDto", () => {
  it("maps the server dto into the browser register state shape", () => {
    const state = mapRegisterStateDto({
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "cashier-1", firstName: "Ama", lastName: "K" },
      activeRegisterSession: null,
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    });

    expect(state.phase).toBe("readyToStart");
    expect(state.terminal?.displayName).toBe("Front Counter");
  });

  it("preserves active drawer visibility and resumable session identity", () => {
    const state = mapRegisterStateDto({
      phase: "resumable",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "cashier-1", firstName: "Ama", lastName: "K" },
      activeRegisterSession: {
        _id: "drawer-1" as never,
        status: "closing",
        registerNumber: "A1",
        openingFloat: 5000,
        expectedCash: 5000,
        openedAt: 1710000000000,
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: {
        _id: "session-1",
        sessionNumber: "POS-001",
        registerSessionId: "drawer-1",
      },
    });

    expect(state.activeRegisterSession).toEqual(
      expect.objectContaining({
        _id: "drawer-1",
        status: "closing",
      }),
    );
    expect(state.resumableSession).toEqual(
      expect.objectContaining({
        _id: "session-1",
        registerSessionId: "drawer-1",
      }),
    );
  });
});
