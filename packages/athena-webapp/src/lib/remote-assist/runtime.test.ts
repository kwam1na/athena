import { describe, expect, it } from "vitest";

import {
  getRemoteAssistConnectedState,
  type RemoteAssistRuntimeState,
} from "./runtime";

describe("remote assist runtime state", () => {
  it.each([
    {
      expected: {
        allowsControl: false,
        isConnected: false,
        label: "Ready",
        tone: "neutral",
      },
      state: buildState({ status: "idle" }),
    },
    {
      expected: {
        allowsControl: false,
        isConnected: false,
        label: "Connecting",
        tone: "progress",
      },
      state: buildState({ status: "connecting" }),
    },
    {
      expected: {
        allowsControl: true,
        isConnected: true,
        label: "Connected",
        tone: "connected",
      },
      state: buildState({ controlEnabled: true, status: "connected" }),
    },
    {
      expected: {
        allowsControl: false,
        isConnected: true,
        label: "View only",
        tone: "connected",
      },
      state: buildState({ controlEnabled: false, status: "connected" }),
    },
    {
      expected: {
        allowsControl: false,
        isConnected: true,
        label: "Reconnecting",
        tone: "warning",
      },
      state: buildState({ status: "reconnecting" }),
    },
    {
      expected: {
        allowsControl: false,
        isConnected: true,
        label: "Disconnecting",
        tone: "progress",
      },
      state: buildState({ status: "disconnecting" }),
    },
    {
      expected: {
        allowsControl: false,
        isConnected: false,
        label: "Cashier approval required",
        tone: "danger",
      },
      state: buildState({
        blockedReason: "Cashier approval required",
        status: "blocked",
      }),
    },
    {
      expected: {
        allowsControl: false,
        isConnected: false,
        label: "Connection error",
        tone: "danger",
      },
      state: buildState({ status: "error" }),
    },
    {
      expected: {
        allowsControl: false,
        isConnected: false,
        label: "Disconnected",
        tone: "neutral",
      },
      state: buildState({ status: "disconnected" }),
    },
  ])("maps $state.status runtime state", ({ expected, state }) => {
    expect(getRemoteAssistConnectedState(state)).toEqual(expected);
  });
});

function buildState(
  overrides: Partial<RemoteAssistRuntimeState>,
): Pick<RemoteAssistRuntimeState, "blockedReason" | "controlEnabled" | "status"> {
  return {
    blockedReason: null,
    controlEnabled: false,
    status: "idle",
    ...overrides,
  };
}
