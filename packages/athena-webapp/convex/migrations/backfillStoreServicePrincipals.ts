import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  POS_APPLICATION_CAPABILITY_ID,
  POS_SERVICE_PRINCIPAL_CONSUMER_ID,
  reconcilePosServicePrincipal,
} from "../pos/application/posServicePrincipal";
import { migrateLegacyRecoveryCredentialWithCtx } from "../pos/public/posRecoveryCodes";
import {
  STORE_SERVICE_PRINCIPAL_STABLE_KEY,
  reconcileServicePrincipalAuthBinding,
} from "../servicePrincipals/lifecycle";

const LEGACY_POS_ACCOUNT_EMAIL = "pos@wigclub.store";
const DEFAULT_BATCH_LIMIT = 5;
const MAX_BATCH_LIMIT = 10;
const MAX_AUTH_USER_CENSUS = 10_000;
const MAX_MEMBER_CENSUS_PER_ORGANIZATION = 5_000;
const MAX_TERMINAL_CENSUS_PER_STORE = 250;

export type PosServicePrincipalMigrationConflict =
  | "store_organization_missing"
  | "principal_missing"
  | "principal_duplicate"
  | "principal_inactive"
  | "pos_grant_missing"
  | "pos_grant_duplicate"
  | "pos_grant_cross_principal"
  | "pos_grant_inactive"
  | "transport_binding_missing"
  | "transport_binding_duplicate"
  | "transport_binding_cross_principal"
  | "transport_binding_inactive"
  | "transport_auth_user_missing"
  | "transport_auth_user_not_neutral"
  | "transport_binding_legacy_identity"
  | "credential_missing"
  | "credential_duplicate"
  | "credential_cross_organization"
  | "credential_principal_mismatch"
  | "credential_legacy_sha_only"
  | "credential_keyed_verifier_missing"
  | "credential_plaintext_exposed"
  | "terminal_duplicate_fingerprint"
  | "terminal_cross_store_binding"
  | "terminal_organization_mismatch"
  | "terminal_proof_missing"
  | "terminal_recovery_pending"
  | "legacy_pos_account_missing"
  | "legacy_pos_account_duplicate"
  | "legacy_auth_user_missing"
  | "legacy_auth_user_duplicate"
  | "legacy_membership_missing"
  | "legacy_membership_duplicate"
  | "legacy_membership_wrong_role"
  | "secret_exposure"
  | "census_overflow";

const BLOCKING_CONFLICTS = new Set<PosServicePrincipalMigrationConflict>([
  "store_organization_missing",
  "principal_duplicate",
  "principal_inactive",
  "pos_grant_duplicate",
  "pos_grant_cross_principal",
  "pos_grant_inactive",
  "transport_binding_duplicate",
  "transport_binding_cross_principal",
  "transport_binding_inactive",
  "transport_auth_user_missing",
  "transport_auth_user_not_neutral",
  "transport_binding_legacy_identity",
  "credential_missing",
  "credential_duplicate",
  "credential_cross_organization",
  "credential_principal_mismatch",
  "terminal_duplicate_fingerprint",
  "terminal_cross_store_binding",
  "terminal_organization_mismatch",
  "terminal_proof_missing",
  "legacy_pos_account_missing",
  "legacy_pos_account_duplicate",
  "legacy_auth_user_missing",
  "legacy_auth_user_duplicate",
  "legacy_membership_missing",
  "legacy_membership_duplicate",
  "legacy_membership_wrong_role",
  "secret_exposure",
  "census_overflow",
]);

type BackfillArgs = {
  automationIdentity: string;
  cursor?: string | null;
  dryRun?: boolean;
  limit?: number;
  previewRunId?: Id<"posServicePrincipalMigrationRun">;
  runId?: Id<"posServicePrincipalMigrationRun">;
};

type MigrationDependencies = {
  migrateCredential?: typeof migrateLegacyRecoveryCredentialWithCtx;
};

type StoreCensus = {
  action: "unchanged" | "reconcile" | "rotation_required" | "conflict";
  censusFingerprint: string;
  conflicts: PosServicePrincipalMigrationConflict[];
  credential: Doc<"posRecoveryCredential"> | null;
  humanPosOnlyMembershipCount: number;
  organizationId: Id<"organization">;
  pendingTerminalCount: number;
  principal: Doc<"servicePrincipal"> | null;
  store: Doc<"store">;
  terminalCount: number;
  terminals: Doc<"posTerminal">[];
};

function normalizeLimit(limit?: number) {
  if (!Number.isInteger(limit) || limit === undefined || limit < 1) {
    return DEFAULT_BATCH_LIMIT;
  }
  return Math.min(limit, MAX_BATCH_LIMIT);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const AUTH_IDENTITY_FIELDS = [
  "name",
  "image",
  "email",
  "emailVerificationTime",
  "phone",
  "phoneVerificationTime",
  "isAnonymous",
] as const;

function isNeutralTransportAuthUser(user: Doc<"users">) {
  const document = user as unknown as Record<string, unknown>;
  return AUTH_IDENTITY_FIELDS.every((field) => document[field] === undefined);
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fingerprint(value: unknown) {
  return bytesToHex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
}

function hasKeyedVerifier(credential: Doc<"posRecoveryCredential">) {
  return (
    credential.verifierKind === "deployment_keyed_pbkdf2_sha256" &&
    credential.keyedVerifierDigest !== undefined &&
    credential.keyedVerifierIterations !== undefined &&
    credential.keyedVerifierPepperVersion !== undefined &&
    credential.keyedVerifierSalt !== undefined &&
    credential.keyedVerifierVersion !== undefined
  );
}

export function buildPosServicePrincipalCredentialCensusState(
  credential: Doc<"posRecoveryCredential">,
) {
  return [
    credential._id,
    credential.organizationId,
    credential.servicePrincipalId,
    credential.status,
    credential.credentialRevision ?? 1,
    credential.rotatedAt,
    credential.verifierKind,
    credential.codeHash === undefined
      ? "legacy_hash_absent"
      : "legacy_hash_present",
    credential.codeSalt === undefined
      ? "legacy_salt_absent"
      : "legacy_salt_present",
    credential.codeVersion,
    credential.keyedVerifierDigest === undefined
      ? "keyed_digest_absent"
      : "keyed_digest_present",
    credential.keyedVerifierSalt === undefined
      ? "keyed_salt_absent"
      : "keyed_salt_present",
    credential.keyedVerifierVersion,
    credential.keyedVerifierPepperVersion,
    credential.keyedVerifierIterations,
    credential.legacyMigrationStatus,
    credential.plaintextCode === undefined
      ? "plaintext_absent"
      : "plaintext_present",
  ] as const;
}

function uniqueSortedConflicts(
  conflicts: PosServicePrincipalMigrationConflict[],
) {
  return [
    ...new Set(conflicts),
  ].sort() as PosServicePrincipalMigrationConflict[];
}

async function censusStoreWithCtx(
  ctx: MutationCtx,
  store: Doc<"store">,
): Promise<StoreCensus> {
  const conflicts: PosServicePrincipalMigrationConflict[] = [];
  const organizationId = store.organizationId;
  if (!(await ctx.db.get("organization", organizationId))) {
    conflicts.push("store_organization_missing");
  }

  const principals = await ctx.db
    .query("servicePrincipal")
    .withIndex("by_organizationId_and_storeId_and_stableKey", (query) =>
      query
        .eq("organizationId", organizationId)
        .eq("storeId", store._id)
        .eq("stableKey", STORE_SERVICE_PRINCIPAL_STABLE_KEY),
    )
    .take(3);
  if (principals.length === 0) conflicts.push("principal_missing");
  if (principals.length > 1) conflicts.push("principal_duplicate");
  const principal = principals.length === 1 ? principals[0] : null;
  if (principal && principal.status !== "active") {
    conflicts.push("principal_inactive");
  }

  const grants = principal
    ? await ctx.db
        .query("servicePrincipalCapability")
        .withIndex(
          "by_servicePrincipalId_and_consumerId_and_capabilityId",
          (query) =>
            query
              .eq("servicePrincipalId", principal._id)
              .eq("consumerId", POS_SERVICE_PRINCIPAL_CONSUMER_ID)
              .eq("capabilityId", POS_APPLICATION_CAPABILITY_ID),
        )
        .take(3)
    : [];
  const storePosGrants = (
    await Promise.all(
      (["active", "revoked"] as const).map((status) =>
        ctx.db
          .query("servicePrincipalCapability")
          .withIndex("by_organizationId_and_storeId_and_status", (query) =>
            query
              .eq("organizationId", organizationId)
              .eq("storeId", store._id)
              .eq("status", status),
          )
          .take(25),
      ),
    )
  )
    .flat()
    .filter(
      (grant) =>
        grant.consumerId === POS_SERVICE_PRINCIPAL_CONSUMER_ID &&
        grant.capabilityId === POS_APPLICATION_CAPABILITY_ID,
    );
  if (principal && grants.length === 0) conflicts.push("pos_grant_missing");
  if (grants.length > 1) conflicts.push("pos_grant_duplicate");
  if (
    storePosGrants.some(
      (grant) =>
        principal === null || grant.servicePrincipalId !== principal._id,
    )
  ) {
    conflicts.push("pos_grant_cross_principal");
  }
  if (grants.length === 1 && grants[0].status !== "active") {
    conflicts.push("pos_grant_inactive");
  }

  const legacyAthenaUsers = await ctx.db
    .query("athenaUser")
    .withIndex("by_normalizedEmail", (query) =>
      query.eq("normalizedEmail", LEGACY_POS_ACCOUNT_EMAIL),
    )
    .take(3);
  if (legacyAthenaUsers.length === 0) {
    conflicts.push("legacy_pos_account_missing");
  }
  if (legacyAthenaUsers.length > 1) {
    conflicts.push("legacy_pos_account_duplicate");
  }
  const legacyAthenaUser =
    legacyAthenaUsers.length === 1 ? legacyAthenaUsers[0] : null;

  const authUserCensus = await ctx.db
    .query("users")
    .take(MAX_AUTH_USER_CENSUS + 1);
  if (authUserCensus.length > MAX_AUTH_USER_CENSUS) {
    conflicts.push("census_overflow");
  }
  const authUsers = authUserCensus
    .slice(0, MAX_AUTH_USER_CENSUS)
    .filter(
      (user) =>
        typeof user.email === "string" &&
        normalizeEmail(user.email) === LEGACY_POS_ACCOUNT_EMAIL,
    );
  if (authUsers.length === 0) conflicts.push("legacy_auth_user_missing");
  if (authUsers.length > 1) conflicts.push("legacy_auth_user_duplicate");

  const organizationMembers = await ctx.db
    .query("organizationMember")
    .withIndex("by_organizationId_userId", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(MAX_MEMBER_CENSUS_PER_ORGANIZATION + 1);
  if (organizationMembers.length > MAX_MEMBER_CENSUS_PER_ORGANIZATION) {
    conflicts.push("census_overflow");
  }
  const boundedMembers = organizationMembers.slice(
    0,
    MAX_MEMBER_CENSUS_PER_ORGANIZATION,
  );
  const legacyMemberships = legacyAthenaUser
    ? boundedMembers.filter(
        (membership) => membership.userId === legacyAthenaUser._id,
      )
    : [];
  if (legacyAthenaUser && legacyMemberships.length === 0) {
    conflicts.push("legacy_membership_missing");
  }
  if (legacyMemberships.length > 1) {
    conflicts.push("legacy_membership_duplicate");
  }
  if (
    legacyMemberships.length === 1 &&
    legacyMemberships[0].role !== "pos_only"
  ) {
    conflicts.push("legacy_membership_wrong_role");
  }
  const humanPosOnlyMembershipCount = boundedMembers.filter(
    (membership) =>
      membership.role === "pos_only" &&
      membership.userId !== legacyAthenaUser?._id,
  ).length;

  const bindings = principal
    ? await ctx.db
        .query("servicePrincipalAuthBinding")
        .withIndex("by_servicePrincipalId", (query) =>
          query.eq("servicePrincipalId", principal._id),
        )
        .take(3)
    : [];
  const storeBindings = (
    await Promise.all(
      (["active", "decommissioned"] as const).map((status) =>
        ctx.db
          .query("servicePrincipalAuthBinding")
          .withIndex("by_organizationId_and_storeId_and_status", (query) =>
            query
              .eq("organizationId", organizationId)
              .eq("storeId", store._id)
              .eq("status", status),
          )
          .take(25),
      ),
    )
  ).flat();
  if (principal && bindings.length === 0) {
    conflicts.push("transport_binding_missing");
  }
  if (bindings.length > 1) conflicts.push("transport_binding_duplicate");
  if (
    storeBindings.some(
      (binding) =>
        principal === null || binding.servicePrincipalId !== principal._id,
    )
  ) {
    conflicts.push("transport_binding_cross_principal");
  }
  if (bindings.length === 1 && bindings[0].status !== "active") {
    conflicts.push("transport_binding_inactive");
  }
  const boundTransportUsers = await Promise.all(
    bindings.map((binding) => ctx.db.get("users", binding.authUserId)),
  );
  if (boundTransportUsers.some((user) => user === null)) {
    conflicts.push("transport_auth_user_missing");
  }
  for (const user of boundTransportUsers) {
    if (!user) continue;
    if (!isNeutralTransportAuthUser(user)) {
      conflicts.push("transport_auth_user_not_neutral");
    }
    if (
      typeof user.email === "string" &&
      normalizeEmail(user.email) === LEGACY_POS_ACCOUNT_EMAIL
    ) {
      conflicts.push("transport_binding_legacy_identity");
    }
  }
  for (const legacyAuthUser of authUsers) {
    const legacyBindings = await ctx.db
      .query("servicePrincipalAuthBinding")
      .withIndex("by_authUserId", (query) =>
        query.eq("authUserId", legacyAuthUser._id),
      )
      .take(3);
    if (legacyBindings.length > 1) {
      conflicts.push("transport_binding_duplicate");
    }
    if (legacyBindings.length > 0) {
      conflicts.push("transport_binding_legacy_identity");
    }
  }

  const credentials = await ctx.db
    .query("posRecoveryCredential")
    .withIndex("by_storeId", (query) => query.eq("storeId", store._id))
    .take(3);
  if (credentials.length === 0) conflicts.push("credential_missing");
  if (credentials.length > 1) conflicts.push("credential_duplicate");
  const credential = credentials.length === 1 ? credentials[0] : null;
  if (credential?.organizationId !== organizationId) {
    conflicts.push("credential_cross_organization");
  }
  if (
    credential?.servicePrincipalId &&
    (principal === null || credential.servicePrincipalId !== principal._id)
  ) {
    conflicts.push("credential_principal_mismatch");
  }
  if (credential && !hasKeyedVerifier(credential)) {
    conflicts.push("credential_legacy_sha_only");
    conflicts.push("credential_keyed_verifier_missing");
  }
  if (credential?.plaintextCode !== undefined) {
    conflicts.push("credential_plaintext_exposed");
  }

  const terminalCensus = await ctx.db
    .query("posTerminal")
    .withIndex("by_storeId", (query) => query.eq("storeId", store._id))
    .take(MAX_TERMINAL_CENSUS_PER_STORE + 1);
  if (terminalCensus.length > MAX_TERMINAL_CENSUS_PER_STORE) {
    conflicts.push("census_overflow");
  }
  const terminals = terminalCensus.slice(0, MAX_TERMINAL_CENSUS_PER_STORE);
  const fingerprintCounts = new Map<string, number>();
  for (const terminal of terminals) {
    fingerprintCounts.set(
      terminal.fingerprintHash,
      (fingerprintCounts.get(terminal.fingerprintHash) ?? 0) + 1,
    );
    if (
      terminal.organizationId !== undefined &&
      terminal.organizationId !== organizationId
    ) {
      conflicts.push("terminal_organization_mismatch");
    }
    if (terminal.status === "active" && !terminal.syncSecretHash) {
      conflicts.push("terminal_proof_missing");
    }
    const fingerprintMatches = await ctx.db
      .query("posTerminal")
      .withIndex("by_fingerprintHash", (query) =>
        query.eq("fingerprintHash", terminal.fingerprintHash),
      )
      .take(3);
    if (fingerprintMatches.some((match) => match.storeId !== store._id)) {
      conflicts.push("terminal_cross_store_binding");
    }
  }
  if ([...fingerprintCounts.values()].some((count) => count > 1)) {
    conflicts.push("terminal_duplicate_fingerprint");
  }

  let pendingTerminalCount = 0;
  for (const terminal of terminals) {
    const evidence = await ctx.db
      .query("posServicePrincipalMigrationTerminalEvidence")
      .withIndex("by_storeId_terminalId", (query) =>
        query.eq("storeId", store._id).eq("terminalId", terminal._id),
      )
      .take(2);
    if (evidence.length > 1) conflicts.push("terminal_duplicate_fingerprint");
    if (
      evidence[0]?.status !== "recovered" &&
      evidence[0]?.status !== "dispositioned"
    ) {
      pendingTerminalCount += 1;
    }
  }
  if (pendingTerminalCount > 0) conflicts.push("terminal_recovery_pending");

  const normalizedConflicts = uniqueSortedConflicts(conflicts);
  const hasBlockingConflict = normalizedConflicts.some((conflict) =>
    BLOCKING_CONFLICTS.has(conflict),
  );
  const rotationRequired =
    credential !== null &&
    !hasKeyedVerifier(credential) &&
    credential.plaintextCode === undefined;
  const needsReconciliation = normalizedConflicts.some((conflict) =>
    [
      "principal_missing",
      "pos_grant_missing",
      "transport_binding_missing",
      "credential_legacy_sha_only",
      "credential_keyed_verifier_missing",
      "credential_plaintext_exposed",
      "terminal_recovery_pending",
    ].includes(conflict),
  );
  const action = hasBlockingConflict
    ? "conflict"
    : rotationRequired
      ? "rotation_required"
      : needsReconciliation
        ? "reconcile"
        : "unchanged";

  const censusFingerprint = await fingerprint({
    store: [store._id, organizationId],
    principals: principals.map((row) => [
      row._id,
      row.status,
      row.lifecycleRevision,
      row.lastCorrelationId,
    ]),
    grants: storePosGrants.map((row) => [
      row._id,
      row.servicePrincipalId,
      row.status,
      row.revision,
    ]),
    bindings: storeBindings.map((row) => [
      row._id,
      row.authUserId,
      row.servicePrincipalId,
      row.status,
      row.revision,
    ]),
    boundTransportUsers: boundTransportUsers.map((user) =>
      user
        ? [
            user._id,
            isNeutralTransportAuthUser(user),
            typeof user.email === "string" ? normalizeEmail(user.email) : null,
          ]
        : null,
    ),
    credential: credential
      ? buildPosServicePrincipalCredentialCensusState(credential)
      : null,
    terminals: terminals.map((terminal) => [
      terminal._id,
      terminal.storeId,
      terminal.organizationId,
      terminal.status,
      terminal.lifecycleRevision ?? 1,
      terminal.proofRevision ?? 1,
      terminal.syncSecretHash,
      terminal.lastServicePrincipalRecoveryAt,
      terminal.servicePrincipalRecoveryVersion,
    ]),
    legacy: {
      athenaUserIds: legacyAthenaUsers.map((row) => row._id),
      authUserIds: authUsers.map((row) => row._id),
      legacyMemberships: legacyMemberships.map((row) => [row._id, row.role]),
      humanPosOnlyMembershipCount,
    },
  });

  return {
    action,
    censusFingerprint,
    conflicts: normalizedConflicts,
    credential,
    humanPosOnlyMembershipCount,
    organizationId,
    pendingTerminalCount,
    principal,
    store,
    terminalCount: terminals.length,
    terminals,
  };
}

async function getCandidateWithCtx(
  ctx: MutationCtx,
  runId: Id<"posServicePrincipalMigrationRun">,
  storeId: Id<"store">,
) {
  const candidates = await ctx.db
    .query("posServicePrincipalMigrationCandidate")
    .withIndex("by_runId_storeId", (query) =>
      query.eq("runId", runId).eq("storeId", storeId),
    )
    .take(2);
  if (candidates.length > 1) throw new Error("duplicate_migration_candidate");
  return candidates[0] ?? null;
}

async function getStoreStateWithCtx(ctx: MutationCtx, storeId: Id<"store">) {
  const states = await ctx.db
    .query("posServicePrincipalMigrationStoreState")
    .withIndex("by_storeId", (query) => query.eq("storeId", storeId))
    .take(2);
  if (states.length > 1) throw new Error("duplicate_store_migration_state");
  return states[0] ?? null;
}

async function ensureTerminalEvidenceWithCtx(
  ctx: MutationCtx,
  args: {
    now: number;
    organizationId: Id<"organization">;
    servicePrincipalId: Id<"servicePrincipal">;
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
) {
  const existing = await ctx.db
    .query("posServicePrincipalMigrationTerminalEvidence")
    .withIndex("by_storeId_terminalId", (query) =>
      query.eq("storeId", args.storeId).eq("terminalId", args.terminal._id),
    )
    .take(2);
  if (existing.length > 1) throw new Error("duplicate_terminal_evidence");
  if (existing[0]) return existing[0];
  const isActive = args.terminal.status === "active";
  const id = await ctx.db.insert(
    "posServicePrincipalMigrationTerminalEvidence",
    {
      createdAt: args.now,
      ...(isActive
        ? {}
        : { disposition: `preexisting_${args.terminal.status}` }),
      organizationId: args.organizationId,
      servicePrincipalId: args.servicePrincipalId,
      status: isActive ? "pending" : "dispositioned",
      storeId: args.storeId,
      terminalId: args.terminal._id,
      terminalLifecycleRevision: args.terminal.lifecycleRevision ?? 1,
      terminalProofRevision: args.terminal.proofRevision ?? 1,
      updatedAt: args.now,
    },
  );
  return (await ctx.db.get(
    "posServicePrincipalMigrationTerminalEvidence",
    id,
  ))!;
}

async function reconcileNeutralTransportBindingWithCtx(
  ctx: MutationCtx,
  args: {
    correlationId: string;
    now: number;
    organizationId: Id<"organization">;
    servicePrincipalId: Id<"servicePrincipal">;
    storeId: Id<"store">;
  },
) {
  const bindings = await ctx.db
    .query("servicePrincipalAuthBinding")
    .withIndex("by_servicePrincipalId", (query) =>
      query.eq("servicePrincipalId", args.servicePrincipalId),
    )
    .take(2);
  if (bindings.length > 1) throw new Error("transport_binding_duplicate");
  const existing = bindings[0];
  if (existing) {
    if (
      existing.organizationId !== args.organizationId ||
      existing.storeId !== args.storeId ||
      existing.status !== "active"
    ) {
      throw new Error("transport_binding_scope_or_status_mismatch");
    }
    const authUser = await ctx.db.get("users", existing.authUserId);
    if (!authUser) throw new Error("transport_auth_user_missing");
    if (!isNeutralTransportAuthUser(authUser)) {
      throw new Error("transport_auth_user_not_neutral");
    }
    return {
      authUserId: existing.authUserId,
      created: false,
      servicePrincipalAuthBindingId: existing._id,
    };
  }

  // The transport identity is intentionally a blank Auth user. Legacy
  // synthetic POS accounts remain census-only inputs and are never reused.
  const authUserId = await ctx.db.insert("users", {});
  const reconciled = await reconcileServicePrincipalAuthBinding(ctx as never, {
    authUserId,
    correlationId: args.correlationId,
    now: args.now,
    organizationId: args.organizationId,
    servicePrincipalId: args.servicePrincipalId,
    storeId: args.storeId,
  });
  return {
    authUserId,
    created: reconciled.created,
    servicePrincipalAuthBindingId:
      reconciled.servicePrincipalAuthBindingId as Id<"servicePrincipalAuthBinding">,
  };
}

async function applyStoreWithCtx(
  ctx: MutationCtx,
  census: StoreCensus,
  args: {
    now: number;
    previewRunId: Id<"posServicePrincipalMigrationRun">;
  },
  dependencies: MigrationDependencies,
) {
  const existingState = await getStoreStateWithCtx(ctx, census.store._id);
  if (existingState?.lastAppliedPreviewRunId === args.previewRunId) {
    return { changed: false, disposition: "already_applied" as const };
  }
  if (!census.credential) {
    throw new Error("migration_candidate_not_applicable");
  }
  const reconciled = await reconcilePosServicePrincipal(ctx as never, {
    correlationId: `pos-service-migration:${args.previewRunId}:${census.store._id}`,
    now: args.now,
    organizationId: census.organizationId,
    storeId: census.store._id,
  });
  await reconcileNeutralTransportBindingWithCtx(ctx, {
    correlationId: `pos-service-migration-binding:${args.previewRunId}:${census.store._id}`,
    now: args.now,
    organizationId: census.organizationId,
    servicePrincipalId: reconciled.servicePrincipalId,
    storeId: census.store._id,
  });
  if (census.credential.servicePrincipalId === undefined) {
    await ctx.db.patch("posRecoveryCredential", census.credential._id, {
      lastCorrelationId: `pos-service-migration:${args.previewRunId}:${census.store._id}`,
      servicePrincipalId: reconciled.servicePrincipalId,
    });
  }
  const migrateCredential =
    dependencies.migrateCredential ?? migrateLegacyRecoveryCredentialWithCtx;
  const credentialDisposition = await migrateCredential(ctx, {
    credentialId: census.credential._id,
    now: args.now,
  });
  const migratedCredential = await ctx.db.get(
    "posRecoveryCredential",
    census.credential._id,
  );
  if (
    migratedCredential &&
    hasKeyedVerifier(migratedCredential) &&
    migratedCredential.plaintextCode !== undefined
  ) {
    await ctx.db.patch("posRecoveryCredential", migratedCredential._id, {
      plaintextCode: undefined,
      plaintextRemovedAt: args.now,
    });
  }

  if (existingState) {
    await ctx.db.patch(
      "posServicePrincipalMigrationStoreState",
      existingState._id,
      {
        lastAppliedPreviewRunId: args.previewRunId,
        updatedAt: args.now,
      },
    );
  } else {
    await ctx.db.insert("posServicePrincipalMigrationStoreState", {
      legacyFallbackAllowed: true,
      lastAppliedPreviewRunId: args.previewRunId,
      mode: "compatibility",
      organizationId: census.organizationId,
      recordedCompatibilityMode: "compatibility",
      revision: 1,
      storeId: census.store._id,
      updatedAt: args.now,
    });
  }
  for (const terminal of census.terminals) {
    await ensureTerminalEvidenceWithCtx(ctx, {
      now: args.now,
      organizationId: census.organizationId,
      servicePrincipalId: reconciled.servicePrincipalId,
      storeId: census.store._id,
      terminal,
    });
  }
  return {
    changed: true,
    disposition: credentialDisposition.disposition,
  };
}

async function requireRunWithCtx(ctx: MutationCtx, args: BackfillArgs) {
  const operation = args.dryRun === false ? "apply" : "preview";
  const now = Date.now();
  if (operation === "apply") {
    if (!args.previewRunId) {
      throw new Error("A completed conflict-free preview is required.");
    }
    const preview = await ctx.db.get(
      "posServicePrincipalMigrationRun",
      args.previewRunId,
    );
    if (
      !preview ||
      preview.operation !== "preview" ||
      preview.status !== "completed" ||
      !preview.coverageComplete ||
      preview.conflictCount !== 0
    ) {
      throw new Error("A completed conflict-free preview is required.");
    }
  }
  if (args.runId) {
    const run = await ctx.db.get("posServicePrincipalMigrationRun", args.runId);
    if (
      !run ||
      run.operation !== operation ||
      run.automationIdentity !== args.automationIdentity ||
      run.previewRunId !== args.previewRunId
    ) {
      throw new Error("Migration run does not match this request.");
    }
    if (run.status !== "running") {
      return { now, operation, run, terminal: true as const };
    }
    const expectedCursor = run.cursor ?? null;
    if ((args.cursor ?? null) !== expectedCursor) {
      throw new Error("Migration cursor is stale.");
    }
    return { now, operation, run, terminal: false as const };
  }
  if (args.cursor) throw new Error("A run ID is required for this cursor.");
  const runId = await ctx.db.insert("posServicePrincipalMigrationRun", {
    automationIdentity: args.automationIdentity,
    changedCount: 0,
    conflictCount: 0,
    coverageComplete: false,
    operation,
    ...(args.previewRunId ? { previewRunId: args.previewRunId } : {}),
    scannedCount: 0,
    startedAt: now,
    status: "running",
    updatedAt: now,
  });
  const run = (await ctx.db.get("posServicePrincipalMigrationRun", runId))!;
  return { now, operation, run, terminal: false as const };
}

export async function backfillStoreServicePrincipalsBatchWithCtx(
  ctx: MutationCtx,
  args: BackfillArgs,
  dependencies: MigrationDependencies = {},
) {
  const { now, operation, run, terminal } = await requireRunWithCtx(ctx, args);
  if (terminal) {
    return {
      candidates: [],
      changedCount: run.changedCount,
      conflictCount: run.conflictCount,
      continueCursor: null,
      coverageComplete: run.coverageComplete,
      isDone: true,
      runId: run._id,
      status: run.status as "running" | "completed" | "blocked",
    };
  }

  const page = await ctx.db.query("store").paginate({
    cursor: args.cursor ?? null,
    numItems: normalizeLimit(args.limit),
  });
  const candidates: Array<{
    action: string;
    conflicts: PosServicePrincipalMigrationConflict[];
    storeId: Id<"store">;
  }> = [];
  let changedCount = 0;
  let conflictCount = 0;

  for (const store of page.page) {
    const census = await censusStoreWithCtx(ctx, store);
    const blockingConflictCount = census.conflicts.filter((conflict) =>
      BLOCKING_CONFLICTS.has(conflict),
    ).length;
    conflictCount += blockingConflictCount;
    let action: string = census.action;

    if (operation === "apply") {
      const previewCandidate = await getCandidateWithCtx(
        ctx,
        args.previewRunId!,
        store._id,
      );
      const existingState = await getStoreStateWithCtx(ctx, store._id);
      if (existingState?.lastAppliedPreviewRunId === args.previewRunId) {
        action = "applied";
      } else {
        if (
          !previewCandidate ||
          previewCandidate.action === "conflict" ||
          previewCandidate.censusFingerprint !== census.censusFingerprint
        ) {
          throw new Error(`Migration preview is stale for store ${store._id}.`);
        }
        const applied = await applyStoreWithCtx(
          ctx,
          census,
          { now, previewRunId: args.previewRunId! },
          dependencies,
        );
        changedCount += applied.changed ? 1 : 0;
        action = "applied";
      }
    }

    const existingCandidate = await getCandidateWithCtx(
      ctx,
      run._id,
      store._id,
    );
    const candidateValue = {
      action: action as
        | "unchanged"
        | "reconcile"
        | "rotation_required"
        | "conflict"
        | "applied",
      censusFingerprint: census.censusFingerprint,
      conflicts: census.conflicts,
      humanPosOnlyMembershipCount: census.humanPosOnlyMembershipCount,
      organizationId: census.organizationId,
      pendingTerminalCount: census.pendingTerminalCount,
      runId: run._id,
      storeId: store._id,
      terminalCount: census.terminalCount,
      updatedAt: now,
      ...(action === "applied" ? { appliedAt: now } : {}),
    };
    if (existingCandidate) {
      await ctx.db.patch(
        "posServicePrincipalMigrationCandidate",
        existingCandidate._id,
        candidateValue,
      );
    } else {
      await ctx.db.insert("posServicePrincipalMigrationCandidate", {
        ...candidateValue,
        createdAt: now,
      });
    }
    candidates.push({
      action,
      conflicts: census.conflicts,
      storeId: store._id,
    });
  }

  const nextConflictCount = run.conflictCount + conflictCount;
  const nextStatus = !page.isDone
    ? "running"
    : nextConflictCount > 0
      ? "blocked"
      : "completed";
  const coverageComplete = page.isDone && nextConflictCount === 0;
  await ctx.db.patch("posServicePrincipalMigrationRun", run._id, {
    changedCount: run.changedCount + changedCount,
    completedAt: nextStatus === "running" ? undefined : now,
    conflictCount: nextConflictCount,
    coverageComplete,
    cursor: nextStatus === "running" ? page.continueCursor : undefined,
    scannedCount: run.scannedCount + page.page.length,
    status: nextStatus as "running" | "completed" | "blocked",
    updatedAt: now,
  });

  return {
    candidates,
    changedCount: run.changedCount + changedCount,
    conflictCount: nextConflictCount,
    continueCursor: nextStatus === "running" ? page.continueCursor : null,
    coverageComplete,
    isDone: nextStatus !== "running",
    runId: run._id,
    status: nextStatus as "running" | "completed" | "blocked",
  };
}

export function resolvePosMigrationAuthority(input: {
  legacyAuthorityValid: boolean;
  mode: "compatibility" | "shadow" | "enforced";
  newAuthorityValid: boolean;
}) {
  if (input.mode === "enforced") {
    return {
      authorization: input.newAuthorityValid ? "new" : "denied",
      legacyFallbackAttempted: false,
      shadowResult: null,
    } as const;
  }
  if (input.mode === "shadow") {
    return {
      authorization: input.legacyAuthorityValid ? "legacy" : "denied",
      legacyFallbackAttempted: true,
      shadowResult: input.newAuthorityValid ? "would_authorize" : "would_deny",
    } as const;
  }
  return {
    authorization: input.newAuthorityValid
      ? "new"
      : input.legacyAuthorityValid
        ? "legacy"
        : "denied",
    legacyFallbackAttempted: !input.newAuthorityValid,
    shadowResult: null,
  } as const;
}

export function evaluatePosMigrationRollback(input: {
  globalRetiredAt?: number;
  now: number;
  rollbackDeadlineAt?: number;
}) {
  if (input.globalRetiredAt !== undefined) {
    return { allowed: false, reason: "global_authority_retired" } as const;
  }
  if (
    input.rollbackDeadlineAt === undefined ||
    input.now > input.rollbackDeadlineAt
  ) {
    return { allowed: false, reason: "rollback_deadline_passed" } as const;
  }
  return { allowed: true, reason: null } as const;
}

export function evaluatePosGlobalRetirement(input: {
  activeStoreCount: number;
  conflictedStoreCount: number;
  enforcedStoreCount: number;
  latestRollbackDeadlineAt?: number;
  now: number;
  pendingTerminalCount: number;
  plaintextCredentialCount: number;
  rotationRequiredCredentialCount: number;
}) {
  const blockers: string[] = [];
  if (input.conflictedStoreCount > 0) blockers.push("conflicted_stores");
  if (input.enforcedStoreCount !== input.activeStoreCount) {
    blockers.push("stores_not_enforced");
  }
  if (input.pendingTerminalCount > 0) blockers.push("terminals_not_recovered");
  if (input.plaintextCredentialCount > 0) {
    blockers.push("plaintext_credentials_present");
  }
  if (input.rotationRequiredCredentialCount > 0) {
    blockers.push("credential_rotation_required");
  }
  if (
    input.latestRollbackDeadlineAt === undefined ||
    input.now <= input.latestRollbackDeadlineAt
  ) {
    blockers.push("rollback_window_open");
  }
  return { allowed: blockers.length === 0, blockers };
}

export async function transitionPosServicePrincipalMigrationModeWithCtx(
  ctx: MutationCtx,
  args: {
    expectedRevision: number;
    globalRetiredAt?: number;
    nextMode: "compatibility" | "shadow" | "enforced";
    now: number;
    rollbackDeadlineAt?: number;
    storeId: Id<"store">;
  },
) {
  const state = await getStoreStateWithCtx(ctx, args.storeId);
  if (!state) throw new Error("store_migration_state_missing");
  if (state.revision !== args.expectedRevision) {
    throw new Error("stale_migration_revision");
  }
  if (state.mode === args.nextMode) return state;

  if (args.nextMode === "shadow") {
    if (
      state.mode !== "compatibility" ||
      args.rollbackDeadlineAt === undefined ||
      args.rollbackDeadlineAt <= args.now
    ) {
      throw new Error("invalid_shadow_transition");
    }
  } else if (args.nextMode === "enforced") {
    if (state.mode !== "shadow") throw new Error("shadow_required");
    const store = await ctx.db.get("store", args.storeId);
    if (!store) throw new Error("store_missing");
    const census = await censusStoreWithCtx(ctx, store);
    const blocking = census.conflicts.filter((conflict) =>
      BLOCKING_CONFLICTS.has(conflict),
    );
    if (
      blocking.length > 0 ||
      census.pendingTerminalCount > 0 ||
      !census.credential ||
      !hasKeyedVerifier(census.credential) ||
      census.credential.status === "revoked" ||
      census.credential.legacyMigrationStatus === "rotation_required"
    ) {
      throw new Error("store_migration_not_ready");
    }
  } else {
    const rollback = evaluatePosMigrationRollback({
      globalRetiredAt: args.globalRetiredAt,
      now: args.now,
      rollbackDeadlineAt: state.rollbackDeadlineAt,
    });
    if (!rollback.allowed) throw new Error(rollback.reason);
  }

  const revision = state.revision + 1;
  await ctx.db.patch("posServicePrincipalMigrationStoreState", state._id, {
    legacyFallbackAllowed: args.nextMode !== "enforced",
    mode: args.nextMode,
    revision,
    updatedAt: args.now,
    ...(args.nextMode === "shadow"
      ? {
          rollbackDeadlineAt: args.rollbackDeadlineAt,
          shadowStartedAt: args.now,
        }
      : {}),
    ...(args.nextMode === "enforced" ? { enforcedAt: args.now } : {}),
  });
  return ctx.db.get("posServicePrincipalMigrationStoreState", state._id);
}

const batchResultValidator = v.object({
  candidates: v.array(
    v.object({
      action: v.string(),
      conflicts: v.array(v.string()),
      storeId: v.id("store"),
    }),
  ),
  changedCount: v.number(),
  conflictCount: v.number(),
  continueCursor: v.union(v.string(), v.null()),
  coverageComplete: v.boolean(),
  isDone: v.boolean(),
  runId: v.id("posServicePrincipalMigrationRun"),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("blocked"),
  ),
});

export const backfillStoreServicePrincipalsBatch = internalMutation({
  args: {
    automationIdentity: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    previewRunId: v.optional(v.id("posServicePrincipalMigrationRun")),
    runId: v.optional(v.id("posServicePrincipalMigrationRun")),
  },
  returns: batchResultValidator,
  handler: backfillStoreServicePrincipalsBatchWithCtx,
});
