import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type {
  ApprovalRequestPendingData,
  ApprovalRequestPendingProps,
} from "../emails/ApprovalRequestPending";
import { getStoreScheduleContextForStoreAtWithCtx } from "../inventory/storeSchedule";
import { toDisplayAmount } from "../lib/currency";
import type { StoreScheduleContext } from "../lib/storeScheduleTime";
import { currencyFormatter } from "../utils";
import { formatPaymentMethod, resolveAppUrl } from "./dailyManagerReportEmail";
import { formatRegisterCloseoutVarianceAlertReason } from "./registerCloseoutVarianceEmail";

export type ApprovalRequestPendingPayload = ApprovalRequestPendingProps & {
  approvalRequestId: Id<"approvalRequest">;
  storeId: Id<"store">;
};

// Loads FRESH approval-request data at send time for the
// approvals.request_created notification. The null/throw contract is
// load-bearing for the rail:
//   - null  = genuinely unsendable (request gone, or already decided) →
//             the delivery suppresses with an operational event.
//   - throw = transient read fault (missing context row, read limit, OCC) →
//             the delivery stays retryable.
// Never conflate the two: returning null on a transient fault would
// permanently silence the alert; throwing on a decided request would retry
// a notification that must never send.
export const getApprovalRequestPendingPayload = internalQuery({
  args: {
    approvalRequestId: v.id("approvalRequest"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<ApprovalRequestPendingPayload | null> => {
    const approvalRequest = await ctx.db.get(
      "approvalRequest",
      args.approvalRequestId,
    );
    // Missing or already decided: the "approval needed" email is no longer
    // true, so there is nothing to send.
    if (!approvalRequest || approvalRequest.status !== "pending") {
      return null;
    }

    const [store, requestedByStaffProfile, requestedByUser] =
      await Promise.all([
        ctx.db.get("store", approvalRequest.storeId),
        approvalRequest.requestedByStaffProfileId
          ? ctx.db.get(
              "staffProfile",
              approvalRequest.requestedByStaffProfileId,
            )
          : Promise.resolve(null),
        approvalRequest.requestedByUserId
          ? ctx.db.get("athenaUser", approvalRequest.requestedByUserId)
          : Promise.resolve(null),
      ]);
    if (!store) {
      // The request itself is live, so a missing store is a broken read of
      // required context — a transient fault, not a suppression.
      throw new Error("Approval request context was not found.");
    }

    const [organization, scheduleContext] = await Promise.all([
      ctx.db.get("organization", store.organizationId),
      getStoreScheduleContextForStoreAtWithCtx(ctx, {
        at: approvalRequest.createdAt,
        storeId: store._id,
      }).then((result) => result.context),
    ]);

    const currency = store.currency || "GHS";
    const data = buildApprovalRequestPendingData({
      approvalRequest,
      currency,
    });

    return {
      approvalRequestId: approvalRequest._id,
      storeId: store._id,
      storeName: store.name,
      requestType: approvalRequest.requestType,
      identifier: resolveApprovalRequestIdentifier({
        data,
        approvalRequest,
        scheduleContext,
      }),
      requesterName: resolveRequesterName({
        requestedByStaffProfile,
        requestedByUser,
      }),
      createdAt: formatCreatedAt(approvalRequest.createdAt, scheduleContext),
      reason: formatRegisterCloseoutVarianceAlertReason(
        currency,
        approvalRequest.reason,
      ),
      // The requester's own words, from the server-validated column on the
      // request row — not producer-controlled metadata. `reason` above is
      // policy text explaining why approval is required; this is the context
      // the cashier typed, and reviewers need both.
      requesterNote: approvalRequest.notes?.trim() || undefined,
      queueUrl: buildApprovalsQueueUrl({ organization, store }),
      data,
    };
  },
});

// Producers stamp request metadata with per-type fields (metadata is
// v.record(v.string(), v.any())), so every read is type-guarded — a missing
// or malformed field renders as an omitted row, never a crash.
function buildApprovalRequestPendingData(args: {
  approvalRequest: Doc<"approvalRequest">;
  currency: string;
}): ApprovalRequestPendingData {
  const { approvalRequest, currency } = args;
  const metadata = approvalRequest.metadata ?? {};
  const money = currencyFormatter(currency || "GHS");
  const formatMoney = (amount: number) =>
    money.format(toDisplayAmount(amount));

  const data: ApprovalRequestPendingData = {};

  const transactionNumber = metadataString(metadata, "transactionNumber");
  if (transactionNumber) {
    data.transactionNumber = formatTransactionNumber(transactionNumber);
  }

  const amount = metadataNumber(
    metadata,
    approvalRequest.requestType === "pos_transaction_void"
      ? "total"
      : approvalRequest.requestType === "pos_item_adjustment" ||
          approvalRequest.requestType === "pos_item_adjustment_review"
        ? "deltaTotal"
        : "amount",
  );
  if (amount !== undefined) data.amount = formatMoney(amount);

  const previousPaymentMethod = metadataString(
    metadata,
    "previousPaymentMethod",
  );
  if (previousPaymentMethod) {
    data.previousPaymentMethod = formatPaymentMethod(previousPaymentMethod);
  }
  const paymentMethod = metadataString(metadata, "paymentMethod");
  if (paymentMethod) data.paymentMethod = formatPaymentMethod(paymentMethod);

  const serviceName = metadataString(metadata, "serviceName");
  if (serviceName) data.serviceName = serviceName;
  const depositAmount = metadataNumber(metadata, "depositAmount");
  if (depositAmount !== undefined) data.depositAmount = formatMoney(depositAmount);

  const adjustmentType = metadataString(metadata, "adjustmentType");
  if (adjustmentType) {
    const lineItems = metadata.lineItems;
    data.adjustmentSummary = Array.isArray(lineItems)
      ? `${adjustmentType} (${lineItems.length} line ${lineItems.length === 1 ? "item" : "items"})`
      : adjustmentType;
  }
  const netQuantityDelta = metadataNumber(metadata, "netQuantityDelta");
  if (netQuantityDelta !== undefined) {
    data.netQuantityDelta =
      netQuantityDelta > 0 ? `+${netQuantityDelta}` : String(netQuantityDelta);
  }

  const returnItemIds = metadata.returnItemIds;
  if (Array.isArray(returnItemIds) && returnItemIds.length > 0) {
    data.itemSummary = `${returnItemIds.length} ${returnItemIds.length === 1 ? "item" : "items"}`;
  }

  return data;
}

function resolveApprovalRequestIdentifier(args: {
  data: ApprovalRequestPendingData;
  approvalRequest: Doc<"approvalRequest">;
  scheduleContext: StoreScheduleContext;
}): string {
  const metadata = args.approvalRequest.metadata ?? {};
  return (
    args.data.transactionNumber ??
    args.data.orderNumber ??
    metadataString(metadata, "adjustmentBatchId") ??
    args.scheduleContext.operatingDate
  );
}

// Requester attribution comes ONLY from the server-validated linkage fields
// on the request row; metadata is producer-controlled and never trusted for
// identity.
function resolveRequesterName(args: {
  requestedByStaffProfile: Doc<"staffProfile"> | null;
  requestedByUser: Doc<"athenaUser"> | null;
}): string {
  if (args.requestedByStaffProfile?.fullName) {
    return args.requestedByStaffProfile.fullName;
  }
  const user = args.requestedByUser;
  if (user) {
    const name = [user.firstName, user.lastName]
      .filter((part) => Boolean(part?.trim()))
      .join(" ");
    if (name) return name;
    if (user.email) return user.email;
  }
  return "POS operator";
}

function formatCreatedAt(
  timestamp: number,
  scheduleContext: StoreScheduleContext,
) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone:
      scheduleContext.kind === "resolved" ? scheduleContext.timezone : "UTC",
  }).format(new Date(timestamp));
}

// Queue-level link only: the email is a nudge toward the approvals queue,
// where the request's live status gates what the reviewer can do. A
// per-request deep link would go stale the moment the request is decided.
function buildApprovalsQueueUrl(args: {
  organization: Doc<"organization"> | null;
  store: Doc<"store">;
}) {
  const orgSlug = args.organization?.slug ?? args.store.slug;
  return `${resolveAppUrl()}/${orgSlug}/store/${args.store.slug}/operations/approvals`;
}

// Applied once, in the builder, so the number reads identically in the
// subject line, the header subtitle, and the Transaction row — all three
// resolve from `data.transactionNumber`. Producers that already stamp a "#"
// do not get a second one.
function formatTransactionNumber(transactionNumber: string) {
  return `#${transactionNumber.trim().replace(/^#+/, "")}`;
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function metadataNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
