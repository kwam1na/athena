import { v } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import { mutation, type MutationCtx } from "../../_generated/server";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";

const ASSERTION_TTL_MS = 5 * 60 * 1000;
const POS_HUB_ROUTE_SCOPE = "pos_hub";

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
