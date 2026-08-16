/// <reference types="vite/client" />

/**
 * U6 shared-demo admission, per retired demo-helper call site.
 *
 * This file drives the demo adapter directly rather than through `convexTest`
 * so it never imports the composition root: `platform/operationAdmission`
 * constructs this very adapter at module init, and loading both in one test
 * module makes the adapter observably half-initialized.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

/**
 * Cuts the one module cycle that reaches back into the composition root. Every
 * case below injects its own `requireReadyWrite`, so the real restore fence is
 * never the thing under test here.
 */
vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

import { createSharedDemoOperationAdapter } from "../sharedDemo/operationAdapter";
import {
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

const DEMO_PRINCIPAL = {
  admissionExpiresAt: Number.MAX_SAFE_INTEGER,
  athenaUserId: "demo-athena-user",
  authUserId: "demo-auth-user",
  organizationId: "demo-org",
  storeId: "demo-store",
};

function demoCtx(rows: Record<string, Record<string, unknown>> = {}) {
  return {
    auth: { getUserIdentity: vi.fn() },
    db: {
      get: vi.fn(async (_table: string, id: string) => rows[id] ?? null),
      normalizeId: vi.fn((_table: string, id: string) => id),
      query: vi.fn(() => ({
        withIndex: vi.fn((_name: string, apply: (b: unknown) => void) => {
          apply({ eq: vi.fn().mockReturnThis() });
          return {
            first: vi.fn().mockResolvedValue(null),
            unique: vi.fn().mockResolvedValue(DEMO_PRINCIPAL),
          };
        }),
      })),
    },
  };
}

describe("U6 shared-demo admission", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth-user" as never);
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  /**
   * One row per retired demo-helper call site. Each of these used to refuse the
   * demo inside the handler — after the OTP row was written, or with the
   * Paystack client already constructed. The refusal is now an admission-time
   * denial with a typed reason and nothing executed.
   */
  it.each([
    // enforceSharedDemoActionCapability("billing.manage")
    [
      "payment:createTransaction",
      createTransactionOperationDefinition,
      { checkoutSessionId: "demo-session" },
    ],
    [
      "payment:createPODOrder",
      createPODOrderOperationDefinition,
      { checkoutSessionId: "demo-session" },
    ],
    [
      "payment:verifyPayment",
      verifyPaymentOperationDefinition,
      { externalReference: "ref-1" },
    ],
    // requireAuthenticatedNonDemoEffect
    ["checkoutSession:cancelOrder", cancelOrderOperationDefinition, { id: "demo-session" }],
    ["paystackActions:getAllTransactions", getAllTransactionsOperationDefinition, {}],
    [
      "paystackActions:checkTransactionStatus",
      checkTransactionStatusOperationDefinition,
      { reference: "ref-1" },
    ],
    [
      "paystackActions:findOrderTransactions",
      findOrderTransactionsOperationDefinition,
      { customerEmail: "shopper@test", orderCreatedAt: 0 },
    ],
    // denySharedDemoEffectIfApplicable
    [
      "auth:sendVerificationCodeViaProvider",
      sendVerificationCodeViaProviderOperationDefinition,
      { storeId: "demo-store" },
    ],
    // storefront.session.manage / identity.authenticate are ungranted
    ["auth:verifyCode", verifyCodeOperationDefinition, { storeId: "demo-store" }],
  ])("denies a demo visitor on %s with a recognized reason", async (
    _site,
    definition,
    args,
  ) => {
    const requireReadyWrite = vi.fn();

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite }).resolve(
        demoCtx({ "demo-session": { storeId: "demo-store" } }) as never,
        args,
        definition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "actor_denied",
    });
    // Nothing ran: no restore fence, therefore no write path was entered.
    expect(requireReadyWrite).not.toHaveBeenCalled();
  });

  /**
   * The refund keeps the reach the retired helper granted it — and gains the
   * store clamp and restore fence the helper never applied. The store is
   * derived from the order the transaction id names, not from an argument.
   */
  it("admits the demo refund with the store clamp and the restore fence", async () => {
    const requireReadyWrite = vi.fn();
    const ctx = demoCtx();
    ctx.db.query = vi.fn(() => ({
      withIndex: vi.fn((_name: string, apply: (b: unknown) => void) => {
        apply({ eq: vi.fn().mockReturnThis() });
        return {
          first: vi.fn().mockResolvedValue({ storeId: "demo-store" }),
          unique: vi.fn().mockResolvedValue(DEMO_PRINCIPAL),
        };
      }),
    })) as never;

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite }).resolve(
        ctx as never,
        { externalTransactionId: "demo-transaction" },
        refundPaymentOperationDefinition,
      ),
    ).resolves.toMatchObject({
      actor: { kind: "shared_demo", storeId: "demo-store" },
      constraints: { organizationId: "demo-org", storeId: "demo-store" },
      decision: { adapter: "shared_demo", outcome: "admitted" },
    });
  });

  /**
   * Cross-store: the refund's store comes from the named order, so a demo
   * visitor holding another store's transaction id is denied after scope
   * resolution rather than admitted against their own store.
   */
  it("denies the demo refund across stores after resource-derived scope resolution", async () => {
    const requireReadyWrite = vi.fn();
    const ctx = demoCtx();
    ctx.db.query = vi.fn(() => ({
      withIndex: vi.fn((_name: string, apply: (b: unknown) => void) => {
        apply({ eq: vi.fn().mockReturnThis() });
        return {
          first: vi.fn().mockResolvedValue({ storeId: "other-store" }),
          unique: vi.fn().mockResolvedValue(DEMO_PRINCIPAL),
        };
      }),
    })) as never;

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite }).resolve(
        ctx as never,
        { externalTransactionId: "foreign-transaction" },
        refundPaymentOperationDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "scope_denied",
    });
    expect(requireReadyWrite).not.toHaveBeenCalled();
  });
});
