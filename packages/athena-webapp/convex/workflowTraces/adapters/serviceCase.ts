import type { Id } from "../../_generated/dataModel";
import {
  createWorkflowTraceId,
  normalizeWorkflowTraceLookupValue,
} from "../../../shared/workflowTrace";

export const SERVICE_CASE_WORKFLOW_TYPE = "service_case";
export const SERVICE_CASE_LOOKUP_TYPE = "service_case_id";

export type ServiceCaseTraceSeed = {
  trace: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    traceId: string;
    workflowType: typeof SERVICE_CASE_WORKFLOW_TYPE;
    title: string;
    status: "started" | "succeeded" | "failed" | "blocked" | "info";
    health: "healthy";
    startedAt: number;
    completedAt?: number;
    primaryLookupType: typeof SERVICE_CASE_LOOKUP_TYPE;
    primaryLookupValue: string;
    primarySubjectType: "service_case";
    primarySubjectId: Id<"serviceCase">;
    summary: string;
  };
  lookups: Array<{
    storeId: Id<"store">;
    workflowType: typeof SERVICE_CASE_WORKFLOW_TYPE;
    lookupType: string;
    lookupValue: string;
    traceId: string;
  }>;
  subjectRefs: Record<string, string>;
  eventSource: "workflow.serviceCase";
};

function addLookup(
  lookups: ServiceCaseTraceSeed["lookups"],
  args: {
    storeId: Id<"store">;
    traceId: string;
    lookupType: string;
    lookupValue?: string;
  },
) {
  const lookupValue = args.lookupValue?.trim();

  if (!lookupValue) {
    return;
  }

  lookups.push({
    storeId: args.storeId,
    workflowType: SERVICE_CASE_WORKFLOW_TYPE,
    lookupType: args.lookupType,
    lookupValue: normalizeWorkflowTraceLookupValue(lookupValue),
    traceId: args.traceId,
  });
}

export function buildServiceCaseTraceSeed(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  serviceCaseId: Id<"serviceCase">;
  customerProfileId: Id<"customerProfile">;
  operationalWorkItemId: Id<"operationalWorkItem">;
  appointmentId?: Id<"serviceAppointment">;
  serviceCatalogId?: Id<"serviceCatalog">;
  assignedStaffProfileId?: Id<"staffProfile">;
  createdAt: number;
  serviceMode: string;
}): ServiceCaseTraceSeed {
  const serviceCaseId = String(args.serviceCaseId);
  const traceId = createWorkflowTraceId({
    workflowType: SERVICE_CASE_WORKFLOW_TYPE,
    primaryLookupValue: serviceCaseId,
  });
  const lookups: ServiceCaseTraceSeed["lookups"] = [];

  addLookup(lookups, {
    storeId: args.storeId,
    traceId,
    lookupType: SERVICE_CASE_LOOKUP_TYPE,
    lookupValue: serviceCaseId,
  });
  addLookup(lookups, {
    storeId: args.storeId,
    traceId,
    lookupType: "customer_profile_id",
    lookupValue: String(args.customerProfileId),
  });
  addLookup(lookups, {
    storeId: args.storeId,
    traceId,
    lookupType: "operational_work_item_id",
    lookupValue: String(args.operationalWorkItemId),
  });
  addLookup(lookups, {
    storeId: args.storeId,
    traceId,
    lookupType: "service_appointment_id",
    lookupValue: args.appointmentId ? String(args.appointmentId) : undefined,
  });

  const subjectRefs = Object.fromEntries(
    Object.entries({
      serviceCaseId,
      customerProfileId: String(args.customerProfileId),
      operationalWorkItemId: String(args.operationalWorkItemId),
      appointmentId: args.appointmentId ? String(args.appointmentId) : undefined,
      serviceCatalogId: args.serviceCatalogId
        ? String(args.serviceCatalogId)
        : undefined,
      assignedStaffProfileId: args.assignedStaffProfileId
        ? String(args.assignedStaffProfileId)
        : undefined,
      serviceMode: args.serviceMode,
    }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;

  return {
    trace: {
      storeId: args.storeId,
      organizationId: args.organizationId,
      traceId,
      workflowType: SERVICE_CASE_WORKFLOW_TYPE,
      title: `Service case ${serviceCaseId}`,
      status: "started",
      health: "healthy",
      startedAt: args.createdAt,
      primaryLookupType: SERVICE_CASE_LOOKUP_TYPE,
      primaryLookupValue: serviceCaseId,
      primarySubjectType: "service_case",
      primarySubjectId: args.serviceCaseId,
      summary: `Trace for service case ${serviceCaseId}`,
    },
    lookups,
    subjectRefs,
    eventSource: "workflow.serviceCase",
  };
}
