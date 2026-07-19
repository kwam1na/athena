import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import {
  isPosUsableRegisterSessionStatus,
  isRegisterSessionStatus,
  type RegisterSessionStatus,
} from "../../../../shared/registerSessionStatus";
import {
  createRegisterLifecycleAuthorityRepository,
  type RegisterLifecycleAuthorityRepository,
} from "../../infrastructure/repositories/registerLifecycleAuthorityRepository";
import {
  createRegisterLifecycleAuthorityStatusReadRepository,
  type RegisterLifecycleAuthorityStatusReadRepository,
} from "../../infrastructure/repositories/registerLifecycleAuthorityStatusRepository";

export const MAX_REGISTER_LIFECYCLE_AUTHORITY_CANDIDATES = 16;
export const MAX_REGISTER_LIFECYCLE_AUTHORITY_ID_LENGTH = 120;

export type RegisterLifecycleAuthorityCandidate = {
  cloudRegisterSessionId?: string;
  localRegisterSessionId: string;
};

export type RegisterLifecycleAuthorityShadowClassification =
  | "unmapped"
  | "sale_usable"
  | "sale_blocked"
  | "stale_cloud_subject"
  | "repair_required";

export type RegisterLifecycleAuthorityShadowResult = {
  candidateCount: number;
  maximumDocumentReads: number;
  mode: "shadow";
  results: Array<{
    classification: RegisterLifecycleAuthorityShadowClassification;
    cloudRegisterSessionId?: string;
    cloudStatus?: RegisterSessionStatus;
    localRegisterSessionId: string;
  }>;
};

export type RegisterLifecycleAuthorityCursor = {
  lifecycleRevision: number;
  mappingAuthorityRevision: number;
};

export type RegisterLifecycleAuthorityResult = {
  bootstrap?: RegisterLifecycleAuthorityBootstrap;
  candidateCount: number;
  maximumDocumentReads: number;
  results: Array<{
    authorityCursor: RegisterLifecycleAuthorityCursor;
    classification: RegisterLifecycleAuthorityShadowClassification;
    cloudRegisterSessionId?: string;
    cloudStatus?: RegisterSessionStatus;
    lifecycleRevision: number;
    localRegisterSessionId: string;
    mappingAuthorityRevision: number;
  }>;
};

export type RegisterLifecycleAuthorityBootstrap = {
  authorityCursor: RegisterLifecycleAuthorityCursor;
  classification: "sale_usable";
  cloudRegisterSessionId: string;
  cloudStatus: "active" | "open";
  expectedCash: number;
  lifecycleRevision: number;
  localRegisterSessionId: string;
  mappingAuthorityRevision: number;
  openedAt: number;
  openingFloat: number;
  registerNumber?: string;
  staffProfileId?: Id<"staffProfile">;
};

export async function getRegisterLifecycleAuthorityAcknowledgement(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
  repository: RegisterLifecycleAuthorityStatusReadRepository =
    createRegisterLifecycleAuthorityStatusReadRepository(ctx),
) {
  const latest = await repository.getLatest(args.terminalId);
  if (!latest || latest.storeId !== args.storeId) return null;

  return {
    terminalId: latest.terminalId,
    localRegisterSessionId: latest.localRegisterSessionId,
    ...(latest.cloudRegisterSessionId
      ? { cloudRegisterSessionId: latest.cloudRegisterSessionId }
      : {}),
    mappingAuthorityRevision: latest.mappingAuthorityRevision,
    lifecycleRevision: latest.lifecycleRevision,
    outcome: latest.outcome,
    rolloutMode: latest.rolloutMode,
    rolloutCohort: latest.rolloutCohort,
    ...(latest.appVersion ? { appVersion: latest.appVersion } : {}),
    ...(latest.buildSha ? { buildSha: latest.buildSha } : {}),
    receivedAt: latest.receivedAt,
  };
}

export async function getRegisterLifecycleAuthorityShadow(
  ctx: QueryCtx,
  args: {
    candidates: RegisterLifecycleAuthorityCandidate[];
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
  repository: RegisterLifecycleAuthorityRepository =
    createRegisterLifecycleAuthorityRepository(ctx),
): Promise<RegisterLifecycleAuthorityShadowResult> {
  const results = await Promise.all(
    args.candidates.map((candidate) =>
      classifyCandidate(repository, {
        candidate,
        storeId: args.storeId,
        terminal: args.terminal,
      }),
    ),
  );

  return {
    candidateCount: args.candidates.length,
    maximumDocumentReads: maximumDocumentReads(args.candidates.length),
    mode: "shadow",
    results,
  };
}

export async function getRegisterLifecycleAuthority(
  ctx: QueryCtx,
  args: {
    candidates: RegisterLifecycleAuthorityCandidate[];
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
  repository: RegisterLifecycleAuthorityRepository =
    createRegisterLifecycleAuthorityRepository(ctx),
): Promise<RegisterLifecycleAuthorityResult> {
  const bootstrap =
    args.candidates.length === 0
      ? await getTerminalRegisterBootstrap(repository, {
          storeId: args.storeId,
          terminal: args.terminal,
        })
      : undefined;
  const results = await Promise.all(
    args.candidates.map((candidate) =>
      classifyVersionedCandidate(repository, {
        candidate,
        storeId: args.storeId,
        terminal: args.terminal,
      }),
    ),
  );

  return {
    ...(bootstrap ? { bootstrap } : {}),
    candidateCount: args.candidates.length,
    maximumDocumentReads: maximumDocumentReads(args.candidates.length),
    results,
  };
}

export function compareRegisterLifecycleAuthorityCursors(
  left: RegisterLifecycleAuthorityCursor,
  right: RegisterLifecycleAuthorityCursor,
) {
  if (left.mappingAuthorityRevision !== right.mappingAuthorityRevision) {
    return left.mappingAuthorityRevision - right.mappingAuthorityRevision;
  }
  return left.lifecycleRevision - right.lifecycleRevision;
}

export function isValidRegisterLifecycleAuthorityCandidates(
  candidates: RegisterLifecycleAuthorityCandidate[],
): boolean {
  if (candidates.length > MAX_REGISTER_LIFECYCLE_AUTHORITY_CANDIDATES) {
    return false;
  }

  const localIds = new Set<string>();
  for (const candidate of candidates) {
    if (!isBoundedIdentifier(candidate.localRegisterSessionId)) return false;
    if (
      candidate.cloudRegisterSessionId !== undefined &&
      !isBoundedIdentifier(candidate.cloudRegisterSessionId)
    ) {
      return false;
    }
    if (localIds.has(candidate.localRegisterSessionId)) return false;
    localIds.add(candidate.localRegisterSessionId);
  }

  return true;
}

function maximumDocumentReads(candidateCount: number) {
  // One terminal-proof document plus at most two returned documents per
  // candidate. Versioned subjects read authority + session. Legacy subjects
  // return no authority document, then read mapping + session. Ambiguous
  // legacy mappings stop after the second mapping row.
  return 1 + (candidateCount === 0 ? 2 : candidateCount * 2);
}

async function getTerminalRegisterBootstrap(
  repository: RegisterLifecycleAuthorityRepository,
  input: {
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
): Promise<RegisterLifecycleAuthorityBootstrap | undefined> {
  const sessions = (
    await Promise.all(
      (["active", "open"] as const).map((status) =>
        repository.listSaleUsableRegisterSessions({
          status,
          storeId: input.storeId,
          terminalId: input.terminal._id,
        }),
      ),
    )
  )
    .flat()
    .filter(
      (session) =>
        session.storeId === input.storeId &&
        session.terminalId === input.terminal._id &&
        isRegisterNumberCompatible(input.terminal, session),
    )
    .sort((left, right) => right._creationTime - left._creationTime);
  const session = sessions[0];
  if (!session || !isPosUsableRegisterSessionStatus(session.status)) {
    return undefined;
  }
  const lifecycleRevision = normalizeRevision(
    session.lifecycleAuthorityRevision,
  );
  return {
    authorityCursor: {
      lifecycleRevision,
      mappingAuthorityRevision: 0,
    },
    classification: "sale_usable",
    cloudRegisterSessionId: String(session._id),
    cloudStatus: session.status as "active" | "open",
    expectedCash: session.expectedCash,
    lifecycleRevision,
    localRegisterSessionId: String(session._id),
    mappingAuthorityRevision: 0,
    openedAt: session.openedAt,
    openingFloat: session.openingFloat,
    ...(session.registerNumber
      ? { registerNumber: session.registerNumber }
      : {}),
    ...(session.openedByStaffProfileId
      ? { staffProfileId: session.openedByStaffProfileId }
      : {}),
  };
}

async function classifyVersionedCandidate(
  repository: RegisterLifecycleAuthorityRepository,
  input: {
    candidate: RegisterLifecycleAuthorityCandidate;
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
) {
  const localRegisterSessionId = input.candidate.localRegisterSessionId;
  const mappingAuthority = await repository.getRegisterMappingAuthority({
    localRegisterSessionId,
    storeId: input.storeId,
    terminalId: input.terminal._id,
  });
  if (!mappingAuthority) {
    return classifyLegacyVersionedCandidate(repository, input);
  }

  const mappingAuthorityRevision = normalizeRevision(
    mappingAuthority.revision,
  );
  if (
    mappingAuthority.storeId !== input.storeId ||
    mappingAuthority.terminalId !== input.terminal._id ||
    mappingAuthority.localRegisterSessionId !== localRegisterSessionId ||
    mappingAuthority.state !== "mapped" ||
    !mappingAuthority.cloudRegisterSessionId ||
    (input.candidate.cloudRegisterSessionId !== undefined &&
      input.candidate.cloudRegisterSessionId !==
        mappingAuthority.cloudRegisterSessionId)
  ) {
    return versionedRepair(localRegisterSessionId, mappingAuthorityRevision);
  }

  return classifyExactVersionedSession(repository, {
    cloudRegisterSessionId: mappingAuthority.cloudRegisterSessionId,
    localRegisterSessionId,
    mappingAuthorityRevision,
    storeId: input.storeId,
    terminal: input.terminal,
  });
}

async function classifyLegacyVersionedCandidate(
  repository: RegisterLifecycleAuthorityRepository,
  input: {
    candidate: RegisterLifecycleAuthorityCandidate;
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
) {
  const localRegisterSessionId = input.candidate.localRegisterSessionId;
  const mappings = await repository.listRegisterSessionMappings({
    localRegisterSessionId,
    storeId: input.storeId,
    terminalId: input.terminal._id,
  });
  if (mappings.length === 0) {
    if (input.candidate.cloudRegisterSessionId) {
      const claimedSession = await repository.getRegisterSession(
        input.candidate.cloudRegisterSessionId,
      );
      if (
        claimedSession &&
        localRegisterSessionId === input.candidate.cloudRegisterSessionId
      ) {
        return classifyVersionedRegisterSession({
          localRegisterSessionId,
          mappingAuthorityRevision: 0,
          registerSession: claimedSession,
          storeId: input.storeId,
          terminal: input.terminal,
        });
      }
      return claimedSession
        ? versionedRepair(localRegisterSessionId, 0)
        : versionedStaleCloudSubject(
            localRegisterSessionId,
            input.candidate.cloudRegisterSessionId,
            0,
          );
    }
    return versionedResult({
      classification: "unmapped",
      lifecycleRevision: 0,
      localRegisterSessionId,
      mappingAuthorityRevision: 0,
    });
  }
  if (mappings.length !== 1) {
    return versionedRepair(localRegisterSessionId, 0);
  }

  const mapping = mappings[0];
  if (
    mapping.cloudTable !== "registerSession" ||
    mapping.localRegisterSessionId !== localRegisterSessionId ||
    mapping.localId !== localRegisterSessionId ||
    (input.candidate.cloudRegisterSessionId !== undefined &&
      input.candidate.cloudRegisterSessionId !== mapping.cloudId)
  ) {
    return versionedRepair(localRegisterSessionId, 0);
  }

  return classifyExactVersionedSession(repository, {
    cloudRegisterSessionId: mapping.cloudId,
    localRegisterSessionId,
    mappingAuthorityRevision: 0,
    storeId: input.storeId,
    terminal: input.terminal,
  });
}

async function classifyExactVersionedSession(
  repository: RegisterLifecycleAuthorityRepository,
  input: {
    cloudRegisterSessionId: string;
    localRegisterSessionId: string;
    mappingAuthorityRevision: number;
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
) {
  const registerSession = await repository.getRegisterSession(
    input.cloudRegisterSessionId,
  );
  if (!registerSession) {
    return versionedStaleCloudSubject(
      input.localRegisterSessionId,
      input.cloudRegisterSessionId,
      input.mappingAuthorityRevision,
    );
  }
  return classifyVersionedRegisterSession({
    localRegisterSessionId: input.localRegisterSessionId,
    mappingAuthorityRevision: input.mappingAuthorityRevision,
    registerSession,
    storeId: input.storeId,
    terminal: input.terminal,
  });
}

function classifyVersionedRegisterSession(input: {
  localRegisterSessionId: string;
  mappingAuthorityRevision: number;
  registerSession: Doc<"registerSession"> | null;
  storeId: Id<"store">;
  terminal: Doc<"posTerminal">;
}) {
  const registerSession = input.registerSession;
  if (
    !registerSession ||
    registerSession.storeId !== input.storeId ||
    registerSession.terminalId !== input.terminal._id ||
    !isRegisterNumberCompatible(input.terminal, registerSession) ||
    !isRegisterSessionStatus(registerSession.status)
  ) {
    return versionedRepair(
      input.localRegisterSessionId,
      input.mappingAuthorityRevision,
    );
  }

  const lifecycleRevision = normalizeRevision(
    registerSession.lifecycleAuthorityRevision,
  );
  return versionedResult({
    classification: isPosUsableRegisterSessionStatus(registerSession.status)
      ? "sale_usable"
      : "sale_blocked",
    cloudRegisterSessionId: registerSession._id,
    cloudStatus: registerSession.status,
    lifecycleRevision,
    localRegisterSessionId: input.localRegisterSessionId,
    mappingAuthorityRevision: input.mappingAuthorityRevision,
  });
}

function versionedRepair(
  localRegisterSessionId: string,
  mappingAuthorityRevision: number,
) {
  return versionedResult({
    classification: "repair_required" as const,
    lifecycleRevision: 0,
    localRegisterSessionId,
    mappingAuthorityRevision,
  });
}

function versionedStaleCloudSubject(
  localRegisterSessionId: string,
  cloudRegisterSessionId: string,
  mappingAuthorityRevision: number,
) {
  return versionedResult({
    classification: "stale_cloud_subject" as const,
    cloudRegisterSessionId: cloudRegisterSessionId as Id<"registerSession">,
    lifecycleRevision: 0,
    localRegisterSessionId,
    mappingAuthorityRevision,
  });
}

function versionedResult(input: {
  classification: RegisterLifecycleAuthorityShadowClassification;
  cloudRegisterSessionId?: Id<"registerSession">;
  cloudStatus?: RegisterSessionStatus;
  lifecycleRevision: number;
  localRegisterSessionId: string;
  mappingAuthorityRevision: number;
}) {
  return {
    authorityCursor: {
      lifecycleRevision: input.lifecycleRevision,
      mappingAuthorityRevision: input.mappingAuthorityRevision,
    },
    classification: input.classification,
    ...(input.cloudRegisterSessionId
      ? { cloudRegisterSessionId: input.cloudRegisterSessionId }
      : {}),
    ...(input.cloudStatus ? { cloudStatus: input.cloudStatus } : {}),
    lifecycleRevision: input.lifecycleRevision,
    localRegisterSessionId: input.localRegisterSessionId,
    mappingAuthorityRevision: input.mappingAuthorityRevision,
  };
}

function normalizeRevision(value: number | undefined) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isInteger(value)
    ? value
    : 0;
}

async function classifyCandidate(
  repository: RegisterLifecycleAuthorityRepository,
  input: {
    candidate: RegisterLifecycleAuthorityCandidate;
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
) {
  const localRegisterSessionId = input.candidate.localRegisterSessionId;
  const mappings = await repository.listRegisterSessionMappings({
    localRegisterSessionId,
    storeId: input.storeId,
    terminalId: input.terminal._id,
  });

  if (mappings.length === 0) {
    if (input.candidate.cloudRegisterSessionId) {
      const claimedSession = await repository.getRegisterSession(
        input.candidate.cloudRegisterSessionId,
      );
      if (
        claimedSession &&
        localRegisterSessionId === input.candidate.cloudRegisterSessionId
      ) {
        return classifyShadowRegisterSession({
          localRegisterSessionId,
          registerSession: claimedSession,
          storeId: input.storeId,
          terminal: input.terminal,
        });
      }
      return claimedSession
        ? repairRequired(localRegisterSessionId)
        : {
            classification: "stale_cloud_subject" as const,
            cloudRegisterSessionId: input.candidate.cloudRegisterSessionId,
            localRegisterSessionId,
          };
    }
    return {
      classification: "unmapped" as const,
      localRegisterSessionId,
    };
  }
  if (mappings.length !== 1) {
    return repairRequired(localRegisterSessionId);
  }

  const mapping = mappings[0];
  if (
    mapping.cloudTable !== "registerSession" ||
    mapping.localRegisterSessionId !== localRegisterSessionId ||
    mapping.localId !== localRegisterSessionId ||
    (input.candidate.cloudRegisterSessionId !== undefined &&
      input.candidate.cloudRegisterSessionId !== mapping.cloudId)
  ) {
    return repairRequired(localRegisterSessionId);
  }

  const registerSession = await repository.getRegisterSession(mapping.cloudId);
  return classifyShadowRegisterSession({
    localRegisterSessionId,
    registerSession,
    storeId: input.storeId,
    terminal: input.terminal,
  });
}

function classifyShadowRegisterSession(input: {
  localRegisterSessionId: string;
  registerSession: Doc<"registerSession"> | null;
  storeId: Id<"store">;
  terminal: Doc<"posTerminal">;
}) {
  const registerSession = input.registerSession;
  if (
    !registerSession ||
    registerSession.storeId !== input.storeId ||
    registerSession.terminalId !== input.terminal._id ||
    !isRegisterNumberCompatible(input.terminal, registerSession) ||
    !isRegisterSessionStatus(registerSession.status)
  ) {
    return repairRequired(input.localRegisterSessionId);
  }

  return {
    classification: isPosUsableRegisterSessionStatus(registerSession.status)
      ? ("sale_usable" as const)
      : ("sale_blocked" as const),
    cloudRegisterSessionId: registerSession._id,
    cloudStatus: registerSession.status,
    localRegisterSessionId: input.localRegisterSessionId,
  };
}

function repairRequired(localRegisterSessionId: string) {
  return {
    classification: "repair_required" as const,
    localRegisterSessionId,
  };
}

function isRegisterNumberCompatible(
  terminal: Pick<Doc<"posTerminal">, "registerNumber">,
  registerSession: Pick<Doc<"registerSession">, "registerNumber">,
) {
  return (
    !terminal.registerNumber ||
    !registerSession.registerNumber ||
    terminal.registerNumber === registerSession.registerNumber
  );
}

function isBoundedIdentifier(value: string) {
  return (
    value.length > 0 &&
    value.length <= MAX_REGISTER_LIFECYCLE_AUTHORITY_ID_LENGTH &&
    value.trim() === value
  );
}
