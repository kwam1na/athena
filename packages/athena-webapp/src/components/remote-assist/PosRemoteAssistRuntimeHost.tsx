import { useMutation, useQuery } from "convex/react";
import { useMemo } from "react";

import { RemoteAssistRuntimeShell } from "./RemoteAssistRuntimeShell";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { useOptionalUpdateCoordinator } from "@/lib/app-update/UpdateCoordinatorProvider";
import type { PosLocalEntryContext } from "@/lib/pos/infrastructure/local/localPosEntryContext";
import { usePosLocalSyncRuntimeStatus } from "@/lib/pos/infrastructure/local/usePosLocalSyncRuntime";
import type { PosTerminalRuntimeAppSessionRecoveryInput } from "@/lib/pos/infrastructure/local/terminalRuntimeStatus";
import {
  useRemoteAssistRuntimeTransport,
  type RemoteAssistRuntimeState,
} from "@/lib/remote-assist";

type RemoteAssistSessionSummary = {
  _id: Id<"remoteAssistSession"> | string;
  effectiveMode: "attended" | "unattended" | string;
  sensitiveModeActive: boolean;
  status: string;
};

export function PosRemoteAssistRuntimeHost({
  appSessionRecovery,
  entryContext,
}: {
  appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryInput | null;
  entryContext: PosLocalEntryContext;
}) {
  const terminalSeed =
    entryContext.status === "ready" ? entryContext.terminalSeed : null;
  const remoteAssistRuntimeIdentity =
    terminalSeed?.cloudTerminalId ?? terminalSeed?.terminalId;
  const updateCoordinator = useOptionalUpdateCoordinator();
  const appUpdateCoordinator = useMemo(
    () =>
      updateCoordinator
        ? {
            applyUpdate: updateCoordinator.applyUpdate,
            getSnapshot: updateCoordinator.getSnapshot,
          }
        : null,
    [updateCoordinator],
  );

  usePosLocalSyncRuntimeStatus({
    appUpdateCoordinator,
    appSessionRecovery,
    mode: "drain-enabled",
    storeId: terminalSeed?.storeId,
    terminalId: remoteAssistRuntimeIdentity,
  });

  const remoteAssistSession = useQuery(
    api.pos.public.terminals.getRuntimeRemoteAssistSession,
    terminalSeed?.storeId &&
      terminalSeed?.syncSecretHash &&
      remoteAssistRuntimeIdentity
      ? {
          storeId: terminalSeed.storeId as Id<"store">,
          syncSecretHash: terminalSeed.syncSecretHash,
          terminalId: remoteAssistRuntimeIdentity as Id<"posTerminal">,
        }
      : "skip",
  ) as RemoteAssistSessionSummary | null | undefined;
  const disconnectRemoteAssistSession = useMutation(
    api.pos.public.terminals.disconnectRemoteAssistSession,
  );

  const remoteAssistRuntimeState =
    getRemoteAssistRuntimeState(remoteAssistSession);
  const remoteAssistTransport = useRemoteAssistRuntimeTransport({
    enabled: Boolean(
      remoteAssistRuntimeState &&
        terminalSeed?.storeId &&
        terminalSeed.syncSecretHash &&
        remoteAssistRuntimeIdentity,
    ),
    session: remoteAssistSession,
    storeId: terminalSeed?.storeId,
    syncSecretHash: terminalSeed?.syncSecretHash,
    terminalId: remoteAssistRuntimeIdentity,
  });

  if (!remoteAssistRuntimeState || !terminalSeed || !remoteAssistRuntimeIdentity) {
    return null;
  }

  return (
    <RemoteAssistRuntimeShell
      onDisconnect={() => {
        void disconnectRemoteAssistSession({
          sessionId: remoteAssistSession!._id as Id<"remoteAssistSession">,
          storeId: terminalSeed.storeId as Id<"store">,
          syncSecretHash: terminalSeed.syncSecretHash,
          terminalId: remoteAssistRuntimeIdentity as Id<"posTerminal">,
        });
      }}
      state={withRuntimeTransportState(
        remoteAssistRuntimeState,
        remoteAssistTransport.connectionState,
      )}
    />
  );
}

function withRuntimeTransportState(
  state: RemoteAssistRuntimeState,
  transportState: string,
): RemoteAssistRuntimeState {
  if (transportState === "connected") {
    return {
      ...state,
      status: "connected",
    };
  }

  if (transportState === "connecting") {
    return {
      ...state,
      status: "connecting",
    };
  }

  if (transportState === "reconnecting") {
    return {
      ...state,
      status: "reconnecting",
    };
  }

  if (transportState === "error") {
    return {
      ...state,
      status: "error",
    };
  }

  return state;
}

function getRemoteAssistRuntimeState(
  session: RemoteAssistSessionSummary | null | undefined,
): RemoteAssistRuntimeState | null {
  if (
    !session ||
    !["active", "connecting", "pending_attended_approval"].includes(session.status)
  ) {
    return null;
  }
  return {
    blockedReason:
      session.status === "pending_attended_approval"
        ? "Approval required"
        : null,
    controlEnabled:
      session.status === "active" &&
      session.effectiveMode === "unattended" &&
      !session.sensitiveModeActive,
    sessionId: session._id,
    status:
      session.status === "active"
        ? "connected"
        : session.status === "pending_attended_approval"
          ? "blocked"
          : "connecting",
    supportAgentName: null,
    viewerCount: 0,
  };
}
