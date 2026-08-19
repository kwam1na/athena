import { describe, expect, it } from "vitest";

import { OPERATION_READ_ADMISSION_DEFINITIONS } from "../operationAdmission/readDefinitions";
import { ATHENA_READ_INTENT_CATALOG } from "../platform/readIntentCatalog";
import {
  isSharedDemoReadIntentAllowed,
  SHARED_DEMO_ALLOWED_READ_INTENTS,
} from "./policy";

describe("shared demo read intent grants", () => {
  it("covers the intents of every currently demo-admitted read definition", () => {
    const derived = [
      ...new Set(
        OPERATION_READ_ADMISSION_DEFINITIONS.filter(
          (definition) => definition.actors.sharedDemo === "admit",
        ).map((definition) => definition.access.intent),
      ),
    ].sort();

    // Seed ⊇ derived. The strict direction is the one that matters: a demo
    // read whose intent is not granted must fail here rather than admit, so
    // demo reach cannot widen silently. The seed is allowed to run ahead of
    // the migrated definitions for a surface the demo already shows (see the
    // per-entry evidence in `policy.ts`); it may not run behind them.
    const granted = new Set<string>(SHARED_DEMO_ALLOWED_READ_INTENTS);
    expect(derived.filter((intent) => !granted.has(intent))).toEqual([]);
  });

  it("grants only intents that exist in the closed catalog", () => {
    const catalog = new Set<string>(
      ATHENA_READ_INTENT_CATALOG.map(({ id }) => id),
    );
    for (const intent of SHARED_DEMO_ALLOWED_READ_INTENTS) {
      expect(catalog.has(intent), intent).toBe(true);
    }
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
