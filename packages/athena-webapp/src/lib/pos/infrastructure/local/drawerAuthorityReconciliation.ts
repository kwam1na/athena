import {
  createPosLocalStore,
  type PosDrawerAuthorityState,
  type PosLocalEventRecord,
  type PosLocalStoreResult,
} from "./posLocalStore";

type PosLocalRuntimeStore = ReturnType<typeof createPosLocalStore>;

type ReviewConflict = {
  localEventId?: string | null;
  summary?: string | null;
};

const REGISTER_NOT_OPEN_SYNC_REVIEW_SUMMARY =
  "Register was not open before this sale synced.";

export async function persistDrawerAuthorityBlockForReviewEvents(input: {
  events: PosLocalEventRecord[];
  reason: NonNullable<PosDrawerAuthorityState["reason"]>;
  reviewConflicts?: ReviewConflict[];
  reviewEventIds: string[];
  store: PosLocalRuntimeStore;
}) {
  const writeDrawerAuthorityState = (
    input.store as {
      writeDrawerAuthorityState?: PosLocalRuntimeStore["writeDrawerAuthorityState"];
    }
  ).writeDrawerAuthorityState;
  if (input.reviewEventIds.length === 0 || !writeDrawerAuthorityState) {
    return;
  }

  const reviewEventIds = new Set(input.reviewEventIds);
  const block = findDrawerAuthorityBlockForReview({
    events: input.events,
    reason: input.reason,
    reviewConflicts: input.reviewConflicts ?? [],
    reviewEventIds,
  });
  if (!block) return;

  const mappings = await input.store.listLocalCloudMappings?.();
  if (mappings && !mappings.ok) return;
  const cloudRegisterSessionId = mappings?.value.find(
    (mapping) =>
      mapping.entity === "registerSession" &&
      mapping.localId === block.event.localRegisterSessionId,
  )?.cloudId;

  const result = await writeDrawerAuthorityState({
    ...(cloudRegisterSessionId ? { cloudRegisterSessionId } : {}),
    localRegisterSessionId: block.event.localRegisterSessionId,
    message: block.message,
    observedAt: Date.now(),
    reason: block.reason,
    registerNumber: block.event.registerNumber,
    status: "blocked",
    storeId: block.event.storeId,
    terminalId: block.event.terminalId,
  });
  assertPosLocalStoreOk(result);
}

function findDrawerAuthorityBlockForReview(input: {
  events: PosLocalEventRecord[];
  reason: NonNullable<PosDrawerAuthorityState["reason"]>;
  reviewConflicts: ReviewConflict[];
  reviewEventIds: Set<string>;
}): {
  event: PosLocalEventRecord & { localRegisterSessionId: string };
  message: string;
  reason: NonNullable<PosDrawerAuthorityState["reason"]>;
} | null {
  const registerNotOpenConflictEventIds = new Set(
    input.reviewConflicts
      .filter(
        (conflict) =>
          conflict.summary === REGISTER_NOT_OPEN_SYNC_REVIEW_SUMMARY &&
          conflict.localEventId &&
          input.reviewEventIds.has(conflict.localEventId),
      )
      .map((conflict) => conflict.localEventId as string),
  );
  if (registerNotOpenConflictEventIds.size > 0) {
    const event = input.events.find(
      (candidate) =>
        registerNotOpenConflictEventIds.has(candidate.localEventId) &&
        candidate.localRegisterSessionId,
    );
    if (event?.localRegisterSessionId) {
      return {
        event: event as PosLocalEventRecord & { localRegisterSessionId: string },
        message:
          "The mapped cloud register is closed. Open a register before selling.",
        reason: "cloud_closed",
      };
    }
  }

  const event = input.events.find(
    (candidate) =>
      input.reviewEventIds.has(candidate.localEventId) &&
      isDrawerAuthorityLifecycleEvent(candidate) &&
      candidate.localRegisterSessionId,
  );
  if (!event?.localRegisterSessionId) return null;

  return {
    event: event as PosLocalEventRecord & { localRegisterSessionId: string },
    message: "Cloud sync needs review before this local drawer can continue.",
    reason: input.reason,
  };
}

export async function clearRecoverableDrawerAuthorityForSyncedEvents(input: {
  events: PosLocalEventRecord[];
  reviewEventIds: string[];
  store: PosLocalRuntimeStore;
  syncedEventIds: string[];
}) {
  const clearDrawerAuthorityState = (
    input.store as {
      clearDrawerAuthorityState?: PosLocalRuntimeStore["clearDrawerAuthorityState"];
    }
  ).clearDrawerAuthorityState;
  const readDrawerAuthorityState = (
    input.store as {
      readDrawerAuthorityState?: PosLocalRuntimeStore["readDrawerAuthorityState"];
    }
  ).readDrawerAuthorityState;
  if (
    !clearDrawerAuthorityState ||
    !readDrawerAuthorityState ||
    input.syncedEventIds.length === 0
  ) {
    return;
  }

  const syncedEventIds = new Set(input.syncedEventIds);
  const reviewEventIds = new Set(input.reviewEventIds);
  const remainingReviewDrawers = new Set(
    input.events
      .filter(
        (event) =>
          ((event.sync.status === "needs_review" && event.sync.uploaded) ||
            reviewEventIds.has(event.localEventId)) &&
          !syncedEventIds.has(event.localEventId) &&
          event.localRegisterSessionId &&
          isDrawerAuthorityLifecycleEvent(event),
      )
      .map((event) =>
        drawerAuthorityEventKey({
          localRegisterSessionId: event.localRegisterSessionId!,
          storeId: event.storeId,
          terminalId: event.terminalId,
        }),
      ),
  );
  const cleared = new Set<string>();
  for (const event of input.events) {
    if (
      !syncedEventIds.has(event.localEventId) ||
      !event.localRegisterSessionId ||
      !isDrawerAuthorityLifecycleEvent(event)
    ) {
      continue;
    }

    const key = drawerAuthorityEventKey({
      localRegisterSessionId: event.localRegisterSessionId,
      storeId: event.storeId,
      terminalId: event.terminalId,
    });
    if (remainingReviewDrawers.has(key)) continue;
    if (cleared.has(key)) continue;
    cleared.add(key);

    const drawerAuthority = await readDrawerAuthorityState({
      localRegisterSessionId: event.localRegisterSessionId,
      storeId: event.storeId,
      terminalId: event.terminalId,
    });
    assertPosLocalStoreOk(drawerAuthority);
    if (!isRecoverableDrawerAuthorityReason(drawerAuthority.value?.reason)) {
      continue;
    }

    const result: PosLocalStoreResult<null> = await clearDrawerAuthorityState({
      localRegisterSessionId: event.localRegisterSessionId,
      storeId: event.storeId,
      terminalId: event.terminalId,
    });
    assertPosLocalStoreOk(result);
  }
}

export async function clearSupersededRecoverableDrawerAuthorityBlocks(input: {
  acceptedEvents: Array<{
    localEventId: string;
    status: string;
  }>;
  events: PosLocalEventRecord[];
  returnedMappings: Array<{
    cloudId: string;
    localId: string;
    localIdKind: string;
  }>;
  store: PosLocalRuntimeStore;
}) {
  const clearDrawerAuthorityState = (
    input.store as {
      clearDrawerAuthorityState?: PosLocalRuntimeStore["clearDrawerAuthorityState"];
    }
  ).clearDrawerAuthorityState;
  const readDrawerAuthorityState = (
    input.store as {
      readDrawerAuthorityState?: PosLocalRuntimeStore["readDrawerAuthorityState"];
    }
  ).readDrawerAuthorityState;
  const listLocalCloudMappings = (
    input.store as {
      listLocalCloudMappings?: PosLocalRuntimeStore["listLocalCloudMappings"];
    }
  ).listLocalCloudMappings;
  if (
    !clearDrawerAuthorityState ||
    !readDrawerAuthorityState ||
    !listLocalCloudMappings
  ) {
    return;
  }

  const acceptedProjectedEventIds = new Set(
    input.acceptedEvents
      .filter((event) => event.status === "projected")
      .map((event) => event.localEventId),
  );
  const replacementDrawerOpenings = input.returnedMappings
    .filter((mapping) => mapping.localIdKind === "registerSession")
    .map((mapping) => {
      const event = input.events.find(
        (candidate) =>
          candidate.type === "register.opened" &&
          candidate.localRegisterSessionId === mapping.localId &&
          acceptedProjectedEventIds.has(candidate.localEventId),
      );
      return event
        ? {
            cloudRegisterSessionId: mapping.cloudId,
            event,
          }
        : null;
    })
    .filter(
      (entry): entry is {
        cloudRegisterSessionId: string;
        event: PosLocalEventRecord;
      } => Boolean(entry),
    );
  if (replacementDrawerOpenings.length === 0) {
    return;
  }

  const mappings = await listLocalCloudMappings();
  assertPosLocalStoreOk(mappings);

  for (const replacement of replacementDrawerOpenings) {
    const supersededRegisterSessionIds = mappings.value
      .filter(
        (mapping) =>
          mapping.entity === "registerSession" &&
          mapping.cloudId === replacement.cloudRegisterSessionId &&
          mapping.localId !== replacement.event.localRegisterSessionId,
      )
      .map((mapping) => mapping.localId);
    const uniqueSupersededRegisterSessionIds = [
      ...new Set(supersededRegisterSessionIds),
    ];

    for (const localRegisterSessionId of uniqueSupersededRegisterSessionIds) {
      const terminalIds = [
        ...new Set(
          input.events
            .filter(
              (event) =>
                event.storeId === replacement.event.storeId &&
                event.localRegisterSessionId === localRegisterSessionId,
            )
            .map((event) => event.terminalId),
        ),
      ];
      for (const terminalId of terminalIds) {
        const drawerAuthority: PosLocalStoreResult<PosDrawerAuthorityState | null> =
          await readDrawerAuthorityState({
            localRegisterSessionId,
            storeId: replacement.event.storeId,
            terminalId,
          });
        assertPosLocalStoreOk(drawerAuthority);
        if (
          drawerAuthority.value?.status !== "blocked" ||
          !isRecoverableDrawerAuthorityReason(drawerAuthority.value.reason) ||
          drawerAuthority.value.observedAt > replacement.event.createdAt ||
          (drawerAuthority.value.cloudRegisterSessionId &&
            drawerAuthority.value.cloudRegisterSessionId !==
              replacement.cloudRegisterSessionId)
        ) {
          continue;
        }

        const result: PosLocalStoreResult<null> = await clearDrawerAuthorityState({
          localRegisterSessionId,
          storeId: replacement.event.storeId,
          terminalId,
        });
        assertPosLocalStoreOk(result);
      }
    }
  }
}

export async function clearSettledRecoverableDrawerAuthorityBlock(input: {
  drawerAuthority: PosDrawerAuthorityState;
  events: PosLocalEventRecord[];
  store: PosLocalRuntimeStore;
}): Promise<PosLocalStoreResult<boolean>> {
  const clearDrawerAuthorityState = (
    input.store as {
      clearDrawerAuthorityState?: PosLocalRuntimeStore["clearDrawerAuthorityState"];
    }
  ).clearDrawerAuthorityState;
  if (
    !clearDrawerAuthorityState ||
    input.drawerAuthority.status !== "blocked" ||
    !isRecoverableDrawerAuthorityReason(input.drawerAuthority.reason)
  ) {
    return { ok: true, value: false };
  }

  const drawerLifecycleEvents = input.events.filter(
    (event) =>
      event.localRegisterSessionId ===
        input.drawerAuthority.localRegisterSessionId &&
      event.storeId === input.drawerAuthority.storeId &&
      event.terminalId === input.drawerAuthority.terminalId &&
      isDrawerAuthorityLifecycleEvent(event),
  );
  if (drawerLifecycleEvents.length === 0) {
    return { ok: true, value: false };
  }

  const hasUnsettledLifecycleEvent = drawerLifecycleEvents.some(
    (event) => event.sync.status !== "synced",
  );
  if (hasUnsettledLifecycleEvent) {
    return { ok: true, value: false };
  }

  const hasRemainingLifecycleReview = drawerLifecycleEvents.some(
    (event) => event.sync.status === "needs_review" && event.sync.uploaded,
  );
  if (hasRemainingLifecycleReview) {
    return { ok: true, value: false };
  }

  const result = await clearDrawerAuthorityState({
    localRegisterSessionId: input.drawerAuthority.localRegisterSessionId,
    storeId: input.drawerAuthority.storeId,
    terminalId: input.drawerAuthority.terminalId,
  });
  if (!result.ok) return result;

  return { ok: true, value: true };
}

export async function readLatestRuntimeDrawerAuthorityState(input: {
  localRegisterSessionId: string;
  readDrawerAuthorityState: NonNullable<
    PosLocalRuntimeStore["readDrawerAuthorityState"]
  >;
  storeId: string;
  terminalIds: Set<string>;
}): Promise<PosLocalStoreResult<PosDrawerAuthorityState | null>> {
  if (input.terminalIds.size === 0) {
    return { ok: true, value: null };
  }

  const states: PosDrawerAuthorityState[] = [];
  for (const terminalId of input.terminalIds) {
    const result = await input.readDrawerAuthorityState({
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

export function isRecoverableDrawerAuthorityReason(
  reason: PosDrawerAuthorityState["reason"] | undefined,
) {
  return reason === "lifecycle_rejected" || reason === "authority_unknown";
}

function drawerAuthorityEventKey(input: {
  localRegisterSessionId: string;
  storeId: string;
  terminalId: string;
}) {
  return `${input.storeId}:${input.terminalId}:${input.localRegisterSessionId}`;
}

export function isDrawerAuthorityLifecycleEvent(event: PosLocalEventRecord) {
  return (
    event.type === "register.opened" ||
    event.type === "register.closeout_started" ||
    event.type === "register.reopened"
  );
}

function assertPosLocalStoreOk<T>(
  result: PosLocalStoreResult<T>,
): asserts result is { ok: true; value: T } {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
}
