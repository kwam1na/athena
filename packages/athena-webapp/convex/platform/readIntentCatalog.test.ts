import { describe, expect, it } from "vitest";

import { OPERATION_READ_ADMISSION_DEFINITIONS } from "../operationAdmission/readDefinitions";
import {
  ATHENA_READ_INTENT_CATALOG,
  isAthenaReadIntent,
} from "./readIntentCatalog";

describe("closed read intent catalog", () => {
  it("has unique ids kept in sorted order", () => {
    const ids = ATHENA_READ_INTENT_CATALOG.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    // Sorted so the list stays reviewable as it grows and a duplicate or a
    // near-duplicate (`staff.view` vs `staff.messages.view`) lands next to the
    // entry it would shadow.
    expect([...ids]).toEqual([...ids].sort());
  });

  it("names every intent as <area>.view", () => {
    for (const { id, label } of ATHENA_READ_INTENT_CATALOG) {
      // `operations.workItems.view` predates the convention and keeps its
      // camelCase segment rather than churning three live definitions and a
      // demo grant for cosmetics; the shape (`<area>.view`) is what is asserted.
      expect(id, id).toMatch(/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*\.view$/);
      expect(label.length, id).toBeGreaterThan(0);
    }
  });

  it("recognizes exactly the catalogued intents", () => {
    for (const { id } of ATHENA_READ_INTENT_CATALOG) {
      expect(isAthenaReadIntent(id)).toBe(true);
    }
    expect(isAthenaReadIntent("storefront.catalog")).toBe(false);
    expect(isAthenaReadIntent("not.a.real.view")).toBe(false);
  });

  it("covers every intent already declared by a read definition", () => {
    const catalog = new Set<string>(
      ATHENA_READ_INTENT_CATALOG.map(({ id }) => id),
    );
    for (const definition of OPERATION_READ_ADMISSION_DEFINITIONS) {
      expect(catalog.has(definition.access.intent), definition.operationId).toBe(
        true,
      );
    }
  });
});
