import { describe, expect, it } from "vitest";

import { bootstrapRegister } from "./useCases/bootstrapRegister";
import type { PosCashDrawerDto, PosRegisterStateDto } from "./dto";

const terminal = { _id: "terminal-1", displayName: "Front Counter" };
const cashier = { _id: "cashier-1", firstName: "Ama", lastName: "K" };

function drawer(
  overrides: Partial<PosCashDrawerDto> = {},
): PosCashDrawerDto {
  return {
    _id: "drawer-1" as PosCashDrawerDto["_id"],
    status: "open",
    openingFloat: 5000,
    expectedCash: 5000,
    openedAt: 1710000000000,
    registerNumber: "A1",
    ...overrides,
  };
}

function state(
  overrides: Partial<PosRegisterStateDto>,
): PosRegisterStateDto {
  return {
    phase: "readyToStart",
    terminal,
    cashier,
    activeRegisterSession: null,
    activeSession: null,
    resumableSession: null,
    ...overrides,
  };
}

describe("bootstrapRegister", () => {
  it("returns requiresCashier when terminal exists but no cashier is authenticated", () => {
    const state = bootstrapRegister({
      registerState: {
        phase: "requiresCashier",
        terminal: { _id: "terminal-1", displayName: "Front Counter" },
        cashier: null,
        activeRegisterSession: null,
        activeSession: null,
        resumableSession: null,
      },
    });

    expect(state).toBeDefined();
    expect(state?.phase).toBe("requiresCashier");
    expect(state?.canStartSession).toBe(false);
    expect(state?.canResumeSession).toBe(false);
  });

  it.each([
    {
      phase: "readyToStart" as const,
      activeRegisterSession: drawer(),
      expected: { canStartSession: true, canResumeSession: false },
    },
    {
      phase: "readyToStart" as const,
      activeRegisterSession: null,
      expected: { canStartSession: false, canResumeSession: false },
    },
    {
      phase: "resumable" as const,
      activeRegisterSession: drawer(),
      resumableSession: { _id: "session-1", sessionNumber: "POS-001" },
      expected: { canStartSession: false, canResumeSession: true },
    },
    {
      phase: "resumable" as const,
      activeRegisterSession: null,
      resumableSession: { _id: "session-1", sessionNumber: "POS-001" },
      expected: { canStartSession: false, canResumeSession: false },
    },
  ])(
    "derives start/resume permissions for $phase with active drawer $activeRegisterSession",
    ({ expected, ...registerState }) => {
      const result = bootstrapRegister({
        registerState: state(registerState),
      });

      expect(result).toMatchObject(expected);
    },
  );

  it.each([
    { phase: "requiresCashier" as const },
    {
      phase: "active" as const,
      activeSession: { _id: "session-1", sessionNumber: "POS-001" },
    },
  ])("does not enable session actions while phase is $phase", (overrides) => {
    const result = bootstrapRegister({
      registerState: state({
        activeRegisterSession: drawer(),
        ...overrides,
      }),
    });

    expect(result?.canStartSession).toBe(false);
    expect(result?.canResumeSession).toBe(false);
  });

  it.each([
    { phase: "readyToStart" as const, expected: "canStartSession" as const },
    {
      phase: "resumable" as const,
      resumableSession: { _id: "session-1", sessionNumber: "POS-001" },
      expected: "canResumeSession" as const,
    },
  ])(
    "does not treat a closing drawer as available for $phase",
    ({ expected, ...registerState }) => {
      const result = bootstrapRegister({
        registerState: state({
          activeRegisterSession: drawer({ status: "closing" }),
          ...registerState,
        }),
      });

      expect(result?.[expected]).toBe(false);
    },
  );

  it("returns undefined while register state is still loading", () => {
    expect(bootstrapRegister({ registerState: undefined })).toBeUndefined();
  });
});
