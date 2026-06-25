import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { toDisplayAmount } from "../lib/currency";
import { currencyFormatter } from "../utils";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../workflowTraces/core";
import {
  buildRegisterSessionTraceSeed,
  type RegisterSessionTraceSeed,
} from "../workflowTraces/adapters/registerSession";

export type RegisterSessionTraceStage =
  | "opened"
  | "sale_recorded"
  | "void_recorded"
  | "deposit_recorded"
  | "opening_float_corrected"
  | "closeout_submitted"
  | "closeout_reopened"
  | "approval_pending"
  | "item_adjustment_approval_pending"
  | "item_adjustment_applied"
  | "closeout_approved"
  | "closeout_rejected"
  | "closed";

export type RegisterSessionTraceableSession = {
  _id: Id<"registerSession">;
  closedAt?: number;
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
  status: "open" | "active" | "closing" | "closeout_rejected" | "closed";
  openedByUserId?: Id<"athenaUser">;
  openedByStaffProfileId?: Id<"staffProfile">;
  openedAt: number;
  openingFloat: number;
  expectedCash: number;
  countedCash?: number;
  variance?: number;
  managerApprovalRequestId?: Id<"approvalRequest">;
  workflowTraceId?: string;
};

type RegisterSessionTraceArgs = {
  stage: RegisterSessionTraceStage;
  session: RegisterSessionTraceableSession;
  occurredAt?: number;
  amount?: number;
  adjustmentId?: Id<"posTransactionAdjustment">;
  approvalRequestId?: Id<"approvalRequest">;
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  countedCash?: number;
  correctedOpeningFloat?: number;
  cashDelta?: number;
  previousOpeningFloat?: number;
  paymentCount?: number;
  paymentMethodLabels?: string[];
  registerSessionExpectedCashDelta?: number;
  reason?: string;
  saleTotal?: number;
  settlementDirection?: "collect" | "refund" | "none";
  settlementMethod?: string;
  syncOrigin?: "online" | "local_sync";
  transactionId?: Id<"posTransaction">;
  transactionNumber?: string;
  variance?: number;
};

function resolveOccurredAt(input: RegisterSessionTraceArgs) {
  if (input.occurredAt !== undefined) {
    return input.occurredAt;
  }

  switch (input.stage) {
    case "opened":
      return input.session.openedAt;
    case "closeout_approved":
    case "closed":
      return input.session.closedAt ?? Date.now();
    default:
      return Date.now();
  }
}

function safeTraceWrite(
  label: string,
  write: () => Promise<void>,
) {
  return write().catch((error) => {
    console.error(`[workflow-trace] ${label}`, error);
  });
}

function buildActorRefs(args: RegisterSessionTraceArgs) {
  const actorRefs = Object.fromEntries(
    Object.entries({
      actorStaffProfileId: args.actorStaffProfileId
        ? String(args.actorStaffProfileId)
        : undefined,
      actorUserId: args.actorUserId ? String(args.actorUserId) : undefined,
    }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;

  return Object.keys(actorRefs).length > 0 ? actorRefs : undefined;
}

function displayTraceAmount(
  amount: number | undefined,
  currency: string,
) {
  const displayAmount = toDisplayAmount(amount ?? 0);

  try {
    return currencyFormatter(currency).format(displayAmount);
  } catch (error) {
    console.error("[workflow-trace] register.session.trace.currency-format", {
      currency,
      error,
    });

    return currencyFormatter("GHS").format(displayAmount);
  }
}

function formatTransactionLabel(input: RegisterSessionTraceArgs) {
  const transactionNumber = input.transactionNumber?.trim();

  if (transactionNumber) {
    return `transaction #${transactionNumber}`;
  }

  if (input.transactionId) {
    return `transaction ${String(input.transactionId)}`;
  }

  return "the transaction";
}

async function resolveStoreCurrency(
  ctx: MutationCtx,
  session: RegisterSessionTraceableSession,
) {
  const store = await ctx.db.get("store", session.storeId).catch((error) => {
    console.error(
      "[workflow-trace] register.session.trace.store-currency",
      error,
    );
    return null;
  });

  return store?.currency?.trim() || "GHS";
}

function buildTraceRecord(args: {
  traceSeed: RegisterSessionTraceSeed;
  input: RegisterSessionTraceArgs;
}) {
  const baseTrace = args.traceSeed.trace;
  const occurredAt = resolveOccurredAt(args.input);
  const completedAt =
    args.input.stage === "closeout_approved" || args.input.stage === "closed"
      ? occurredAt
      : undefined;

  switch (args.input.stage) {
    case "approval_pending":
    case "closeout_rejected":
      return {
        ...baseTrace,
        status: "blocked" as const,
        completedAt: undefined,
      };
    case "closeout_approved":
    case "closed":
      return {
        ...baseTrace,
        status: "succeeded" as const,
        completedAt,
      };
    default:
      return {
        ...baseTrace,
        status: "started" as const,
        completedAt: undefined,
      };
  }
}

function buildTraceEvent(args: {
  currency: string;
  traceSeed: RegisterSessionTraceSeed;
  input: RegisterSessionTraceArgs;
}) {
  const occurredAt = resolveOccurredAt(args.input);
  const registerLabel =
    args.input.session.registerNumber?.trim() || String(args.input.session._id);
  const details = Object.fromEntries(
    Object.entries({
      amount: args.input.amount,
      adjustmentId: args.input.adjustmentId
        ? String(args.input.adjustmentId)
        : undefined,
      approvalRequestId: args.input.approvalRequestId
        ? String(args.input.approvalRequestId)
        : undefined,
      countedCash: args.input.countedCash ?? args.input.session.countedCash,
      correctedOpeningFloat: args.input.correctedOpeningFloat,
      cashDelta: args.input.cashDelta,
      expectedCash: args.input.session.expectedCash,
      paymentCount: args.input.paymentCount,
      paymentMethodLabels: args.input.paymentMethodLabels,
      previousOpeningFloat: args.input.previousOpeningFloat,
      registerSessionExpectedCashDelta:
        args.input.registerSessionExpectedCashDelta,
      reason: args.input.reason,
      registerStatus: args.input.session.status,
      saleTotal: args.input.saleTotal,
      settlementDirection: args.input.settlementDirection,
      settlementMethod: args.input.settlementMethod,
      syncOrigin: args.input.syncOrigin,
      transactionId: args.input.transactionId
        ? String(args.input.transactionId)
        : undefined,
      transactionNumber: args.input.transactionNumber,
      variance: args.input.variance ?? args.input.session.variance,
    }).filter(([, value]) => value !== undefined),
  );
  const subjectRefs = {
    ...args.traceSeed.subjectRefs,
    ...(args.input.adjustmentId
      ? { adjustmentId: String(args.input.adjustmentId) }
      : {}),
    ...(args.input.approvalRequestId
      ? { approvalRequestId: String(args.input.approvalRequestId) }
      : {}),
    ...(args.input.transactionId
      ? { posTransactionId: String(args.input.transactionId) }
      : {}),
  };
  const transactionLabel = formatTransactionLabel(args.input);

  switch (args.input.stage) {
    case "opened":
      return {
        kind: "milestone" as const,
        step: "register_session_opened",
        status: "started" as const,
        message: `Register session opened for ${registerLabel}.`,
        occurredAt,
        details,
        subjectRefs,
      };
    case "sale_recorded":
      if (args.input.saleTotal !== undefined) {
        const tenderSummary = args.input.paymentMethodLabels?.join(", ");
        const cashDelta = args.input.cashDelta ?? args.input.amount ?? 0;
        const cashImpact =
          cashDelta > 0
            ? ` Cash impact: ${displayTraceAmount(cashDelta, args.currency)}.`
            : " No cash drawer impact.";

        return {
          kind: "system_action" as const,
          step: "register_session_sale_recorded",
          status: "info" as const,
          message: `Recorded ${formatTransactionLabel(args.input)} sale of ${displayTraceAmount(args.input.saleTotal, args.currency)}${tenderSummary ? ` paid by ${tenderSummary}` : ""}.${cashImpact}`,
          occurredAt,
          details,
          subjectRefs,
        };
      }

      return {
        kind: "system_action" as const,
        step: "register_session_sale_recorded",
        status: "info" as const,
        message: `Recorded sale cash movement of ${displayTraceAmount(args.input.amount, args.currency)}.`,
        occurredAt,
        details,
        subjectRefs,
      };
    case "void_recorded":
      return {
        kind: "system_action" as const,
        step: "register_session_void_recorded",
        status: "info" as const,
        message: `Recorded void cash adjustment of ${displayTraceAmount(args.input.amount, args.currency)}.`,
        occurredAt,
        details,
        subjectRefs,
      };
    case "deposit_recorded":
      return {
        kind: "system_action" as const,
        step: "register_session_deposit_recorded",
        status: "info" as const,
        message: `Recorded cash deposit of ${displayTraceAmount(args.input.amount, args.currency)}.`,
        occurredAt,
        details,
        subjectRefs,
      };
    case "opening_float_corrected":
      return {
        kind: "system_action" as const,
        step: "register_session_opening_float_corrected",
        status: "info" as const,
        message: `Corrected opening float from ${displayTraceAmount(args.input.previousOpeningFloat, args.currency)} to ${displayTraceAmount(args.input.correctedOpeningFloat, args.currency)}.`,
        occurredAt,
        details,
        subjectRefs,
      };
    case "closeout_submitted":
      return {
        kind: "milestone" as const,
        step: "register_session_closeout_submitted",
        status: "started" as const,
        message: "Register closeout submitted.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "approval_pending":
      return {
        kind: "milestone" as const,
        step: "register_session_approval_pending",
        status: "blocked" as const,
        message: "Register closeout is pending manager approval.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "item_adjustment_approval_pending":
      return {
        kind: "system_action" as const,
        step: "register_session_item_adjustment_approval_pending",
        status: "info" as const,
        message: `Queued item adjustment for ${transactionLabel} for manager approval.`,
        occurredAt,
        details,
        subjectRefs,
      };
    case "item_adjustment_applied":
      return {
        kind: "system_action" as const,
        step: "register_session_item_adjustment_applied",
        status: "info" as const,
        message:
          args.input.settlementDirection === "refund" && (args.input.amount ?? 0) > 0
            ? `Applied item adjustment refund of ${displayTraceAmount(args.input.amount, args.currency)} for ${transactionLabel}.`
            : args.input.settlementDirection === "collect" && (args.input.amount ?? 0) > 0
              ? `Applied item adjustment collection of ${displayTraceAmount(args.input.amount, args.currency)} for ${transactionLabel}.`
              : `Applied item adjustment for ${transactionLabel}.`,
        occurredAt,
        details,
        subjectRefs,
      };
    case "closeout_approved":
      return {
        kind: "milestone" as const,
        step: "register_session_closeout_approved",
        status: "succeeded" as const,
        message: "Manager approved the register closeout and the session closed.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "closeout_rejected":
      return {
        kind: "milestone" as const,
        step: "register_session_closeout_rejected",
        status: "blocked" as const,
        message: "Manager rejected the register closeout for correction.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "closeout_reopened":
      return {
        kind: "system_action" as const,
        step: "register_session_closeout_reopened",
        status: "info" as const,
        message: `Reopened closeout for ${registerLabel}.`,
        occurredAt,
        details,
        subjectRefs,
      };
    case "closed":
      return {
        kind: "milestone" as const,
        step: "register_session_closed",
        status: "succeeded" as const,
        message: "Register session closed.",
        occurredAt,
        details,
        subjectRefs,
      };
  }
}

export async function recordRegisterSessionTraceBestEffort(
  ctx: MutationCtx,
  args: RegisterSessionTraceArgs,
) {
  const currency = await resolveStoreCurrency(ctx, args.session);
  const traceSeed = buildRegisterSessionTraceSeed({
    storeId: args.session.storeId,
    organizationId: args.session.organizationId,
    registerSessionId: args.session._id,
    registerNumber: args.session.registerNumber,
    terminalId: args.session.terminalId,
    openedAt: args.session.openedAt,
    openedByStaffProfileId: args.session.openedByStaffProfileId,
    openedByUserId: args.session.openedByUserId,
  });
  const traceRecord = buildTraceRecord({
    traceSeed,
    input: args,
  });
  const traceEvent = buildTraceEvent({
    currency,
    traceSeed,
    input: args,
  });

  let traceCreated = false;

  await safeTraceWrite("register.session.trace.create", async () => {
    await createWorkflowTraceWithCtx(ctx, traceRecord);
    traceCreated = true;
  });

  await safeTraceWrite("register.session.trace.lookup", async () => {
    await registerWorkflowTraceLookupWithCtx(ctx, traceSeed.lookup);
  });

  await safeTraceWrite("register.session.trace.event", async () => {
    await appendWorkflowTraceEventWithCtx(ctx, {
      storeId: traceSeed.trace.storeId,
      traceId: traceSeed.trace.traceId,
      workflowType: traceSeed.trace.workflowType,
      ...traceEvent,
      source: traceSeed.eventSource,
      actorRefs: buildActorRefs(args),
    });
  });

  return {
    traceCreated,
    traceId: traceSeed.trace.traceId,
  };
}
