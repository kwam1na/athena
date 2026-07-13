import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../../_generated/server";
import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_FINANCIAL_DATE_CONTRACT_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
} from "../../../shared/reportingContract";
import { requireReportingStoreAccess } from "../access";
import { assertStoreTimezoneVersionCanBeInserted } from "../storeTimeAuthority";
import {
  backfillAuthorizationEnvelopeHash,
  backfillAuthorizationMatches,
  type BackfillAuthorizationEnvelope,
} from "./backfillAuthorization";
import {
  assertReportingRunTransition,
  createReportingRunWithCtx,
} from "./runLedger";

const AUTHORIZATION_DENIED = "Reporting backfill authorization unavailable.";
const REQUEST_NONCE_LIMIT = 128;
const OPERATION = "financial_truth_reset_backfill";
const TIMEZONE_EVIDENCE_HASH_LIMIT = 256;

type StringRecord = Readonly<Record<string, unknown>>;

export type AuthorizedPosBackfillLineage = {
  expectedIdentitySubject?: string;
  grant: StringRecord;
  grantId: string;
  run: StringRecord;
};

export function normalizeBackfillRequestNonce(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Reporting backfill request nonce is required");
  }
  if (normalized.length > REQUEST_NONCE_LIMIT) {
    throw new Error("Reporting backfill request nonce is too long");
  }
  return normalized;
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function storeTimezoneAuthorizationContentHash(input: {
  effectiveFrom: number;
  evidenceHash: string;
  organizationId: string;
  storeId: string;
  timezone: string;
}) {
  return `store-timezone-authorization-v1:${fnv1a(
    JSON.stringify([
      input.organizationId,
      input.storeId,
      input.timezone.trim(),
      input.effectiveFrom,
      input.evidenceHash.trim(),
    ]),
  )}`;
}

function assertField(
  record: StringRecord,
  field: string,
  expected: unknown,
  boundary: "grant" | "run",
) {
  if (record[field] !== expected) {
    throw new Error(`Authorized POS backfill ${boundary} mismatch: ${field}`);
  }
}

export function assertAuthorizedPosBackfillLineage(
  input: AuthorizedPosBackfillLineage,
) {
  const { grant, run } = input;
  const grantId = input.grantId;
  const sharedFields = ["organizationId", "storeId"] as const;
  for (const field of sharedFields) {
    assertField(run, field, grant[field], "run");
  }
  assertField(grant, "sourceScope", "pos", "grant");
  assertField(run, "sourceScope", "pos", "run");
  assertField(
    grant,
    "migrationPurpose",
    "reports_financial_truth_reset_backfill",
    "grant",
  );
  assertField(grant, "roleSnapshot", "full_admin", "grant");
  assertField(
    grant,
    "contractVersion",
    REPORTING_FINANCIAL_DATE_CONTRACT_VERSION,
    "grant",
  );
  assertField(run, "actorKind", "human", "run");
  assertField(run, "actorUserId", grant.athenaUserId, "run");
  assertField(run, "runType", "backfill", "run");
  assertField(run, "domain", "reporting", "run");
  assertField(run, "operation", OPERATION, "run");
  assertField(
    run,
    "factContractVersion",
    REPORTING_FACT_CONTRACT_VERSION,
    "run",
  );
  assertField(
    run,
    "projectionContractVersion",
    REPORTING_PROJECTION_CONTRACT_VERSION,
    "run",
  );
  assertField(run, "requestKey", grant.envelopeHash, "run");
  assertField(run, "backfillAuthorizationGrantId", grantId, "run");
  assertField(
    run,
    "financialDateContractVersion",
    grant.contractVersion,
    "run",
  );
  assertField(
    run,
    "censusToken",
    `reporting-pos-census-v1:${String(grant.envelopeHash)}`,
    "run",
  );
  assertField(grant, "runId", run._id, "grant");
  if (input.expectedIdentitySubject !== undefined) {
    assertField(
      grant,
      "identitySubject",
      input.expectedIdentitySubject,
      "grant",
    );
  }
}

function authorizationEnvelope(
  grant: Pick<
    Doc<"reportingBackfillAuthorizationGrant">,
    | "contractVersion"
    | "migrationPurpose"
    | "organizationId"
    | "requestNonce"
    | "sourceScope"
    | "storeId"
    | "timezoneContentHash"
  >,
): BackfillAuthorizationEnvelope {
  return {
    contractVersion: grant.contractVersion,
    migrationPurpose: grant.migrationPurpose,
    organizationId: String(grant.organizationId),
    requestNonce: grant.requestNonce,
    sourceScope: grant.sourceScope,
    storeId: String(grant.storeId),
    timezoneContentHash: grant.timezoneContentHash,
  };
}

function assertAuthorizationEnvelopeMatches(
  actual: BackfillAuthorizationEnvelope,
  expected: BackfillAuthorizationEnvelope,
) {
  for (const field of [
    "contractVersion",
    "migrationPurpose",
    "organizationId",
    "requestNonce",
    "sourceScope",
    "storeId",
    "timezoneContentHash",
  ] as const) {
    if (actual[field] !== expected[field]) {
      throw new Error(`Reporting backfill grant scope mismatch: ${field}`);
    }
  }
}

export async function requireAuthorizedLineageWithCtx(
  ctx: MutationCtx,
  args: {
    grantId: Id<"reportingBackfillAuthorizationGrant">;
    runId: Id<"reportingRun">;
  },
) {
  const [grant, run] = await Promise.all([
    ctx.db.get("reportingBackfillAuthorizationGrant", args.grantId),
    ctx.db.get("reportingRun", args.runId),
  ]);
  if (!grant || !run) {
    throw new Error("Authorized POS backfill lineage is unavailable");
  }
  const [athenaUser, membership, store, timezoneVersions] = await Promise.all([
    ctx.db.get("athenaUser", grant.athenaUserId),
    ctx.db.get("organizationMember", grant.membershipId),
    ctx.db.get("store", grant.storeId),
    ctx.db
      .query("storeTimezoneVersion")
      .withIndex("by_storeId_contentHash", (q) =>
        q
          .eq("storeId", grant.storeId)
          .eq("contentHash", grant.timezoneContentHash),
      )
      .take(2),
  ]);
  if (
    !athenaUser ||
    !membership ||
    membership.userId !== grant.athenaUserId ||
    membership.organizationId !== grant.organizationId ||
    membership.role !== "full_admin" ||
    !store ||
    store.organizationId !== grant.organizationId ||
    timezoneVersions.length !== 1 ||
    timezoneVersions[0].organizationId !== grant.organizationId ||
    timezoneVersions[0].source !== "admin_authorized"
  ) {
    throw new Error("Authorized POS backfill authority is no longer valid");
  }
  if (
    !backfillAuthorizationMatches({
      envelope: authorizationEnvelope(grant),
      envelopeHash: grant.envelopeHash,
    })
  ) {
    throw new Error("Authorized POS backfill grant hash is invalid");
  }
  assertAuthorizedPosBackfillLineage({
    grant,
    grantId: String(args.grantId),
    run,
  });
  assertField(grant, "runId", args.runId, "grant");
  return { grant, run };
}

async function assertExternallyPurgedDevelopmentReportingStateWithCtx(
  ctx: MutationCtx,
  allowedRunId?: Id<"reportingRun">,
) {
  const residualRows = await Promise.all([
    ctx.db.query("reportingIngress").first(),
    ctx.db.query("reportingIngressSourceReference").first(),
    ctx.db.query("reportingIngressLine").first(),
    ctx.db.query("reportingIngressConflict").first(),
    ctx.db.query("reportingFact").first(),
    ctx.db.query("reportingFactSourceReference").first(),
    ctx.db.query("reportingFactProcessingAttempt").first(),
    ctx.db.query("reportingSkuAttribution").first(),
    ctx.db.query("reportingSkuAttributionCursor").first(),
    ctx.db.query("reportingSkuAttributionAppliedSequence").first(),
    ctx.db.query("reportingProjectionGeneration").first(),
    ctx.db.query("reportingProjectionActivation").first(),
    ctx.db.query("reportingStoreDayProjection").first(),
    ctx.db.query("reportingStoreIntradayProjection").first(),
    ctx.db.query("reportingStoreIntradayScheduleState").first(),
    ctx.db.query("reportingSkuDayProjection").first(),
    ctx.db.query("reportingCurrentValuationProjection").first(),
    ctx.db.query("reportingRangeProjection").first(),
    ctx.db.query("reportingAttentionProjection").first(),
    ctx.db.query("reportingDailyCloseProjection").first(),
    ctx.db.query("reportingSkuInsightProjection").first(),
    ctx.db.query("reportingMetricCoverage").first(),
    ctx.db.query("reportingStorePeriodSummary").first(),
    ctx.db.query("reportingSkuPeriodSummary").first(),
    ctx.db.query("reportingSkuPeriodClassification").first(),
    ctx.db.query("reportingPeriodRollup").first(),
    ctx.db.query("reportingPeriodFacet").first(),
    ctx.db.query("reportingInventoryExposureSummary").first(),
    ctx.db.query("reportingInventoryMovementSummary").first(),
    ctx.db.query("reportingInventoryPeriodSummary").first(),
    ctx.db.query("reportingDailyCloseTrust").first(),
    ctx.db.query("reportingReadCursorContext").first(),
    ctx.db.query("reportingWorkspaceMaterializationEpoch").first(),
    ctx.db.query("reportingWorkspaceReadModelActivation").first(),
    ctx.db.query("reportingReadBundle").first(),
    ctx.db.query("reportingReadBundleActivation").first(),
    ctx.db.query("reportingProjectionEvidence").first(),
    ctx.db.query("reportingSkuEvidence").first(),
    ctx.db.query("reportingProjectionHealth").first(),
    ctx.db.query("reportingHistoricalInterpretationPolicy").first(),
    ctx.db.query("reportingHistoricalInterpretationEvidence").first(),
    ctx.db.query("reportingPosSourceReconciliation").first(),
    ctx.db.query("reportingExportChunk").first(),
    ctx.db.query("reportingCutoverPreviewItem").first(),
    ctx.db.query("reportingCutoverBaselineDeficitLot").first(),
    ctx.db.query("reportingCutoverBaseline").first(),
    ctx.db.query("reportingBackfillSourceAudit").first(),
    ctx.db.query("reportingBackfillPreviewItem").first(),
    ctx.db.query("reportingBackfillApplyManifest").first(),
    ctx.db.query("reportingBackfillApplyManifestItem").first(),
    ctx.db.query("reportingQuarantine").first(),
    ctx.db.query("reportingReconciliationDiscrepancy").first(),
    ctx.db.query("reportingReconciliationAccumulator").first(),
  ]);
  const [runs, grants, unexpectedRunEvent] = await Promise.all([
    ctx.db.query("reportingRun").take(2),
    ctx.db.query("reportingBackfillAuthorizationGrant").take(2),
    allowedRunId
      ? ctx.db
          .query("reportingRunEvent")
          .filter((q) => q.neq(q.field("runId"), allowedRunId))
          .first()
      : ctx.db.query("reportingRunEvent").first(),
  ]);
  const unexpectedRun = runs.find((run) => run._id !== allowedRunId);
  const unexpectedGrant = grants.find((grant) => grant.runId !== allowedRunId);
  if (
    residualRows.some((row) => row !== null) ||
    unexpectedRun ||
    unexpectedGrant ||
    unexpectedRunEvent
  ) {
    throw new Error(
      "Development reporting state must be externally purged before POS backfill.",
    );
  }
}

async function authorizeStoreTimezoneWithCtx(
  ctx: MutationCtx,
  args: {
    athenaUserId: Id<"athenaUser">;
    effectiveFrom: number;
    evidenceHash: string;
    now: number;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
    timezone: string;
  },
) {
  if (
    !Number.isSafeInteger(args.effectiveFrom) ||
    args.effectiveFrom < 0 ||
    args.effectiveFrom > args.now
  ) {
    throw new Error("Reporting backfill timezone effective date is invalid");
  }
  const timezone = args.timezone.trim();
  const evidenceHash = args.evidenceHash.trim();
  if (!evidenceHash) {
    throw new Error("Reporting backfill timezone evidence is required");
  }
  if (evidenceHash.length > TIMEZONE_EVIDENCE_HASH_LIMIT) {
    throw new Error("Reporting backfill timezone evidence is too long");
  }
  const contentHash = storeTimezoneAuthorizationContentHash({
    effectiveFrom: args.effectiveFrom,
    evidenceHash,
    organizationId: String(args.organizationId),
    storeId: String(args.storeId),
    timezone,
  });
  const sameHash = await ctx.db
    .query("storeTimezoneVersion")
    .withIndex("by_storeId_contentHash", (q) =>
      q.eq("storeId", args.storeId).eq("contentHash", contentHash),
    )
    .take(2);
  if (sameHash.length > 1) {
    throw new Error("Store timezone authority content hash is not unique");
  }
  if (sameHash[0]) {
    const existing = sameHash[0];
    if (
      existing.organizationId !== args.organizationId ||
      existing.storeId !== args.storeId ||
      existing.timezone !== timezone ||
      existing.effectiveFrom !== args.effectiveFrom ||
      existing.effectiveTo !== undefined ||
      existing.evidenceHash !== evidenceHash ||
      existing.source !== "admin_authorized"
    ) {
      throw new Error("Store timezone authority content hash conflicts");
    }
    return existing;
  }
  const [prior, next] = await Promise.all([
    ctx.db
      .query("storeTimezoneVersion")
      .withIndex("by_storeId_effectiveFrom", (q) =>
        q.eq("storeId", args.storeId).lte("effectiveFrom", args.effectiveFrom),
      )
      .order("desc")
      .take(1),
    ctx.db
      .query("storeTimezoneVersion")
      .withIndex("by_storeId_effectiveFrom", (q) =>
        q.eq("storeId", args.storeId).gte("effectiveFrom", args.effectiveFrom),
      )
      .order("asc")
      .take(1),
  ]);
  const candidate = {
    _id: "candidate",
    authorizedAt: args.now,
    authorizedByUserId: String(args.athenaUserId),
    contentHash,
    createdAt: args.now,
    effectiveFrom: args.effectiveFrom,
    evidenceHash,
    organizationId: String(args.organizationId),
    source: "admin_authorized" as const,
    storeId: String(args.storeId),
    timezone,
  };
  assertStoreTimezoneVersionCanBeInserted({
    candidate,
    existing: [...prior, ...next].map((version) => ({
      ...version,
      _id: String(version._id),
      authorizedByUserId: String(version.authorizedByUserId),
      organizationId: String(version.organizationId),
      storeId: String(version.storeId),
    })),
  });
  const timezoneVersionId = await ctx.db.insert("storeTimezoneVersion", {
    authorizedAt: args.now,
    authorizedByUserId: args.athenaUserId,
    contentHash,
    createdAt: args.now,
    effectiveFrom: args.effectiveFrom,
    evidenceHash,
    organizationId: args.organizationId,
    source: "admin_authorized",
    storeId: args.storeId,
    timezone,
  });
  const created = await ctx.db.get("storeTimezoneVersion", timezoneVersionId);
  if (!created)
    throw new Error("Store timezone authority could not be created");
  return created;
}

export const authorizePosReportingBackfill = mutation({
  args: {
    requestNonce: v.string(),
    storeId: v.id("store"),
    timezone: v.string(),
    timezoneEffectiveFrom: v.number(),
    timezoneEvidenceHash: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error(AUTHORIZATION_DENIED);
    const access = await requireReportingStoreAccess(ctx, args.storeId);
    const now = Date.now();
    const requestNonce = normalizeBackfillRequestNonce(args.requestNonce);
    const timezone = await authorizeStoreTimezoneWithCtx(ctx, {
      athenaUserId: access.athenaUser._id,
      effectiveFrom: args.timezoneEffectiveFrom,
      evidenceHash: args.timezoneEvidenceHash,
      now,
      organizationId: access.store.organizationId,
      storeId: access.store._id,
      timezone: args.timezone,
    });
    const envelope: BackfillAuthorizationEnvelope = {
      contractVersion: REPORTING_FINANCIAL_DATE_CONTRACT_VERSION,
      migrationPurpose: "reports_financial_truth_reset_backfill",
      organizationId: String(access.store.organizationId),
      requestNonce,
      sourceScope: "pos",
      storeId: String(access.store._id),
      timezoneContentHash: timezone.contentHash,
    };
    const envelopeHash = backfillAuthorizationEnvelopeHash(envelope);
    const existing = await ctx.db
      .query("reportingBackfillAuthorizationGrant")
      .withIndex("by_storeId_requestNonce", (q) =>
        q.eq("storeId", access.store._id).eq("requestNonce", requestNonce),
      )
      .take(2);
    if (existing.length > 1) {
      throw new Error("Reporting backfill grant identity is not unique");
    }
    if (existing[0]) {
      const grant = existing[0];
      if (!grant.runId) {
        throw new Error("Reporting backfill grant has incomplete run lineage");
      }
      const run = await ctx.db.get("reportingRun", grant.runId);
      if (!run) {
        throw new Error("Reporting backfill grant run is unavailable");
      }
      assertAuthorizationEnvelopeMatches(
        authorizationEnvelope(grant),
        envelope,
      );
      if (
        grant.identitySubject !== identity.tokenIdentifier ||
        grant.athenaUserId !== access.athenaUser._id ||
        grant.membershipId !== access.membership._id ||
        !backfillAuthorizationMatches({
          envelope,
          envelopeHash: grant.envelopeHash,
        })
      ) {
        throw new Error(
          "Reporting backfill grant does not match this authority",
        );
      }
      assertAuthorizedPosBackfillLineage({
        expectedIdentitySubject: identity.tokenIdentifier,
        grant,
        grantId: String(grant._id),
        run,
      });
      if (grant.status === "authorized" && run.status === "pending") {
        await ctx.scheduler.runAfter(
          0,
          internal.reporting.maintenance.authorizedPosBackfill
            .beginAuthorizedPosReportingBackfill,
          { grantId: grant._id, runId: grant.runId },
        );
      }
      return {
        created: false,
        grantId: grant._id,
        runId: grant.runId,
        status: grant.status,
      };
    }

    await assertExternallyPurgedDevelopmentReportingStateWithCtx(ctx);

    const runResult = await createReportingRunWithCtx(ctx, {
      actorKind: "human",
      actorUserId: String(access.athenaUser._id),
      createdAt: now,
      domain: "reporting",
      factContractVersion: REPORTING_FACT_CONTRACT_VERSION,
      metricContractVersion: 1,
      operation: OPERATION,
      organizationId: access.store.organizationId,
      projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
      requestKey: envelopeHash,
      runType: "backfill",
      storeId: access.store._id,
    });
    if (!runResult.created) {
      throw new Error(
        "Reporting backfill run exists without its authorization grant",
      );
    }
    const grantId = await ctx.db.insert("reportingBackfillAuthorizationGrant", {
      athenaUserId: access.athenaUser._id,
      authorizedAt: now,
      contractVersion: envelope.contractVersion,
      envelopeHash,
      identitySubject: identity.tokenIdentifier,
      membershipId: access.membership._id,
      migrationPurpose: envelope.migrationPurpose,
      organizationId: access.store.organizationId,
      requestNonce,
      roleSnapshot: "full_admin",
      runId: runResult.run._id,
      sourceScope: "pos",
      status: "authorized",
      storeId: access.store._id,
      timezoneContentHash: envelope.timezoneContentHash,
    });
    const censusToken = `reporting-pos-census-v1:${envelopeHash}`;
    await ctx.db.patch("reportingRun", runResult.run._id, {
      backfillAuthorizationGrantId: grantId,
      censusToken,
      financialDateContractVersion: REPORTING_FINANCIAL_DATE_CONTRACT_VERSION,
      sourceScope: "pos",
    });
    await ctx.scheduler.runAfter(
      0,
      internal.reporting.maintenance.authorizedPosBackfill
        .beginAuthorizedPosReportingBackfill,
      { grantId, runId: runResult.run._id },
    );
    return {
      created: true,
      grantId,
      runId: runResult.run._id,
      status: "authorized" as const,
    };
  },
});

export const beginAuthorizedPosReportingBackfill = internalMutation({
  args: {
    grantId: v.id("reportingBackfillAuthorizationGrant"),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const { grant, run } = await requireAuthorizedLineageWithCtx(ctx, args);
    if (grant.status === "running" || grant.status === "completed") {
      return { started: false, status: grant.status };
    }
    if (grant.status !== "authorized" || run.status !== "pending") {
      throw new Error("Authorized POS backfill cannot start from this state");
    }
    await assertExternallyPurgedDevelopmentReportingStateWithCtx(ctx, run._id);
    assertReportingRunTransition(run.status, "running");
    const now = Date.now();
    await ctx.db.patch("reportingBackfillAuthorizationGrant", grant._id, {
      status: "running",
    });
    await ctx.db.patch("reportingRun", run._id, {
      cursor: "purge:verified",
      startedAt: now,
      status: "running",
    });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "financial_truth_external_purge_verified",
      occurredAt: now,
      outcome: "queued",
      runId: run._id,
      sequence: 2,
      storeId: run.storeId,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.reporting.maintenance.posCensusBackfill
        .startAuthorizedPosCensusBackfill,
      { grantId: grant._id, runId: run._id },
    );
    return { started: true, status: "running" as const };
  },
});
