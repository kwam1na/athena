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
  const handle = input.coordinator.prepareHandoff();
  const session: PosRecoveryFlowSession = {
    handle,
    redirectTo: safeRedirect(input.redirectTo),
    terminalId: input.terminalId,
    terminalProof: input.terminalProof,
  };
  input.onSession?.(session);
  input.onPhase?.("prepared");

  return issuePosRecoveryFlow({ ...input, session });
}

export async function issuePosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  code: string;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  await input.adapter.issue({
    code: input.code,
    recoveryCorrelationKey: input.session.handle.correlationKey,
    storage: input.coordinator.getPendingTokenStorage(input.session.handle),
    storageNamespace: input.session.handle.pendingNamespace,
    terminalId: input.session.terminalId,
    terminalProof: input.session.terminalProof,
  });
  input.coordinator.markAuthIssued(input.session.handle);
  input.onPhase?.("auth_issued");
  return activatePosRecoveryFlow(input);
}

export async function activatePosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  input.onPhase?.("activating");
  const activation = await input.adapter.activate();
  input.session.activation = activation;
  input.coordinator.markActivated(input.session.handle);
  writePresentation({
    kind: "pending",
    redirectTo: input.session.redirectTo,
    startedAt: Date.now(),
  });
  input.onPhase?.("promoting");
  input.coordinator.promoteActivated(input.session.handle);
  return verifyPromotedPosRecoveryFlow(input);
}

export async function verifyPromotedPosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  coordinator: AuthRuntimeHandoffCoordinator;
  onPhase?: (phase: PosRecoveryFlowPhase) => void;
  session: PosRecoveryFlowSession;
}) {
  if (!input.session.activation) throw new Error("activation_unavailable");
  await input.adapter.assertActivatedSession(input.session.activation);
  input.coordinator.completeVerifiedPromotion(input.session.handle);
  writePresentation({
    kind: "active",
    redirectTo: input.session.redirectTo,
    startedAt: Date.now(),
  });
  input.onPhase?.("completed");
  return { activation: input.session.activation, session: input.session };
}

export async function abortPosRecoveryFlow(input: {
  adapter: PosRecoveryFrontendAdapter;
  coordinator: AuthRuntimeHandoffCoordinator;
  session: PosRecoveryFlowSession;
}) {
  await input.adapter.abort({
    recoveryCorrelationKey: input.session.handle.correlationKey,
    terminalId: input.session.terminalId,
    terminalProof: input.session.terminalProof,
  });
  input.coordinator.clearAfterConfirmedAbort(input.session.handle);
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
