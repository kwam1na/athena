import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RemoteAssistRuntimeShell } from "./RemoteAssistRuntimeShell";

describe("RemoteAssistRuntimeShell", () => {
  it("renders connected control state and plural viewer count", () => {
    render(
      <RemoteAssistRuntimeShell
        state={{
          controlEnabled: true,
          sessionId: "session-1",
          status: "connected",
          supportAgentName: "Ada",
          viewerCount: 2,
        }}
      />,
    );

    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Control on")).toBeTruthy();
    expect(screen.getByText("2 viewers")).toBeTruthy();
    expect(screen.getByText("Ada assisting")).toBeTruthy();
  });

  it("renders view-only state and singular viewer count", () => {
    render(
      <RemoteAssistRuntimeShell
        state={{
          controlEnabled: false,
          sessionId: "session-1",
          status: "connected",
          viewerCount: 1,
        }}
      />,
    );

    expect(screen.getByText("View only")).toBeTruthy();
    expect(screen.getByText("Control off")).toBeTruthy();
    expect(screen.getByText("1 viewer")).toBeTruthy();
    expect(screen.getByText("Waiting for support connection")).toBeTruthy();
  });

  it("emits operator disconnects for connected sessions", () => {
    const onDisconnect = vi.fn();

    render(
      <RemoteAssistRuntimeShell
        onDisconnect={onDisconnect}
        state={{
          controlEnabled: true,
          sessionId: "session-1",
          status: "connected",
          viewerCount: 1,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect remote assist" }));

    expect(onDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "operator_requested",
        sessionId: "session-1",
      }),
    );
    expect(onDisconnect.mock.calls[0]?.[0].at).toBeInstanceOf(Date);
  });

  it("emits connection-lost disconnects for reconnecting sessions", () => {
    const onDisconnect = vi.fn();

    render(
      <RemoteAssistRuntimeShell
        onDisconnect={onDisconnect}
        state={{
          controlEnabled: false,
          sessionId: "session-1",
          status: "reconnecting",
          viewerCount: 1,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect remote assist" }));

    expect(onDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "connection_lost",
        sessionId: "session-1",
      }),
    );
  });

  it("disables disconnect for blocked sessions", () => {
    render(
      <RemoteAssistRuntimeShell
        state={{
          blockedReason: "Cashier approval required",
          controlEnabled: false,
          sessionId: "session-1",
          status: "blocked",
          viewerCount: 0,
        }}
      />,
    );

    expect(screen.getByText("Cashier approval required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect remote assist" })).toBeDisabled();
  });
});
