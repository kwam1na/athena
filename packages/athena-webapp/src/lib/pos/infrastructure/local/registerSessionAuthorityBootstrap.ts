import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";

import { createLocalCommandGateway } from "./localCommandGateway";

export type RegisterSessionAuthorityBootstrap = {
  cloudRegisterSessionId: string;
  expectedCash: number;
  localRegisterSessionId: string;
  observedAt?: number;
  openedAt: number;
  openingFloat: number;
  registerNumber?: string;
  staffProfileId?: string;
  status: "active" | "open";
};

export type RegisterSessionAuthorityBootstrapResult = {
  seeded: boolean;
  seedResult:
    | "already_seeded"
    | "gateway_rejected"
    | "missing_directive"
    | "missing_staff_identity"
    | "seeded";
};

/**
 * Projects cloud-owned register-session authority through the same local
 * command gateway used by runtime recovery. The resulting register.opened
 * event is already synced and remains terminal scoped.
 */
export async function seedRegisterSessionAuthorityBootstrap(input: {
  bootstrap: RegisterSessionAuthorityBootstrap | null;
  staffProfileId?: string | null;
  staffProofToken?: string | null;
  store: PosLocalStorePort;
  storeId: string;
  terminalId: string;
}): Promise<RegisterSessionAuthorityBootstrapResult> {
  if (!input.bootstrap) {
    return { seeded: false, seedResult: "missing_directive" };
  }
  const staffProfileId =
    input.staffProfileId ?? input.bootstrap.staffProfileId ?? null;
  if (!staffProfileId) {
    return { seeded: false, seedResult: "missing_staff_identity" };
  }

  let appended = false;
  const gateway = createLocalCommandGateway({
    allowExplicitRegisterSessionWithoutProjection: true,
    allowRegisterSessionSeedAfterSettledHistory: true,
    allowRegisterSessionSeedFromRuntimeDirective: true,
    onEventAppended: () => {
      appended = true;
    },
    staffProofToken:
      staffProfileId === input.staffProfileId
        ? (input.staffProofToken ?? undefined)
        : undefined,
    store: input.store,
  });
  const accepted = await gateway.seedRegisterSession({
    cloudRegisterSessionId: input.bootstrap.cloudRegisterSessionId,
    expectedCash: input.bootstrap.expectedCash,
    localRegisterSessionId: input.bootstrap.localRegisterSessionId,
    openingFloat: input.bootstrap.openingFloat,
    registerNumber: input.bootstrap.registerNumber,
    staffProfileId,
    storeId: input.storeId,
    terminalId: input.terminalId,
    validationMetadata: {
      flags: ["cloud-validation-uncertain"],
      observedAt: input.bootstrap.observedAt ?? Date.now(),
    },
    runtimeDirectiveRepair: true,
    status: input.bootstrap.status,
  });
  return {
    seeded: accepted && appended,
    seedResult: !accepted
      ? "gateway_rejected"
      : appended
        ? "seeded"
        : "already_seeded",
  };
}
