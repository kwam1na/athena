import type { TokenStorage } from "@convex-dev/auth/react";

import type {
  AuthRuntimeHandoffCoordinator,
  AuthRuntimeHandoffHandle,
} from "../../../lib/auth/authRuntimeHandoff";

export const POS_SERVICE_AUTH_PRESENTATION_KEY =
  "athena.posServiceAuthPresentation.v1";
export const POS_SERVICE_AUTH_PRESENTATION_EVENT =
  "athena:pos-service-auth-presentation";

export type PosRecoveryActivation = {
  authorityExpiresAt: number;
  offlineAuthorityReceipt: string;
  posApplicationSessionBindingId: string;
  servicePrincipalSessionId: string;
  storeId: string;
  terminalId: string;
};

export type PosRecoveryDisposition =
  | { disposition: "recovery_code_required" }
  | {
      disposition: "administrator_reconnect_required";
      expiresAt: number;
      reconnectIntentToken: string;
    };

export type PosRecoveryFrontendAdapter = {
  requestDisposition(input: {
    browserFingerprintHash: string;
    terminalId: string;
    terminalProof: string;
  }): Promise<PosRecoveryDisposition>;
  issue(input: {
    code: string;
    recoveryCorrelationKey: string;
    storage: TokenStorage;
    storageNamespace: string;
    terminalId: string;
    terminalProof: string;
  }): Promise<void>;
  resume(input: {
    storage: TokenStorage;
    storageNamespace: string;
  }): Promise<void>;
  activate(): Promise<PosRecoveryActivation>;
  assertActivatedSession(input: PosRecoveryActivation): Promise<void>;
  abort(input: {
    recoveryCorrelationKey: string;
    terminalId: string;
    terminalProof: string;
  }): Promise<void>;
};

export const unavailablePosRecoveryFrontendAdapter: PosRecoveryFrontendAdapter =
  {
    requestDisposition: async () => {
      throw new Error("pos_recovery_adapter_unavailable");
    },
    issue: async () => {
      throw new Error("pos_recovery_adapter_unavailable");
    },
    resume: async () => {
      throw new Error("pos_recovery_adapter_unavailable");
    },
    activate: async () => {
      throw new Error("pos_recovery_adapter_unavailable");
    },
    assertActivatedSession: async () => {
      throw new Error("pos_recovery_adapter_unavailable");
    },
    abort: async () => {
      throw new Error("pos_recovery_adapter_unavailable");
    },
  };

export type PosRecoveryFlowSession = {
  activation?: PosRecoveryActivation;
  handle: AuthRuntimeHandoffHandle;
  redirectTo: string;
  terminalId: string;
  terminalProof: string;
};

export type PosRecoveryFlowPhase =
  "prepared" | "auth_issued" | "activating" | "promoting" | "completed";

export async function startPosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  code: string;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  onSession?: (session: PosRecoveryFlowSession) => void;
  redirectTo: string;
  terminalId: string;
  terminalProof: string;
}) {
  return input.coordinator.runExclusive(async () => {
    const handle = input.coordinator.prepareHandoff();
    const session: PosRecoveryFlowSession = {
      handle,
      redirectTo: safeRedirect(input.redirectTo),
      terminalId: input.terminalId,
      terminalProof: input.terminalProof,
    };
    input.onSession?.(session);
    input.onPhase?.("prepared");
    return issuePosRecoveryFlowUnlocked({ ...input, session });
  });
}

export async function issuePosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  code: string;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  return input.coordinator.runExclusive(() =>
    issuePosRecoveryFlowUnlocked(input),
  );
}

async function issuePosRecoveryFlowUnlocked(input: {
  adapter: PosRecoveryFrontendAdapter;
  code: string;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  await input.coordinator.keepLeaseAlive(input.session.handle, () =>
    input.adapter.issue({
      code: input.code,
      recoveryCorrelationKey: input.session.handle.correlationKey,
      storage: input.coordinator.getPendingTokenStorage(input.session.handle),
      storageNamespace: input.session.handle.pendingNamespace,
      terminalId: input.session.terminalId,
      terminalProof: input.session.terminalProof,
    }),
  );
  input.coordinator.markAuthIssued(input.session.handle);
  input.onPhase?.("auth_issued");
  return activatePosRecoveryFlowUnlocked(input);
}

export async function activatePosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  return input.coordinator.runExclusive(() =>
    activatePosRecoveryFlowUnlocked(input),
  );
}

async function activatePosRecoveryFlowUnlocked(
  input: {
    adapter: PosRecoveryFrontendAdapter;
    coordinator: AuthRuntimeHandoffCoordinator;
    onPhase?: (phase: PosRecoveryFlowPhase) => void;
    session: PosRecoveryFlowSession;
  },
  options: { allowPreparedRecovery?: boolean } = {},
) {
  input.onPhase?.("activating");
  const startingPhase = input.coordinator.getSnapshot().handoffPhase;
  if (
    startingPhase !== "auth_issued" &&
    startingPhase !== "activated" &&
    !(options.allowPreparedRecovery && startingPhase === "prepared")
  ) {
    throw new Error("invalid_handoff_transition");
  }
  const activation = await input.coordinator.keepLeaseAlive(
    input.session.handle,
    () => input.adapter.activate(),
  );
  input.session.activation = activation;
  if (startingPhase === "prepared") {
    input.coordinator.markAuthIssued(input.session.handle);
    input.coordinator.markActivated(input.session.handle);
  } else if (startingPhase === "auth_issued") {
    input.coordinator.markActivated(input.session.handle);
  }
  writePresentation({
    kind: "pending",
    redirectTo: input.session.redirectTo,
    startedAt: Date.now(),
  });
  input.onPhase?.("promoting");
  input.coordinator.promoteActivated(input.session.handle);
  return verifyPromotedPosRecoveryFlowUnlocked(input);
}

export async function verifyPromotedPosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  return input.coordinator.runExclusive(() =>
    verifyPromotedPosRecoveryFlowUnlocked(input),
  );
}

async function verifyPromotedPosRecoveryFlowUnlocked(input: {
  adapter: PosRecoveryFrontendAdapter;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  if (!input.session.activation) throw new Error("activation_unavailable");
  await input.coordinator.keepLeaseAlive(input.session.handle, () =>
    input.adapter.assertActivatedSession(input.session.activation!),
  );
  completeVerifiedPosRecoveryPromotion({
    coordinator: input.coordinator,
    handle: input.session.handle,
    redirectTo: input.session.redirectTo,
  });
  input.onPhase?.("completed");
  return { activation: input.session.activation, session: input.session };
}

export async function resumePosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  return input.coordinator.runExclusive(async () => {
    const phase = input.coordinator.getSnapshot().handoffPhase;
    if (phase === "promoted") return { status: "promoted" as const };
    if (
      phase !== "prepared" &&
      phase !== "auth_issued" &&
      phase !== "activated"
    ) {
      throw new Error("handoff_unavailable");
    }
    await input.coordinator.keepLeaseAlive(input.session.handle, () =>
      input.adapter.resume({
        storage: input.coordinator.getPendingTokenStorage(input.session.handle),
        storageNamespace: input.session.handle.pendingNamespace,
      }),
    );
    try {
      const result = await activatePosRecoveryFlowUnlocked(input, {
        allowPreparedRecovery: true,
      });
      return { ...result, status: "completed" as const };
    } catch (error) {
      if (
        phase !== "prepared" ||
        input.coordinator.getSnapshot().handoffPhase !== "prepared"
      ) {
        throw error;
      }
      return { status: "code_required" as const };
    }
  });
}

export async function abortPosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  coordinator: AuthRuntimeHandoffCoordinator;
  session: PosRecoveryFlowSession;
}) {
  return input.coordinator.runExclusive(async () => {
    await input.coordinator.keepLeaseAlive(input.session.handle, () =>
      input.adapter.abort({
        recoveryCorrelationKey: input.session.handle.correlationKey,
        terminalId: input.session.terminalId,
        terminalProof: input.session.terminalProof,
      }),
    );
    input.coordinator.clearAfterConfirmedAbort(input.session.handle);
  });
}

export function completeVerifiedPosRecoveryPromotion(input: {
  coordinator: AuthRuntimeHandoffCoordinator;
  handle: AuthRuntimeHandoffHandle;
  redirectTo: string;
}) {
  input.coordinator.completeVerifiedPromotion(input.handle);
  writePresentation({
    kind: "active",
    redirectTo: safeRedirect(input.redirectTo),
    startedAt: Date.now(),
  });
}

export function getPosServiceAuthPresentation(): {
  kind: "pending" | "active";
  redirectTo: string;
  startedAt: number;
} | null {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(POS_SERVICE_AUTH_PRESENTATION_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (
      (candidate.kind !== "pending" && candidate.kind !== "active") ||
      typeof candidate.redirectTo !== "string" ||
      typeof candidate.startedAt !== "number"
    )
      return null;
    return {
      kind: candidate.kind,
      redirectTo: safeRedirect(candidate.redirectTo),
      startedAt: candidate.startedAt,
    };
  } catch {
    return null;
  }
}

export function clearPosServiceAuthPresentation() {
  sessionStorage.removeItem(POS_SERVICE_AUTH_PRESENTATION_KEY);
  window.dispatchEvent(new Event(POS_SERVICE_AUTH_PRESENTATION_EVENT));
}

function writePresentation(value: {
  kind: "pending" | "active";
  redirectTo: string;
  startedAt: number;
}) {
  sessionStorage.setItem(
    POS_SERVICE_AUTH_PRESENTATION_KEY,
    JSON.stringify(value),
  );
  window.dispatchEvent(new Event(POS_SERVICE_AUTH_PRESENTATION_EVENT));
}

function safeRedirect(redirectTo: string) {
  if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) return "/";
  return redirectTo;
}
