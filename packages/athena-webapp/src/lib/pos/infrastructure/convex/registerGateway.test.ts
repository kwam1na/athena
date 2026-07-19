import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: queryMocks.useQuery,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    pos: {
      public: {
        register: { getState: "getState" },
        terminals: { getTerminalByFingerprint: "getTerminalByFingerprint" },
      },
    },
  },
}));

import {
  mapRegisterStateDto,
  useConvexTerminalByFingerprint,
} from "./registerGateway";
import type { Id } from "~/convex/_generated/dataModel";

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

describe("useConvexTerminalByFingerprint", () => {
  it("preserves terminal identity across unrelated rerenders", () => {
    const terminal = {
      _id: "terminal-1",
      displayName: "Front Counter",
      status: "active",
    };
    queryMocks.useQuery.mockReturnValue(terminal);

    const { result, rerender } = renderHook(() =>
      useConvexTerminalByFingerprint({
        fingerprintHash: "fingerprint-1",
        storeId: "store-1" as Id<"store">,
      }),
    );
    const firstResult = result.current;

    rerender();

    expect(result.current).toBe(firstResult);
  });
});
