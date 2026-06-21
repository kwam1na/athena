import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../workflowTraces/core";

import { recordServiceCaseTraceBestEffort } from "./serviceCaseTracing";

vi.mock("../workflowTraces/core", () => ({
  appendWorkflowTraceEventWithCtx: vi.fn(),
  createWorkflowTraceWithCtx: vi.fn(),
  registerWorkflowTraceLookupWithCtx: vi.fn(),
}));

function buildServiceCase() {
  return {
    _id: "case-1" as Id<"serviceCase">,
    appointmentId: "appointment-1" as Id<"serviceAppointment">,
    assignedStaffProfileId: "staff-1" as Id<"staffProfile">,
    balanceDueAmount: 12_000,
    createdAt: 111,
    customerProfileId: "customer-1" as Id<"customerProfile">,
    lastStatusChangedAt: 222,
    operationalWorkItemId: "work-1" as Id<"operationalWorkItem">,
    organizationId: "org-1" as Id<"organization">,
    paymentStatus: "partially_paid" as const,
    serviceCatalogId: "catalog-1" as Id<"serviceCatalog">,
    serviceMode: "repair" as const,
    status: "in_progress" as const,
    storeId: "store-1" as Id<"store">,
    totalAmount: 20_000,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-row-1" as never);
  vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
    "lookup-row-1" as never,
  );
  vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
    "event-row-1" as never,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordServiceCaseTraceBestEffort", () => {
  it("records service payment evidence on the service-case trace with refs and actor refs", async () => {
    await recordServiceCaseTraceBestEffort({} as never, {
      actorStaffProfileId: "staff-cashier-1" as Id<"staffProfile">,
      actorUserId: "user-1" as Id<"athenaUser">,
      amount: 8_000,
      direction: "in",
      method: "cash",
      paymentAllocationId: "payment-1" as Id<"paymentAllocation">,
      registerSessionId: "session-1" as Id<"registerSession">,
      serviceCase: buildServiceCase(),
      stage: "payment_recorded",
    });

    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        primarySubjectId: "case-1",
        status: "started",
        traceId: "service_case:case-1",
        workflowType: "service_case",
      }),
    );
    expect(registerWorkflowTraceLookupWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lookupType: "payment_allocation_id",
        lookupValue: "payment-1",
        traceId: "service_case:case-1",
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorRefs: {
          actorStaffProfileId: "staff-cashier-1",
          actorUserId: "user-1",
        },
        details: expect.objectContaining({
          amount: 8_000,
          direction: "in",
          method: "cash",
        }),
        eventKey: "case-1:payment_recorded:payment-1",
        message: "Service payment recorded.",
        source: "workflow.serviceCase",
        step: "service_case_payment_recorded",
        subjectRefs: expect.objectContaining({
          customerProfileId: "customer-1",
          operationalWorkItemId: "work-1",
          paymentAllocationId: "payment-1",
          registerSessionId: "session-1",
          serviceCaseId: "case-1",
        }),
      }),
    );
    expect(
      vi.mocked(appendWorkflowTraceEventWithCtx).mock.calls[0]?.[1],
    ).not.toHaveProperty("details.serviceNotes");
    expect(
      vi.mocked(appendWorkflowTraceEventWithCtx).mock.calls[0]?.[1],
    ).not.toHaveProperty("details.customerPhone");
  });

  it("marks terminal service-case states on the same trace", async () => {
    await recordServiceCaseTraceBestEffort({} as never, {
      nextStatus: "completed",
      previousStatus: "awaiting_pickup",
      serviceCase: {
        ...buildServiceCase(),
        completedAt: 333,
        status: "completed",
        paymentStatus: "paid",
        balanceDueAmount: 0,
      },
      stage: "completed",
    });

    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        completedAt: 333,
        status: "succeeded",
        traceId: "service_case:case-1",
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventKey: "case-1:status:awaiting_pickup:completed",
        status: "succeeded",
        step: "service_case_completed",
      }),
    );
  });

  it("keeps service commands non-blocking when trace writes fail", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(createWorkflowTraceWithCtx).mockRejectedValueOnce(
      new Error("trace unavailable"),
    );

    await expect(
      recordServiceCaseTraceBestEffort({} as never, {
        serviceCase: buildServiceCase(),
        stage: "created",
      }),
    ).resolves.toEqual({ traceId: "service_case:case-1" });

    expect(registerWorkflowTraceLookupWithCtx).toHaveBeenCalled();
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventKey: "case-1:created",
        step: "service_case_created",
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[workflow-trace] service.case.trace.create",
      expect.any(Error),
    );
  });
});
