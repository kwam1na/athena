import { v } from "convex/values";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";

import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "../../_generated/server";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import {
  POS_APPLICATION_CAPABILITY_ID,
  POS_SERVICE_PRINCIPAL_CONSUMER_ID,
  resolvePosApplicationCapability,
} from "../application/posServicePrincipal";
import { issueServicePrincipalSession } from "../../servicePrincipals/lifecycle";
import { requirePosApplicationAuthorityWithCtx } from "../application/posApplicationAuthority";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import { issuePosOfflineAuthorityReceipt } from "../application/offlineAuthorityReceipt";
import { recordPosTerminalMigrationRecoveryWithCtx } from "../application/posServicePrincipalMigrationEvidence";

const ASSERTION_TTL_MS = 5 * 60 * 1000;
const POS_HUB_ROUTE_SCOPE = "pos_hub";
const POS_SERVICE_SESSION_IDLE_DURATION_MS = 12 * 60 * 60 * 1000;
const POS_SERVICE_SESSION_ABSOLUTE_DURATION_MS = 24 * 60 * 60 * 1000;
const GENERIC_EXACT_SESSION_FAILURE =
  "POS session recovery could not be completed.";
const POS_RECOVERY_CLEANUP_TOKEN_PAGE_SIZE = 20;
const POS_RECOVERY_CLEANUP_MAX_EXCHANGES = 25;

const blockedReasonValidator = v.union(
  v.literal("missing_terminal_proof"),
  v.literal("terminal_not_available"),
  v.literal("invalid_terminal_proof"),
  v.literal("store_mismatch"),
  v.literal("terminal_revoked"),
  v.literal("app_account_disabled"),
  v.literal("app_account_not_pos_scoped"),
  v.literal("unsupported_route_scope"),
);

const recoveryDiagnosticsValidator = v.object({
  reason: v.union(v.literal("validated"), blockedReasonValidator),
});

const recoveryAssertionValidator = v.object({
  accountId: v.id("athenaUser"),
  expiresAt: v.number(),
  issuedAt: v.number(),
  recoveryAttemptId: v.string(),
  routeScope: v.literal(POS_HUB_ROUTE_SCOPE),
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
});

const recoveryResultValidator = v.union(
  v.object({
    assertion: recoveryAssertionValidator,
    diagnostics: recoveryDiagnosticsValidator,
    status: v.literal("recoverable"),
  }),
  v.object({
    diagnostics: recoveryDiagnosticsValidator,
    reason: blockedReasonValidator,
    status: v.literal("blocked"),
  }),
  v.object({
    diagnostics: v.object({
      reason: v.literal("transient_failure"),
    }),
    status: v.literal("retryable"),
  }),
);

type TerminalAppSessionRecoveryArgs = {
  accountId: Id<"athenaUser">;
  metadata?: Record<string, unknown>;
  routeIntent: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  terminalProof?: string;
};

type TerminalAppSessionRecoveryBlockedReason =
  | "missing_terminal_proof"
  | "terminal_not_available"
  | "invalid_terminal_proof"
  | "store_mismatch"
  | "terminal_revoked"
  | "app_account_disabled"
  | "app_account_not_pos_scoped"
  | "unsupported_route_scope";

type TerminalAppSessionRecoveryResult =
  | {
      assertion: {
        accountId: Id<"athenaUser">;
        expiresAt: number;
        issuedAt: number;
        recoveryAttemptId: string;
        routeScope: typeof POS_HUB_ROUTE_SCOPE;
        storeId: Id<"store">;
        terminalId: Id<"posTerminal">;
      };
      diagnostics: {
        reason: "validated";
      };
      status: "recoverable";
    }
  | {
      diagnostics: {
        reason: TerminalAppSessionRecoveryBlockedReason;
      };
      reason: TerminalAppSessionRecoveryBlockedReason;
      status: "blocked";
    }
  | {
      diagnostics: {
        reason: "transient_failure";
      };
      status: "retryable";
    };

type TerminalAppSessionRecoveryCtx = Pick<MutationCtx, "db">;

function blocked(
  reason: TerminalAppSessionRecoveryBlockedReason,
): TerminalAppSessionRecoveryResult {
  return {
    status: "blocked",
    reason,
    diagnostics: { reason },
  };
}

function buildRecoveryAttemptId(args: {
  accountId: Id<"athenaUser">;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
}) {
  return [
    "pos-terminal-app-session",
    args.storeId,
    args.terminalId,
    args.accountId,
    POS_HUB_ROUTE_SCOPE,
  ].join(":");
}

async function recordRecoveryEvent(
  ctx: TerminalAppSessionRecoveryCtx,
  args: {
    accountId?: Id<"athenaUser">;
    eventType: string;
    organizationId?: Id<"organization">;
    reason: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  await recordOperationalEventWithCtx(ctx as MutationCtx, {
    storeId: args.storeId,
    organizationId: args.organizationId,
    eventType: args.eventType,
    subjectType: "posTerminal",
    subjectId: args.terminalId,
    reason: args.reason,
    message: "POS terminal app-session recovery validation updated.",
    metadata: {
      accountId: args.accountId,
      reason: args.reason,
      routeScope: POS_HUB_ROUTE_SCOPE,
    },
    metadataDedupeKeys: ["accountId"],
  });
}

async function getOrganizationMemberForAccount(
  ctx: TerminalAppSessionRecoveryCtx,
  args: {
    accountId: Id<"athenaUser">;
    organizationId: Id<"organization">;
  },
) {
  return ctx.db
    .query("organizationMember")
    .filter((q) =>
      q.and(
        q.eq(q.field("organizationId"), args.organizationId),
        q.eq(q.field("userId"), args.accountId),
      ),
    )
    .first();
}

async function validatePosAppAccount(
  ctx: TerminalAppSessionRecoveryCtx,
  args: {
    accountId: Id<"athenaUser">;
    organizationId: Id<"organization">;
  },
): Promise<TerminalAppSessionRecoveryBlockedReason | null> {
  const account = await ctx.db.get("athenaUser", args.accountId);
  if (!account) {
    return "app_account_disabled";
  }

  const membership = await getOrganizationMemberForAccount(ctx, args);
  if (!membership) {
    return "app_account_disabled";
  }

  return membership.role === "pos_only" ? null : "app_account_not_pos_scoped";
}

export async function validateTerminalAppSessionRecoveryWithCtx(
  ctx: TerminalAppSessionRecoveryCtx,
  args: TerminalAppSessionRecoveryArgs,
): Promise<TerminalAppSessionRecoveryResult> {
  if (args.routeIntent !== POS_HUB_ROUTE_SCOPE) {
    return blocked("unsupported_route_scope");
  }

  const terminalProof = args.terminalProof?.trim();
  if (!terminalProof) {
    return blocked("missing_terminal_proof");
  }

  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  if (!terminal) {
    return blocked("terminal_not_available");
  }

  if (!terminal.syncSecretHash) {
    return blocked("invalid_terminal_proof");
  }

  const submittedProofHash = await hashPosTerminalSyncSecret(terminalProof);
  if (terminal.syncSecretHash !== submittedProofHash) {
    return blocked("invalid_terminal_proof");
  }

  const terminalStore = await ctx.db.get("store", terminal.storeId);
  if (terminal.storeId !== args.storeId) {
    await recordRecoveryEvent(ctx, {
      accountId: args.accountId,
      eventType: "pos_terminal_app_session_recovery_blocked",
      organizationId: terminalStore?.organizationId,
      reason: "store_mismatch",
      storeId: terminal.storeId,
      terminalId: terminal._id,
    });
    return blocked("store_mismatch");
  }

  if (terminal.status !== "active") {
    await recordRecoveryEvent(ctx, {
      accountId: args.accountId,
      eventType: "pos_terminal_app_session_recovery_blocked",
      organizationId: terminalStore?.organizationId,
      reason: "terminal_revoked",
      storeId: args.storeId,
      terminalId: terminal._id,
    });
    return blocked("terminal_revoked");
  }

  const store = terminalStore ?? (await ctx.db.get("store", args.storeId));
  if (!store) {
    return blocked("terminal_not_available");
  }

  const accountBlockReason = await validatePosAppAccount(ctx, {
    accountId: args.accountId,
    organizationId: store.organizationId,
  });
  if (accountBlockReason) {
    await recordRecoveryEvent(ctx, {
      accountId: args.accountId,
      eventType: "pos_terminal_app_session_recovery_blocked",
      organizationId: store.organizationId,
      reason: accountBlockReason,
      storeId: args.storeId,
      terminalId: terminal._id,
    });
    return blocked(accountBlockReason);
  }

  await recordRecoveryEvent(ctx, {
    accountId: args.accountId,
    eventType: "pos_terminal_app_session_recovery_validated",
    organizationId: store.organizationId,
    reason: "validated",
    storeId: args.storeId,
    terminalId: terminal._id,
  });

  const issuedAt = Date.now();
  return {
    status: "recoverable",
    assertion: {
      accountId: args.accountId,
      issuedAt,
      expiresAt: issuedAt + ASSERTION_TTL_MS,
      recoveryAttemptId: buildRecoveryAttemptId(args),
      routeScope: POS_HUB_ROUTE_SCOPE,
      storeId: args.storeId,
      terminalId: terminal._id,
    },
    diagnostics: {
      reason: "validated",
    },
  };
}

export const validateTerminalAppSessionRecovery = mutation({
  args: {
    accountId: v.id("athenaUser"),
    metadata: v.optional(v.record(v.string(), v.any())),
    routeIntent: v.string(),
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    terminalProof: v.optional(v.string()),
  },
  returns: recoveryResultValidator,
  handler: (ctx, args) => validateTerminalAppSessionRecoveryWithCtx(ctx, args),
});

const exactSessionActivationResultValidator = v.union(
  v.object({ status: v.literal("code_required") }),
  v.object({
    authorityExpiresAt: v.number(),
    offlineAuthorityReceipt: v.string(),
    posApplicationSessionBindingId: v.id("posApplicationSessionBinding"),
    servicePrincipalSessionId: v.id("servicePrincipalSession"),
    status: v.literal("activated"),
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  }),
);

async function getOnlyExchangeForAuthSession(
  ctx: Pick<MutationCtx, "db">,
  authSessionId: Id<"authSessions">,
) {
  const exchanges = await ctx.db
    .query("posRecoveryExchange")
    .withIndex("by_authSessionId", (query) =>
      query.eq("authSessionId", authSessionId),
    )
    .take(2);
  if (exchanges.length !== 1) throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  return exchanges[0];
}

async function validateCurrentExchangeAuthority(
  ctx: MutationCtx,
  exchange: Doc<"posRecoveryExchange">,
  now: number,
) {
  const [store, principal, authBinding, terminal, credential, authSession] =
    await Promise.all([
      ctx.db.get("store", exchange.storeId),
      ctx.db.get("servicePrincipal", exchange.servicePrincipalId),
      ctx.db.get(
        "servicePrincipalAuthBinding",
        exchange.servicePrincipalAuthBindingId,
      ),
      ctx.db.get("posTerminal", exchange.terminalId),
      ctx.db.get("posRecoveryCredential", exchange.posRecoveryCredentialId),
      ctx.db.get("authSessions", exchange.authSessionId),
    ]);
  if (
    !store ||
    !principal ||
    !authBinding ||
    !terminal ||
    !credential ||
    !authSession ||
    store.organizationId !== exchange.organizationId ||
    principal.organizationId !== exchange.organizationId ||
    principal.storeId !== exchange.storeId ||
    principal.status !== "active" ||
    principal.lifecycleRevision !== exchange.principalLifecycleRevision ||
    authBinding.organizationId !== exchange.organizationId ||
    authBinding.storeId !== exchange.storeId ||
    authBinding.servicePrincipalId !== exchange.servicePrincipalId ||
    authBinding.authUserId !== exchange.authUserId ||
    authBinding.status !== "active" ||
    terminal.storeId !== exchange.storeId ||
    (terminal.organizationId !== undefined &&
      terminal.organizationId !== exchange.organizationId) ||
    terminal.status !== "active" ||
    (terminal.lifecycleRevision ?? 1) !== exchange.terminalLifecycleRevision ||
    (terminal.proofRevision ?? 1) !== exchange.terminalProofRevision ||
    credential.storeId !== exchange.storeId ||
    credential.organizationId !== exchange.organizationId ||
    (credential.servicePrincipalId !== undefined &&
      credential.servicePrincipalId !== exchange.servicePrincipalId) ||
    credential.status !== "active" ||
    (credential.credentialRevision ?? 1) !== exchange.credentialRevision ||
    authSession.userId !== exchange.authUserId ||
    authSession.expirationTime <= now
  ) {
    throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  }
  const grant = await resolvePosApplicationCapability(ctx as never, {
    now,
    organizationId: exchange.organizationId,
    servicePrincipalId: exchange.servicePrincipalId,
    storeId: exchange.storeId,
  });
  if (
    grant.grantId !== exchange.capabilityGrantId ||
    grant.revision !== exchange.capabilityRevision ||
    grant.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    grant.capabilityId !== POS_APPLICATION_CAPABILITY_ID
  ) {
    throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  }
  return { credential, principal, terminal };
}

export async function activatePreparedPosTerminalSessionWithCtx(
  ctx: MutationCtx,
  options: { now?: number } = {},
) {
  let activationStage = "load_auth_identity";
  try {
    const [authUserId, authSessionId] = await Promise.all([
      getAuthUserId(ctx),
      getAuthSessionId(ctx),
    ]);
    if (!authUserId || !authSessionId) {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
    activationStage = "load_prepared_exchange";
    const exchange = await getOnlyExchangeForAuthSession(ctx, authSessionId);
    if (
      exchange.authUserId !== authUserId ||
      exchange.authSessionId !== authSessionId
    ) {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
    const now = options.now ?? Date.now();

    if (exchange.status === "activated") {
      activationStage = "reload_activated_session";
      if (
        !exchange.servicePrincipalSessionId ||
        !exchange.posApplicationSessionBindingId
      ) {
        throw new Error(GENERIC_EXACT_SESSION_FAILURE);
      }
      const retainedSession = await ctx.db.get(
        "servicePrincipalSession",
        exchange.servicePrincipalSessionId,
      );
      const retainedBinding = await ctx.db.get(
        "posApplicationSessionBinding",
        exchange.posApplicationSessionBindingId,
      );
      if (
        !retainedSession ||
        retainedSession.status !== "active" ||
        retainedSession.absoluteExpiresAt <= now ||
        !retainedBinding ||
        retainedBinding.status !== "active" ||
        retainedBinding.servicePrincipalSessionId !== retainedSession._id ||
        retainedBinding.servicePrincipalId !== exchange.servicePrincipalId ||
        retainedBinding.storeId !== exchange.storeId ||
        retainedBinding.terminalId !== exchange.terminalId ||
        !retainedBinding.offlineAuthorityReceipt
      ) {
        throw new Error(GENERIC_EXACT_SESSION_FAILURE);
      }
      return {
        authorityExpiresAt: retainedSession.absoluteExpiresAt,
        offlineAuthorityReceipt: retainedBinding.offlineAuthorityReceipt,
        posApplicationSessionBindingId: exchange.posApplicationSessionBindingId,
        servicePrincipalSessionId: exchange.servicePrincipalSessionId,
        status: "activated" as const,
        storeId: exchange.storeId,
        terminalId: exchange.terminalId,
      };
    }

    if (exchange.status !== "prepared") {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
    if (exchange.expiresAt <= now) {
      activationStage = "abort_expired_exchange";
      await abortPreparedPosTerminalSessionWithCtx(
        ctx,
        {
          recoveryCorrelationKey: exchange.recoveryCorrelationKey,
          terminalId: exchange.terminalId,
        },
        { now },
      );
      return { status: "code_required" as const };
    }
    activationStage = "validate_current_authority";
    const { terminal } = await validateCurrentExchangeAuthority(
      ctx,
      exchange,
      now,
    );
    activationStage = "issue_service_session";
    const issued = await issueServicePrincipalSession(ctx as never, {
      absoluteExpiresAt: now + POS_SERVICE_SESSION_ABSOLUTE_DURATION_MS,
      authSessionId,
      authUserId,
      capabilityRevision: exchange.capabilityRevision,
      consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
      correlationId: exchange.recoveryCorrelationKey,
      idleExpiresAt: now + POS_SERVICE_SESSION_IDLE_DURATION_MS,
      now,
      organizationId: exchange.organizationId,
      principalLifecycleRevision: exchange.principalLifecycleRevision,
      requiredCapabilityId: POS_APPLICATION_CAPABILITY_ID,
      servicePrincipalAuthBindingId: exchange.servicePrincipalAuthBindingId,
      servicePrincipalId: exchange.servicePrincipalId,
      storeId: exchange.storeId,
    });
    if (issued.status !== "active") {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }

    activationStage = "load_predecessor_binding";
    const predecessors = await ctx.db
      .query("posApplicationSessionBinding")
      .withIndex(
        "by_servicePrincipalId_and_terminalId_and_consumerId_and_status",
        (query) =>
          query
            .eq("servicePrincipalId", exchange.servicePrincipalId)
            .eq("terminalId", exchange.terminalId)
            .eq("consumerId", POS_SERVICE_PRINCIPAL_CONSUMER_ID)
            .eq("status", "active"),
      )
      .take(2);
    if (predecessors.length > 1) {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
    activationStage = "create_application_binding";
    const posApplicationSessionBindingId = await ctx.db.insert(
      "posApplicationSessionBinding",
      {
        organizationId: exchange.organizationId,
        storeId: exchange.storeId,
        servicePrincipalId: exchange.servicePrincipalId,
        servicePrincipalSessionId: issued.servicePrincipalSessionId,
        terminalId: exchange.terminalId,
        posRecoveryCredentialId: exchange.posRecoveryCredentialId,
        capabilityGrantId: exchange.capabilityGrantId,
        consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
        capabilityId: POS_APPLICATION_CAPABILITY_ID,
        status: "active",
        revision: 1,
        principalLifecycleRevision: exchange.principalLifecycleRevision,
        capabilityRevision: exchange.capabilityRevision,
        credentialRevision: exchange.credentialRevision,
        terminalLifecycleRevision: exchange.terminalLifecycleRevision,
        terminalProofRevision: exchange.terminalProofRevision,
        activatedAt: now,
        updatedAt: now,
        lastCorrelationId: exchange.recoveryCorrelationKey,
      },
    );
    activationStage = "issue_offline_authority_receipt";
    const offlineAuthorityReceipt = await issuePosOfflineAuthorityReceipt({
      authorityExpiresAt: issued.absoluteExpiresAt,
      capabilityRevision: exchange.capabilityRevision,
      credentialRevision: exchange.credentialRevision,
      issuedAt: now,
      posApplicationSessionBindingId,
      principalLifecycleRevision: exchange.principalLifecycleRevision,
      servicePrincipalId: exchange.servicePrincipalId,
      servicePrincipalSessionId: issued.servicePrincipalSessionId,
      storeId: exchange.storeId,
      terminalId: exchange.terminalId,
      terminalLifecycleRevision: exchange.terminalLifecycleRevision,
      terminalProofRevision: exchange.terminalProofRevision,
    });
    activationStage = "attach_offline_authority_receipt";
    await ctx.db.patch(
      "posApplicationSessionBinding",
      posApplicationSessionBindingId,
      {
        offlineAuthorityReceipt,
      },
    );

    // The new authority is already present in this transaction before its
    // same-terminal predecessor is superseded. Sibling terminal lineages are
    // never selected by this index.
    activationStage = "supersede_predecessor_binding";
    const predecessor = predecessors[0];
    if (predecessor) {
      await ctx.db.patch("posApplicationSessionBinding", predecessor._id, {
        lastCorrelationId: exchange.recoveryCorrelationKey,
        revision: predecessor.revision + 1,
        status: "superseded",
        supersededAt: now,
        updatedAt: now,
      });
      const predecessorSession = await ctx.db.get(
        "servicePrincipalSession",
        predecessor.servicePrincipalSessionId,
      );
      if (predecessorSession?.status === "active") {
        await ctx.db.patch("servicePrincipalSession", predecessorSession._id, {
          lastCorrelationId: exchange.recoveryCorrelationKey,
          revision: predecessorSession.revision + 1,
          status: "superseded",
          supersededAt: now,
          updatedAt: now,
        });
      }
    }

    activationStage = "activate_exchange";
    await ctx.db.patch("posRecoveryExchange", exchange._id, {
      activatedAt: now,
      lastCorrelationId: exchange.recoveryCorrelationKey,
      posApplicationSessionBindingId,
      revision: exchange.revision + 1,
      servicePrincipalSessionId: issued.servicePrincipalSessionId,
      status: "activated",
      updatedAt: now,
    });
    activationStage = "record_terminal_recovery";
    const recoveryVersion = (terminal.servicePrincipalRecoveryVersion ?? 0) + 1;
    await ctx.db.patch("posTerminal", terminal._id, {
      lastCorrelationId: exchange.recoveryCorrelationKey,
      lastServicePrincipalRecoveryAt: now,
      servicePrincipalRecoveryVersion: recoveryVersion,
    });
    activationStage = "record_migration_evidence";
    await recordPosTerminalMigrationRecoveryWithCtx(ctx, {
      credentialId: exchange.posRecoveryCredentialId,
      credentialRevision: exchange.credentialRevision,
      now,
      organizationId: exchange.organizationId,
      posApplicationSessionBindingId,
      recoveryVersion,
      servicePrincipalId: exchange.servicePrincipalId,
      servicePrincipalSessionId: issued.servicePrincipalSessionId,
      storeId: exchange.storeId,
      terminalId: exchange.terminalId,
    });
    activationStage = "record_operational_event";
    await recordOperationalEventWithCtx(ctx, {
      actorServicePrincipalId: exchange.servicePrincipalId,
      actorServicePrincipalSessionId: issued.servicePrincipalSessionId,
      actorType: "service_principal",
      eventType: "pos_service_session_activated",
      metadata: { recoveryCorrelationKey: exchange.recoveryCorrelationKey },
      metadataDedupeKeys: ["recoveryCorrelationKey"],
      organizationId: exchange.organizationId,
      reason: "exact_session_activated",
      servicePrincipalId: exchange.servicePrincipalId,
      servicePrincipalSessionId: issued.servicePrincipalSessionId,
      storeId: exchange.storeId,
      subjectId: posApplicationSessionBindingId,
      subjectType: "posApplicationSessionBinding",
      terminalId: exchange.terminalId,
    });

    activationStage = "complete";
    return {
      authorityExpiresAt: issued.absoluteExpiresAt,
      offlineAuthorityReceipt,
      posApplicationSessionBindingId,
      servicePrincipalSessionId: issued.servicePrincipalSessionId,
      status: "activated" as const,
      storeId: exchange.storeId,
      terminalId: exchange.terminalId,
    };
  } catch (error) {
    console.error("POS exact-session activation stage failed", {
      activationStage,
      reason:
        error instanceof Error ? error.message : "unknown_activation_error",
    });
    throw error;
  }
}

export const activatePreparedPosTerminalSession = mutation({
  args: {},
  returns: exactSessionActivationResultValidator,
  handler: async (ctx) => {
    try {
      return await activatePreparedPosTerminalSessionWithCtx(ctx);
    } catch {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
  },
});

async function loadOnlyExchangeByCorrelationKey(
  ctx: Pick<MutationCtx, "db">,
  recoveryCorrelationKey: string,
) {
  const exchanges = await ctx.db
    .query("posRecoveryExchange")
    .withIndex("by_recoveryCorrelationKey", (query) =>
      query.eq("recoveryCorrelationKey", recoveryCorrelationKey),
    )
    .take(2);
  if (exchanges.length !== 1) throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  return exchanges[0];
}

export async function abortPreparedPosTerminalSessionWithCtx(
  ctx: MutationCtx,
  args: {
    recoveryCorrelationKey: string;
    terminalId: Id<"posTerminal">;
    terminalProof?: string;
  },
  options: { now?: number } = {},
) {
  const exchange = await loadOnlyExchangeByCorrelationKey(
    ctx,
    args.recoveryCorrelationKey.trim(),
  );
  if (exchange.terminalId !== args.terminalId) {
    throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  }
  const refreshTokens = await ctx.db
    .query("authRefreshTokens")
    .withIndex("sessionId", (query) =>
      query.eq("sessionId", exchange.authSessionId),
    )
    .take(20);
  if (refreshTokens.length === 20) {
    throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  }

  const [authUserId, authSessionId] = await Promise.all([
    getAuthUserId(ctx),
    getAuthSessionId(ctx),
  ]);
  const abortedByExactSession =
    authUserId === exchange.authUserId &&
    authSessionId === exchange.authSessionId;
  if (refreshTokens.length > 0 && !abortedByExactSession) {
    throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  }
  if (!abortedByExactSession) {
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    const terminalProof = args.terminalProof?.trim();
    if (!terminal || !terminalProof || !terminal.syncSecretHash) {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
    const submittedProofHash = await hashPosTerminalSyncSecret(terminalProof);
    if (
      submittedProofHash !== terminal.syncSecretHash ||
      terminal.storeId !== exchange.storeId
    ) {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
  }

  if (exchange.status !== "prepared" && exchange.status !== "aborted") {
    throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  }
  const now = options.now ?? Date.now();
  for (const refreshToken of refreshTokens) {
    await ctx.db.delete("authRefreshTokens", refreshToken._id);
  }
  const authSession = await ctx.db.get("authSessions", exchange.authSessionId);
  if (authSession) await ctx.db.delete("authSessions", authSession._id);
  if (exchange.status === "aborted") return { status: "aborted" as const };
  await ctx.db.patch("posRecoveryExchange", exchange._id, {
    abortedAt: now,
    lastCorrelationId: exchange.recoveryCorrelationKey,
    revision: exchange.revision + 1,
    status: "aborted",
    updatedAt: now,
  });
  await recordOperationalEventWithCtx(ctx, {
    eventType: "pos_service_session_recovery_aborted",
    metadata: { recoveryCorrelationKey: exchange.recoveryCorrelationKey },
    metadataDedupeKeys: ["recoveryCorrelationKey"],
    organizationId: exchange.organizationId,
    reason: abortedByExactSession ? "issued_session_abort" : "proof_abort",
    storeId: exchange.storeId,
    subjectId: exchange._id,
    subjectType: "posRecoveryExchange",
    terminalId: exchange.terminalId,
  });
  return { status: "aborted" as const };
}

export const abortPreparedPosTerminalSession = mutation({
  args: {
    recoveryCorrelationKey: v.string(),
    terminalId: v.id("posTerminal"),
    terminalProof: v.optional(v.string()),
  },
  returns: v.object({ status: v.literal("aborted") }),
  handler: async (ctx, args) => {
    try {
      return await abortPreparedPosTerminalSessionWithCtx(ctx, args);
    } catch {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
  },
});

export const cleanupExpiredPosRecoveryArtifacts = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ cleaned: v.number(), progressed: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(
      1,
      Math.min(
        POS_RECOVERY_CLEANUP_MAX_EXCHANGES,
        Math.floor(args.limit ?? POS_RECOVERY_CLEANUP_MAX_EXCHANGES),
      ),
    );
    const [expiredPrepared, aborted, cleanupPending] = await Promise.all([
      ctx.db
        .query("posRecoveryExchange")
        .withIndex("by_status_and_expiresAt", (query) =>
          query.eq("status", "prepared").lte("expiresAt", now),
        )
        .take(limit),
      ctx.db
        .query("posRecoveryExchange")
        .withIndex("by_status_and_expiresAt", (query) =>
          query.eq("status", "aborted").lte("expiresAt", now),
        )
        .take(limit),
      ctx.db
        .query("posRecoveryExchange")
        .withIndex("by_status_and_cleanupAttemptedAt", (query) =>
          query.eq("status", "cleanup_pending"),
        )
        .take(limit),
    ]);
    const exchanges = [...expiredPrepared, ...aborted, ...cleanupPending]
      .sort(
        (left, right) =>
          (left.cleanupAttemptedAt ?? left.expiresAt) -
            (right.cleanupAttemptedAt ?? right.expiresAt) ||
          left._creationTime - right._creationTime,
      )
      .slice(0, limit);
    let cleaned = 0;
    for (const exchange of exchanges) {
      const cleanupFinalStatus =
        exchange.status === "prepared"
          ? ("expired" as const)
          : exchange.status === "aborted"
            ? ("cleaned" as const)
            : exchange.cleanupFinalStatus;
      if (!cleanupFinalStatus) {
        throw new Error(GENERIC_EXACT_SESSION_FAILURE);
      }
      const refreshTokenPage = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (query) =>
          query.eq("sessionId", exchange.authSessionId),
        )
        .take(POS_RECOVERY_CLEANUP_TOKEN_PAGE_SIZE + 1);
      const refreshTokens = refreshTokenPage.slice(
        0,
        POS_RECOVERY_CLEANUP_TOKEN_PAGE_SIZE,
      );
      for (const refreshToken of refreshTokens) {
        await ctx.db.delete("authRefreshTokens", refreshToken._id);
      }
      if (refreshTokenPage.length > POS_RECOVERY_CLEANUP_TOKEN_PAGE_SIZE) {
        await ctx.db.patch("posRecoveryExchange", exchange._id, {
          cleanupAttemptedAt: now,
          cleanupFinalStatus,
          cleanupStartedAt: exchange.cleanupStartedAt ?? now,
          revision: exchange.revision + 1,
          status: "cleanup_pending",
          updatedAt: now,
        });
        continue;
      }
      const authSession = await ctx.db.get(
        "authSessions",
        exchange.authSessionId,
      );
      if (authSession) {
        await ctx.db.delete("authSessions", authSession._id);
      }
      if (cleanupFinalStatus === "expired") {
        await ctx.db.patch("posRecoveryExchange", exchange._id, {
          cleanupAttemptedAt: now,
          cleanupFinalStatus,
          cleanupStartedAt: exchange.cleanupStartedAt ?? now,
          expiredAt: now,
          revision: exchange.revision + 1,
          status: "expired",
          updatedAt: now,
        });
      } else {
        await ctx.db.patch("posRecoveryExchange", exchange._id, {
          cleanedAt: now,
          cleanupAttemptedAt: now,
          cleanupFinalStatus,
          cleanupStartedAt: exchange.cleanupStartedAt ?? now,
          revision: exchange.revision + 1,
          status: "cleaned",
          updatedAt: now,
        });
      }
      cleaned += 1;
    }
    return { cleaned, progressed: exchanges.length };
  },
});

export const getCurrentPosTerminalServiceSession = query({
  args: {},
  returns: v.union(
    // Clients poll this while the Auth provider remounts onto freshly promoted
    // tokens, so an unauthorized caller is an expected state — never an error.
    v.object({ status: v.literal("unavailable") }),
    v.object({
      authorityExpiresAt: v.number(),
      authSessionId: v.id("authSessions"),
      offlineAuthorityReceipt: v.string(),
      posApplicationSessionBindingId: v.id("posApplicationSessionBinding"),
      servicePrincipalSessionId: v.id("servicePrincipalSession"),
      status: v.literal("active"),
      storeId: v.id("store"),
      terminalId: v.id("posTerminal"),
    }),
  ),
  handler: async (ctx) => {
    let authority;
    try {
      authority = await requirePosApplicationAuthorityWithCtx(ctx);
    } catch {
      return { status: "unavailable" as const };
    }
    return {
      authorityExpiresAt: authority.actor.absoluteExpiresAt,
      authSessionId: authority.actor.authSessionId,
      offlineAuthorityReceipt: authority.offlineAuthorityReceipt,
      posApplicationSessionBindingId: authority.posApplicationSessionBindingId,
      servicePrincipalSessionId: authority.servicePrincipalSessionId,
      status: "active" as const,
      storeId: authority.storeId,
      terminalId: authority.terminalId,
    };
  },
});

export async function refreshCurrentPosTerminalOfflineAuthorityReceiptWithCtx(
  ctx: MutationCtx,
  options: { now?: number } = {},
) {
  const now = options.now ?? Date.now();
  const authority = await requirePosApplicationAuthorityWithCtx(ctx, { now });
  const binding = await ctx.db.get(
    "posApplicationSessionBinding",
    authority.posApplicationSessionBindingId,
  );
  if (!binding || binding.status !== "active") {
    throw new Error(GENERIC_EXACT_SESSION_FAILURE);
  }
  const offlineAuthorityReceipt = await issuePosOfflineAuthorityReceipt({
    authorityExpiresAt: authority.actor.absoluteExpiresAt,
    capabilityRevision: binding.capabilityRevision,
    credentialRevision: binding.credentialRevision,
    issuedAt: now,
    posApplicationSessionBindingId: binding._id,
    principalLifecycleRevision: binding.principalLifecycleRevision,
    servicePrincipalId: binding.servicePrincipalId,
    servicePrincipalSessionId: binding.servicePrincipalSessionId,
    storeId: binding.storeId,
    terminalId: binding.terminalId,
    terminalLifecycleRevision: binding.terminalLifecycleRevision,
    terminalProofRevision: binding.terminalProofRevision,
  });
  await ctx.db.patch("posApplicationSessionBinding", binding._id, {
    offlineAuthorityReceipt,
    revision: binding.revision + 1,
    updatedAt: now,
  });
  return {
    authorityExpiresAt: authority.actor.absoluteExpiresAt,
    authSessionId: authority.actor.authSessionId,
    offlineAuthorityReceipt,
    posApplicationSessionBindingId: binding._id,
    servicePrincipalSessionId: binding.servicePrincipalSessionId,
    storeId: binding.storeId,
    terminalId: binding.terminalId,
  };
}

export const refreshCurrentPosTerminalOfflineAuthorityReceipt = mutation({
  args: {},
  returns: v.object({
    authorityExpiresAt: v.number(),
    authSessionId: v.id("authSessions"),
    offlineAuthorityReceipt: v.string(),
    posApplicationSessionBindingId: v.id("posApplicationSessionBinding"),
    servicePrincipalSessionId: v.id("servicePrincipalSession"),
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  }),
  handler: async (ctx) => {
    try {
      return await refreshCurrentPosTerminalOfflineAuthorityReceiptWithCtx(ctx);
    } catch {
      throw new Error(GENERIC_EXACT_SESSION_FAILURE);
    }
  },
});
