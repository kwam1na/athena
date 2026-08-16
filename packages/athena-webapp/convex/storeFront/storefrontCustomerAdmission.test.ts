/// <reference types="vite/client" />

/**
 * U6 admission contract for `convex/storeFront/{auth,bag,bagItem,
 * checkoutSession,customerBehaviorTimeline,guest,homepageSnapshot,offers,
 * payment,paystackActions,rewards,savedBag,supportTicket,user,users}.ts`.
 *
 * Three layers, matching the three things this migration had to preserve:
 *
 * 1. The definitions are valid, and they say what the retired handler-local
 *    guards used to say (the mapping table: retired call site -> successor).
 * 2. Storefront shoppers are NEVER an admitted actor on a Convex-function kind
 *    — a plain argument is not a claim boundary — so the ownership contract
 *    travels to internal callees as an explicit `owner` parameter instead.
 * 3. End to end at the EXPORTED handler: the pre-auth OTP pair still works
 *    anonymously, everything else denies an anonymous caller before it reads or
 *    writes, and a normal user's outcome is unchanged.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "../_generated/api";
import schema from "../schema";
import { validateOperationDefinition } from "../operationAdmission/definitions";
import { validateReadOperationDefinition } from "../operationAdmission/readDefinitions";
import { SHARED_DEMO_ALLOWED_READ_INTENTS } from "../sharedDemo/policy";
import { SHARED_DEMO_ALLOWED_CAPABILITIES } from "../platform/capabilityCatalog";
import {
  U6_STOREFRONT_CUSTOMER_OPERATION_DEFINITIONS,
  cancelOrderOperationDefinition,
  checkTransactionStatusOperationDefinition,
  createPODOrderOperationDefinition,
  createTransactionOperationDefinition,
  findOrderTransactionsOperationDefinition,
  getAllTransactionsOperationDefinition,
  refundPaymentOperationDefinition,
  sendVerificationCodeViaProviderOperationDefinition,
  verifyCodeOperationDefinition,
  verifyPaymentOperationDefinition,
} from "../operationAdmission/domains/u6_storefrontCustomer_definitions";
import {
  U6_STOREFRONT_CUSTOMER_READ_OPERATION_DEFINITIONS,
  getActiveCheckoutSessionsForStoreReadDefinition,
} from "../operationAdmission/domains/u6_storefrontCustomer_readDefinitions";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./storeFront/"),
    loader,
  ]),
);

const DENIED_ANONYMOUSLY = /Sign in again to continue\./;

/* ------------------------------------------------------------- 1. contract */

describe("U6 operation definitions", () => {
  it("declares 11 mutations, 9 actions, and 37 reads", () => {
    const byKind = U6_STOREFRONT_CUSTOMER_OPERATION_DEFINITIONS.reduce<
      Record<string, number>
    >((counts, definition) => {
      counts[definition.kind] = (counts[definition.kind] ?? 0) + 1;
      return counts;
    }, {});

    expect(byKind).toEqual({ action: 9, mutation: 11 });
    expect(U6_STOREFRONT_CUSTOMER_READ_OPERATION_DEFINITIONS).toHaveLength(37);
  });

  it("passes rail definition validation and declares every actor explicitly", () => {
    for (const definition of U6_STOREFRONT_CUSTOMER_OPERATION_DEFINITIONS) {
      expect({
        errors: validateOperationDefinition(definition),
        id: definition.operationId,
      }).toEqual({ errors: [], id: definition.operationId });
      expect(definition.actors.normalUser).toBeDefined();
      expect(definition.actors.sharedDemo).toBeDefined();
      expect(definition.actors.public).toBeDefined();
    }

    for (const definition of U6_STOREFRONT_CUSTOMER_READ_OPERATION_DEFINITIONS) {
      expect({
        errors: validateReadOperationDefinition(definition),
        id: definition.operationId,
      }).toEqual({ errors: [], id: definition.operationId });
      expect(definition.actors.public).toBeDefined();
    }
  });

  /**
   * The headline decision of this unit. A storefront shopper holds a bearer
   * cookie, which is a claim only where the rail can read it — HTTP ingress.
   * Admitting `storefront_customer` on a Convex function would mean trusting an
   * ordinary argument as identity, so every U6 definition leaves it unset and
   * the rail rejects it on these kinds anyway.
   */
  it("never admits storefront customers on a Convex-function kind", () => {
    for (const definition of [
      ...U6_STOREFRONT_CUSTOMER_OPERATION_DEFINITIONS,
      ...U6_STOREFRONT_CUSTOMER_READ_OPERATION_DEFINITIONS,
    ]) {
      expect({
        id: definition.operationId,
        storefrontCustomer: definition.actors.storefrontCustomer,
      }).toEqual({ id: definition.operationId, storefrontCustomer: undefined });
    }
  });

  it("never widens shared-demo reach beyond the closed grant sets", () => {
    for (const definition of U6_STOREFRONT_CUSTOMER_OPERATION_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(SHARED_DEMO_ALLOWED_CAPABILITIES).toContain(
        definition.capability as never,
      );
    }

    for (const definition of U6_STOREFRONT_CUSTOMER_READ_OPERATION_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(SHARED_DEMO_ALLOWED_READ_INTENTS).toContain(
        definition.access.intent as never,
      );
    }
  });

  // `public: "admit"` is the one place an operation gives up identity entirely,
  // so the set is enumerated rather than spot-checked.
  it("admits anonymous callers on exactly the two pre-auth OTP operations", () => {
    expect(
      U6_STOREFRONT_CUSTOMER_OPERATION_DEFINITIONS.filter(
        (definition) => definition.actors.public === "admit",
      ).map((definition) => definition.functionName),
    ).toEqual([
      "storeFront/auth:verifyCode",
      "storeFront/auth:sendVerificationCodeViaProvider",
    ]);

    expect(
      U6_STOREFRONT_CUSTOMER_READ_OPERATION_DEFINITIONS.filter(
        (definition) => definition.actors.public === "admit",
      ),
    ).toEqual([]);
  });

  // Exactly one read qualifies under the unit's stated rule (granted intent AND
  // store-scoped by argument). Pinning the whole set makes a future widening a
  // deliberate edit to this list rather than a quiet extra "admit".
  it("grants the shared demo exactly one read", () => {
    expect(
      U6_STOREFRONT_CUSTOMER_READ_OPERATION_DEFINITIONS.filter(
        (definition) => definition.actors.sharedDemo === "admit",
      ),
    ).toEqual([getActiveCheckoutSessionsForStoreReadDefinition]);
  });
});

/**
 * Mapping table: every handler-local guard this unit retired, and the
 * definition field that now carries it.
 */
describe("U6 retired guard successors", () => {
  it.each([
    // enforceSharedDemoActionCapability("billing.manage") -> capability +
    // declared gateway + demo denial (billing.manage is not demo-granted).
    ["payment:createTransaction", createTransactionOperationDefinition],
    ["payment:createPODOrder", createPODOrderOperationDefinition],
    ["payment:verifyPayment", verifyPaymentOperationDefinition],
  ])("re-expresses the demo capability check on %s", (_site, definition) => {
    expect(definition.capability).toBe("billing.manage");
    expect(definition.effects).toEqual({
      mode: "protected",
      gateways: ["payment.collect"],
    });
    expect(definition.actors.sharedDemo).toBe("deny");
    expect(definition.actors.public).toBe("deny");
  });

  /**
   * The one payment path the demo keeps. `payments.refund` is granted and the
   * `payment.refund` gateway is classified `simulated`, so a demo visitor still
   * sees the refund flow — now behind the store clamp and the `store_ready`
   * restore fence the ad-hoc helper never applied.
   */
  it("keeps the refund path demo-reachable, fenced and clamped", () => {
    expect(refundPaymentOperationDefinition.capability).toBe("payments.refund");
    expect(refundPaymentOperationDefinition.effects).toEqual({
      mode: "protected",
      gateways: ["payment.refund"],
    });
    expect(refundPaymentOperationDefinition.actors.sharedDemo).toBe("admit");
    expect(refundPaymentOperationDefinition.readiness).toEqual({
      kind: "store_ready",
    });
    expect(refundPaymentOperationDefinition.scope.kind).toBe("store");
  });

  it.each([
    // requireAuthenticatedNonDemoEffect -> identity required + demo denied
    ["checkoutSession:cancelOrder", cancelOrderOperationDefinition],
    ["paystackActions:getAllTransactions", getAllTransactionsOperationDefinition],
    [
      "paystackActions:checkTransactionStatus",
      checkTransactionStatusOperationDefinition,
    ],
    [
      "paystackActions:findOrderTransactions",
      findOrderTransactionsOperationDefinition,
    ],
  ])("re-expresses requireAuthenticatedNonDemoEffect on %s", (
    _site,
    definition,
  ) => {
    expect(definition.kind).toBe("action");
    // "an identity is required"
    expect(definition.actors.normalUser).toBe("admit");
    expect(definition.actors.public).toBe("deny");
    // "and a demo principal is refused"
    expect(definition.actors.sharedDemo).toBe("deny");
  });

  /**
   * `denySharedDemoEffectIfApplicable` refused the demo but demanded no
   * identity — this is the pre-auth OTP send, whose caller cannot be signed in
   * yet. The successor keeps exactly that asymmetry.
   */
  it("re-expresses denySharedDemoEffectIfApplicable on auth:sendVerificationCodeViaProvider", () => {
    expect(sendVerificationCodeViaProviderOperationDefinition.actors).toEqual({
      normalUser: "admit",
      public: "admit",
      sharedDemo: "deny",
    });
  });

  it("keeps the pre-auth code exchange anonymous", () => {
    expect(verifyCodeOperationDefinition.actors.public).toBe("admit");
    expect(verifyCodeOperationDefinition.actors.sharedDemo).toBe("deny");
  });

  // No U6 handler called requireNonDemoFoundation*, so no definition may
  // silently acquire a target guard it never had.
  it("declares no target guards, because no foundation guard existed here", () => {
    for (const definition of U6_STOREFRONT_CUSTOMER_OPERATION_DEFINITIONS) {
      expect({
        id: definition.operationId,
        target: definition.target,
      }).toEqual({ id: definition.operationId, target: undefined });
    }
  });
});

/* ------------------------------------------------------ 2. exported handler */

async function seedStore(t: ReturnType<typeof convexTest>) {
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
    const guestId = await ctx.db.insert("guest", {
      marker: "guest-marker",
      organizationId,
      storeId,
    });
    return { athenaUserId, authUserId, guestId, organizationId, storeId };
  });
}

describe("U6 exported handler admission", () => {
  it("still lets an anonymous shopper run the pre-auth code exchange", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedStore(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("storeFrontVerificationCode", {
        code: "123456",
        email: "shopper@test",
        expiration: Date.now() + 600_000,
        isUsed: false,
        storeId: seed.storeId,
      });
    });

    // Admitted anonymously: the result is the DOMAIN outcome, not a denial.
    // A wrong code is the assertion on purpose — the success path mints a JWT,
    // which the Convex test runtime cannot sign, and the point here is that
    // admission let an identity-less caller reach the handler at all.
    await expect(
      t.mutation(api.storeFront.auth.verifyCode, {
        code: "000000",
        email: "shopper@test",
        organizationId: seed.organizationId,
        storeId: seed.storeId,
        userId: seed.guestId,
      }),
    ).resolves.toEqual({
      error: true,
      message: "Invalid verification code",
    });

    // The stored code is still unused, so nothing about the anonymous path
    // consumed state before the domain check ran.
    await expect(
      t.run(async (ctx) =>
        (await ctx.db.query("storeFrontVerificationCode").first())?.isUsed,
      ),
    ).resolves.toBe(false);
  });

  it("denies anonymous callers everywhere else, before any read or write", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedStore(t);

    await expect(
      t.query(api.storeFront.bag.getPaginatedBags, {
        pagination: { pageIndex: 0, pageSize: 10 },
        storeId: seed.storeId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.query(api.storeFront.rewards.getTiers, { storeId: seed.storeId }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.query(api.storeFront.guest.getAll, {}),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.mutation(api.storeFront.guest.deleteGuest, { id: seed.guestId }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.mutation(api.storeFront.supportTicket.create, {
        origin: "checkout",
        storeFrontUserId: seed.guestId,
        storeId: seed.storeId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);

    // The denial is terminal: the guest row the delete named is untouched.
    await expect(
      t.run((ctx) => ctx.db.get("guest", seed.guestId)),
    ).resolves.not.toBeNull();
  });

  it("keeps normal-user outcomes unchanged", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedStore(t);
    const as = t.withIdentity({ subject: `${seed.authUserId}|session` });

    await expect(
      as.query(api.storeFront.rewards.getTiers, { storeId: seed.storeId }),
    ).resolves.toEqual([]);

    await expect(
      as.query(api.storeFront.bag.getPaginatedBags, {
        pagination: { pageIndex: 0, pageSize: 10 },
        storeId: seed.storeId,
      }),
    ).resolves.toEqual({ items: [], pageCount: 0, totalCount: 0 });

    await expect(
      as.mutation(api.storeFront.supportTicket.create, {
        origin: "checkout",
        storeFrontUserId: seed.guestId,
        storeId: seed.storeId,
      }),
    ).resolves.toMatchObject({ origin: "checkout", storeId: seed.storeId });

    await expect(
      as.mutation(api.storeFront.guest.deleteGuest, { id: seed.guestId }),
    ).resolves.toEqual({ message: "Guest deleted" });
  });

  /**
   * The two-step internalization contract: an internal sibling must return the
   * same thing as the public original for the same inputs, so wave B2 can flip
   * a route to it without changing a payload.
   */
  it("gives internal siblings the same result as their public originals", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedStore(t);
    const as = t.withIdentity({ subject: `${seed.authUserId}|session` });

    const owner = { guestId: seed.guestId, storeId: seed.storeId };

    await expect(
      t.run((ctx) =>
        ctx.runQuery(internal.storeFront.rewards.getTiersInternal, {
          owner,
          storeId: seed.storeId,
        }),
      ),
    ).resolves.toEqual(
      await as.query(api.storeFront.rewards.getTiers, {
        storeId: seed.storeId,
      }),
    );
  });
});
