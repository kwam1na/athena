import type { PosLocalCloudMapping } from "./posLocalStore";

export const MAX_REGISTER_LIFECYCLE_AUTHORITY_CANDIDATES = 16;
export const MAX_REGISTER_LIFECYCLE_AUTHORITY_ID_LENGTH = 120;

export type RegisterLifecycleAuthorityCandidate = {
  cloudRegisterSessionId?: string;
  expectedMapping?: {
    cloudRegisterSessionId?: string;
    mappedAt?: number;
    mappingAuthorityRevision?: number;
    registerCandidateState?: "current" | "historical";
    registerNumber?: string;
    storeId?: string;
    terminalId?: string;
  };
  localRegisterSessionId: string;
};

export type RegisterLifecycleAuthorityCandidateState =
  | {
      candidates: RegisterLifecycleAuthorityCandidate[];
      status: "ready";
    }
  | { candidates: []; status: "empty" }
  | {
      reason: "ambiguous" | "malformed" | "overflow";
      status: "invalid";
    }
  | { status: "loading" };

type CandidateProjection = {
  activeRegisterSession: {
    cloudRegisterSessionId?: string;
    localRegisterSessionId: string;
  } | null;
  mappings?: PosLocalCloudMapping[];
  sourceEvents: Array<{
    localRegisterSessionId?: string;
    sync: { status: string };
    type: string;
  }>;
};

export function deriveRegisterLifecycleAuthorityCandidates(input: {
  projection: CandidateProjection;
  registerNumber?: string;
  storeId: string;
  terminalId: string;
}): RegisterLifecycleAuthorityCandidateState {
  const candidates = new Map<string, RegisterLifecycleAuthorityCandidate>();
  let invalidReason: "ambiguous" | "malformed" | "overflow" | null = null;

  function add(candidate: RegisterLifecycleAuthorityCandidate) {
    if (invalidReason) return;
    if (
      !isBoundedIdentifier(candidate.localRegisterSessionId) ||
      (candidate.cloudRegisterSessionId !== undefined &&
        !isBoundedIdentifier(candidate.cloudRegisterSessionId))
    ) {
      invalidReason = "malformed";
      return;
    }

    const existing = candidates.get(candidate.localRegisterSessionId);
    if (
      existing?.cloudRegisterSessionId &&
      candidate.cloudRegisterSessionId &&
      existing.cloudRegisterSessionId !== candidate.cloudRegisterSessionId
    ) {
      invalidReason = "ambiguous";
      return;
    }
    const cloudRegisterSessionId =
      candidate.cloudRegisterSessionId ?? existing?.cloudRegisterSessionId;
    const expectedMapping =
      candidate.expectedMapping ?? existing?.expectedMapping;
    candidates.set(candidate.localRegisterSessionId, {
      ...(cloudRegisterSessionId ? { cloudRegisterSessionId } : {}),
      ...(expectedMapping ? { expectedMapping } : {}),
      localRegisterSessionId: candidate.localRegisterSessionId,
    });
    if (candidates.size > MAX_REGISTER_LIFECYCLE_AUTHORITY_CANDIDATES) {
      invalidReason = "overflow";
    }
  }

  const active = input.projection.activeRegisterSession;
  if (active) {
    add({
      ...(active.cloudRegisterSessionId
        ? { cloudRegisterSessionId: active.cloudRegisterSessionId }
        : {}),
      localRegisterSessionId: active.localRegisterSessionId,
    });
  }

  for (const event of input.projection.sourceEvents) {
    if (
      event.type !== "register.opened" ||
      event.sync.status === "synced" ||
      event.sync.status === "locally_resolved" ||
      !event.localRegisterSessionId
    ) {
      continue;
    }
    add({ localRegisterSessionId: event.localRegisterSessionId });
  }

  const scopedMappings = (input.projection.mappings ?? []).filter((mapping) =>
    isEligibleRegisterMapping(mapping, input),
  );
  const currentMappings = scopedMappings.filter(
    (mapping) => mapping.registerCandidateState === "current",
  );
  if (currentMappings.length > 0) {
    if (currentMappings.length > MAX_REGISTER_LIFECYCLE_AUTHORITY_CANDIDATES) {
      invalidReason = "overflow";
    } else if (
      new Set(
        currentMappings.map(
          (mapping) => `${mapping.localId}\u0000${mapping.cloudId}`,
        ),
      ).size > 1
    ) {
      invalidReason = "ambiguous";
    } else {
      add(mappingCandidate(currentMappings[0]));
    }
  } else {
    const legacyMappings = scopedMappings.filter(
      (mapping) => mapping.registerCandidateState === undefined,
    );
    if (legacyMappings.length > 0) {
      const activeSessionMappings = legacyMappings.filter(
        (mapping) => legacyMappingMatchesActiveSession(mapping, active),
      );
      const exactScopedMappings = legacyMappings.filter(
        (mapping) =>
          mapping.storeId === input.storeId &&
          mapping.terminalId === input.terminalId &&
          Boolean(mapping.registerNumber) &&
          mapping.registerNumber === input.registerNumber,
      );
      if (activeSessionMappings.length === 1) {
        add(mappingCandidate(activeSessionMappings[0]));
      } else if (activeSessionMappings.length > 1) {
        invalidReason = "ambiguous";
      } else if (
        legacyMappings.length === 1 &&
        exactScopedMappings.length === 1
      ) {
        add(mappingCandidate(exactScopedMappings[0]));
      } else {
        invalidReason = "ambiguous";
      }
    }
  }

  if (invalidReason) return { reason: invalidReason, status: "invalid" };
  const values = [...candidates.values()];
  return values.length > 0
    ? { candidates: values, status: "ready" }
    : { candidates: [], status: "empty" };
}

function isEligibleRegisterMapping(
  mapping: PosLocalCloudMapping,
  scope: { registerNumber?: string; storeId: string; terminalId: string },
) {
  return (
    mapping.entity === "registerSession" &&
    mapping.registerCandidateState !== "historical" &&
    (!mapping.storeId || mapping.storeId === scope.storeId) &&
    (!mapping.terminalId || mapping.terminalId === scope.terminalId) &&
    (!mapping.registerNumber ||
      !scope.registerNumber ||
      mapping.registerNumber === scope.registerNumber)
  );
}

function legacyMappingMatchesActiveSession(
  mapping: PosLocalCloudMapping,
  active: CandidateProjection["activeRegisterSession"],
) {
  return (
    Boolean(active) &&
    mapping.localId === active?.localRegisterSessionId &&
    (!active.cloudRegisterSessionId ||
      mapping.cloudId === active.cloudRegisterSessionId)
  );
}

function mappingCandidate(
  mapping: PosLocalCloudMapping,
): RegisterLifecycleAuthorityCandidate {
  return {
    cloudRegisterSessionId: mapping.cloudId,
    expectedMapping: {
      cloudRegisterSessionId: mapping.cloudId,
      mappedAt: mapping.mappedAt,
      ...(mapping.mappingAuthorityRevision !== undefined
        ? { mappingAuthorityRevision: mapping.mappingAuthorityRevision }
        : {}),
      ...(mapping.registerCandidateState !== undefined
        ? { registerCandidateState: mapping.registerCandidateState }
        : {}),
      ...(mapping.registerNumber !== undefined
        ? { registerNumber: mapping.registerNumber }
        : {}),
      ...(mapping.storeId !== undefined ? { storeId: mapping.storeId } : {}),
      ...(mapping.terminalId !== undefined
        ? { terminalId: mapping.terminalId }
        : {}),
    },
    localRegisterSessionId: mapping.localId,
  };
}

function isBoundedIdentifier(value: string) {
  return (
    value.length > 0 &&
    value.length <= MAX_REGISTER_LIFECYCLE_AUTHORITY_ID_LENGTH &&
    value.trim() === value
  );
}
