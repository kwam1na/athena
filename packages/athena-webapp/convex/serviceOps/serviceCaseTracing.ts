import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../workflowTraces/core";
import {
  buildServiceCaseTraceSeed,
  SERVICE_CASE_WORKFLOW_TYPE,
  type ServiceCaseTraceSeed,
} from "../workflowTraces/adapters/serviceCase";

export type ServiceCaseTraceStage =
  | "created"
  | "intake_created"
  | "appointment_converted"
  | "line_item_added"
  | "approval_pending"
  | "payment_recorded"
  | "refund_recorded"
  | "inventory_usage_recorded"
  | "awaiting_pickup"
  | "completed"
  | "cancelled"
  | "status_updated";

export type ServiceCaseTraceableCase = Pick<
  Doc<"serviceCase">,
  | "_id"
  | "appointmentId"
  | "assignedStaffProfileId"
  | "createdAt"
  | "customerProfileId"
  | "lastStatusChangedAt"
  | "operationalWorkItemId"
  | "organizationId"
  | "paymentStatus"
  | "serviceCatalogId"
  | "serviceMode"
  | "status"
  | "storeId"
  | "totalAmount"
  | "balanceDueAmount"
> & {
  completedAt?: number;
  cancelledAt?: number;
};

type ServiceCaseTraceArgs = {
  stage: ServiceCaseTraceStage;
  serviceCase: ServiceCaseTraceableCase;
  occurredAt?: number;
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  approvalRequestId?: Id<"approvalRequest">;
  appointmentId?: Id<"serviceAppointment">;
  inventoryMovementId?: Id<"inventoryMovement">;
  lineItemId?: Id<"serviceCaseLineItem">;
  lineType?: string;
  paymentAllocationId?: Id<"paymentAllocation">;
  productSkuId?: Id<"productSku">;
  quantity?: number;
  registerSessionId?: Id<"registerSession">;
  serviceInventoryUsageId?: Id<"serviceInventoryUsage">;
  amount?: number;
  direction?: "in" | "out";
  method?: string;
  nextStatus?: string;
  previousStatus?: string;
  eventKey?: string;
};

function safeTraceWrite(label: string, write: () => Promise<void>) {
  return write().catch((error) => {
    console.error(`[workflow-trace] ${label}`, error);
  });
}

function resolveOccurredAt(args: ServiceCaseTraceArgs) {
  if (args.occurredAt !== undefined) {
    return args.occurredAt;
  }

  switch (args.stage) {
    case "created":
    case "intake_created":
    case "appointment_converted":
      return args.serviceCase.createdAt;
    case "completed":
      return args.serviceCase.completedAt ?? args.serviceCase.lastStatusChangedAt;
    case "cancelled":
      return args.serviceCase.cancelledAt ?? args.serviceCase.lastStatusChangedAt;
    default:
      return Date.now();
  }
}

function buildActorRefs(args: ServiceCaseTraceArgs) {
  const actorRefs = Object.fromEntries(
    Object.entries({
      actorStaffProfileId: args.actorStaffProfileId
        ? String(args.actorStaffProfileId)
        : undefined,
      actorUserId: args.actorUserId ? String(args.actorUserId) : undefined,
    }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;

  return Object.keys(actorRefs).length > 0 ? actorRefs : undefined;
}

function buildLookupRefs(args: {
  serviceCase: ServiceCaseTraceableCase;
  traceId: string;
  stageArgs: ServiceCaseTraceArgs;
}) {
  return [
    ["approval_request_id", args.stageArgs.approvalRequestId],
    ["payment_allocation_id", args.stageArgs.paymentAllocationId],
    ["inventory_movement_id", args.stageArgs.inventoryMovementId],
    ["service_inventory_usage_id", args.stageArgs.serviceInventoryUsageId],
  ].flatMap(([lookupType, lookupValue]) =>
    lookupValue
      ? [
          {
            storeId: args.serviceCase.storeId,
            workflowType: SERVICE_CASE_WORKFLOW_TYPE,
            lookupType: String(lookupType),
            lookupValue: String(lookupValue),
            traceId: args.traceId,
          },
        ]
      : [],
  );
}

function buildTraceRecord(args: {
  traceSeed: ServiceCaseTraceSeed;
  input: ServiceCaseTraceArgs;
}) {
  const occurredAt = resolveOccurredAt(args.input);

  switch (args.input.stage) {
    case "approval_pending":
      return {
        ...args.traceSeed.trace,
        status: "blocked" as const,
        completedAt: undefined,
      };
    case "completed":
      return {
        ...args.traceSeed.trace,
        status: "succeeded" as const,
        completedAt: occurredAt,
      };
    case "cancelled":
      return {
        ...args.traceSeed.trace,
        status: "failed" as const,
        completedAt: occurredAt,
      };
    default:
      return {
        ...args.traceSeed.trace,
        status: "started" as const,
        completedAt: undefined,
      };
  }
}

function buildEventKey(args: ServiceCaseTraceArgs) {
  if (args.eventKey) {
    return args.eventKey;
  }

  const serviceCaseId = String(args.serviceCase._id);

  switch (args.stage) {
    case "created":
    case "intake_created":
      return `${serviceCaseId}:${args.stage}`;
    case "appointment_converted":
      return `${serviceCaseId}:appointment_converted:${args.appointmentId ?? args.serviceCase.appointmentId ?? "unknown"}`;
    case "approval_pending":
      return args.approvalRequestId
        ? `${serviceCaseId}:approval_pending:${args.approvalRequestId}`
        : `${serviceCaseId}:approval_pending`;
    case "payment_recorded":
    case "refund_recorded":
      return args.paymentAllocationId
        ? `${serviceCaseId}:${args.stage}:${args.paymentAllocationId}`
        : undefined;
    case "inventory_usage_recorded":
      return args.serviceInventoryUsageId
        ? `${serviceCaseId}:inventory_usage:${args.serviceInventoryUsageId}`
        : undefined;
    case "line_item_added":
      return args.lineItemId
        ? `${serviceCaseId}:line_item:${args.lineItemId}`
        : undefined;
    case "awaiting_pickup":
    case "completed":
    case "cancelled":
      return `${serviceCaseId}:status:${args.previousStatus ?? "unknown"}:${args.stage}`;
    case "status_updated":
      return args.nextStatus
        ? `${serviceCaseId}:status:${args.previousStatus ?? "unknown"}:${args.nextStatus}`
        : undefined;
  }
}

function buildTraceEvent(args: {
  traceSeed: ServiceCaseTraceSeed;
  input: ServiceCaseTraceArgs;
}) {
  const occurredAt = resolveOccurredAt(args.input);
  const details = Object.fromEntries(
    Object.entries({
      amount: args.input.amount,
      direction: args.input.direction,
      lineType: args.input.lineType,
      method: args.input.method,
      nextStatus: args.input.nextStatus,
      paymentStatus: args.input.serviceCase.paymentStatus,
      previousStatus: args.input.previousStatus,
      quantity: args.input.quantity,
      serviceMode: args.input.serviceCase.serviceMode,
      status: args.input.serviceCase.status,
      totalAmount: args.input.serviceCase.totalAmount,
      balanceDueAmount: args.input.serviceCase.balanceDueAmount,
    }).filter(([, value]) => value !== undefined),
  );
  const subjectRefs = Object.fromEntries(
    Object.entries({
      ...args.traceSeed.subjectRefs,
      approvalRequestId: args.input.approvalRequestId
        ? String(args.input.approvalRequestId)
        : undefined,
      appointmentId: args.input.appointmentId
        ? String(args.input.appointmentId)
        : undefined,
      inventoryMovementId: args.input.inventoryMovementId
        ? String(args.input.inventoryMovementId)
        : undefined,
      lineItemId: args.input.lineItemId ? String(args.input.lineItemId) : undefined,
      paymentAllocationId: args.input.paymentAllocationId
        ? String(args.input.paymentAllocationId)
        : undefined,
      productSkuId: args.input.productSkuId
        ? String(args.input.productSkuId)
        : undefined,
      registerSessionId: args.input.registerSessionId
        ? String(args.input.registerSessionId)
        : undefined,
      serviceInventoryUsageId: args.input.serviceInventoryUsageId
        ? String(args.input.serviceInventoryUsageId)
        : undefined,
    }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;

  switch (args.input.stage) {
    case "created":
      return {
        kind: "milestone" as const,
        step: "service_case_created",
        status: "started" as const,
        message: "Service case created.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "intake_created":
      return {
        kind: "milestone" as const,
        step: "service_case_intake_created",
        status: "started" as const,
        message: "Service intake created the case.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "appointment_converted":
      return {
        kind: "milestone" as const,
        step: "service_case_appointment_converted",
        status: "started" as const,
        message: "Service appointment converted to a case.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "line_item_added":
      return {
        kind: "system_action" as const,
        step: "service_case_line_item_added",
        status: "info" as const,
        message: "Service case line item added.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "approval_pending":
      return {
        kind: "milestone" as const,
        step: "service_case_approval_pending",
        status: "blocked" as const,
        message: "Service case is waiting for approval.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "payment_recorded":
      return {
        kind: "system_action" as const,
        step: "service_case_payment_recorded",
        status: "info" as const,
        message: "Service payment recorded.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "refund_recorded":
      return {
        kind: "system_action" as const,
        step: "service_case_refund_recorded",
        status: "info" as const,
        message: "Service refund recorded.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "inventory_usage_recorded":
      return {
        kind: "system_action" as const,
        step: "service_case_inventory_usage_recorded",
        status: "info" as const,
        message: "Service material usage recorded.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "awaiting_pickup":
      return {
        kind: "milestone" as const,
        step: "service_case_awaiting_pickup",
        status: "started" as const,
        message: "Service case is waiting for pickup.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "completed":
      return {
        kind: "milestone" as const,
        step: "service_case_completed",
        status: "succeeded" as const,
        message: "Service case completed.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "cancelled":
      return {
        kind: "milestone" as const,
        step: "service_case_cancelled",
        status: "failed" as const,
        message: "Service case cancelled.",
        occurredAt,
        details,
        subjectRefs,
      };
    case "status_updated":
      return {
        kind: "milestone" as const,
        step: "service_case_status_updated",
        status: "info" as const,
        message: "Service case status updated.",
        occurredAt,
        details,
        subjectRefs,
      };
  }
}

export async function recordServiceCaseTraceBestEffort(
  ctx: MutationCtx,
  args: ServiceCaseTraceArgs,
) {
  const traceSeed = buildServiceCaseTraceSeed({
    storeId: args.serviceCase.storeId,
    organizationId: args.serviceCase.organizationId,
    serviceCaseId: args.serviceCase._id,
    customerProfileId: args.serviceCase.customerProfileId,
    operationalWorkItemId: args.serviceCase.operationalWorkItemId,
    appointmentId: args.serviceCase.appointmentId,
    serviceCatalogId: args.serviceCase.serviceCatalogId,
    assignedStaffProfileId: args.serviceCase.assignedStaffProfileId,
    createdAt: args.serviceCase.createdAt,
    serviceMode: args.serviceCase.serviceMode,
  });
  const traceRecord = buildTraceRecord({ traceSeed, input: args });
  const traceEvent = buildTraceEvent({ traceSeed, input: args });
  const extraLookups = buildLookupRefs({
    serviceCase: args.serviceCase,
    traceId: traceSeed.trace.traceId,
    stageArgs: args,
  });

  await safeTraceWrite("service.case.trace.create", async () => {
    await createWorkflowTraceWithCtx(ctx, traceRecord);
  });

  await safeTraceWrite("service.case.trace.lookup", async () => {
    await Promise.all(
      [...traceSeed.lookups, ...extraLookups].map((lookup) =>
        registerWorkflowTraceLookupWithCtx(ctx, lookup),
      ),
    );
  });

  await safeTraceWrite("service.case.trace.event", async () => {
    await appendWorkflowTraceEventWithCtx(ctx, {
      storeId: traceSeed.trace.storeId,
      traceId: traceSeed.trace.traceId,
      workflowType: traceSeed.trace.workflowType,
      ...traceEvent,
      eventKey: buildEventKey(args),
      source: traceSeed.eventSource,
      actorRefs: buildActorRefs(args),
    });
  });

  return {
    traceId: traceSeed.trace.traceId,
  };
}
