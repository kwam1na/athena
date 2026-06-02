import { createContext, useContext } from "react";

import type { PosTerminalRuntimeAppSessionRecoveryInput } from "../local/terminalRuntimeStatus";
import type { PosTerminalAppSessionRecoveryState } from "./usePosTerminalAppSessionRecovery";

const PosTerminalAppSessionRecoveryContext =
  createContext<PosTerminalRuntimeAppSessionRecoveryInput | null>(null);

export const PosTerminalAppSessionRecoveryProvider =
  PosTerminalAppSessionRecoveryContext.Provider;

export function usePosTerminalAppSessionRecoveryRuntimeInput() {
  return useContext(PosTerminalAppSessionRecoveryContext);
}

export function toPosTerminalAppSessionRecoveryRuntimeInput(
  state: PosTerminalAppSessionRecoveryState,
): PosTerminalRuntimeAppSessionRecoveryInput {
  return {
    assertion: state.assertion ? "present" : null,
    reason: state.reason,
    status: state.status,
  };
}
