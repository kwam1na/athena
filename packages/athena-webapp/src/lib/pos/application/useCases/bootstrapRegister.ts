import type {
  PosRegisterBootstrapDto,
  PosRegisterStateDto,
} from "../dto";

export function bootstrapRegister(input: {
  registerState: PosRegisterStateDto | undefined;
}): PosRegisterBootstrapDto | undefined {
  const registerState = input.registerState;

  if (registerState === undefined) {
    return undefined;
  }

  return {
    phase: registerState.phase,
    canStartSession: registerState.phase === "readyToStart",
    canResumeSession: registerState.phase === "resumable",
    terminal: registerState.terminal,
    cashier: registerState.cashier,
    activeSession: registerState.activeSession,
    resumableSession: registerState.resumableSession,
  };
}
