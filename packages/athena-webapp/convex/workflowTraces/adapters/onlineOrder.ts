import type { Doc, Id } from "../../_generated/dataModel";
import {
  createWorkflowTraceId,
  normalizeWorkflowTraceLookupValue,
} from "../../../shared/workflowTrace";

export const ONLINE_ORDER_WORKFLOW_TYPE = "online_order";
export const ONLINE_ORDER_LOOKUP_TYPES = {
  checkoutSessionId: "checkout_session_id",
  externalReference: "external_reference_fingerprint",
  orderId: "online_order_id",
  orderNumber: "order_number",
} as const;

export type OnlineOrderTraceSeed = {
  trace: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    traceId: string;
    workflowType: typeof ONLINE_ORDER_WORKFLOW_TYPE;
    title: string;
    status: "started";
    health: "healthy";
    startedAt: number;
    primaryLookupType: typeof ONLINE_ORDER_LOOKUP_TYPES.orderId;
    primaryLookupValue: string;
    primarySubjectType: "online_order";
    primarySubjectId: Id<"onlineOrder">;
    summary: string;
  };
  lookups: Array<{
    storeId: Id<"store">;
    workflowType: typeof ONLINE_ORDER_WORKFLOW_TYPE;
    lookupType:
      (typeof ONLINE_ORDER_LOOKUP_TYPES)[keyof typeof ONLINE_ORDER_LOOKUP_TYPES];
    lookupValue: string;
    traceId: string;
  }>;
  subjectRefs: Record<string, string>;
  eventSource: "workflow.onlineOrder";
};

function stableFingerprint(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

export function buildSafeExternalReferenceRef(value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  const suffix = normalized.slice(-6);

  return `external:${stableFingerprint(normalized.toLowerCase())}:${suffix}`;
}

function buildLookup(args: {
  storeId: Id<"store">;
  lookupType:
    (typeof ONLINE_ORDER_LOOKUP_TYPES)[keyof typeof ONLINE_ORDER_LOOKUP_TYPES];
  lookupValue: string | undefined;
  traceId: string;
}) {
  if (!args.lookupValue) {
    return null;
  }

  return {
    storeId: args.storeId,
    workflowType: ONLINE_ORDER_WORKFLOW_TYPE as typeof ONLINE_ORDER_WORKFLOW_TYPE,
    lookupType: args.lookupType,
    lookupValue: normalizeWorkflowTraceLookupValue(args.lookupValue),
    traceId: args.traceId,
  };
}

export function buildOnlineOrderTraceSeed(args: {
  order: Pick<
    Doc<"onlineOrder">,
    | "_creationTime"
    | "_id"
    | "checkoutSessionId"
    | "customerProfileId"
    | "deliveryMethod"
    | "externalReference"
    | "externalTransactionId"
    | "orderNumber"
    | "status"
    | "storeFrontUserId"
    | "storeId"
  >;
  organizationId?: Id<"organization">;
}): OnlineOrderTraceSeed {
  const lookupValue = String(args.order._id);
  const traceId = createWorkflowTraceId({
    workflowType: ONLINE_ORDER_WORKFLOW_TYPE,
    primaryLookupValue: lookupValue,
  });
  const orderNumber = args.order.orderNumber.trim();
  const safeExternalReference =
    buildSafeExternalReferenceRef(args.order.externalReference) ??
    buildSafeExternalReferenceRef(args.order.externalTransactionId);
  const lookupInputs = [
    buildLookup({
      storeId: args.order.storeId,
      lookupType: ONLINE_ORDER_LOOKUP_TYPES.orderId,
      lookupValue,
      traceId,
    }),
    buildLookup({
      storeId: args.order.storeId,
      lookupType: ONLINE_ORDER_LOOKUP_TYPES.orderNumber,
      lookupValue: orderNumber,
      traceId,
    }),
    buildLookup({
      storeId: args.order.storeId,
      lookupType: ONLINE_ORDER_LOOKUP_TYPES.checkoutSessionId,
      lookupValue: String(args.order.checkoutSessionId),
      traceId,
    }),
    buildLookup({
      storeId: args.order.storeId,
      lookupType: ONLINE_ORDER_LOOKUP_TYPES.externalReference,
      lookupValue: safeExternalReference,
      traceId,
    }),
  ];
  const subjectRefs = Object.fromEntries(
    Object.entries({
      onlineOrderId: String(args.order._id),
      orderNumber,
      checkoutSessionId: String(args.order.checkoutSessionId),
      customerProfileId: args.order.customerProfileId
        ? String(args.order.customerProfileId)
        : undefined,
      storeFrontUserId: String(args.order.storeFrontUserId),
      safeExternalReference,
    }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;

  return {
    trace: {
      storeId: args.order.storeId,
      organizationId: args.organizationId,
      traceId,
      workflowType: ONLINE_ORDER_WORKFLOW_TYPE,
      title: `Online order ${orderNumber}`,
      status: "started",
      health: "healthy",
      startedAt: args.order._creationTime,
      primaryLookupType: ONLINE_ORDER_LOOKUP_TYPES.orderId,
      primaryLookupValue: lookupValue,
      primarySubjectType: "online_order",
      primarySubjectId: args.order._id,
      summary: `Trace for online order ${orderNumber}`,
    },
    lookups: lookupInputs.filter(
      (lookup): lookup is NonNullable<typeof lookup> => Boolean(lookup),
    ),
    subjectRefs,
    eventSource: "workflow.onlineOrder",
  };
}
