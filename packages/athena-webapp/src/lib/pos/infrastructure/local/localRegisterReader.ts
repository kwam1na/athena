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
} from "@/lib/pos/application/posLocalStoreTypes";
import type { PosLocalOpaqueContinuation } from "@/lib/pos/application/posLocalStoreTypes";
import {
  isPosLocalEventInTerminalScope,
  resolvePosLocalTerminalScope,
  type PosLocalTerminalScope,
  type PosLocalTerminalDescriptor,
} from "./terminalScope";

export type PosLocalRegisterReaderStore = {
  listEvents(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  listLocalCloudMappings?(): Promise<
    PosLocalStoreResult<PosLocalCloudMapping[]>
  >;
  readLocalCloudMapping?(input: {
    entity: PosLocalCloudMapping["entity"];
    localId: string;
  }): Promise<PosLocalStoreResult<PosLocalCloudMapping | null>>;
  readEventHistoryPage?(input: {
    continuation?: PosLocalOpaqueContinuation;
    limit: number;
    storeId: string;
    terminalId: string;
  }): Promise<
    PosLocalStoreResult<{
      continuation?: PosLocalOpaqueContinuation;
      items: PosLocalEventRecord[];
    }>
  >;
  readMappingPage?(input: {
    continuation?: PosLocalOpaqueContinuation;
    limit: number;
    storeId: string;
    terminalId: string;
  }): Promise<
    PosLocalStoreResult<{
      continuation?: PosLocalOpaqueContinuation;
      items: PosLocalCloudMapping[];
    }>
  >;
  readDrawerAuthorityState?(input: {
    cloudRegisterSessionId?: string;
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
  const terminalSeed = input.store.readProvisionedTerminalSeed
    ? await input.store.readProvisionedTerminalSeed()
    : ({ ok: true, value: null } as const);
  if (!terminalSeed.ok) return terminalSeed;

  const scope = resolvePosLocalTerminalScope({
    storeId: input.storeId,
    terminal: input.terminal,
    terminalId: input.terminalId,
    terminalSeed: terminalSeed.value,
  });
  const events = await readScopedPagesOrFallback({
    fallback: () => input.store.listEvents(),
    identity: (event) => event.localEventId,
    page: input.store.readEventHistoryPage
      ? (pageInput) => input.store.readEventHistoryPage!(pageInput)
      : undefined,
    scope,
  });
  if (!events.ok) return events;

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

  const scope = resolvePosLocalTerminalScope({
    storeId: input.storeId,
    terminal: input.terminal,
    terminalId: input.terminalId,
    terminalSeed: scoped.value.terminalSeed,
  });
  const mappings = await readScopedPagesOrFallback({
    fallback: input.store.listLocalCloudMappings
      ? () => input.store.listLocalCloudMappings!()
      : async () => ({
          ok: true as const,
          value: [] as PosLocalCloudMapping[],
        }),
    identity: (mapping) => `${mapping.entity}:${mapping.localId}`,
    page: input.store.readMappingPage
      ? (pageInput) => input.store.readMappingPage!(pageInput)
      : undefined,
    scope,
  });
  if (!mappings.ok) return mappings;
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

  let projectionMappings = mappings.value;
  let baseModel = projectLocalRegisterReadModel({
    events: scoped.value.events,
    terminalSeed: scoped.value.terminalSeed,
    mappings: projectionMappings,
    isOnline: input.isOnline,
    terminalIntegrity: terminalIntegrity.value,
  });
  const activeLocalRegisterSessionId =
    baseModel.activeRegisterSession?.localRegisterSessionId;
  if (
    activeLocalRegisterSessionId &&
    input.store.readLocalCloudMapping &&
    !projectionMappings.some(
      (mapping) =>
        mapping.entity === "registerSession" &&
        mapping.localId === activeLocalRegisterSessionId,
    )
  ) {
    const legacyMapping = await input.store.readLocalCloudMapping({
      entity: "registerSession",
      localId: activeLocalRegisterSessionId,
    });
    if (!legacyMapping.ok) return legacyMapping;
    if (legacyMapping.value) {
      projectionMappings = [...projectionMappings, legacyMapping.value];
      baseModel = projectLocalRegisterReadModel({
        events: scoped.value.events,
        terminalSeed: scoped.value.terminalSeed,
        mappings: projectionMappings,
        isOnline: input.isOnline,
        terminalIntegrity: terminalIntegrity.value,
      });
    }
  }
  const activeCloudRegisterSessionId =
    baseModel.activeRegisterSession?.cloudRegisterSessionId;
  const drawerAuthority =
    input.store.readDrawerAuthorityState &&
    scope.storeId &&
    activeLocalRegisterSessionId
      ? await readLatestDrawerAuthorityState({
          cloudRegisterSessionId: activeCloudRegisterSessionId,
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
      mappings: projectionMappings,
      isOnline: input.isOnline,
      drawerAuthority: drawerAuthority.value,
      terminalIntegrity: terminalIntegrity.value,
    }),
  };
}

async function readScopedPagesOrFallback<T>(input: {
  fallback: () => Promise<PosLocalStoreResult<T[]>>;
  identity: (item: T) => string;
  page?: (pageInput: {
    continuation?: PosLocalOpaqueContinuation;
    limit: number;
    storeId: string;
    terminalId: string;
  }) => Promise<
    PosLocalStoreResult<{
      continuation?: PosLocalOpaqueContinuation;
      items: T[];
    }>
  >;
  scope: PosLocalTerminalScope;
}): Promise<PosLocalStoreResult<T[]>> {
  if (
    !input.page ||
    !input.scope.storeId ||
    input.scope.terminalIds.size === 0
  ) {
    return input.fallback();
  }

  const items = new Map<string, T>();
  for (const terminalId of input.scope.terminalIds) {
    let continuation: PosLocalOpaqueContinuation | undefined;
    const visitedContinuations = new Set<string>();
    do {
      const result = await input.page({
        ...(continuation ? { continuation } : {}),
        limit: 250,
        storeId: input.scope.storeId,
        terminalId,
      });
      if (!result.ok) return result;
      for (const item of result.value.items) {
        items.set(input.identity(item), item);
      }

      continuation = result.value.continuation;
      if (continuation) {
        if (visitedContinuations.has(continuation)) {
          return {
            ok: false,
            error: {
              code: "read_failed",
              message: "POS local storage returned a repeated continuation.",
            },
          };
        }
        visitedContinuations.add(continuation);
      }
    } while (continuation);
  }

  return { ok: true, value: [...items.values()] };
}

async function readLatestDrawerAuthorityState(input: {
  cloudRegisterSessionId?: string;
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
      ...(input.cloudRegisterSessionId
        ? { cloudRegisterSessionId: input.cloudRegisterSessionId }
        : {}),
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
