import { describe, expect, it } from "vitest";

import { OPERATION_READ_ADMISSION_DEFINITIONS } from "../operationAdmission/readDefinitions";
import { ATHENA_READ_INTENT_CATALOG } from "../platform/readIntentCatalog";
import {
  isSharedDemoReadIntentAllowed,
  SHARED_DEMO_ALLOWED_READ_INTENTS,
} from "./policy";

describe("shared demo read intent grants", () => {
  it("matches the intents of the currently demo-admitted read definitions", () => {
    const derived = [
      ...new Set(
        OPERATION_READ_ADMISSION_DEFINITIONS.filter(
          (definition) => definition.actors.sharedDemo === "admit",
        ).map((definition) => definition.access.intent),
      ),
    ].sort();

    // Both directions on purpose: a new demo-admitted read must add its intent
    // here (no silent widening), and dropping a grant must drop the read (no
    // silent narrowing).
    expect(derived).toEqual([...SHARED_DEMO_ALLOWED_READ_INTENTS].sort());
  });

  it("denies every intent outside the grant set", () => {
    for (const { id } of ATHENA_READ_INTENT_CATALOG) {
      expect(isSharedDemoReadIntentAllowed(id)).toBe(
        (SHARED_DEMO_ALLOWED_READ_INTENTS as readonly string[]).includes(id),
      );
    }
    expect(isSharedDemoReadIntentAllowed("not.a.real.intent")).toBe(false);
  });

  it("keeps every declared read intent inside the closed catalog", () => {
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
