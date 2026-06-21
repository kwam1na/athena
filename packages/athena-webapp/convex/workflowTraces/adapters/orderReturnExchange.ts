import type { Doc, Id } from "../../_generated/dataModel";
import {
  createWorkflowTraceId,
  normalizeWorkflowTraceLookupValue,
} from "../../../shared/workflowTrace";
import {
  buildOnlineOrderTraceSeed,
  ONLINE_ORDER_WORKFLOW_TYPE,
} from "./onlineOrder";

export const ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE =
  "online_order_return_exchange";
export const ORDER_RETURN_EXCHANGE_LOOKUP_TYPES = {
  orderId: "online_order_id",
  orderNumber: "order_number",
  parentTraceId: "parent_trace_id",
  subflowRef: "return_exchange_ref",
} as const;

export type OrderReturnExchangeTraceSeed = {
  trace: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    traceId: string;
    workflowType: typeof ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE;
    title: string;
    status: "started";
    health: "healthy";
    startedAt: number;
    primaryLookupType: typeof ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.subflowRef;
    primaryLookupValue: string;
    primarySubjectType: "online_order";
    primarySubjectId: Id<"onlineOrder">;
    summary: string;
    details: {
      parentTraceId: string;
      parentWorkflowType: typeof ONLINE_ORDER_WORKFLOW_TYPE;
      source: "storefront_online_order_return_exchange";
    };
  };
  lookups: Array<{
    storeId: Id<"store">;
    workflowType: typeof ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE;
    lookupType:
      (typeof ORDER_RETURN_EXCHANGE_LOOKUP_TYPES)[keyof typeof ORDER_RETURN_EXCHANGE_LOOKUP_TYPES];
    lookupValue: string;
    traceId: string;
  }>;
  subjectRefs: Record<string, string>;
  eventSource: "workflow.onlineOrderReturnExchange";
};

type TraceableOrder = Pick<
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

function buildLookup(args: {
  storeId: Id<"store">;
  traceId: string;
  lookupType:
    (typeof ORDER_RETURN_EXCHANGE_LOOKUP_TYPES)[keyof typeof ORDER_RETURN_EXCHANGE_LOOKUP_TYPES];
  lookupValue: string | undefined;
}) {
  if (!args.lookupValue) {
    return null;
  }

  return {
    storeId: args.storeId,
    workflowType:
      ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE as typeof ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE,
    lookupType: args.lookupType,
    lookupValue: normalizeWorkflowTraceLookupValue(args.lookupValue),
    traceId: args.traceId,
  };
}

export function buildOrderReturnExchangeTraceSeed(args: {
  operationRef: string;
  order: TraceableOrder;
  organizationId?: Id<"organization">;
  startedAt?: number;
}): OrderReturnExchangeTraceSeed {
  const parentSeed = buildOnlineOrderTraceSeed({
    order: args.order,
    organizationId: args.organizationId,
  });
  const orderId = String(args.order._id);
  const orderNumber = args.order.orderNumber.trim();
  const operationRef = `${orderId}:${args.operationRef.trim()}`;
  const traceId = createWorkflowTraceId({
    workflowType: ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE,
    primaryLookupValue: operationRef,
  });
  const lookupInputs = [
    buildLookup({
      storeId: args.order.storeId,
      traceId,
      lookupType: ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.subflowRef,
      lookupValue: operationRef,
    }),
    buildLookup({
      storeId: args.order.storeId,
      traceId,
      lookupType: ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.orderId,
      lookupValue: orderId,
    }),
    buildLookup({
      storeId: args.order.storeId,
      traceId,
      lookupType: ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.orderNumber,
      lookupValue: orderNumber,
    }),
    buildLookup({
      storeId: args.order.storeId,
      traceId,
      lookupType: ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.parentTraceId,
      lookupValue: parentSeed.trace.traceId,
    }),
  ];
  const subjectRefs = Object.fromEntries(
    Object.entries({
      ...parentSeed.subjectRefs,
      parentTraceId: parentSeed.trace.traceId,
      returnExchangeRef: operationRef,
    }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;

  return {
    trace: {
      storeId: args.order.storeId,
      organizationId: args.organizationId,
      traceId,
      workflowType: ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE,
      title: `Return/exchange for online order ${orderNumber}`,
      status: "started",
      health: "healthy",
      startedAt: args.startedAt ?? Date.now(),
      primaryLookupType: ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.subflowRef,
      primaryLookupValue: operationRef,
      primarySubjectType: "online_order",
      primarySubjectId: args.order._id,
      summary: `Trace for return/refund/exchange activity on online order ${orderNumber}`,
      details: {
        parentTraceId: parentSeed.trace.traceId,
        parentWorkflowType: ONLINE_ORDER_WORKFLOW_TYPE,
        source: "storefront_online_order_return_exchange",
      },
    },
    lookups: lookupInputs.filter(
      (lookup): lookup is NonNullable<typeof lookup> => Boolean(lookup),
    ),
    subjectRefs,
    eventSource: "workflow.onlineOrderReturnExchange",
  };
}
