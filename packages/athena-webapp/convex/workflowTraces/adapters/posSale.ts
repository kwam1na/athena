import type { Id } from "../../_generated/dataModel";
import {
  createWorkflowTraceId,
  normalizeWorkflowTraceLookupValue,
} from "../../../shared/workflowTrace";

export const POS_SALE_WORKFLOW_TYPE = "pos_sale";
export const POS_TRANSACTION_LOOKUP_TYPE = "transaction_number";

export type PosSaleTraceSeed = {
  trace: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    traceId: string;
    workflowType: typeof POS_SALE_WORKFLOW_TYPE;
    title: string;
    status: "started";
    health: "healthy";
    startedAt: number;
    primaryLookupType: typeof POS_TRANSACTION_LOOKUP_TYPE;
    primaryLookupValue: string;
    primarySubjectType: "pos_transaction";
    primarySubjectId?: Id<"posTransaction">;
    summary: string;
  };
  lookup: {
    storeId: Id<"store">;
    workflowType: typeof POS_SALE_WORKFLOW_TYPE;
    lookupType: typeof POS_TRANSACTION_LOOKUP_TYPE;
    lookupValue: string;
    traceId: string;
  };
  subjectRefs: {
    posTransactionId?: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    cashierId?: Id<"cashier">;
    terminalId?: Id<"posTerminal">;
    customerId?: Id<"posCustomer">;
  };
  eventSource: "workflow.posSale";
};

export function buildPosSaleTraceSeed(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  startedAt?: number;
  transactionNumber: string;
  posTransactionId?: Id<"posTransaction">;
  registerSessionId?: Id<"registerSession">;
  cashierId?: Id<"cashier">;
  terminalId?: Id<"posTerminal">;
  customerId?: Id<"posCustomer">;
}): PosSaleTraceSeed {
  const displayTransactionNumber = args.transactionNumber.trim();
  const traceId = createWorkflowTraceId({
    workflowType: POS_SALE_WORKFLOW_TYPE,
    primaryLookupValue: displayTransactionNumber,
  });
  const lookupValue = normalizeWorkflowTraceLookupValue(displayTransactionNumber);
  const subjectRefs = Object.fromEntries(
    Object.entries({
      posTransactionId: args.posTransactionId,
      registerSessionId: args.registerSessionId,
      cashierId: args.cashierId,
      terminalId: args.terminalId,
      customerId: args.customerId,
    }).filter(([, value]) => Boolean(value)),
  ) as PosSaleTraceSeed["subjectRefs"];

  return {
    trace: {
      storeId: args.storeId,
      organizationId: args.organizationId,
      traceId,
      workflowType: POS_SALE_WORKFLOW_TYPE,
      title: `POS sale ${displayTransactionNumber}`,
      status: "started",
      health: "healthy",
      startedAt: args.startedAt ?? Date.now(),
      primaryLookupType: POS_TRANSACTION_LOOKUP_TYPE,
      primaryLookupValue: displayTransactionNumber,
      primarySubjectType: "pos_transaction",
      primarySubjectId: args.posTransactionId,
      summary: `Trace for POS transaction ${displayTransactionNumber}`,
    },
    lookup: {
      storeId: args.storeId,
      workflowType: POS_SALE_WORKFLOW_TYPE,
      lookupType: POS_TRANSACTION_LOOKUP_TYPE,
      lookupValue,
      traceId,
    },
    subjectRefs,
    eventSource: "workflow.posSale",
  };
}
