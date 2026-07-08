import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  type ActionCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { ADMIN_EMAILS } from "../constants/email";
import type { RegisterCloseoutVarianceAlertProps } from "../emails/RegisterCloseoutVarianceAlert";
import { toDisplayAmount } from "../lib/currency";
import { sendRegisterCloseoutVarianceAlertEmail } from "../mailersend";
import { currencyFormatter } from "../utils";
import { resolveAppUrl } from "./dailyManagerReportEmail";

type RegisterCloseoutVariancePayload =
  RegisterCloseoutVarianceAlertProps & {
    approvalRequestId: Id<"approvalRequest">;
    storeId: Id<"store">;
  };

type SentRegisterCloseoutVarianceAlert = {
  approvalRequestId: Id<"approvalRequest">;
  recipientEmail: string;
  status: number;
  storeName: string;
};

type CloseoutVarianceMetadata = {
  closeoutOccurredAt?: number;
  countedCash?: number;
  expectedCash?: number;
  terminalId?: Id<"posTerminal">;
  variance?: number;
};

export const getRegisterCloseoutVarianceAlertPayload = internalQuery({
  args: {
    approvalRequestId: v.id("approvalRequest"),
  },
  handler: async (ctx, args): Promise<RegisterCloseoutVariancePayload> => {
    const approvalRequest = await ctx.db.get(
      "approvalRequest",
      args.approvalRequestId,
    );
    if (
      !approvalRequest ||
      approvalRequest.requestType !== "variance_review" ||
      !approvalRequest.registerSessionId
    ) {
      throw new Error("Register closeout variance review was not found.");
    }

    const [store, registerSession, requestedBy] = await Promise.all([
      ctx.db.get("store", approvalRequest.storeId),
      ctx.db.get("registerSession", approvalRequest.registerSessionId),
      approvalRequest.requestedByStaffProfileId
        ? ctx.db.get("staffProfile", approvalRequest.requestedByStaffProfileId)
        : Promise.resolve(null),
    ]);

    if (!store || !registerSession) {
      throw new Error("Register closeout variance context was not found.");
    }

    const metadata = readCloseoutVarianceMetadata(approvalRequest.metadata);
    const terminalId = metadata.terminalId ?? registerSession.terminalId;
    const [organization, terminal] = await Promise.all([
      ctx.db.get("organization", store.organizationId),
      terminalId ? ctx.db.get("posTerminal", terminalId) : Promise.resolve(null),
    ]);
    const currency = store.currency || "GHS";
    const money = currencyFormatter(currency);
    const expectedCash = amountFromMetadata(
      metadata.expectedCash,
      registerSession.expectedCash,
    );
    const countedCash = amountFromMetadata(
      metadata.countedCash,
      registerSession.countedCash,
    );
    const variance = amountFromMetadata(
      metadata.variance,
      countedCash - expectedCash,
    );

    return {
      approvalRequestId: approvalRequest._id,
      storeId: store._id,
      storeName: store.name,
      registerLabel: formatRegisterLabel({ registerSession, terminal }),
      submittedAt: formatSubmittedAt(
        metadata.closeoutOccurredAt ?? approvalRequest.createdAt,
      ),
      submittedBy: requestedBy?.fullName ?? "POS operator",
      expectedCash: money.format(toDisplayAmount(expectedCash)),
      countedCash: money.format(toDisplayAmount(countedCash)),
      variance: money.format(toDisplayAmount(variance)),
      varianceDirection: variance >= 0 ? "over" : "short",
      reason: approvalRequest.reason,
      notes: approvalRequest.notes,
      reviewUrl: buildRegisterReviewUrl({
        organization,
        registerSessionId: registerSession._id,
        store,
      }),
    };
  },
});

export async function sendRegisterCloseoutVarianceAlertToAdminsWithCtx(
  ctx: Pick<ActionCtx, "runQuery">,
  args: {
    approvalRequestId: Id<"approvalRequest">;
  },
): Promise<SentRegisterCloseoutVarianceAlert[]> {
  const payload: RegisterCloseoutVariancePayload = await ctx.runQuery(
    internal.operations.registerCloseoutVarianceEmail
      .getRegisterCloseoutVarianceAlertPayload,
    {
      approvalRequestId: args.approvalRequestId,
    },
  );
  const sentAlerts: SentRegisterCloseoutVarianceAlert[] = [];

  for (const recipient of ADMIN_EMAILS) {
    const response = await sendRegisterCloseoutVarianceAlertEmail({
      ...payload,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject: `${payload.storeName} register variance - ${payload.registerLabel}`,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    sentAlerts.push({
      approvalRequestId: payload.approvalRequestId,
      recipientEmail: recipient.email,
      status: response.status,
      storeName: payload.storeName,
    });
  }

  return sentAlerts;
}

export const sendRegisterCloseoutVarianceAlertToAdmins = internalAction({
  args: {
    approvalRequestId: v.id("approvalRequest"),
  },
  handler: (ctx, args) =>
    sendRegisterCloseoutVarianceAlertToAdminsWithCtx(ctx, args),
});

function readCloseoutVarianceMetadata(
  metadata: Doc<"approvalRequest">["metadata"],
): CloseoutVarianceMetadata {
  return {
    closeoutOccurredAt:
      typeof metadata?.closeoutOccurredAt === "number"
        ? metadata.closeoutOccurredAt
        : undefined,
    countedCash:
      typeof metadata?.countedCash === "number"
        ? metadata.countedCash
        : undefined,
    expectedCash:
      typeof metadata?.expectedCash === "number"
        ? metadata.expectedCash
        : undefined,
    terminalId:
      typeof metadata?.terminalId === "string"
        ? (metadata.terminalId as Id<"posTerminal">)
        : undefined,
    variance:
      typeof metadata?.variance === "number" ? metadata.variance : undefined,
  };
}

function amountFromMetadata(value: number | undefined, fallback?: number) {
  return typeof value === "number"
    ? value
    : typeof fallback === "number"
      ? fallback
      : 0;
}

function formatRegisterLabel(args: {
  registerSession: Doc<"registerSession">;
  terminal: Doc<"posTerminal"> | null;
}) {
  const registerNumber =
    args.registerSession.registerNumber ?? args.terminal?.registerNumber;
  const terminalName = args.terminal?.displayName;

  if (terminalName && registerNumber) {
    return `${terminalName} / Register ${registerNumber}`;
  }
  if (terminalName) return terminalName;
  if (registerNumber) return `Register ${registerNumber}`;
  return "Register session";
}

function formatSubmittedAt(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  }).format(new Date(timestamp));
}

function buildRegisterReviewUrl(args: {
  organization: Doc<"organization"> | null;
  registerSessionId: Id<"registerSession">;
  store: Doc<"store">;
}) {
  const orgSlug = args.organization?.slug ?? args.store.slug;

  return `${resolveAppUrl()}/${orgSlug}/store/${args.store.slug}/cash-controls/registers/${args.registerSessionId}`;
}
