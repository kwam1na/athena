import type { Id } from "../../_generated/dataModel";
import {
  createWorkflowTraceId,
  normalizeWorkflowTraceLookupValue,
} from "../../../shared/workflowTrace";

export const REGISTER_SESSION_WORKFLOW_TYPE = "register_session";
export const REGISTER_SESSION_LOOKUP_TYPE = "register_session_id";

export type RegisterSessionTraceSeed = {
  trace: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    traceId: string;
    workflowType: typeof REGISTER_SESSION_WORKFLOW_TYPE;
    title: string;
    status: "started";
    health: "healthy";
    startedAt: number;
    primaryLookupType: typeof REGISTER_SESSION_LOOKUP_TYPE;
    primaryLookupValue: string;
    primarySubjectType: "register_session";
    primarySubjectId: Id<"registerSession">;
    summary: string;
  };
  lookup: {
    storeId: Id<"store">;
    workflowType: typeof REGISTER_SESSION_WORKFLOW_TYPE;
    lookupType: typeof REGISTER_SESSION_LOOKUP_TYPE;
    lookupValue: string;
    traceId: string;
  };
  subjectRefs: Record<string, string>;
  eventSource: "workflow.registerSession";
};

function formatRegisterSessionLabel(args: {
  registerNumber?: string;
  registerSessionId: Id<"registerSession">;
}) {
  const registerNumber = args.registerNumber?.trim();
  return registerNumber ? registerNumber : String(args.registerSessionId);
}

export function buildRegisterSessionTraceSeed(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  registerSessionId: Id<"registerSession">;
  registerNumber?: string;
  terminalId?: Id<"posTerminal">;
  openedAt: number;
  openedByStaffProfileId?: Id<"staffProfile">;
  openedByUserId?: Id<"athenaUser">;
}): RegisterSessionTraceSeed {
  const lookupValue = String(args.registerSessionId);
  const traceId = createWorkflowTraceId({
    workflowType: REGISTER_SESSION_WORKFLOW_TYPE,
    primaryLookupValue: lookupValue,
  });
  const registerLabel = formatRegisterSessionLabel(args);
  const subjectRefs = Object.fromEntries(
    Object.entries({
      registerSessionId: String(args.registerSessionId),
      registerNumber: args.registerNumber?.trim(),
      terminalId: args.terminalId ? String(args.terminalId) : undefined,
      openedByStaffProfileId: args.openedByStaffProfileId
        ? String(args.openedByStaffProfileId)
        : undefined,
      openedByUserId: args.openedByUserId ? String(args.openedByUserId) : undefined,
    }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;

  return {
    trace: {
      storeId: args.storeId,
      organizationId: args.organizationId,
      traceId,
      workflowType: REGISTER_SESSION_WORKFLOW_TYPE,
      title: `Register session ${registerLabel}`,
      status: "started",
      health: "healthy",
      startedAt: args.openedAt,
      primaryLookupType: REGISTER_SESSION_LOOKUP_TYPE,
      primaryLookupValue: lookupValue,
      primarySubjectType: "register_session",
      primarySubjectId: args.registerSessionId,
      summary: `Trace for register session ${registerLabel}`,
    },
    lookup: {
      storeId: args.storeId,
      workflowType: REGISTER_SESSION_WORKFLOW_TYPE,
      lookupType: REGISTER_SESSION_LOOKUP_TYPE,
      lookupValue: normalizeWorkflowTraceLookupValue(lookupValue),
      traceId,
    },
    subjectRefs,
    eventSource: "workflow.registerSession",
  };
}
