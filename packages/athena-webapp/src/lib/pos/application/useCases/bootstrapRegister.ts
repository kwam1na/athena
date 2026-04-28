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

  const hasUsableRegisterSession =
    registerState.activeRegisterSession?.status === "open" ||
    registerState.activeRegisterSession?.status === "active";

  return {
    phase: registerState.phase,
    canStartSession:
      registerState.phase === "readyToStart" && hasUsableRegisterSession,
    canResumeSession:
      registerState.phase === "resumable" && hasUsableRegisterSession,
    terminal: registerState.terminal,
    cashier: registerState.cashier,
    activeRegisterSession: registerState.activeRegisterSession,
    activeSession: registerState.activeSession,
    resumableSession: registerState.resumableSession,
  };
}
