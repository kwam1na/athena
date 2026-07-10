import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { posRegisterAuthorityReplicationOutcomeValidator } from "../../../schemas/pos/posRegisterAuthorityReplicationStatus";
import type {
  posRegisterAuthorityReplicationRolloutCohortValidator,
  posRegisterAuthorityReplicationRolloutModeValidator,
} from "../../../schemas/pos/posRegisterAuthorityReplicationStatus";
import {
  getRegisterLifecycleAuthority,
  isValidRegisterLifecycleAuthorityCandidates,
} from "../queries/registerLifecycleAuthority";
import {
  createRegisterLifecycleAuthorityStatusRepository,
  type RegisterLifecycleAuthorityStatusRepository,
} from "../../infrastructure/repositories/registerLifecycleAuthorityStatusRepository";

const COALESCE_WINDOW_MS = 30_000;
const MAX_SAFE_METADATA_LENGTH = 120;

type ReplicationOutcome = typeof posRegisterAuthorityReplicationOutcomeValidator.type;
type ReplicationRolloutCohort =
  typeof posRegisterAuthorityReplicationRolloutCohortValidator.type;
type ReplicationRolloutMode =
  typeof posRegisterAuthorityReplicationRolloutModeValidator.type;

export type RegisterLifecycleAuthorityAcknowledgementInput = {
  appVersion?: string;
  buildSha?: string;
  cloudRegisterSessionId?: string;
  lifecycleRevision: number;
  localRegisterSessionId: string;
  mappingAuthorityRevision: number;
  outcome: ReplicationOutcome;
  rolloutCohort: ReplicationRolloutCohort;
  rolloutMode: ReplicationRolloutMode;
  storeId: Id<"store">;
  terminal: Doc<"posTerminal">;
};

type Dependencies = {
  getAuthority: typeof getRegisterLifecycleAuthority;
  now: () => number;
  repository: RegisterLifecycleAuthorityStatusRepository;
};

export async function acknowledgeRegisterLifecycleAuthority(
  ctx: MutationCtx,
  input: RegisterLifecycleAuthorityAcknowledgementInput,
  dependencies: Dependencies = {
    getAuthority: getRegisterLifecycleAuthority,
    now: Date.now,
    repository: createRegisterLifecycleAuthorityStatusRepository(ctx),
  },
) {
  const appVersion = normalizeSafeMetadata(input.appVersion);
  const buildSha = normalizeSafeMetadata(input.buildSha);
  const candidates = [
    {
      cloudRegisterSessionId: input.cloudRegisterSessionId,
      localRegisterSessionId: input.localRegisterSessionId,
    },
  ];
  if (
    input.terminal.storeId !== input.storeId ||
    !isValidRegisterLifecycleAuthorityCandidates(candidates) ||
    appVersion === null ||
    buildSha === null ||
    !isRevision(input.lifecycleRevision) ||
    !isRevision(input.mappingAuthorityRevision)
  ) {
    return { status: "rejected" as const };
  }

  const authority = await dependencies.getAuthority(
    ctx as unknown as QueryCtx,
    {
      candidates,
      storeId: input.storeId,
      terminal: input.terminal,
    },
  );
  const result = authority.results[0];
  if (
    authority.results.length !== 1 ||
    !result ||
    result.localRegisterSessionId !== input.localRegisterSessionId ||
    result.cloudRegisterSessionId !== input.cloudRegisterSessionId ||
    result.authorityCursor.mappingAuthorityRevision !==
      input.mappingAuthorityRevision ||
    result.authorityCursor.lifecycleRevision !== input.lifecycleRevision
  ) {
    return { status: "rejected" as const };
  }

  const receivedAt = dependencies.now();
  const value = {
    storeId: input.storeId,
    localRegisterSessionId: input.localRegisterSessionId,
    ...(input.cloudRegisterSessionId === undefined
      ? {}
      : { cloudRegisterSessionId: input.cloudRegisterSessionId }),
    mappingAuthorityRevision: input.mappingAuthorityRevision,
    lifecycleRevision: input.lifecycleRevision,
    outcome: input.outcome,
    rolloutCohort: input.rolloutCohort,
    rolloutMode: input.rolloutMode,
    ...(appVersion === undefined ? {} : { appVersion }),
    ...(buildSha === undefined ? {} : { buildSha }),
    receivedAt,
  };
  const latest = await dependencies.repository.getLatest(input.terminal._id);
  if (
    latest &&
    receivedAt - latest.receivedAt < COALESCE_WINDOW_MS &&
    equivalentAcknowledgement(latest, value)
  ) {
    return { status: "accepted" as const, coalesced: true };
  }

  await dependencies.repository.upsertLatest(input.terminal._id, value);
  return { status: "accepted" as const, coalesced: false };
}

function equivalentAcknowledgement(
  left: Doc<"posRegisterAuthorityReplicationStatus">,
  right: Omit<
    Doc<"posRegisterAuthorityReplicationStatus">,
    "_id" | "_creationTime" | "terminalId"
  >,
) {
  return (
    left.storeId === right.storeId &&
    left.localRegisterSessionId === right.localRegisterSessionId &&
    left.cloudRegisterSessionId === right.cloudRegisterSessionId &&
    left.mappingAuthorityRevision === right.mappingAuthorityRevision &&
    left.lifecycleRevision === right.lifecycleRevision &&
    left.outcome === right.outcome &&
    left.rolloutCohort === right.rolloutCohort &&
    left.rolloutMode === right.rolloutMode &&
    left.appVersion === right.appVersion &&
    left.buildSha === right.buildSha
  );
}

function normalizeSafeMetadata(value?: string) {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_SAFE_METADATA_LENGTH
    ? normalized
    : null;
}

function isRevision(value: number) {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}
