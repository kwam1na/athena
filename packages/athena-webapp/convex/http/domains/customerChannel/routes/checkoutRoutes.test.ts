/// <reference types="vite/client" />

/**
 * Behavioural coverage for the EXPORTED `checkoutRoutes` router.
 *
 * The admission migration deleted the public Convex exports this surface used
 * to be (`storeFront/checkoutSession.create`, `storeFront/payment.createTransaction`,
 * `createPODOrder`, `cancelOrder`, `verifyPayment`) and moved their bodies
 * behind `internal.*` siblings that only these Hono routes call. The tests that
 * covered the public exports went with them, so the money path — the pay
 * action, the pay-on-delivery action, the cancel action and payment
 * verification — was left with nothing but definition-shape assertions.
 *
 * These tests re-derive the invariants at the boundary that actually regressed:
 * the route. They drive `checkoutRoutes.fetch(...)` through the REAL admission
 * entry points (same harness shape as `customerChannelAdmission.test.ts`) and
 * assert observable outcomes — response status, response body, and which
 * internal function was or was NOT reached with which `owner`.
 *
 * The properties under test:
 *
 * 1. A pay action for an owned session initializes a transaction, forwarding
 *    the SERVER-side session amount and the ADMITTED owner.
 * 2. The pay-on-delivery action does the same through `createPODOrderInternal`.
 * 3. A session belonging to another shopper is refused and NO transaction is
 *    initialized — the money call is never made.
 * 4. A tampered amount, an already-finalized session and a checkout-disabled
 *    store each stop before the provider.
 * 5. Create / cancel / verify forward the admitted owner rather than any id the
 *    request body or path supplied.
 */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";

import { internal } from "../../../../_generated/api";
import {
  admitOperationWithCtx,
  admitReadOperationWithCtx,
} from "../../../../platform/operationAdmission";

import { checkoutRoutes } from "./checkout";

const ALLOWED_ORIGIN = "https://shop.test";
const ORIGIN_ENV = "ATHENA_STOREFRONT_ALLOWED_ORIGINS";

const ADMIT_WRITE = getFunctionName(
  internal.platform.admissionEntrypoints.admitOperation,
);
const ADMIT_READ = getFunctionName(
  internal.platform.admissionEntrypoints.admitReadOperation,
);

type Rows = Record<string, Record<string, any>>;

/**
 * Same harness contract as `customerChannelAdmission.test.ts`: the two
 * composition-root admission entry points run the real rail against a small
 * in-memory `db`, and every other call is recorded so a test can assert exactly
 * what a route forwarded (or that it forwarded nothing at all).
 */
function harness(rows: Rows = {}, results: Record<string, unknown> = {}) {
  const ctx = {
    auth: { getUserIdentity: async () => null },
    db: {
      get: async (table: string, id: string) => rows[table]?.[id] ?? null,
    },
  } as any;

  const calls: { name: string; args: any }[] = [];

  const dispatch = async (ref: any, args: any) => {
    const name = getFunctionName(ref);
    if (name === ADMIT_WRITE) {
      return await admitOperationWithCtx(ctx, args);
    }
    if (name === ADMIT_READ) {
      return await admitReadOperationWithCtx(ctx, args);
    }
    calls.push({ name, args });
    return results[name] ?? null;
  };

  return {
    calls,
    env: {
      runMutation: dispatch,
      runQuery: dispatch,
      runAction: dispatch,
    },
    called: (fn: any) =>
      calls.find((call) => call.name === getFunctionName(fn)),
  };
}

const STORE_ROWS: Rows = {
  storeFrontUser: {
    "user-A": { _id: "user-A", storeId: "store-1" },
    "user-B": { _id: "user-B", storeId: "store-1" },
  },
  guest: {
    "guest-A": { _id: "guest-A", storeId: "store-1" },
  },
};

const ADMITTED_OWNER = { storeFrontUserId: "user-A", storeId: "store-1" };

const name = (fn: any) => getFunctionName(fn);

function request(
  path: string,
  options: {
    body?: unknown;
    cookie?: string;
    method?: string;
    origin?: string | null;
  } = {},
) {
  const headers = new Headers();
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (typeof options.origin === "string") {
    headers.set("Origin", options.origin);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(`https://api.test${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

const withOrigin = async (run: () => Promise<void>) => {
  vi.stubEnv(ORIGIN_ENV, ALLOWED_ORIGIN);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
};

const CUSTOMER_COOKIE = "user_id=user-A; store_id=store-1";

/** A checkout session as `getByIdInternal` returns it to the route. */
const session = (overrides: Record<string, any> = {}) => ({
  _id: "session-1",
  amount: 10_000,
  discount: null,
  hasCompletedPayment: false,
  items: [
    {
      isVisible: true,
      price: 10_000,
      productId: "product-1",
      productSku: "SKU-1",
      productSkuId: "sku-1",
      quantity: 1,
    },
  ],
  storeFrontUserId: "user-A",
  storeId: "store-1",
  ...overrides,
});

const ORDER_DETAILS = {
  billingDetails: null,
  customerDetails: {
    email: "shopper@test.com",
    firstName: "Ada",
    lastName: "Shopper",
    phoneNumber: "0200000000",
  },
  deliveryDetails: { country: "GH", region: "GA" },
  deliveryFee: 1_000,
  deliveryMethod: "delivery",
  deliveryOption: "within-accra",
  pickupLocation: null,
};

const PAYSTACK_RESULT = {
  access_code: "access-1",
  authorization_url: "https://checkout.paystack.com/access-1",
  reference: "reference-1",
};

const OPEN_STORE = { _id: "store-1", config: {} };

/** The pay action, with everything the happy path needs already stubbed. */
function payHarness(
  sessionOverrides: Record<string, any> = {},
  extraResults: Record<string, unknown> = {},
) {
  return harness(STORE_ROWS, {
    [name(internal.storeFront.checkoutSession.getByIdInternal)]:
      session(sessionOverrides),
    [name(internal.inventory.stores.findById)]: OPEN_STORE,
    [name(internal.storeFront.payment.createTransactionInternal)]:
      PAYSTACK_RESULT,
    [name(internal.storeFront.payment.createPODOrderInternal)]: {
      message: "Order placed.",
      reference: "POD-1",
      success: true,
    },
    ...extraResults,
  });
}

const post = (
  test: ReturnType<typeof harness>,
  path: string,
  body: unknown,
  cookie: string = CUSTOMER_COOKIE,
) =>
  checkoutRoutes.fetch(
    request(path, { body, cookie, method: "POST", origin: ALLOWED_ORIGIN }),
    test.env as never,
  );

describe("POST /checkout/:checkoutSessionId — pay action", () => {
  it("initializes a Paystack transaction for the admitted shopper's own session", async () => {
    await withOrigin(async () => {
      const test = payHarness();

      const response = await post(test, "/session-1", {
        action: "finalize-payment",
        amount: 10_000,
        customerEmail: "shopper@test.com",
        orderDetails: ORDER_DETAILS,
      });

      expect(await response.json()).toEqual(PAYSTACK_RESULT);
      expect(response.status).toBe(200);

      const call = test.called(
        internal.storeFront.payment.createTransactionInternal,
      );
      expect(call?.args.owner).toEqual(ADMITTED_OWNER);
      expect(call?.args.checkoutSessionId).toBe("session-1");
      // The charged amount is the SERVER's session amount, never the body's.
      expect(call?.args.amount).toBe(10_000);
      expect(call?.args.customerEmail).toBe("shopper@test.com");

      // The session lookup itself carries the owner, so the callee can refuse a
      // foreign id even if the route's own check were ever removed.
      expect(
        test.called(internal.storeFront.checkoutSession.getByIdInternal)?.args,
      ).toEqual({ sessionId: "session-1", owner: ADMITTED_OWNER });
    });
  });

  it("charges the session amount even when the body claims a smaller one", async () => {
    await withOrigin(async () => {
      const test = payHarness();

      const response = await post(test, "/session-1", {
        action: "finalize-payment",
        // Tampered downward: the guard fires before any provider work.
        amount: 1,
        customerEmail: "shopper@test.com",
        orderDetails: ORDER_DETAILS,
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "Amount mismatch detected",
      });
      expect(
        test.called(internal.storeFront.payment.createTransactionInternal),
      ).toBeUndefined();
    });
  });

  it("refuses a session belonging to another shopper without initializing a transaction", async () => {
    await withOrigin(async () => {
      // A perfectly valid session id — for customer B. Possession proves
      // nothing: the admitted claim is customer A's.
      const test = payHarness({ storeFrontUserId: "user-B" });

      const response = await post(test, "/session-1", {
        action: "finalize-payment",
        amount: 10_000,
        customerEmail: "shopper@test.com",
        orderDetails: ORDER_DETAILS,
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
      expect(
        test.called(internal.storeFront.payment.createTransactionInternal),
      ).toBeUndefined();
      expect(
        test.called(internal.storeFront.payment.createPODOrderInternal),
      ).toBeUndefined();
    });
  });

  it("returns 404 for an unknown session and initializes nothing", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS, {
        [name(internal.storeFront.checkoutSession.getByIdInternal)]: null,
      });

      const response = await post(test, "/session-missing", {
        action: "finalize-payment",
        amount: 10_000,
        orderDetails: ORDER_DETAILS,
      });

      expect(response.status).toBe(404);
      expect(
        test.called(internal.storeFront.payment.createTransactionInternal),
      ).toBeUndefined();
    });
  });

  it("refuses to re-charge an already finalized session", async () => {
    await withOrigin(async () => {
      const test = payHarness({ hasCompletedPayment: true });

      const response = await post(test, "/session-1", {
        action: "finalize-payment",
        amount: 10_000,
        orderDetails: ORDER_DETAILS,
      });

      expect(await response.json()).toEqual(
        expect.objectContaining({
          code: "SESSION_ALREADY_FINALIZED",
          success: false,
        }),
      );
      expect(
        test.called(internal.storeFront.payment.createTransactionInternal),
      ).toBeUndefined();
    });
  });

  it("stops at a store whose checkout is switched off", async () => {
    await withOrigin(async () => {
      const test = payHarness(
        {},
        {
          [name(internal.inventory.stores.findById)]: {
            _id: "store-1",
            config: { operations: { availability: { inMaintenanceMode: true } } },
          },
        },
      );

      const response = await post(test, "/session-1", {
        action: "finalize-payment",
        amount: 10_000,
        orderDetails: ORDER_DETAILS,
      });

      expect(await response.json()).toEqual({
        message: "Store checkout is currently not available",
        success: false,
      });
      expect(
        test.called(internal.storeFront.payment.createTransactionInternal),
      ).toBeUndefined();

      // The store that is consulted is the ADMITTED one, not a cookie's.
      expect(test.called(internal.inventory.stores.findById)?.args).toEqual({
        id: "store-1",
      });
    });
  });

  it("refuses to charge for a session holding a no-longer-visible item", async () => {
    await withOrigin(async () => {
      const test = payHarness({
        items: [
          {
            isVisible: false,
            price: 10_000,
            productId: "product-1",
            productSku: "SKU-1",
            productSkuId: "sku-1",
            quantity: 1,
          },
        ],
      });

      const response = await post(test, "/session-1", {
        action: "finalize-payment",
        amount: 10_000,
        orderDetails: ORDER_DETAILS,
      });

      expect(await response.json()).toEqual({
        message: "Some items in your bag are no longer available",
        success: false,
      });
      expect(
        test.called(internal.storeFront.payment.createTransactionInternal),
      ).toBeUndefined();
    });
  });
});

describe("POST /checkout/:checkoutSessionId — pay-on-delivery action", () => {
  it("places a POD order for the admitted shopper's own session", async () => {
    await withOrigin(async () => {
      const test = payHarness();

      const response = await post(test, "/session-1", {
        action: "create-pod-order",
        amount: 10_000,
        customerEmail: "shopper@test.com",
        orderDetails: {
          ...ORDER_DETAILS,
          paymentMethod: "payment_on_delivery",
          podPaymentMethod: "cash",
        },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        message: "Order placed.",
        reference: "POD-1",
        success: true,
      });

      const call = test.called(
        internal.storeFront.payment.createPODOrderInternal,
      );
      expect(call?.args.owner).toEqual(ADMITTED_OWNER);
      expect(call?.args.checkoutSessionId).toBe("session-1");
      expect(call?.args.amount).toBe(10_000);
      // No online-payment transaction is opened on this branch.
      expect(
        test.called(internal.storeFront.payment.createTransactionInternal),
      ).toBeUndefined();
    });
  });

  it("refuses a POD order against another shopper's session", async () => {
    await withOrigin(async () => {
      const test = payHarness({ storeFrontUserId: "user-B" });

      const response = await post(test, "/session-1", {
        action: "create-pod-order",
        amount: 10_000,
        orderDetails: ORDER_DETAILS,
      });

      expect(response.status).toBe(403);
      expect(
        test.called(internal.storeFront.payment.createPODOrderInternal),
      ).toBeUndefined();
    });
  });

  it("refuses a tampered POD amount before the order is created", async () => {
    await withOrigin(async () => {
      const test = payHarness();

      const response = await post(test, "/session-1", {
        action: "create-pod-order",
        amount: 5,
        orderDetails: ORDER_DETAILS,
      });

      expect(response.status).toBe(422);
      expect(
        test.called(internal.storeFront.payment.createPODOrderInternal),
      ).toBeUndefined();
    });
  });
});

describe("POST /checkout/:checkoutSessionId — cancel action", () => {
  it("cancels the admitted shopper's own order", async () => {
    await withOrigin(async () => {
      const test = payHarness(
        {},
        {
          [name(internal.storeFront.checkoutSession.cancelOrderInternal)]: {
            message: "Order has been cancelled.",
            success: true,
          },
        },
      );

      const response = await post(test, "/session-1", {
        action: "cancel-order",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        message: "Order has been cancelled.",
        success: true,
      });
      expect(
        test.called(internal.storeFront.checkoutSession.cancelOrderInternal)
          ?.args,
      ).toEqual({ id: "session-1", owner: ADMITTED_OWNER });
    });
  });

  it("does not cancel another shopper's order", async () => {
    await withOrigin(async () => {
      const test = payHarness({ storeFrontUserId: "user-B" });

      const response = await post(test, "/session-1", {
        action: "cancel-order",
      });

      expect(response.status).toBe(403);
      expect(
        test.called(internal.storeFront.checkoutSession.cancelOrderInternal),
      ).toBeUndefined();
    });
  });
});

describe("POST /checkout — session creation", () => {
  it("opens a session for the admitted shopper from their own bag", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS, {
        [name(internal.storeFront.bag.getByIdInternal)]: {
          _id: "bag-1",
          items: [
            {
              price: 2_500,
              productId: "product-1",
              productSku: "SKU-1",
              productSkuId: "sku-1",
              quantity: 2,
            },
          ],
          storeFrontUserId: "user-A",
          storeId: "store-1",
        },
        [name(internal.storeFront.checkoutSession.createInternal)]: {
          session: { _id: "session-1" },
          success: true,
        },
      });

      const response = await post(test, "/", {
        bagId: "bag-1",
        // Forged: neither of these may reach the callee as identity.
        storeFrontUserId: "user-B",
        storeId: "store-2",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        session: { _id: "session-1" },
        success: true,
      });

      const call = test.called(
        internal.storeFront.checkoutSession.createInternal,
      );
      expect(call?.args.owner).toEqual(ADMITTED_OWNER);
      expect(call?.args.storeFrontUserId).toBe("user-A");
      expect(call?.args.storeId).toBe("store-1");
      // Amount is recomputed from the bag server-side: 2 x 2_500.
      expect(call?.args.amount).toBe(5_000);
    });
  });

  it("refuses to open a session on another shopper's bag", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS, {
        [name(internal.storeFront.bag.getByIdInternal)]: {
          _id: "bag-1",
          items: [
            {
              price: 2_500,
              productId: "product-1",
              productSku: "SKU-1",
              productSkuId: "sku-1",
              quantity: 1,
            },
          ],
          storeFrontUserId: "user-B",
          storeId: "store-1",
        },
      });

      const response = await post(test, "/", { bagId: "bag-1" });

      expect(response.status).toBe(403);
      expect(
        test.called(internal.storeFront.checkoutSession.createInternal),
      ).toBeUndefined();
    });
  });
});

describe("GET /checkout/verify/:reference", () => {
  it("verifies payment as the admitted shopper", async () => {
    const test = harness(STORE_ROWS, {
      [name(internal.storeFront.payment.verifyPaymentInternal)]: {
        message: "Payment verified.",
        success: true,
      },
    });

    const response = await checkoutRoutes.fetch(
      request("/verify/reference-1", { cookie: CUSTOMER_COOKIE }),
      test.env as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Payment verified.",
      success: true,
    });
    expect(
      test.called(internal.storeFront.payment.verifyPaymentInternal)?.args,
    ).toEqual({
      externalReference: "reference-1",
      owner: ADMITTED_OWNER,
      storeFrontUserId: "user-A",
    });
  });

  it("denies a cookieless verification before the action runs", async () => {
    const test = harness(STORE_ROWS);

    const response = await checkoutRoutes.fetch(
      request("/verify/reference-1"),
      test.env as never,
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(test.calls).toEqual([]);
  });
});
