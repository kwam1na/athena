import type { Id } from "../../_generated/dataModel";
import {
  createWorkflowTraceId,
  normalizeWorkflowTraceLookupValue,
} from "../../../shared/workflowTrace";

export const POS_SESSION_WORKFLOW_TYPE = "pos_session";
export const POS_SESSION_LOOKUP_TYPE = "session_number";

export type PosSessionTraceSeed = {
  trace: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    traceId: string;
    workflowType: typeof POS_SESSION_WORKFLOW_TYPE;
    title: string;
    status: "started";
    health: "healthy";
    startedAt: number;
    primaryLookupType: typeof POS_SESSION_LOOKUP_TYPE;
    primaryLookupValue: string;
    primarySubjectType: "pos_session";
    primarySubjectId?: Id<"posSession">;
    summary: string;
  };
  lookup: {
    storeId: Id<"store">;
    workflowType: typeof POS_SESSION_WORKFLOW_TYPE;
    lookupType: typeof POS_SESSION_LOOKUP_TYPE;
    lookupValue: string;
    traceId: string;
  };
  subjectRefs: {
    posSessionId?: Id<"posSession">;
    staffProfileId?: Id<"staffProfile">;
    terminalId?: Id<"posTerminal">;
    customerId?: Id<"posCustomer">;
    posTransactionId?: Id<"posTransaction">;
  };
  eventSource: "workflow.posSession";
};

export function buildPosSessionTraceSeed(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  startedAt?: number;
  sessionNumber: string;
  posSessionId?: Id<"posSession">;
  staffProfileId?: Id<"staffProfile">;
  terminalId?: Id<"posTerminal">;
  customerId?: Id<"posCustomer">;
  posTransactionId?: Id<"posTransaction">;
}): PosSessionTraceSeed {
  const displaySessionNumber = args.sessionNumber.trim();
  const traceId = createWorkflowTraceId({
    workflowType: POS_SESSION_WORKFLOW_TYPE,
    primaryLookupValue: args.posSessionId ?? displaySessionNumber,
  });
  const lookupValue = normalizeWorkflowTraceLookupValue(displaySessionNumber);
  const subjectRefs = Object.fromEntries(
    Object.entries({
      posSessionId: args.posSessionId,
      staffProfileId: args.staffProfileId,
      terminalId: args.terminalId,
      customerId: args.customerId,
      posTransactionId: args.posTransactionId,
    }).filter(([, value]) => Boolean(value)),
  ) as PosSessionTraceSeed["subjectRefs"];

  return {
    trace: {
      storeId: args.storeId,
      organizationId: args.organizationId,
      traceId,
      workflowType: POS_SESSION_WORKFLOW_TYPE,
      title: `POS session ${displaySessionNumber}`,
      status: "started",
      health: "healthy",
      startedAt: args.startedAt ?? Date.now(),
      primaryLookupType: POS_SESSION_LOOKUP_TYPE,
      primaryLookupValue: displaySessionNumber,
      primarySubjectType: "pos_session",
      primarySubjectId: args.posSessionId,
      summary: `Trace for POS session ${displaySessionNumber}`,
    },
    lookup: {
      storeId: args.storeId,
      workflowType: POS_SESSION_WORKFLOW_TYPE,
      lookupType: POS_SESSION_LOOKUP_TYPE,
      lookupValue,
      traceId,
    },
    subjectRefs,
    eventSource: "workflow.posSession",
  };
}
