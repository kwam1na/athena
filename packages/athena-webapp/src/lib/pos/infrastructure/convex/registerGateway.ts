import { useQuery } from "convex/react";

import type {
  PosRegisteredTerminalDto,
  PosRegisterStateDto,
  PosRegisterStateQueryInput,
  PosTerminalLookupInput,
} from "@/lib/pos/application/dto";
import type { PosRegisterReader } from "@/lib/pos/application/ports";
import { api } from "~/convex/_generated/api";

export function mapRegisterStateDto(
  dto: PosRegisterStateDto,
): PosRegisterStateDto {
  return {
    phase: dto.phase,
    terminal: dto.terminal ? { ...dto.terminal } : null,
    cashier: dto.cashier ? { ...dto.cashier } : null,
    activeSession: dto.activeSession ? { ...dto.activeSession } : null,
    resumableSession: dto.resumableSession ? { ...dto.resumableSession } : null,
  };
}

export function mapTerminalDto(
  dto: PosRegisteredTerminalDto | null,
): PosRegisteredTerminalDto | null {
  return dto ? { ...dto } : null;
}

export function useConvexRegisterState(
  input: PosRegisterStateQueryInput,
): PosRegisterStateDto | undefined {
  const result = useQuery(
    api.pos.public.register.getState,
    input.storeId
      ? {
          storeId: input.storeId,
          terminalId: input.terminalId ?? undefined,
          cashierId: input.cashierId ?? undefined,
          registerNumber: input.registerNumber,
        }
      : "skip",
  );

  if (result === undefined) {
    return undefined;
  }

  return mapRegisterStateDto(result);
}

export function useConvexTerminalByFingerprint(
  input: PosTerminalLookupInput,
): PosRegisteredTerminalDto | null | undefined {
  const result = useQuery(
    api.pos.public.terminals.getTerminalByFingerprint,
    input.storeId && input.fingerprintHash
      ? {
          storeId: input.storeId,
          fingerprintHash: input.fingerprintHash,
        }
      : "skip",
  );

  if (result === undefined) {
    return undefined;
  }

  return mapTerminalDto(result);
}

export const convexRegisterReader: PosRegisterReader = {
  useRegisterState: useConvexRegisterState,
  useTerminal: useConvexTerminalByFingerprint,
};
