import type { Id } from "../../_generated/dataModel";
import {
  createWorkflowTraceId,
  normalizeWorkflowTraceLookupValue,
} from "../../../shared/workflowTrace";

export const EXPENSE_SESSION_WORKFLOW_TYPE = "expense_session";
export const EXPENSE_SESSION_LOOKUP_TYPE = "session_number";

export type ExpenseSessionTraceSeed = {
  trace: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    traceId: string;
    workflowType: typeof EXPENSE_SESSION_WORKFLOW_TYPE;
    title: string;
    status: "started";
    health: "healthy";
    startedAt: number;
    primaryLookupType: typeof EXPENSE_SESSION_LOOKUP_TYPE;
    primaryLookupValue: string;
    primarySubjectType: "expense_session";
    primarySubjectId?: Id<"expenseSession">;
    summary: string;
  };
  lookup: {
    storeId: Id<"store">;
    workflowType: typeof EXPENSE_SESSION_WORKFLOW_TYPE;
    lookupType: typeof EXPENSE_SESSION_LOOKUP_TYPE;
    lookupValue: string;
    traceId: string;
  };
  subjectRefs: {
    expenseSessionId?: Id<"expenseSession">;
    staffProfileId?: Id<"staffProfile">;
    terminalId?: Id<"posTerminal">;
    registerSessionId?: Id<"registerSession">;
  };
  eventSource: "workflow.expenseSession";
};

export function buildExpenseSessionTraceSeed(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  startedAt?: number;
  sessionNumber: string;
  expenseSessionId?: Id<"expenseSession">;
  staffProfileId?: Id<"staffProfile">;
  terminalId?: Id<"posTerminal">;
  registerSessionId?: Id<"registerSession">;
}): ExpenseSessionTraceSeed {
  const displaySessionNumber = args.sessionNumber.trim();
  const traceId = createWorkflowTraceId({
    workflowType: EXPENSE_SESSION_WORKFLOW_TYPE,
    primaryLookupValue: args.expenseSessionId ?? displaySessionNumber,
  });
  const lookupValue = normalizeWorkflowTraceLookupValue(displaySessionNumber);
  const subjectRefs = Object.fromEntries(
    Object.entries({
      expenseSessionId: args.expenseSessionId,
      staffProfileId: args.staffProfileId,
      terminalId: args.terminalId,
      registerSessionId: args.registerSessionId,
    }).filter(([, value]) => Boolean(value)),
  ) as ExpenseSessionTraceSeed["subjectRefs"];

  return {
    trace: {
      storeId: args.storeId,
      organizationId: args.organizationId,
      traceId,
      workflowType: EXPENSE_SESSION_WORKFLOW_TYPE,
      title: `Expense session ${displaySessionNumber}`,
      status: "started",
      health: "healthy",
      startedAt: args.startedAt ?? Date.now(),
      primaryLookupType: EXPENSE_SESSION_LOOKUP_TYPE,
      primaryLookupValue: displaySessionNumber,
      primarySubjectType: "expense_session",
      primarySubjectId: args.expenseSessionId,
      summary: `Trace for expense session ${displaySessionNumber}`,
    },
    lookup: {
      storeId: args.storeId,
      workflowType: EXPENSE_SESSION_WORKFLOW_TYPE,
      lookupType: EXPENSE_SESSION_LOOKUP_TYPE,
      lookupValue,
      traceId,
    },
    subjectRefs,
    eventSource: "workflow.expenseSession",
  };
}
