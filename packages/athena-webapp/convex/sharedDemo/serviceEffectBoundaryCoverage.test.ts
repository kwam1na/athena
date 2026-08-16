import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OPERATION_ADMISSION_DEFINITIONS } from "../operationAdmission/definitions";
import { SHARED_DEMO_ALLOWED_CAPABILITIES } from "../platform/capabilityCatalog";

/**
 * Service-desk and vendor writes stay outside the shared demo.
 *
 * This used to be a source-shape assertion: count the
 * `await requireReadySharedDemoStoreCapabilityIfApplicable(` calls in each
 * module and require one per exported `mutation(`. Both halves of that shape
 * are gone — these modules are admitted through the rail now, so they export
 * `admitPublicMutation(...)` and carry no handler-local demo guard.
 *
 * Counting guards was always a proxy for the real property, and a lossy one:
 * `stockOps/vendors.ts` had TWO public mutations and only ONE guard, and the
 * hand-written `guardCount: 1` encoded that gap as if it were correct. The
 * derived form below has no way to express such a gap — every public write in
 * the module is enumerated from the definitions, so a missing one is a
 * checker finding rather than a number nobody re-derived.
 */
const cases = [
  {
    module: "serviceOps/appointments",
    writes: [
      "createAppointment",
      "rescheduleAppointment",
      "cancelAppointment",
      "convertAppointmentToWalkIn",
    ],
    capabilities: ["appointments.manage"],
  },
  {
    module: "serviceOps/catalog",
    writes: [
      "createServiceCatalogItem",
      "updateServiceCatalogItem",
      "archiveServiceCatalogItem",
    ],
    capabilities: ["service.catalog.manage"],
  },
  {
    module: "serviceOps/serviceCases",
    writes: [
      "createServiceCase",
      "createWalkInServiceCase",
      "addServiceCaseLineItem",
      "recordServiceInventoryUsage",
      "recordServicePayment",
      "updateServiceCaseStatus",
    ],
    capabilities: ["service.cases.manage", "billing.manage"],
  },
  {
    module: "operations/serviceIntake",
    writes: ["createServiceIntake"],
    capabilities: ["service.intake.write"],
  },
  {
    module: "stockOps/vendors",
    writes: ["createVendor", "createVendorCommand"],
    capabilities: ["procurement.manage"],
  },
] as const;

const grantedCapabilities = new Set<string>(SHARED_DEMO_ALLOWED_CAPABILITIES);

describe("shared demo service and vendor effect boundaries", () => {
  it.each(cases)(
    "admits every public write in $module store-scoped and demo-denied",
    ({ capabilities, module, writes }) => {
      const definitions = OPERATION_ADMISSION_DEFINITIONS.filter(
        (definition) => definition.functionName?.startsWith(`${module}:`),
      );

      expect(
        definitions.map((definition) => definition.functionName!.split(":")[1]),
        module,
      ).toEqual([...writes]);

      for (const definition of definitions) {
        const name = definition.functionName!;
        // Demo denial is the point of this file: none of these capabilities is
        // in the demo grant set, so none of these writes may admit the demo.
        expect(definition.actors.sharedDemo, name).toBe("deny");
        expect(definition.actors.public, name).toBe("deny");
        // The clamp the retired guard provided: every write is scoped to a
        // store, so an operator cannot write across store boundaries.
        expect(definition.scope.kind, name).toBe("store");

        const declared =
          typeof definition.capability === "string"
            ? [definition.capability]
            : definition.capability.candidates;
        for (const capability of declared) {
          expect(capabilities as readonly string[], name).toContain(capability);
          expect(grantedCapabilities.has(capability), name).toBe(false);
        }
      }
    },
  );

  it.each(cases)("leaves no retired demo guard in $module", ({ module }) => {
    const source = readFileSync(`convex/${module}.ts`, "utf8");
    expect(source, module).not.toContain(
      "requireReadySharedDemoStoreCapabilityIfApplicable(",
    );
  });
});
