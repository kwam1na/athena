import { describe, expect, it } from "vitest";

import { OPERATION_READ_ADMISSION_DEFINITIONS } from "../operationAdmission/readDefinitions";
import { isSharedDemoReadIntentAllowed } from "./policy";

/**
 * Reads the demo's own navigation walks into.
 *
 * Demo read admission takes TWO keys — the definition's `actors.sharedDemo`
 * and the intent's place in `SHARED_DEMO_ALLOWED_READ_INTENTS`. That is a good
 * containment property and a quiet failure mode: a read moved onto the rails
 * with either key missing throws `shared_demo_action_denied` on load, and the
 * surface behind it renders the router's error boundary instead of the store.
 * Neither `readIntentGrants.test.ts` (seed ⊇ derived) nor
 * `coverage.test.ts` (grants agree in both directions) can see that — both
 * describe the grants that EXIST, and a demo surface losing its read leaves
 * both of them true.
 *
 * So this names the other direction: reads a demo visitor reaches by clicking.
 * Every entry is a surface the demo sidebar or hub links to; the read beside
 * it is one the surface's view issues on load. A migration that re-denies any
 * of them fails here rather than in the demo.
 *
 * Be honest about the bound. This list is NOT a complete map of demo read
 * reachability — it covers the surfaces this delivery repaired, not all
 * eighteen granted intents. It fails closed only for reads it already names:
 * a demo surface added without adding its reads here is not detected, and
 * re-denying a read outside these groups still fails silently in the demo.
 * Widening it to the rest of the demo's surfaces is tracked separately.
 *
 * This list is deliberately NOT derived. Deriving it would mean walking the
 * React tree for `useQuery` calls, and the derivation would go stale in the
 * same silence it is here to break. Adding a surface to the demo sidebar means
 * adding its reads here.
 *
 * A read the demo deliberately does NOT issue does not belong here. The
 * sidebar's pending-review count is the example: `app-sidebar.tsx` passes
 * "skip" for it in the shared demo, so it stays denied and unlisted. Listing
 * it would assert reachability the product does not have.
 */
const DEMO_SURFACE_READS: ReadonlyArray<{
  surface: string;
  reads: readonly string[];
}> = [
  {
    surface: "/pos — POS hub, every 'Make a sale' entry point",
    reads: ["inventory/storeSchedule:getStoreScheduleSummary"],
  },
  {
    surface: "/pos/settings",
    reads: ["inventory/storeSchedule:getStoreScheduleSummary"],
  },
  {
    surface: "/pos/expense-reports and one report's detail",
    reads: [
      "inventory/expenseTransactions:getExpenseTransactions",
      "inventory/expenseTransactions:getExpenseTransactionById",
    ],
  },
  {
    surface: "/reviews/new and /reviews/published",
    reads: ["storeFront/reviews:getAllReviewsForStore"],
  },
  {
    surface: "/services/intake",
    reads: [
      "operations/serviceIntake:listAssignableStaff",
      "operations/serviceIntake:searchCustomers",
      "serviceOps/catalog:listServiceCatalogItems",
    ],
  },
  {
    surface: "/services/appointments",
    reads: [
      "operations/serviceIntake:listAssignableStaff",
      "operations/serviceIntake:searchCustomers",
      "serviceOps/appointments:listAppointments",
      "serviceOps/catalog:listServiceCatalogItems",
    ],
  },
  {
    surface: "/services/active-cases",
    reads: [
      "operations/serviceIntake:listAssignableStaff",
      "operations/serviceIntake:searchCustomers",
      "serviceOps/catalog:listServiceCatalogItems",
      "serviceOps/serviceCases:getServiceCaseDetails",
      "serviceOps/serviceCases:listActiveServiceCases",
    ],
  },
  {
    surface: "/services/catalog-management",
    reads: ["serviceOps/catalog:listServiceCatalogItems"],
  },
];

const definitionsByFunctionName = new Map(
  OPERATION_READ_ADMISSION_DEFINITIONS.filter(
    (definition) => definition.functionName,
  ).map((definition) => [definition.functionName, definition]),
);

describe("shared demo surface reads", () => {
  // A sensor whose subject can shrink to nothing is not a sensor. An entry
  // emptied during a route refactor, or the list itself being trimmed instead
  // of updated, would leave every assertion below vacuously true while the
  // demo surface throws on load.
  it("still names the demo's surfaces", () => {
    expect(DEMO_SURFACE_READS.length).toBeGreaterThanOrEqual(8);
    for (const { surface, reads } of DEMO_SURFACE_READS) {
      expect(reads.length, surface).toBeGreaterThan(0);
    }
  });

  it.each(DEMO_SURFACE_READS)(
    "admits every read the demo reaches on $surface",
    ({ reads }) => {
      for (const functionName of reads) {
        const definition = definitionsByFunctionName.get(functionName);
        expect(definition, `${functionName} has no read definition`).toBeTruthy();
        if (!definition) continue;
        expect(definition.actors.sharedDemo, functionName).toBe("admit");
        expect(
          isSharedDemoReadIntentAllowed(definition.access.intent),
          `${functionName} needs intent ${definition.access.intent}`,
        ).toBe(true);
      }
    },
  );
});
