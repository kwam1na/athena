import { describe, expect, it } from "vitest";

import {
  deriveRegisterPhase,
  hasActiveRegisterSession,
  hasResumableRegisterSession,
  isRegisterReadyToStart,
  requiresCashier,
  requiresTerminal,
} from "./index";

describe("deriveRegisterPhase", () => {
  it("prefers an active session when one exists", () => {
    expect(
      deriveRegisterPhase({
        hasTerminal: true,
        hasCashier: true,
        activeSessionId: "session-1",
        resumableSessionId: "session-2",
      }),
    ).toBe("active");
  });

  it("returns readyToStart when prerequisites are met but no session exists", () => {
    expect(
      deriveRegisterPhase({
        hasTerminal: true,
        hasCashier: true,
        activeSessionId: null,
        resumableSessionId: null,
      }),
    ).toBe("readyToStart");
  });
});

describe("phase selectors", () => {
  it("surfaces missing terminal and cashier prerequisites", () => {
    expect(
      requiresTerminal({
        hasTerminal: false,
        hasCashier: false,
        activeSessionId: null,
        resumableSessionId: null,
      }),
    ).toBe(true);

    expect(
      requiresCashier({
        hasTerminal: true,
        hasCashier: false,
        activeSessionId: null,
        resumableSessionId: null,
      }),
    ).toBe(true);
  });

  it("detects active and resumable register states", () => {
    expect(
      hasActiveRegisterSession({
        hasTerminal: true,
        hasCashier: true,
        activeSessionId: "session-1",
        resumableSessionId: "session-2",
      }),
    ).toBe(true);

    expect(
      hasResumableRegisterSession({
        hasTerminal: true,
        hasCashier: true,
        activeSessionId: null,
        resumableSessionId: "session-2",
      }),
    ).toBe(true);
  });

  it("detects when the register is ready to start a new session", () => {
    expect(
      isRegisterReadyToStart({
        hasTerminal: true,
        hasCashier: true,
        activeSessionId: null,
        resumableSessionId: null,
      }),
    ).toBe(true);
  });
});
