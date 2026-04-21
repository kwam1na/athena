import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateServiceIntakeInput,
} from "./serviceIntake";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("service intake validation", () => {
  it("rejects missing assignees and invalid deposits", () => {
    expect(
      validateServiceIntakeInput({
        customerFullName: "Ama Mensah",
        depositAmount: 0,
        serviceTitle: "Wash and restyle",
      })
    ).toEqual([
      "An assignee is required.",
      "Deposit amount must be greater than zero.",
      "Select how the deposit was collected.",
    ]);
  });

  it("allows linked customers without requiring manual customer fields", () => {
    expect(
      validateServiceIntakeInput({
        assignedStaffProfileId: "staff_1",
        customerProfileId: "customer_1",
        serviceTitle: "Install closure wig",
      })
    ).toEqual([]);
  });

  it("writes through the shared operations rails", () => {
    const source = getSource("./serviceIntake.ts");

    expect(source).toContain("createOperationalWorkItemWithCtx");
    expect(source).toContain("recordOperationalEventWithCtx");
    expect(source).toContain("recordInventoryMovementWithCtx");
    expect(source).toContain("recordPaymentAllocationWithCtx");
    expect(source).toContain("buildApprovalRequest");
  });
});
