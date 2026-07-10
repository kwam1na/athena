import type { CommerceLine, StorefrontStatusEvent } from "./types";
import { canonicalReportingBusinessEventKey } from "../factIdentity";

export function adaptStorefrontStatus(input: {
  currency: string;
  lines: CommerceLine[];
  occurredAt: number;
  orderId: string;
  previousStatus: string;
  recordedAt: number;
  status: string;
  storeId: string;
}): StorefrontStatusEvent {
  const normalizeStatus = (status: string) => status.replaceAll("-", "_");
  return {
    currency: input.currency,
    eventKey: canonicalReportingBusinessEventKey({
      kind: "storefront_fulfillment",
      orderId: input.orderId,
    }),
    kind: "storefront_status_changed",
    lines: input.lines,
    occurredAt: input.occurredAt,
    previousStatus: normalizeStatus(input.previousStatus),
    recordedAt: input.recordedAt,
    sourceId: input.orderId,
    status: normalizeStatus(input.status),
    storeId: input.storeId,
  };
}
