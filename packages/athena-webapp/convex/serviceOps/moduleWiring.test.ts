import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("service ops module wiring", () => {
  it("exposes catalog and appointment mutation surfaces", () => {
    const catalogSource = getSource("./catalog.ts");
    const appointmentsSource = getSource("./appointments.ts");

    expect(catalogSource).toContain("export const listServiceCatalogItems = query({");
    expect(catalogSource).toContain(
      "export const createServiceCatalogItem = mutation({"
    );
    expect(catalogSource).toContain('.withIndex("by_storeId_slug"');

    expect(appointmentsSource).toContain("export const listAppointments = query({");
    expect(appointmentsSource).toContain("export const createAppointment = mutation({");
    expect(appointmentsSource).toContain("export const rescheduleAppointment = mutation({");
    expect(appointmentsSource).toContain(
      "export const convertAppointmentToWalkIn = mutation({"
    );
    expect(appointmentsSource).toContain("findOverlappingAppointment");
  });

  it("threads service cases through shared work, payment, and inventory rails", () => {
    const serviceCasesSource = getSource("./serviceCases.ts");

    expect(serviceCasesSource).toContain("export const createServiceCase = mutation({");
    expect(serviceCasesSource).toContain(
      "export const addServiceCaseLineItem = mutation({"
    );
    expect(serviceCasesSource).toContain(
      "export const recordServiceInventoryUsage = mutation({"
    );
    expect(serviceCasesSource).toContain("export const recordServicePayment = mutation({");
    expect(serviceCasesSource).toContain("recordInventoryMovementWithCtx");
    expect(serviceCasesSource).toContain("recordPaymentAllocationWithCtx");
    expect(serviceCasesSource).toContain("updateOperationalWorkItemStatus");
  });

  it("upgrades service intake to create first-class service cases", () => {
    const serviceIntakeSource = getSource("../operations/serviceIntake.ts");

    expect(serviceIntakeSource).toContain("createServiceCaseWithCtx");
    expect(serviceIntakeSource).toContain("serviceCaseId");
  });
});
