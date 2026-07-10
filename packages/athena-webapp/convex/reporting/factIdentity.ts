import type { ReportingFactType } from "../../shared/reportingContract";

export const REPORTING_FACT_IDENTITY_VERSION = 1 as const;

export type ReportingBusinessEventIdentity =
  | { kind: "pos_sale"; transactionId: string }
  | { kind: "pos_void"; transactionId: string }
  | { kind: "pos_refund"; refundId: string; transactionId: string }
  | { kind: "service_completion"; serviceCaseId: string }
  | { kind: "storefront_fulfillment"; orderId: string }
  | { kind: "storefront_refund"; orderId: string; refundId: string }
  | { kind: "purchase_commitment"; lineId: string; purchaseOrderId: string }
  | {
      kind: "purchase_commitment_transition";
      lineId: string;
      purchaseOrderId: string;
      status: string;
    }
  | {
      kind: "purchase_receipt";
      lineId: string;
      purchaseOrderId: string;
      receivingBatchId: string;
    };

function requiredIdentityPart(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Reporting ${label} identity is required.`);
  }
  return normalized;
}

/**
 * Canonical source identity shared by live ingress and historical backfill.
 * Keys use durable source identifiers only, never arrival time or adapter mode.
 */
export function canonicalReportingBusinessEventKey(
  input: ReportingBusinessEventIdentity,
) {
  switch (input.kind) {
    case "pos_sale":
      return `pos:${requiredIdentityPart(input.transactionId, "transaction")}:complete`;
    case "pos_void":
      return `pos:${requiredIdentityPart(input.transactionId, "transaction")}:void`;
    case "pos_refund":
      return `pos:${requiredIdentityPart(input.transactionId, "transaction")}:refund:${requiredIdentityPart(input.refundId, "refund")}`;
    case "service_completion":
      return `service:${requiredIdentityPart(input.serviceCaseId, "service case")}:complete`;
    case "storefront_fulfillment":
      return `storefront:${requiredIdentityPart(input.orderId, "online order")}:fulfilled`;
    case "storefront_refund":
      return `storefront:${requiredIdentityPart(input.orderId, "online order")}:refund:${requiredIdentityPart(input.refundId, "refund")}`;
    case "purchase_commitment":
      return `purchase_order:${requiredIdentityPart(input.purchaseOrderId, "purchase order")}:commitment:line:${requiredIdentityPart(input.lineId, "purchase order line")}`;
    case "purchase_commitment_transition":
      return `purchase_order:${requiredIdentityPart(input.purchaseOrderId, "purchase order")}:commitment:${requiredIdentityPart(input.status, "purchase order status")}:line:${requiredIdentityPart(input.lineId, "purchase order line")}`;
    case "purchase_receipt":
      return `purchase_order:${requiredIdentityPart(input.purchaseOrderId, "purchase order")}:receipt:${requiredIdentityPart(input.receivingBatchId, "receiving batch")}:line:${requiredIdentityPart(input.lineId, "purchase order line")}`;
  }
}

export function canonicalReportingFactKey(input: {
  businessEventKey: string;
  factType: ReportingFactType;
  lineKey?: string | null;
}) {
  return input.lineKey
    ? `${input.businessEventKey}:line:${input.lineKey}:${input.factType}`
    : `${input.businessEventKey}:${input.factType}`;
}

export function canonicalReportingFactIdentity(input: {
  source: ReportingBusinessEventIdentity;
  factType: ReportingFactType;
  lineKey?: string | null;
}) {
  return canonicalReportingFactKey({
    businessEventKey: canonicalReportingBusinessEventKey(input.source),
    factType: input.factType,
    lineKey: input.lineKey,
  });
}
