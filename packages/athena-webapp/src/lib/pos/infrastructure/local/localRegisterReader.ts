import {
  projectLocalRegisterReadModel,
  type PosLocalRegisterReadModel,
} from "./registerReadModel";
import type {
  PosDrawerAuthorityState,
  PosLocalCloudMapping,
  PosLocalEventRecord,
  PosLocalStoreResult,
  PosTerminalIntegrityState,
  PosProvisionedTerminalSeed,
} from "./posLocalStore";
import {
  isPosLocalEventInTerminalScope,
  resolvePosLocalTerminalScope,
  type PosLocalTerminalDescriptor,
} from "./terminalScope";

export type PosLocalRegisterReaderStore = {
  listEvents(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  listLocalCloudMappings?(): Promise<PosLocalStoreResult<PosLocalCloudMapping[]>>;
  readDrawerAuthorityState?(input: {
    localRegisterSessionId: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosDrawerAuthorityState | null>>;
  readProvisionedTerminalSeed?(): Promise<
    PosLocalStoreResult<PosProvisionedTerminalSeed | null>
  >;
  readTerminalIntegrityState?(input: {
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosTerminalIntegrityState | null>>;
};

export async function readScopedPosLocalEvents(input: {
  store: PosLocalRegisterReaderStore;
  storeId?: string | null;
  terminal?: PosLocalTerminalDescriptor | null;
  terminalId?: string | null;
}): Promise<
  PosLocalStoreResult<{
    events: PosLocalEventRecord[];
    terminalSeed: PosProvisionedTerminalSeed | null;
  }>
> {
  const [events, terminalSeed] = await Promise.all([
    input.store.listEvents(),
    input.store.readProvisionedTerminalSeed
      ? input.store.readProvisionedTerminalSeed()
      : ({ ok: true, value: null } as const),
  ]);
  if (!events.ok) return events;
  if (!terminalSeed.ok) return terminalSeed;

  const scope = resolvePosLocalTerminalScope({
    storeId: input.storeId,
    terminal: input.terminal,
    terminalId: input.terminalId,
    terminalSeed: terminalSeed.value,
  });

  return {
    ok: true,
    value: {
      events: events.value.filter((event) =>
        isPosLocalEventInTerminalScope(event, scope),
      ),
      terminalSeed: scope.provisionedSeed,
    },
  };
}

export async function readProjectedLocalRegisterModel(input: {
  store: PosLocalRegisterReaderStore;
  storeId?: string | null;
  terminal?: PosLocalTerminalDescriptor | null;
  terminalId?: string | null;
  isOnline?: boolean;
}): Promise<PosLocalStoreResult<PosLocalRegisterReadModel>> {
  const scoped = await readScopedPosLocalEvents(input);
  if (!scoped.ok) return scoped;

  const mappings = input.store.listLocalCloudMappings
    ? await input.store.listLocalCloudMappings()
    : ({
        ok: true,
        value: [] as PosLocalCloudMapping[],
      } as const);
  if (!mappings.ok) return mappings;
  const scope = resolvePosLocalTerminalScope({
    storeId: input.storeId,
    terminal: input.terminal,
    terminalId: input.terminalId,
    terminalSeed: scoped.value.terminalSeed,
  });
  const scopedTerminalId =
    scoped.value.terminalSeed?.terminalId ??
    input.terminal?.localTerminalId ??
    input.terminalId ??
    input.terminal?._id ??
    null;
  const terminalIntegrity =
    input.store.readTerminalIntegrityState && scope.storeId && scopedTerminalId
      ? await input.store.readTerminalIntegrityState({
          storeId: scope.storeId,
          terminalId: scopedTerminalId,
        })
      : ({ ok: true, value: null } as const);
  if (!terminalIntegrity.ok) return terminalIntegrity;

  const baseModel = projectLocalRegisterReadModel({
    events: scoped.value.events,
    terminalSeed: scoped.value.terminalSeed,
    mappings: mappings.value,
    isOnline: input.isOnline,
    terminalIntegrity: terminalIntegrity.value,
  });
  const activeLocalRegisterSessionId =
    baseModel.activeRegisterSession?.localRegisterSessionId;
  const drawerAuthority =
    input.store.readDrawerAuthorityState &&
    scope.storeId &&
    activeLocalRegisterSessionId
      ? await readLatestDrawerAuthorityState({
          localRegisterSessionId: activeLocalRegisterSessionId,
          store: input.store,
          storeId: scope.storeId,
          terminalIds: scope.terminalIds,
        })
      : ({ ok: true, value: null } as const);
  if (!drawerAuthority.ok) return drawerAuthority;

  return {
    ok: true,
    value: projectLocalRegisterReadModel({
      events: scoped.value.events,
      terminalSeed: scoped.value.terminalSeed,
      mappings: mappings.value,
      isOnline: input.isOnline,
      drawerAuthority: drawerAuthority.value,
      terminalIntegrity: terminalIntegrity.value,
    }),
  };
}

async function readLatestDrawerAuthorityState(input: {
  localRegisterSessionId: string;
  store: PosLocalRegisterReaderStore;
  storeId: string;
  terminalIds: Set<string>;
}): Promise<PosLocalStoreResult<PosDrawerAuthorityState | null>> {
  if (!input.store.readDrawerAuthorityState || input.terminalIds.size === 0) {
    return { ok: true, value: null };
  }

  const states: PosDrawerAuthorityState[] = [];
  for (const terminalId of input.terminalIds) {
    const result = await input.store.readDrawerAuthorityState({
      localRegisterSessionId: input.localRegisterSessionId,
      storeId: input.storeId,
      terminalId,
    });
    if (!result.ok) return result;
    if (result.value) states.push(result.value);
  }

  return {
    ok: true,
    value:
      states.sort((left, right) => right.observedAt - left.observedAt).at(0) ??
      null,
  };
}
