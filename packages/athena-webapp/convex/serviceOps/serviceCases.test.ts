import { describe, expect, it } from "vitest";
import schema from "../schema";
import { Id } from "../_generated/dataModel";
import {
  assertValidServiceCaseStatusTransition,
  buildServiceCase,
  buildServiceCaseLineItem,
} from "./serviceCases";

type IndexExpectation = {
  table: string;
  descriptor: string;
  fields: string[];
};

function getTableIndexes(tableName: string) {
  return ((schema as any).tables[tableName]?.indexes ?? []) as Array<{
    indexDescriptor: string;
    fields: string[];
  }>;
}

function expectIndex({ table, descriptor, fields }: IndexExpectation) {
  expect(getTableIndexes(table)).toContainEqual({
    indexDescriptor: descriptor,
    fields,
  });
}

describe("service ops schema foundations", () => {
  it("registers service tables with store-scoped indexes", () => {
    [
      {
        table: "serviceCatalog",
        descriptor: "by_storeId_slug",
        fields: ["storeId", "slug"],
      },
      {
        table: "serviceAppointment",
        descriptor: "by_staffProfileId_startAt",
        fields: ["assignedStaffProfileId", "startAt"],
      },
      {
        table: "serviceCase",
        descriptor: "by_operationalWorkItemId",
        fields: ["operationalWorkItemId"],
      },
      {
        table: "serviceCase",
        descriptor: "by_storeId_status",
        fields: ["storeId", "status"],
      },
      {
        table: "serviceCaseLineItem",
        descriptor: "by_serviceCaseId",
        fields: ["serviceCaseId"],
      },
      {
        table: "serviceInventoryUsage",
        descriptor: "by_serviceCaseId",
        fields: ["serviceCaseId"],
      },
    ].forEach(expectIndex);
  });

  it("allows only supported service-case transitions", () => {
    expect(
      assertValidServiceCaseStatusTransition("intake", "in_progress")
    ).toEqual({ kind: "ok", data: null });
    expect(
      assertValidServiceCaseStatusTransition("in_progress", "awaiting_pickup")
    ).toEqual({ kind: "ok", data: null });
    expect(
      assertValidServiceCaseStatusTransition("completed", "in_progress")
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Invalid service case status transition.",
      },
    });
    expect(
      assertValidServiceCaseStatusTransition("cancelled", "completed")
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Invalid service case status transition.",
      },
    });
  });

  it("shapes service cases and line items with persistence-safe defaults", () => {
    const serviceCase = buildServiceCase({
      assignedStaffProfileId: "staff_1" as Id<"staffProfile">,
      customerProfileId: "customer_1" as Id<"customerProfile">,
      operationalWorkItemId: "work_item_1" as Id<"operationalWorkItem">,
      quotedAmount: 450,
      serviceMode: "same_day",
      storeId: "store_1" as Id<"store">,
    });

    expect(serviceCase).toMatchObject({
      assignedStaffProfileId: "staff_1",
      balanceDueAmount: 450,
      paymentStatus: "unpaid",
      serviceMode: "same_day",
      status: "intake",
    });

    expect(
      buildServiceCaseLineItem({
        description: "Closure repair mesh",
        lineType: "material",
        quantity: 0,
        serviceCaseId: "case_1" as Id<"serviceCase">,
        unitPrice: 50,
      })
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Line item quantity must be greater than zero.",
      },
    });

    expect(
      buildServiceCaseLineItem({
        description: "Wash and restyle",
        lineType: "labor",
        quantity: 2,
        serviceCaseId: "case_1" as Id<"serviceCase">,
        unitPrice: 150,
      })
    ).toMatchObject({
      kind: "ok",
      data: {
        amount: 300,
        quantity: 2,
        unitPrice: 150,
      },
    });
  });
});
