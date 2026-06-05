import type {
  PosDrawerAuthorityState,
  PosTerminalIntegrityState,
} from "./posLocalStore";

export type PosLocalSaleBlockReason =
  | "terminal_integrity"
  | "drawer_authority"
  | "missing_event_destination"
  | "missing_identity"
  | "drawer_closed";

export type PosLocalSaleBlocker = {
  reason: PosLocalSaleBlockReason;
};

export function deriveLocalSaleBlocker(input: {
  activeRegisterSession: {
    canReopen: boolean;
    localRegisterSessionId?: string | null;
    status?: string | null;
  } | null;
  drawerAuthority?: Pick<PosDrawerAuthorityState, "status"> | null;
  hasLocalEventDestination: boolean;
  hasRequiredIdentities: boolean;
  terminalIntegrity?: Pick<PosTerminalIntegrityState, "status"> | null;
}): PosLocalSaleBlocker | null {
  if (input.terminalIntegrity?.status !== undefined) {
    if (input.terminalIntegrity.status !== "healthy") {
      return { reason: "terminal_integrity" };
    }
  }

  if (!input.hasLocalEventDestination) {
    return { reason: "missing_event_destination" };
  }

  if (!input.hasRequiredIdentities) {
    return { reason: "missing_identity" };
  }

  if (input.drawerAuthority?.status === "blocked") {
    return { reason: "drawer_authority" };
  }

  if (
    input.activeRegisterSession?.status === "closing" &&
    !input.activeRegisterSession.canReopen
  ) {
    return { reason: "drawer_closed" };
  }

  return null;
}
