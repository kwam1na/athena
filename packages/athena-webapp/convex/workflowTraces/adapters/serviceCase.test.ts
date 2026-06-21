import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";

import { buildServiceCaseTraceSeed } from "./serviceCase";

describe("buildServiceCaseTraceSeed", () => {
  it("creates one stable service-case workflow trace with linked lookup refs", () => {
    const seed = buildServiceCaseTraceSeed({
      storeId: "store_1" as Id<"store">,
      organizationId: "org_1" as Id<"organization">,
      serviceCaseId: "case_1" as Id<"serviceCase">,
      customerProfileId: "customer_1" as Id<"customerProfile">,
      operationalWorkItemId: "work_1" as Id<"operationalWorkItem">,
      appointmentId: "appointment_1" as Id<"serviceAppointment">,
      serviceCatalogId: "catalog_1" as Id<"serviceCatalog">,
      assignedStaffProfileId: "staff_1" as Id<"staffProfile">,
      createdAt: 123,
      serviceMode: "repair",
    });

    expect(seed.trace.traceId).toBe("service_case:case_1");
    expect(seed.trace.workflowType).toBe("service_case");
    expect(seed.trace.primaryLookupType).toBe("service_case_id");
    expect(seed.trace.primaryLookupValue).toBe("case_1");
    expect(seed.trace.startedAt).toBe(123);
    expect(seed.lookups).toEqual([
      expect.objectContaining({
        lookupType: "service_case_id",
        lookupValue: "case_1",
      }),
      expect.objectContaining({
        lookupType: "customer_profile_id",
        lookupValue: "customer_1",
      }),
      expect.objectContaining({
        lookupType: "operational_work_item_id",
        lookupValue: "work_1",
      }),
      expect.objectContaining({
        lookupType: "service_appointment_id",
        lookupValue: "appointment_1",
      }),
    ]);
    expect(seed.subjectRefs).toEqual({
      serviceCaseId: "case_1",
      customerProfileId: "customer_1",
      operationalWorkItemId: "work_1",
      appointmentId: "appointment_1",
      serviceCatalogId: "catalog_1",
      assignedStaffProfileId: "staff_1",
      serviceMode: "repair",
    });
    expect(seed.eventSource).toBe("workflow.serviceCase");
  });
});
