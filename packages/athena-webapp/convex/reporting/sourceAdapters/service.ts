import type { ServiceCompletedEvent } from "./types";
import { canonicalReportingBusinessEventKey } from "../factIdentity";

export function adaptServiceCompletion(input: {
  currency: string;
  netRevenueMinor: number;
  occurredAt: number;
  posTransactionId?: string;
  recordedAt: number;
  serviceCaseId: string;
  storeId: string;
}): ServiceCompletedEvent {
  return {
    currency: input.currency,
    eventKey: canonicalReportingBusinessEventKey({
      kind: "service_completion",
      serviceCaseId: input.serviceCaseId,
    }),
    kind: "service_completed",
    netRevenueMinor: input.netRevenueMinor,
    occurredAt: input.occurredAt,
    posTransactionId: input.posTransactionId,
    recordedAt: input.recordedAt,
    serviceCaseId: input.serviceCaseId,
    storeId: input.storeId,
  };
}
