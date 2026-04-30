import type { Id } from "../../../_generated/dataModel";
import {
  buildOperationalEvent,
  type RecordOperationalEventArgs,
} from "../../../operations/operationalEvents";
import type { SupportedCorrectionIntent } from "./correctionPolicy";

type CorrectionEventSubject = {
  type: string;
  id: string;
  label?: string;
};

type CorrectionEventActor = {
  userId?: Id<"athenaUser">;
  staffProfileId?: Id<"staffProfile">;
};

export type BuildCorrectionOperationalEventArgs = {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  intent: SupportedCorrectionIntent;
  subject: CorrectionEventSubject;
  actor?: CorrectionEventActor;
  reason: string;
  oldValue: unknown;
  newValue: unknown;
  metadata?: Record<string, unknown>;
  customerProfileId?: Id<"customerProfile">;
  registerSessionId?: Id<"registerSession">;
  paymentAllocationId?: Id<"paymentAllocation">;
  posTransactionId?: Id<"posTransaction">;
};

export function buildCorrectionOperationalEvent(
  args: BuildCorrectionOperationalEventArgs
) {
  const eventArgs: RecordOperationalEventArgs = {
    storeId: args.storeId,
    organizationId: args.organizationId,
    eventType: `pos.correction.${args.intent}`,
    subjectType: args.subject.type,
    subjectId: args.subject.id,
    subjectLabel: args.subject.label,
    message: `Correction recorded for ${args.subject.label ?? args.subject.type}.`,
    reason: args.reason,
    metadata: {
      correctionIntent: args.intent,
      oldValue: args.oldValue,
      newValue: args.newValue,
      ...args.metadata,
    },
    actorUserId: args.actor?.userId,
    actorStaffProfileId: args.actor?.staffProfileId,
    customerProfileId: args.customerProfileId,
    registerSessionId: args.registerSessionId,
    paymentAllocationId: args.paymentAllocationId,
    posTransactionId: args.posTransactionId,
  };

  return buildOperationalEvent(eventArgs);
}
