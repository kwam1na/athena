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
    canStartSession:
      registerState.phase === "readyToStart" &&
      Boolean(registerState.activeRegisterSession),
    canResumeSession:
      registerState.phase === "resumable" &&
      Boolean(registerState.activeRegisterSession),
    terminal: registerState.terminal,
    cashier: registerState.cashier,
    activeRegisterSession: registerState.activeRegisterSession,
    activeSession: registerState.activeSession,
    resumableSession: registerState.resumableSession,
  };
}
