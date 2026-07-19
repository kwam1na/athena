import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const cases = [
  {
    file: "convex/serviceOps/appointments.ts",
    mutations: [
      "createAppointment",
      "rescheduleAppointment",
      "cancelAppointment",
      "convertAppointmentToWalkIn",
    ],
    guardCount: 4,
    capabilities: ["appointments.manage"],
  },
  {
    file: "convex/serviceOps/catalog.ts",
    mutations: [
      "createServiceCatalogItem",
      "updateServiceCatalogItem",
      "archiveServiceCatalogItem",
    ],
    guardCount: 3,
    capabilities: ["service.catalog.manage"],
  },
  {
    file: "convex/serviceOps/serviceCases.ts",
    mutations: [
      "createServiceCase",
      "addServiceCaseLineItem",
      "recordServiceInventoryUsage",
      "recordServicePayment",
      "updateServiceCaseStatus",
      "createWalkInServiceCase",
    ],
    guardCount: 6,
    capabilities: ["service.cases.manage", "billing.manage"],
  },
  {
    file: "convex/operations/serviceIntake.ts",
    mutations: ["createServiceIntake"],
    guardCount: 1,
    capabilities: ["service.intake.write"],
  },
  {
    file: "convex/stockOps/vendors.ts",
    mutations: ["createVendor", "createVendorCommand"],
    guardCount: 1,
    capabilities: ["procurement.manage"],
  },
] as const;

describe("shared demo service and vendor effect boundaries", () => {
  it.each(cases)(
    "keeps every public mutation in $file behind the central store/write clamp",
    ({ capabilities, file, guardCount, mutations }) => {
      const source = readFileSync(file, "utf8");
      const exportedMutations = Array.from(
        source.matchAll(/export const (\w+) = mutation\(/g),
        (match) => match[1],
      );

      expect(exportedMutations).toEqual(mutations);
      expect(
        source.match(
          /await requireReadySharedDemoStoreCapabilityIfApplicable\(/g,
        ),
      ).toHaveLength(guardCount);
      for (const capability of capabilities) {
        expect(source).toContain(`"${capability}"`);
      }
    },
  );
});
