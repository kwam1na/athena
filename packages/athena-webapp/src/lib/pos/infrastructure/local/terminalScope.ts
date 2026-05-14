import type { PosLocalEventRecord, PosProvisionedTerminalSeed } from "./posLocalStore";

export type PosLocalTerminalDescriptor = {
  _id?: string | null;
  cloudTerminalId?: string | null;
  localTerminalId?: string | null;
};

export type PosLocalTerminalScope = {
  storeId?: string;
  terminalIds: Set<string>;
  provisionedSeed: PosProvisionedTerminalSeed | null;
};

export function resolvePosLocalTerminalScope(input: {
  storeId?: string | null;
  terminal?: PosLocalTerminalDescriptor | null;
  terminalId?: string | null;
  terminalSeed?: PosProvisionedTerminalSeed | null;
}): PosLocalTerminalScope {
  const requestedStoreId = input.storeId ?? input.terminalSeed?.storeId;
  const requestedTerminalId = input.terminalId ?? input.terminal?._id ?? null;
  const provisionedSeed =
    input.terminalSeed &&
    (!requestedStoreId || input.terminalSeed.storeId === requestedStoreId) &&
    (!requestedTerminalId ||
      input.terminalSeed.cloudTerminalId === requestedTerminalId ||
      input.terminalSeed.terminalId === requestedTerminalId)
      ? input.terminalSeed
      : null;

  const terminalIds = new Set(
    [
      requestedTerminalId,
      input.terminal?._id,
      input.terminal?.cloudTerminalId,
      input.terminal?.localTerminalId,
      provisionedSeed?.cloudTerminalId,
      provisionedSeed?.terminalId,
    ].filter((value): value is string => Boolean(value)),
  );

  return {
    storeId: requestedStoreId ?? undefined,
    terminalIds,
    provisionedSeed,
  };
}

export function isPosLocalEventInTerminalScope(
  event: PosLocalEventRecord,
  scope: PosLocalTerminalScope,
) {
  const storeMatches = !scope.storeId || event.storeId === scope.storeId;
  const terminalMatches =
    scope.terminalIds.size === 0 || scope.terminalIds.has(event.terminalId);
  return storeMatches && terminalMatches;
}
