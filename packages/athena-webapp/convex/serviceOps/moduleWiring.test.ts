import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("service ops module wiring", () => {
  it("exposes catalog and appointment surfaces through the admission rail", () => {
    const catalogSource = getSource("./catalog.ts");
    const appointmentsSource = getSource("./appointments.ts");

    expect(catalogSource).toContain("export const listServiceCatalogItems = query({");
    expect(catalogSource).toContain(
      "export const createServiceCatalogItem = mutation({"
    );
    expect(catalogSource).toContain('.withIndex("by_storeId_slug"');
    expect(catalogSource).toContain(
      "admitPublicQuery(\n    listServiceCatalogItemsReadDefinition,",
    );
    for (const definition of [
      "createServiceCatalogItemOperationDefinition",
      "updateServiceCatalogItemOperationDefinition",
      "archiveServiceCatalogItemOperationDefinition",
    ]) {
      expect(catalogSource).toContain(`admitPublicMutation(\n    ${definition},`);
    }

    expect(appointmentsSource).toContain("export const listAppointments = query({");
    expect(appointmentsSource).toContain("export const createAppointment = mutation({");
    expect(appointmentsSource).toContain("export const rescheduleAppointment = mutation({");
    expect(appointmentsSource).toContain(
      "export const convertAppointmentToWalkIn = mutation({"
    );
    expect(appointmentsSource).toContain("findOverlappingAppointment");
    expect(appointmentsSource).toContain(
      "admitPublicQuery(\n    listAppointmentsReadDefinition,",
    );
    for (const definition of [
      "createAppointmentOperationDefinition",
      "rescheduleAppointmentOperationDefinition",
      "cancelAppointmentOperationDefinition",
      "convertAppointmentToWalkInOperationDefinition",
    ]) {
      expect(appointmentsSource).toContain(
        `admitPublicMutation(\n    ${definition},`,
      );
    }

    // The definitions now carry the capability, scope and demo decision these
    // handler-local guards used to compute, so no call site may remain.
    for (const source of [catalogSource, appointmentsSource]) {
      expect(source).not.toContain(
        "requireReadySharedDemoStoreCapabilityIfApplicable",
      );
    }
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
    for (const definition of [
      "createServiceCaseOperationDefinition",
      "createWalkInServiceCaseOperationDefinition",
      "addServiceCaseLineItemOperationDefinition",
      "recordServiceInventoryUsageOperationDefinition",
      "recordServicePaymentOperationDefinition",
      "updateServiceCaseStatusOperationDefinition",
    ]) {
      expect(serviceCasesSource).toContain(
        `admitPublicMutation(\n    ${definition},`,
      );
    }
    for (const definition of [
      "listActiveServiceCasesReadDefinition",
      "getServiceCaseDetailsReadDefinition",
    ]) {
      expect(serviceCasesSource).toContain(`admitPublicQuery(\n    ${definition},`);
    }
    // Retired at the exported helper too: every caller of
    // `createServiceCaseWithCtx` is an admitted ingress of its own.
    expect(serviceCasesSource).not.toContain(
      "requireReadySharedDemoStoreCapabilityIfApplicable",
    );
    expect(serviceCasesSource).toContain("applyInventoryEffectWithCtx");
    expect(serviceCasesSource).toContain('usageType !== "planned"');
    expect(serviceCasesSource).toContain('disposition: "service_consumption"');
    expect(serviceCasesSource).toContain('factKind: "sale"');
    expect(serviceCasesSource).toContain("recordFacts(ctx, serviceCase.storeId");
    expect(serviceCasesSource).toContain(
      '.query("posTransactionServiceLine")',
    );
    expect(serviceCasesSource).toContain("recordPaymentAllocationWithCtx");
    expect(serviceCasesSource).toContain("args.businessEventKey ??");
    expect(serviceCasesSource).toContain("updateOperationalWorkItemStatus");
  });

  it("upgrades service intake to create first-class service cases", () => {
    const serviceIntakeSource = getSource("../operations/serviceIntake.ts");

    expect(serviceIntakeSource).toContain("createServiceCaseWithCtx");
    expect(serviceIntakeSource).toContain("serviceCaseId");
  });
});
