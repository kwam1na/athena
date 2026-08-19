/// <reference types="vite/client" />

/**
 * U4 admission contract for `convex/inventory/{auth,expenseSessionItems,
 * expenseSessions,expenseTransactions,inviteCode,organizationMembers,
 * organizations,posSessionItems,posSessions,stores}.ts`.
 *
 * Three layers, matching the three things the migration had to preserve:
 *
 * 1. The definitions are valid and say what the retired handler-local guards
 *    used to say (the mapping table: retired call site -> successor).
 * 2. A shared-demo principal is admitted exactly where the closed grant set
 *    allows and denied — recognizably, by reason — everywhere else, including
 *    across stores after resource-derived scope resolution.
 * 3. End to end at the EXPORTED handler: pre-auth flows still succeed
 *    anonymously, everything else denies an anonymous caller before it reads
 *    or writes, a normal user is unchanged, and the demo-foundation rows stay
 *    unmutable by a normal full admin wherever a foundation guard existed.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";
import {
  validateOperationDefinition,
} from "../operationAdmission/definitions";
import { validateReadOperationDefinition } from "../operationAdmission/readDefinitions";
import { SHARED_DEMO_ALLOWED_READ_INTENTS } from "../sharedDemo/policy";
import { SHARED_DEMO_ALLOWED_CAPABILITIES } from "../platform/capabilityCatalog";
import {
  INVENTORY_IDENTITY_DEFINITIONS,
  createInviteCodeOperationDefinition,
  createOrganizationOperationDefinition,
  createStoreOperationDefinition,
  getStoreReelVersionsOperationDefinition,
  listStoresByOrganizationOperationDefinition,
  patchStoreConfigV2CommandOperationDefinition,
  patchStoreConfigV2OperationDefinition,
  redeemInviteCodeOperationDefinition,
  removeOrganizationOperationDefinition,
  removeStoreOperationDefinition,
  sendVerificationCodeViaProviderOperationDefinition,
  syncAuthenticatedAthenaUserOperationDefinition,
  updateOrganizationOperationDefinition,
  updateStoreLandingPageReelOperationDefinition,
  updateStoreOperationDefinition,
  uploadStoreImageAssetsOperationDefinition,
  verifyCodeOperationDefinition,
} from "../operationAdmission/domains/inventoryIdentity_definitions";
import { INVENTORY_IDENTITY_READ_DEFINITIONS } from "../operationAdmission/domains/inventoryIdentity_readDefinitions";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./inventory/"),
    loader,
  ]),
);

const DENIED_ANONYMOUSLY = /Sign in again to continue\./;

/* ------------------------------------------------------------- 1. contract */

describe("U4 operation definitions", () => {
  it("declares 39 mutations, 5 actions, and 18 reads", () => {
    const byKind = INVENTORY_IDENTITY_DEFINITIONS.reduce<
      Record<string, number>
    >((counts, definition) => {
      counts[definition.kind] = (counts[definition.kind] ?? 0) + 1;
      return counts;
    }, {});

    expect(byKind).toEqual({ action: 5, mutation: 39 });
    expect(INVENTORY_IDENTITY_READ_DEFINITIONS).toHaveLength(18);
  });

  it("passes rail definition validation and declares every actor explicitly", () => {
    for (const definition of INVENTORY_IDENTITY_DEFINITIONS) {
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

    for (const definition of INVENTORY_IDENTITY_READ_DEFINITIONS) {
      expect({
        errors: validateReadOperationDefinition(definition),
        id: definition.operationId,
      }).toEqual({ errors: [], id: definition.operationId });
      expect(definition.actors.public).toBeDefined();
      expect(definition.actors.storefrontCustomer).toBeUndefined();
    }
  });

  it("never widens shared-demo reach beyond the closed grant sets", () => {
    for (const definition of INVENTORY_IDENTITY_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(typeof definition.capability).toBe("string");
      expect(SHARED_DEMO_ALLOWED_CAPABILITIES).toContain(
        definition.capability as never,
      );
    }

    for (const definition of INVENTORY_IDENTITY_READ_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(SHARED_DEMO_ALLOWED_READ_INTENTS).toContain(
        definition.access.intent as never,
      );
    }
  });

  // `public: "admit"` is the one place an operation gives up identity entirely,
  // so the set is enumerated rather than merely spot-checked.
  it("admits anonymous callers on exactly the four pre-auth operations", () => {
    expect(
      INVENTORY_IDENTITY_DEFINITIONS.filter(
        (definition) => definition.actors.public === "admit",
      ).map((definition) => definition.functionName),
    ).toEqual([
      "inventory/auth:verifyCode",
      "inventory/auth:syncAuthenticatedAthenaUser",
      "inventory/auth:sendVerificationCodeViaProvider",
      "inventory/inviteCode:redeem",
    ]);

    expect(
      INVENTORY_IDENTITY_READ_DEFINITIONS.filter(
        (definition) => definition.actors.public === "admit",
      ),
    ).toEqual([]);
  });
});

/**
 * Mapping table: every handler-local guard this unit retired, and the
 * definition field that now carries it.
 */
describe("U4 retired guard successors", () => {
  it.each([
    // requireNonDemoFoundationMutation -> bound target guard
    [createOrganizationOperationDefinition, { athenaUserIdArg: "createdByUserId" }],
    [updateOrganizationOperationDefinition, { organizationIdArg: "id" }],
    [removeOrganizationOperationDefinition, { organizationIdArg: "id" }],
    [createStoreOperationDefinition, { organizationIdArg: "organizationId" }],
    [updateStoreOperationDefinition, { storeIdArg: "id" }],
    [removeStoreOperationDefinition, { storeIdArg: "id" }],
    [patchStoreConfigV2OperationDefinition, { storeIdArg: "id" }],
    [patchStoreConfigV2CommandOperationDefinition, { storeIdArg: "id" }],
    [
      createInviteCodeOperationDefinition,
      {
        athenaUserIdArg: "createdByUserId",
        organizationIdArg: "organizationId",
      },
    ],
    [
      listStoresByOrganizationOperationDefinition,
      { organizationIdArg: "organizationId" },
    ],
    [uploadStoreImageAssetsOperationDefinition, { storeIdArg: "storeId" }],
    [updateStoreLandingPageReelOperationDefinition, { storeIdArg: "storeId" }],
    [getStoreReelVersionsOperationDefinition, { storeIdArg: "storeId" }],
  ])(
    "re-expresses a retired foundation guard as a bound target guard",
    (definition, binding) => {
      expect(definition.target?.protectDemoFoundation).toEqual(binding);
    },
  );

  it.each([
    // requireSharedDemoCapabilityIfApplicable -> capability + sharedDemo deny
    [removeStoreOperationDefinition, "administration.destructive"],
    [patchStoreConfigV2CommandOperationDefinition, "integrations.manage"],
    [createInviteCodeOperationDefinition, "permissions.manage"],
  ])(
    "re-expresses a retired demo capability check as %#",
    (definition, capability) => {
      expect(definition.capability).toBe(capability);
      expect(definition.actors.sharedDemo).toBe("deny");
    },
  );

  it.each([
    // requireAuthenticatedNonDemoEffect / denySharedDemoEffectIfApplicable
    ["stores:getAllByOrganization", listStoresByOrganizationOperationDefinition, "deny"],
    ["stores:uploadImageAssets", uploadStoreImageAssetsOperationDefinition, "deny"],
    [
      "stores:updateLandingPageReel",
      updateStoreLandingPageReelOperationDefinition,
      "deny",
    ],
    ["stores:getReelVersions", getStoreReelVersionsOperationDefinition, "deny"],
    [
      "auth:sendVerificationCodeViaProvider",
      sendVerificationCodeViaProviderOperationDefinition,
      "admit",
    ],
  ])(
    "denies the shared demo on %s and keeps its pre-auth reach",
    (_site, definition, publicAccess) => {
      expect(definition.kind).toBe("action");
      expect(definition.actors.sharedDemo).toBe("deny");
      expect(definition.actors.normalUser).toBe("admit");
      // `requireAuthenticatedNonDemoEffect` demanded an identity; the pre-auth
      // provider send never had one to demand.
      expect(definition.actors.public).toBe(publicAccess);
    },
  );

  it("keeps the pre-auth mutations anonymous", () => {
    for (const definition of [
      verifyCodeOperationDefinition,
      syncAuthenticatedAthenaUserOperationDefinition,
      redeemInviteCodeOperationDefinition,
    ]) {
      expect(definition.actors.public).toBe("admit");
      expect(definition.actors.sharedDemo).toBe("deny");
    }
  });
});

/* ------------------------------------------------------ 3. exported handler */

async function seedOrganization(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const athenaUserId = await ctx.db.insert("athenaUser", {
      email: "operator@test",
      normalizedEmail: "operator@test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: athenaUserId,
      name: "org",
      slug: "org",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: athenaUserId,
      currency: "GHS",
      name: "store",
      organizationId,
      slug: "store",
    });
    const authUserId = await ctx.db.insert("users", {
      email: "operator@test",
    });
    return { athenaUserId, authUserId, organizationId, storeId };
  });
}

describe("U4 exported handler admission", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("still lets an anonymous caller run the pre-auth code flows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("appVerificationCode", {
        code: "123456",
        email: "new@test",
        expiration: Date.now() + 600_000,
        isUsed: false,
      });
    });

    // Admitted anonymously: the result is the domain outcome, not a denial.
    await expect(
      t.mutation(api.inventory.auth.verifyCode, {
        code: "123456",
        email: "new@test",
      }),
    ).resolves.toMatchObject({ kind: "ok" });

    await expect(
      t.mutation(api.inventory.inviteCode.redeem, {
        code: "NOPE",
        email: "new@test",
      }),
    ).resolves.toEqual({
      message: "Invalid invite code",
      success: false,
    });
  });

  it("denies anonymous callers everywhere else, before any read or write", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedOrganization(t);

    await expect(
      t.mutation(api.inventory.stores.remove, { id: seed.storeId }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.mutation(api.inventory.posSessions.cleanupOldSessions, {
        storeId: seed.storeId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.query(api.inventory.organizationMembers.getUserPermissions, {
        organizationId: seed.organizationId,
        userId: seed.athenaUserId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.query(api.inventory.stores.getById, { id: seed.storeId }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);

    // The denial is terminal: the store row is untouched.
    await expect(
      t.run((ctx) => ctx.db.get("store", seed.storeId)),
    ).resolves.not.toBeNull();
  });

  it("keeps normal-user outcomes unchanged", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedOrganization(t);
    const as = t.withIdentity({ subject: `${seed.authUserId}|session` });

    await expect(
      as.mutation(api.inventory.organizations.update, {
        id: seed.organizationId,
        name: "renamed",
      }),
    ).resolves.toMatchObject({ name: "renamed" });

    await expect(
      as.query(api.inventory.organizationMembers.getUserPermissions, {
        organizationId: seed.organizationId,
        userId: seed.athenaUserId,
      }),
    ).resolves.toEqual({
      canAccessAdmin: false,
      canAccessPOS: false,
      role: null,
    });
  });

  // The foundation guards protect demo fixture rows from EVERY actor, so the
  // normal full admin above must still be refused on the demo rows.
  it("keeps demo foundation rows unmutable by an authenticated normal user", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedOrganization(t);
    const as = t.withIdentity({ subject: `${seed.authUserId}|session` });

    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
    vi.stubEnv("ATHENA_SHARED_DEMO_ATHENA_USER_ID", seed.athenaUserId);
    vi.stubEnv("ATHENA_SHARED_DEMO_ORGANIZATION_ID", seed.organizationId);
    vi.stubEnv("ATHENA_SHARED_DEMO_STORE_ID", seed.storeId);

    await expect(
      as.mutation(api.inventory.organizations.update, {
        id: seed.organizationId,
        name: "renamed",
      }),
    ).rejects.toThrow();
    await expect(
      as.mutation(api.inventory.stores.update, {
        id: seed.storeId,
        name: "renamed",
      }),
    ).rejects.toThrow();
    await expect(
      as.mutation(api.inventory.stores.patchConfigV2, {
        id: seed.storeId,
        patch: {},
      }),
    ).rejects.toThrow();
    await expect(
      as.mutation(api.inventory.inviteCode.create, {
        createdByUserId: seed.athenaUserId,
        organizationId: seed.organizationId,
        recipientEmail: "invitee@test",
        role: "full_admin",
      }),
    ).rejects.toThrow();

    await expect(
      t.run((ctx) => ctx.db.get("organization", seed.organizationId)),
    ).resolves.toMatchObject({ name: "org" });
  });
});
