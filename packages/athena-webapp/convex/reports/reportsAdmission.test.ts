/// <reference types="vite/client" />

/**
 * U8 admission contract for `convex/reports/{access,customRange,liveDay,
 * queries,skuMixRange,skuMovementRange}.ts`, `convex/inventory/athenaUser.ts`,
 * and the retirement of the `reports.read` auth bridge in
 * `convex/lib/athenaUserAuth.ts`.
 *
 * Three layers, matching the three things the migration had to preserve:
 *
 * 1. The definitions are valid and say what the retired handler-local guards
 *    used to say (the mapping table: retired call site -> successor).
 * 2. A shared-demo principal is admitted exactly where the closed grant set
 *    allows and denied — recognizably — everywhere else, including across
 *    stores after scope resolution.
 * 3. End to end at the EXPORTED handler, with real identities and no mocked
 *    auth: the reports gate still admits only a single full admin of the
 *    owning organization, an anonymous caller is stopped before any read or
 *    write, and the demo workspace still resolves its own Athena user.
 *
 * Nothing here stubs `requireReportsStoreAccess` or the identity port. The
 * module suites do that so they can be about projections; this suite exists so
 * that at least one place runs the whole chain for real.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { validateOperationDefinition } from "../operationAdmission/definitions";
import { validateReadOperationDefinition } from "../operationAdmission/readDefinitions";
import { SHARED_DEMO_ALLOWED_CAPABILITIES } from "../platform/capabilityCatalog";
import { SHARED_DEMO_ALLOWED_READ_INTENTS } from "../sharedDemo/policy";
import {
  U8_REPORTS_OPERATION_DEFINITIONS,
  ensureMixRangeOperationDefinition,
  ensureMovementRangeOperationDefinition,
  requestRangeOperationDefinition,
  retryMixRangeOperationDefinition,
  retryMovementRangeOperationDefinition,
} from "../operationAdmission/domains/u8_reports_definitions";
import {
  U8_REPORTS_READ_OPERATION_DEFINITIONS,
  getAuthenticatedUserReadDefinition,
  getUserByIdReadDefinition,
} from "../operationAdmission/domains/u8_reports_readDefinitions";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);

const DENIED_ANONYMOUSLY = /Sign in again to continue\./;
const REPORTS_ACCESS_DENIED = "Reports access unavailable.";
const DEMO_DENIED = /demo/i;

/* ------------------------------------------------------------- 1. contract */

describe("U8 operation definitions", () => {
  it("declares 5 mutations and 19 reads", () => {
    expect(
      U8_REPORTS_OPERATION_DEFINITIONS.map((definition) => definition.kind),
    ).toEqual(Array.from({ length: 5 }, () => "mutation"));
    expect(U8_REPORTS_READ_OPERATION_DEFINITIONS).toHaveLength(19);
    for (const definition of U8_REPORTS_READ_OPERATION_DEFINITIONS) {
      expect(definition.kind).toBe("query");
    }
  });

  it("passes rail definition validation and declares every actor explicitly", () => {
    for (const definition of U8_REPORTS_OPERATION_DEFINITIONS) {
      expect({
        errors: validateOperationDefinition(definition),
        id: definition.operationId,
      }).toEqual({ errors: [], id: definition.operationId });
      expect(definition.actors.normalUser).toBeDefined();
      expect(definition.actors.sharedDemo).toBeDefined();
      expect(definition.actors.public).toBeDefined();
      // storefrontCustomer is not a valid actor on Convex-function kinds.
      expect(definition.actors.storefrontCustomer).toBeUndefined();
    }

    for (const definition of U8_REPORTS_READ_OPERATION_DEFINITIONS) {
      expect({
        errors: validateReadOperationDefinition(definition),
        id: definition.operationId,
      }).toEqual({ errors: [], id: definition.operationId });
      expect(definition.actors.normalUser).toBeDefined();
      expect(definition.actors.sharedDemo).toBeDefined();
      expect(definition.actors.public).toBeDefined();
      expect(definition.actors.storefrontCustomer).toBeUndefined();
    }
  });

  /**
   * RED until the shared-file owner adds `"identity.view"` to
   * `SHARED_DEMO_ALLOWED_READ_INTENTS` (`convex/sharedDemo/policy.ts`), which
   * U8 does not own. `inventory/athenaUser:getAuthenticatedUser` is the demo
   * shell's identity probe: it resolved the demo principal's Athena user
   * before this migration (through the `{ sharedDemoCapability:
   * "reports.read" }` bridge) and must keep doing so, now through the rail.
   * Granting `identity.view` is not a widening — no other read definition in
   * the backend declares that intent — it is the same reach, declared.
   * `sharedDemo/readIntentGrants.test.ts` fails on the same missing line.
   */
  it("never widens shared-demo reach beyond the closed grant sets", () => {
    for (const definition of U8_REPORTS_OPERATION_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(SHARED_DEMO_ALLOWED_CAPABILITIES).toContain(
        definition.capability as never,
      );
    }

    for (const definition of U8_REPORTS_READ_OPERATION_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(SHARED_DEMO_ALLOWED_READ_INTENTS).toContain(
        definition.access.intent as never,
      );
    }
  });

  it("scopes every reporting read to the store named in its arguments", () => {
    for (const definition of U8_REPORTS_READ_OPERATION_DEFINITIONS) {
      if (definition.access.intent !== "reports.view") continue;
      expect(definition.scope).toEqual({
        kind: "store",
        storeIdArg: "storeId",
      });
      expect(definition.actors.sharedDemo).toBe("admit");
      expect(definition.actors.public).toBe("deny");
    }
  });

  // `public: "admit"` is the one place an operation gives up identity
  // entirely, so the set is enumerated rather than spot-checked.
  it("admits anonymous callers on exactly the identity probe", () => {
    expect(
      U8_REPORTS_READ_OPERATION_DEFINITIONS.filter(
        (definition) => definition.actors.public === "admit",
      ).map((definition) => definition.functionName),
    ).toEqual(["inventory/athenaUser:getAuthenticatedUser"]);

    expect(
      U8_REPORTS_OPERATION_DEFINITIONS.filter(
        (definition) => definition.actors.public === "admit",
      ),
    ).toEqual([]);
  });
});

/**
 * Mapping table: every handler-local guard this unit retired, and the
 * definition field that now carries it.
 */
describe("U8 retired guard successors", () => {
  it.each([
    // requireSharedDemoCapabilityIfApplicable(ctx, "reporting.generate")
    ["skuMixRange:ensureMixRange", ensureMixRangeOperationDefinition],
    ["skuMixRange:retryMixRange", retryMixRangeOperationDefinition],
    [
      "skuMovementRange:ensureMovementRange",
      ensureMovementRangeOperationDefinition,
    ],
    [
      "skuMovementRange:retryMovementRange",
      retryMovementRangeOperationDefinition,
    ],
    // customRange:requestRange had no demo check of its own; it inherited the
    // reports.read gate, which the demo DOES hold. Bringing it under the same
    // generation capability narrows it to match its two siblings.
    ["customRange:requestRange", requestRangeOperationDefinition],
  ])(
    "re-expresses the retired demo capability check on %s",
    (_site, definition) => {
      expect(definition.capability).toBe("reporting.generate");
      expect(definition.actors.sharedDemo).toBe("deny");
      expect(definition.actors.normalUser).toBe("admit");
      expect(definition.actors.public).toBe("deny");
      // No demo actor reaches these, so there is no restore fence to apply
      // and no demo foundation row for them to touch.
      expect(definition.readiness).toEqual({ kind: "none" });
      expect((definition as { target?: unknown }).target).toBeUndefined();
    },
  );

  it("re-expresses requireSharedDemoStoreCapabilityIfApplicable as intent + store scope", () => {
    // The retired call was `(ctx, "reports.read", storeId)`: a closed
    // capability check plus a server-owned store clamp. The successor is the
    // demo-granted `reports.view` intent on a store-scoped read definition,
    // which the shared-demo read adapter clamps to the demo's own store.
    const reportsReads = U8_REPORTS_READ_OPERATION_DEFINITIONS.filter(
      (definition) => definition.access.intent === "reports.view",
    );
    expect(reportsReads).toHaveLength(17);
    expect(SHARED_DEMO_ALLOWED_READ_INTENTS).toContain("reports.view" as never);
  });

  it("re-expresses the reports.read auth bridge as an admitted actor", () => {
    // `getAuthenticatedAthenaUserWithCtx(ctx, { sharedDemoCapability:
    // "reports.read" })` is gone; the demo identity now arrives through the
    // rail, which requires the demo actor to be admitted on this definition.
    expect(getAuthenticatedUserReadDefinition.actors.sharedDemo).toBe("admit");
    expect(getAuthenticatedUserReadDefinition.access.intent).toBe(
      "identity.view",
    );
    // The lookup-by-id sibling gained a gate it never had; it is demo-denied
    // because nothing demo-facing ever called it.
    expect(getUserByIdReadDefinition.actors.sharedDemo).toBe("deny");
    expect(getUserByIdReadDefinition.actors.public).toBe("deny");
  });
});

/* ------------------------------------------------------ 3. exported handler */

async function seedWorld(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    async function organizationWithStore(slug: string) {
      const athenaUserId = await ctx.db.insert("athenaUser", {
        email: `${slug}@test`,
        normalizedEmail: `${slug}@test`,
      });
      const authUserId = await ctx.db.insert("users", {
        email: `${slug}@test`,
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: athenaUserId,
        name: slug,
        slug,
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: athenaUserId,
        currency: "GHS",
        name: slug,
        organizationId,
        slug,
      });
      await ctx.db.insert("organizationMember", {
        organizationId,
        role: "full_admin",
        userId: athenaUserId,
      });
      return { athenaUserId, authUserId, organizationId, storeId };
    }

    const operator = await organizationWithStore("operator");
    const demo = await organizationWithStore("demo");
    await ctx.db.insert("sharedDemoPrincipal", {
      admissionExpiresAt: Date.now() + 3_600_000,
      athenaUserId: demo.athenaUserId,
      authUserId: demo.authUserId,
      organizationId: demo.organizationId,
      storeId: demo.storeId,
      updatedAt: Date.now(),
    });

    // A member of the operator organization who is NOT a full admin: the
    // reports gate must keep rejecting them even though admission succeeds.
    const posOnlyUserId = await ctx.db.insert("athenaUser", {
      email: "pos-only@test",
      normalizedEmail: "pos-only@test",
    });
    const posOnlyAuthUserId = await ctx.db.insert("users", {
      email: "pos-only@test",
    });
    await ctx.db.insert("organizationMember", {
      organizationId: operator.organizationId,
      role: "pos_only",
      userId: posOnlyUserId,
    });

    return { demo, operator, posOnly: { authUserId: posOnlyAuthUserId } };
  });
}

function as(t: ReturnType<typeof convexTest>, authUserId: Id<"users">) {
  return t.withIdentity({ subject: `${authUserId}|session` });
}

describe("U8 exported handler admission", () => {
  beforeEach(() => {
    // The shared-demo adapter is fail-closed on configuration: without these
    // the demo principal is a `demo_disabled` denial rather than an actor.
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "dev");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies an anonymous caller on every reporting surface, before any read or write", async () => {
    const t = convexTest(schema, modules);
    const { operator } = await seedWorld(t);

    await expect(
      t.query(api.reports.queries.getOverview, { storeId: operator.storeId }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.query(api.reports.liveDay.listLiveSkuStock, {
        storeId: operator.storeId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.mutation(api.reports.customRange.requestRange, {
        storeId: operator.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.mutation(api.reports.skuMixRange.ensureMixRange, {
        storeId: operator.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);

    // Terminal: the denied write left nothing behind.
    await expect(
      t.run((ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read
        ctx.db.query("reportRangeResult").collect(),
      ),
    ).resolves.toEqual([]);
  });

  it("keeps normal-user outcomes unchanged for a full admin of the owning organization", async () => {
    const t = convexTest(schema, modules);
    const { operator } = await seedWorld(t);
    const admin = as(t, operator.authUserId);

    // A store with no overview singleton reads as "nothing here", which is
    // the domain answer rather than a denial.
    await expect(
      admin.query(api.reports.queries.getOverview, {
        storeId: operator.storeId,
      }),
    ).resolves.toBeNull();
    await expect(
      admin.query(api.reports.liveDay.listLiveSkuStock, {
        storeId: operator.storeId,
      }),
    ).resolves.toEqual([]);

    const requested = await admin.mutation(
      api.reports.customRange.requestRange,
      {
        storeId: operator.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      },
    );
    expect(requested.requestKey).toMatch(/^range:/);
    await expect(
      admin.query(api.reports.queries.getRangeResult, {
        storeId: operator.storeId,
        requestKey: requested.requestKey,
      }),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("still applies the full-admin reports gate to an admitted normal user", async () => {
    const t = convexTest(schema, modules);
    const { operator, posOnly } = await seedWorld(t);
    const member = as(t, posOnly.authUserId);

    // Admitted by the rail (a real Athena identity), rejected by the gate —
    // with the same opaque message it always used.
    await expect(
      member.query(api.reports.queries.getOverview, {
        storeId: operator.storeId,
      }),
    ).rejects.toThrow(REPORTS_ACCESS_DENIED);
    await expect(
      member.mutation(api.reports.customRange.requestRange, {
        storeId: operator.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(REPORTS_ACCESS_DENIED);
  });

  it("keeps a foreign store indistinguishable from a missing one for a normal user", async () => {
    const t = convexTest(schema, modules);
    const { demo, operator } = await seedWorld(t);

    await expect(
      as(t, operator.authUserId).query(api.reports.queries.getOverview, {
        storeId: demo.storeId,
      }),
    ).rejects.toThrow(REPORTS_ACCESS_DENIED);
  });

  it("lets a shared-demo visitor read its own store's reports", async () => {
    const t = convexTest(schema, modules);
    const { demo } = await seedWorld(t);
    const visitor = as(t, demo.authUserId);

    await expect(
      visitor.query(api.reports.liveDay.getLiveOperatingDay, {
        operatingDate: "2026-07-15",
        storeId: demo.storeId,
      }),
    ).resolves.toEqual({ day: null, operatingDate: "2026-07-15", skus: [] });
    await expect(
      visitor.query(api.reports.queries.getOverview, { storeId: demo.storeId }),
    ).resolves.toBeNull();
  });

  it("denies a shared-demo visitor another store's reports after scope resolution", async () => {
    const t = convexTest(schema, modules);
    const { demo, operator } = await seedWorld(t);

    await expect(
      as(t, demo.authUserId).query(api.reports.queries.getOverview, {
        storeId: operator.storeId,
      }),
    ).rejects.toThrow(DEMO_DENIED);
  });

  it("denies a shared-demo visitor every range generation, including customRange", async () => {
    const t = convexTest(schema, modules);
    const { demo } = await seedWorld(t);
    const visitor = as(t, demo.authUserId);

    await expect(
      visitor.mutation(api.reports.customRange.requestRange, {
        storeId: demo.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DEMO_DENIED);
    await expect(
      visitor.mutation(api.reports.skuMixRange.ensureMixRange, {
        storeId: demo.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DEMO_DENIED);
    await expect(
      visitor.mutation(api.reports.skuMovementRange.ensureMovementRange, {
        storeId: demo.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DEMO_DENIED);

    await expect(
      t.run((ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read
        ctx.db.query("reportRangeResult").collect(),
      ),
    ).resolves.toEqual([]);
  });

  it("resolves the identity probe for anonymous, normal, and demo callers", async () => {
    const t = convexTest(schema, modules);
    const { demo, operator } = await seedWorld(t);

    // Anonymous: admitted (this is a pre-auth probe) and answers "nobody"
    // rather than throwing, which is what the sign-in handoff depends on.
    await expect(
      t.query(api.inventory.athenaUser.getAuthenticatedUser, {}),
    ).resolves.toBeNull();

    await expect(
      as(t, operator.authUserId).query(
        api.inventory.athenaUser.getAuthenticatedUser,
        {},
      ),
    ).resolves.toMatchObject({ _id: operator.athenaUserId });

    // The retired bridge's whole job: a demo principal resolving to the demo
    // organization's Athena user, now through the admitted actor instead.
    await expect(
      as(t, demo.authUserId).query(
        api.inventory.athenaUser.getAuthenticatedUser,
        {},
      ),
    ).resolves.toMatchObject({ _id: demo.athenaUserId });
  });

  it("closes the ungated athenaUser lookup to anonymous and demo callers", async () => {
    const t = convexTest(schema, modules);
    const { demo, operator } = await seedWorld(t);

    await expect(
      t.query(api.inventory.athenaUser.getUserById, {
        id: operator.athenaUserId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      as(t, demo.authUserId).query(api.inventory.athenaUser.getUserById, {
        id: operator.athenaUserId,
      }),
    ).rejects.toThrow(DEMO_DENIED);
    await expect(
      as(t, operator.authUserId).query(api.inventory.athenaUser.getUserById, {
        id: operator.athenaUserId,
      }),
    ).resolves.toMatchObject({ _id: operator.athenaUserId });
  });
});
