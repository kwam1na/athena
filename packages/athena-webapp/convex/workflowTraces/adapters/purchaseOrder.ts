import type { Id } from "../../_generated/dataModel";
import {
  createWorkflowTraceId,
  normalizeWorkflowTraceLookupValue,
} from "../../../shared/workflowTrace";

export const PURCHASE_ORDER_WORKFLOW_TYPE = "purchase_order";
export const PURCHASE_ORDER_ID_LOOKUP_TYPE = "purchase_order_id";
export const PURCHASE_ORDER_NUMBER_LOOKUP_TYPE = "purchase_order_number";
export const PURCHASE_ORDER_VENDOR_LOOKUP_TYPE = "vendor_id";
export const PURCHASE_ORDER_RECEIVING_SUBMISSION_LOOKUP_TYPE =
  "receiving_submission_key";

export type PurchaseOrderTraceLookup = {
  storeId: Id<"store">;
  workflowType: typeof PURCHASE_ORDER_WORKFLOW_TYPE;
  lookupType: string;
  lookupValue: string;
  traceId: string;
};

export type PurchaseOrderTraceSeed = {
  trace: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    traceId: string;
    workflowType: typeof PURCHASE_ORDER_WORKFLOW_TYPE;
    title: string;
    status: "started" | "succeeded" | "failed" | "blocked" | "info";
    health: "healthy" | "partial" | "degraded";
    startedAt: number;
    completedAt?: number;
    primaryLookupType: typeof PURCHASE_ORDER_ID_LOOKUP_TYPE;
    primaryLookupValue: string;
    primarySubjectType: "purchase_order";
    primarySubjectId: Id<"purchaseOrder">;
    summary: string;
    details?: Record<string, unknown>;
  };
  lookups: PurchaseOrderTraceLookup[];
  subjectRefs: Record<string, string>;
  eventSource: "workflow.purchaseOrder";
};

function formatPurchaseOrderLabel(args: {
  poNumber?: string;
  purchaseOrderId: Id<"purchaseOrder">;
}) {
  const poNumber = args.poNumber?.trim();
  return poNumber ? poNumber : String(args.purchaseOrderId);
}

function normalizeLookup(input: {
  storeId: Id<"store">;
  lookupType: string;
  lookupValue: string | undefined;
  traceId: string;
}): PurchaseOrderTraceLookup | null {
  const lookupValue = input.lookupValue?.trim();

  if (!lookupValue) {
    return null;
  }

  return {
    storeId: input.storeId,
    workflowType: PURCHASE_ORDER_WORKFLOW_TYPE,
    lookupType: input.lookupType,
    lookupValue: normalizeWorkflowTraceLookupValue(lookupValue),
    traceId: input.traceId,
  };
}

function compactDetails(entries: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

export function buildPurchaseOrderTraceSeed(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  purchaseOrderId: Id<"purchaseOrder">;
  poNumber?: string;
  vendorId?: Id<"vendor">;
  vendorName?: string;
  operationalWorkItemId?: Id<"operationalWorkItem">;
  status?: string;
  startedAt: number;
  completedAt?: number;
}): PurchaseOrderTraceSeed {
  const purchaseOrderId = String(args.purchaseOrderId);
  const traceId = createWorkflowTraceId({
    workflowType: PURCHASE_ORDER_WORKFLOW_TYPE,
    primaryLookupValue: purchaseOrderId,
  });
  const label = formatPurchaseOrderLabel(args);
  const subjectRefs = Object.fromEntries(
    Object.entries({
      purchaseOrderId,
      poNumber: args.poNumber?.trim(),
      vendorId: args.vendorId ? String(args.vendorId) : undefined,
      operationalWorkItemId: args.operationalWorkItemId
        ? String(args.operationalWorkItemId)
        : undefined,
    }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;
  const completedAt =
    args.status === "received" || args.status === "cancelled"
      ? args.completedAt
      : undefined;
  const lookups = [
    normalizeLookup({
      storeId: args.storeId,
      lookupType: PURCHASE_ORDER_ID_LOOKUP_TYPE,
      lookupValue: purchaseOrderId,
      traceId,
    }),
    normalizeLookup({
      storeId: args.storeId,
      lookupType: PURCHASE_ORDER_NUMBER_LOOKUP_TYPE,
      lookupValue: args.poNumber,
      traceId,
    }),
    normalizeLookup({
      storeId: args.storeId,
      lookupType: PURCHASE_ORDER_VENDOR_LOOKUP_TYPE,
      lookupValue: args.vendorId ? String(args.vendorId) : undefined,
      traceId,
    }),
  ].filter((lookup): lookup is PurchaseOrderTraceLookup => Boolean(lookup));

  return {
    trace: {
      storeId: args.storeId,
      organizationId: args.organizationId,
      traceId,
      workflowType: PURCHASE_ORDER_WORKFLOW_TYPE,
      title: `Purchase order ${label}`,
      status: completedAt ? "succeeded" : "started",
      health: "healthy",
      startedAt: args.startedAt,
      completedAt,
      primaryLookupType: PURCHASE_ORDER_ID_LOOKUP_TYPE,
      primaryLookupValue: purchaseOrderId,
      primarySubjectType: "purchase_order",
      primarySubjectId: args.purchaseOrderId,
      summary: `Trace for purchase order ${label}`,
      details: compactDetails({
        status: args.status,
        vendorName: args.vendorName?.trim(),
      }),
    },
    lookups,
    subjectRefs,
    eventSource: "workflow.purchaseOrder",
  };
}

export function buildPurchaseOrderReceivingLookup(args: {
  storeId: Id<"store">;
  traceId: string;
  submissionKey: string;
}): PurchaseOrderTraceLookup {
  return {
    storeId: args.storeId,
    workflowType: PURCHASE_ORDER_WORKFLOW_TYPE,
    lookupType: PURCHASE_ORDER_RECEIVING_SUBMISSION_LOOKUP_TYPE,
    lookupValue: normalizeWorkflowTraceLookupValue(args.submissionKey),
    traceId: args.traceId,
  };
}
