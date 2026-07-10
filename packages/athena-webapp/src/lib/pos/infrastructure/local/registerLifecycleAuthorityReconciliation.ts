export type PosRegisterAuthorityCursor = {
  lifecycleRevision: number;
  mappingAuthorityRevision: number;
};

export type PosRegisterLifecycleServerAuthority = {
  classification: "sale_usable" | "sale_blocked" | "repair_required";
  cloudRegisterSessionId?: string;
  cursor?: PosRegisterAuthorityCursor;
  message?: string;
  observedAt: number;
  reason?: "cloud_closed" | "authority_unknown";
  source: "dedicated_snapshot" | "legacy_runtime_directive";
  status: "healthy" | "blocked";
};

export type PosRegisterLifecycleAuthorityObservation =
  PosRegisterLifecycleServerAuthority & {
    localRegisterSessionId: string;
    registerNumber?: string;
  };

export type PosRegisterLifecycleAuthorityReconciliation =
  | {
      disposition: "applied";
      reason: "committed";
      value: PosRegisterLifecycleServerAuthority;
    }
  | {
      disposition: "noop";
      reason: "duplicate" | "lower_confidence" | "stale";
    }
  | {
      disposition: "rejected";
      reason: "cursor_conflict";
    };

export function reconcileRegisterLifecycleServerAuthority(
  current: PosRegisterLifecycleServerAuthority | null | undefined,
  incoming: PosRegisterLifecycleServerAuthority,
): PosRegisterLifecycleAuthorityReconciliation {
  if (incoming.source === "dedicated_snapshot" && !isVersioned(incoming)) {
    return { disposition: "rejected", reason: "cursor_conflict" };
  }
  if (!current) {
    return { disposition: "applied", reason: "committed", value: incoming };
  }

  const currentVersioned = isVersioned(current);
  const incomingVersioned = isVersioned(incoming);
  if (currentVersioned && !incomingVersioned) {
    return { disposition: "noop", reason: "lower_confidence" };
  }
  if (!currentVersioned && incomingVersioned) {
    return { disposition: "applied", reason: "committed", value: incoming };
  }

  if (!currentVersioned || !incomingVersioned) {
    return sameAuthorityPayload(current, incoming)
      ? { disposition: "noop", reason: "duplicate" }
      : { disposition: "noop", reason: "lower_confidence" };
  }

  if (
    incoming.cursor.mappingAuthorityRevision <
    current.cursor.mappingAuthorityRevision
  ) {
    return { disposition: "noop", reason: "stale" };
  }
  if (
    incoming.cursor.mappingAuthorityRevision >
    current.cursor.mappingAuthorityRevision
  ) {
    return { disposition: "applied", reason: "committed", value: incoming };
  }
  if (incoming.cloudRegisterSessionId !== current.cloudRegisterSessionId) {
    return { disposition: "rejected", reason: "cursor_conflict" };
  }
  if (incoming.cursor.lifecycleRevision < current.cursor.lifecycleRevision) {
    return { disposition: "noop", reason: "stale" };
  }
  if (incoming.cursor.lifecycleRevision > current.cursor.lifecycleRevision) {
    return { disposition: "applied", reason: "committed", value: incoming };
  }

  return sameAuthorityPayload(current, incoming)
    ? { disposition: "noop", reason: "duplicate" }
    : { disposition: "rejected", reason: "cursor_conflict" };
}

function isVersioned(
  authority: PosRegisterLifecycleServerAuthority,
): authority is PosRegisterLifecycleServerAuthority & {
  cursor: PosRegisterAuthorityCursor;
} {
  return Boolean(
    authority.source === "dedicated_snapshot" &&
    authority.cursor &&
    Number.isSafeInteger(authority.cursor.mappingAuthorityRevision) &&
    authority.cursor.mappingAuthorityRevision >= 0 &&
    Number.isSafeInteger(authority.cursor.lifecycleRevision) &&
    authority.cursor.lifecycleRevision >= 0,
  );
}

function sameAuthorityPayload(
  left: PosRegisterLifecycleServerAuthority,
  right: PosRegisterLifecycleServerAuthority,
) {
  return (
    left.classification === right.classification &&
    left.cloudRegisterSessionId === right.cloudRegisterSessionId &&
    left.reason === right.reason &&
    left.source === right.source &&
    left.status === right.status
  );
}
