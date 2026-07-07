import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";

import { RemoteAssistRuntimeShell } from "./RemoteAssistRuntimeShell";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { useOptionalUpdateCoordinator } from "@/lib/app-update";
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

const activeRuntimeHostClaims = new Map<string, string>();
const RUNTIME_HOST_CLAIM_STORAGE_PREFIX =
  "athena-pos-remote-assist-runtime-host";
const RUNTIME_HOST_CLAIM_TTL_MS = 45_000;

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
  const runtimeHostOwnerIdRef = useRef(createRuntimeHostOwnerId());
  const runtimeHostClaimKey =
    terminalSeed?.storeId && remoteAssistRuntimeIdentity
      ? `${terminalSeed.storeId}:${remoteAssistRuntimeIdentity}`
      : null;
  const ownsRuntimeHostClaim = claimRuntimeHostForTerminal(
    runtimeHostClaimKey,
    runtimeHostOwnerIdRef.current,
  );
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
    appUpdateCoordinator: ownsRuntimeHostClaim ? appUpdateCoordinator : null,
    appSessionRecovery: ownsRuntimeHostClaim ? appSessionRecovery : null,
    mode: "drain-enabled",
    storeId: ownsRuntimeHostClaim ? terminalSeed?.storeId : undefined,
    terminalId: ownsRuntimeHostClaim ? remoteAssistRuntimeIdentity : undefined,
  });

  useEffect(
    () => () => {
      releaseRuntimeHostClaim(
        runtimeHostClaimKey,
        runtimeHostOwnerIdRef.current,
      );
    },
    [runtimeHostClaimKey],
  );

  const remoteAssistSession = useQuery(
    api.pos.public.terminals.getRuntimeRemoteAssistSession,
    ownsRuntimeHostClaim &&
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

export function resetPosRemoteAssistRuntimeHostClaimsForTests() {
  activeRuntimeHostClaims.clear();
  const storage = getRuntimeHostClaimStorage();
  if (!storage) return;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(RUNTIME_HOST_CLAIM_STORAGE_PREFIX)) {
      storage.removeItem(key);
    }
  }
}

function claimRuntimeHostForTerminal(
  claimKey: string | null,
  ownerId: string,
) {
  if (!claimKey) return false;
  const currentOwnerId = activeRuntimeHostClaims.get(claimKey);
  if (currentOwnerId && currentOwnerId !== ownerId) {
    return false;
  }

  const storageKey = `${RUNTIME_HOST_CLAIM_STORAGE_PREFIX}:${claimKey}`;
  const now = Date.now();
  const storage = getRuntimeHostClaimStorage();
  try {
    const currentRaw = storage?.getItem(storageKey);
    if (currentRaw) {
      const current = JSON.parse(currentRaw) as {
        claimedAt?: unknown;
        ownerId?: unknown;
      };
      if (
        typeof current.ownerId === "string" &&
        current.ownerId !== ownerId &&
        typeof current.claimedAt === "number" &&
        now - current.claimedAt < RUNTIME_HOST_CLAIM_TTL_MS
      ) {
        return false;
      }
    }
    storage?.setItem(storageKey, JSON.stringify({ claimedAt: now, ownerId }));
  } catch {
    // Fall back to the in-memory claim below when storage is unavailable.
  }

  activeRuntimeHostClaims.set(claimKey, ownerId);
  return true;
}

function releaseRuntimeHostClaim(claimKey: string | null, ownerId: string) {
  if (!claimKey) return;
  const storageKey = `${RUNTIME_HOST_CLAIM_STORAGE_PREFIX}:${claimKey}`;
  const storage = getRuntimeHostClaimStorage();
  try {
    const currentRaw = storage?.getItem(storageKey);
    if (currentRaw) {
      const current = JSON.parse(currentRaw) as { ownerId?: unknown };
      if (current.ownerId === ownerId) {
        storage?.removeItem(storageKey);
      }
    }
  } catch {
    // Ignore storage release failures; the TTL will expire stale claims.
  }

  if (activeRuntimeHostClaims.get(claimKey) === ownerId) {
    activeRuntimeHostClaims.delete(claimKey);
  }
}

function getRuntimeHostClaimStorage(): Storage | null {
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
    ) {
      return window.localStorage;
    }
    if (typeof globalThis.localStorage !== "undefined") {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function createRuntimeHostOwnerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
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
