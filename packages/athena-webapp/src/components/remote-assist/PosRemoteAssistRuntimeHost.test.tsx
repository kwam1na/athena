import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PosRemoteAssistRuntimeHost } from "./PosRemoteAssistRuntimeHost";

const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const usePosLocalSyncRuntimeStatusMock = vi.fn();
const useRemoteAssistRuntimeTransportMock = vi.fn();
const useOptionalUpdateCoordinatorMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => useMutationMock,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/lib/pos/infrastructure/local/usePosLocalSyncRuntime", () => ({
  usePosLocalSyncRuntimeStatus: (input: Record<string, unknown>) =>
    usePosLocalSyncRuntimeStatusMock(input),
}));

vi.mock("@/lib/app-update", () => ({
  useOptionalUpdateCoordinator: () => useOptionalUpdateCoordinatorMock(),
}));

vi.mock("@/lib/remote-assist", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/remote-assist",
  );
  return {
    ...actual,
    useRemoteAssistRuntimeTransport: (input: Record<string, unknown>) =>
      useRemoteAssistRuntimeTransportMock(input),
  };
});

describe("PosRemoteAssistRuntimeHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMutationMock.mockResolvedValue(null);
    useQueryMock.mockReturnValue(null);
    useOptionalUpdateCoordinatorMock.mockReturnValue(null);
    useRemoteAssistRuntimeTransportMock.mockReturnValue({
      connectionState: "connected",
    });
  });

  it("owns drain-enabled local sync when a provisioned terminal seed is present", () => {
    render(
      <PosRemoteAssistRuntimeHost
        appSessionRecovery={{
          assertion: "present",
          reason: null,
          status: "recoverable",
        }}
        entryContext={readyEntryContext()}
      />,
    );

    expect(usePosLocalSyncRuntimeStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appSessionRecovery: {
          assertion: "present",
          reason: null,
          status: "recoverable",
        },
        mode: "drain-enabled",
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
  });

  it("passes the app update coordinator adapter into the local sync runtime", () => {
    const applyUpdate = vi.fn();
    const getSnapshot = vi.fn();
    useOptionalUpdateCoordinatorMock.mockReturnValue({
      applyUpdate,
      getSnapshot,
    });

    render(<PosRemoteAssistRuntimeHost entryContext={readyEntryContext()} />);

    expect(usePosLocalSyncRuntimeStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appUpdateCoordinator: {
          applyUpdate,
          getSnapshot,
        },
      }),
    );
  });

  it("shows a Remote Assist runtime banner and disconnects with terminal proof", () => {
    useQueryMock.mockReturnValue({
      _id: "remote-session-1",
      effectiveMode: "unattended",
      sensitiveModeActive: false,
      status: "active",
    });

    render(<PosRemoteAssistRuntimeHost entryContext={readyEntryContext()} />);

    expect(screen.getByLabelText("Remote assist runtime")).toBeInTheDocument();
    expect(screen.getByText("Control on")).toBeInTheDocument();
    expect(useRemoteAssistRuntimeTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        storeId: "store-1",
        syncSecretHash: "secret-hash",
        terminalId: "terminal-cloud-1",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /disconnect remote assist/i }),
    );

    expect(useMutationMock).toHaveBeenCalledWith({
      sessionId: "remote-session-1",
      storeId: "store-1",
      syncSecretHash: "secret-hash",
      terminalId: "terminal-cloud-1",
    });
  });
});

function readyEntryContext() {
  return {
    orgUrlSlug: "acme",
    source: "live",
    status: "ready",
    storeId: "store-1",
    storeUrlSlug: "downtown",
    terminalSeed: {
      cloudTerminalId: "terminal-cloud-1",
      displayName: "Front register",
      provisionedAt: 1_700,
      schemaVersion: 2,
      storeId: "store-1",
      syncSecretHash: "secret-hash",
      terminalId: "local-terminal-1",
    },
  } as const;
}
