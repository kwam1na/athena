import {
  projectLocalRegisterReadModel,
  type PosLocalRegisterReadModel,
} from "./registerReadModel";
import type {
  PosLocalCloudMapping,
  PosLocalEventRecord,
  PosLocalStoreResult,
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
  readProvisionedTerminalSeed?(): Promise<
    PosLocalStoreResult<PosProvisionedTerminalSeed | null>
  >;
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

  return {
    ok: true,
    value: projectLocalRegisterReadModel({
      events: scoped.value.events,
      terminalSeed: scoped.value.terminalSeed,
      mappings: mappings.value,
      isOnline: input.isOnline,
    }),
  };
}
