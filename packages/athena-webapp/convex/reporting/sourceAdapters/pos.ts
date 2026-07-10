import type { CommerceLine, PosCompletedEvent } from "./types";
import { canonicalReportingBusinessEventKey } from "../factIdentity";

export function adaptPosCompleted(input: {
  currency: string;
  isOffline?: boolean;
  lines: CommerceLine[];
  occurredAt: number;
  recordedAt: number;
  storeId: string;
  transactionId: string;
}): PosCompletedEvent {
  return {
    currency: input.currency,
    eventKey: canonicalReportingBusinessEventKey({
      kind: "pos_sale",
      transactionId: input.transactionId,
    }),
    kind: "pos_completed",
    lines: input.lines,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    sourceId: input.transactionId,
    storeId: input.storeId,
  };
}
