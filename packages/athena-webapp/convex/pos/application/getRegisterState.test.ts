import { describe, expect, it } from "vitest";

import { buildRegisterState } from "./queries/getRegisterState";

describe("buildRegisterState", () => {
  it("returns requiresTerminal when no terminal is available", () => {
    const result = buildRegisterState({
      terminal: null,
      cashier: { _id: "cashier-1", firstName: "Ama", lastName: "K" },
      activeSession: null,
      heldSessions: [],
    });

    expect(result.phase).toBe("requiresTerminal");
  });

  it("returns requiresCashier when terminal exists but cashier does not", () => {
    const result = buildRegisterState({
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeSession: null,
      heldSessions: [],
    });

    expect(result.phase).toBe("requiresCashier");
  });

  it("prefers an active session over a resumable held session", () => {
    const result = buildRegisterState({
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "cashier-1", firstName: "Ama", lastName: "K" },
      activeSession: { _id: "session-1", sessionNumber: "POS-001" },
      heldSessions: [{ _id: "session-2", sessionNumber: "POS-000" }],
    });

    expect(result.phase).toBe("active");
    expect(result.activeSession?._id).toBe("session-1");
    expect(result.resumableSession?._id).toBe("session-2");
  });

  it("returns resumable when only held sessions exist", () => {
    const result = buildRegisterState({
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "cashier-1", firstName: "Ama", lastName: "K" },
      activeSession: null,
      heldSessions: [
        { _id: "session-2", sessionNumber: "POS-002" },
        { _id: "session-3", sessionNumber: "POS-003" },
      ],
    });

    expect(result.phase).toBe("resumable");
    expect(result.resumableSession?._id).toBe("session-2");
  });

  it("returns readyToStart when prerequisites exist but no session does", () => {
    const result = buildRegisterState({
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "cashier-1", firstName: "Ama", lastName: "K" },
      activeSession: null,
      heldSessions: [],
    });

    expect(result.phase).toBe("readyToStart");
  });
});
