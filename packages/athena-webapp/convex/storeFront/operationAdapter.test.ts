import { describe, expect, it, vi } from "vitest";

import { defineOperation, defineReadOperation } from "../operationAdmission/domains/_shapes";
import { OPERATION_INGRESS_CLAIM_ARG } from "../operationAdmission/types";
import type { OperationDefinition } from "../operationAdmission/types";
import {
  createStorefrontCustomerOperationAdapter,
  createStorefrontCustomerReadOperationAdapter,
} from "./operationAdapter";

const customerWrite = defineOperation({
  kind: "http" as const,
  operationId: "storeFront.bagItem.addItemToBag.http",
  capability: "orders.create",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  ingressVerification: { kind: "origin_allowlist" },
  actors: {
    normalUser: "deny",
    sharedDemo: "deny",
    storefrontCustomer: "admit",
    public: "deny",
  },
}) as OperationDefinition;

const customerRead = defineReadOperation({
  kind: "http_read" as const,
  operationId: "storeFront.bag.getActive.http_read",
  access: { kind: "read", intent: "online_orders.view" },
  scope: { kind: "store", storeIdArg: "storeId" },
  actors: {
    normalUser: "deny",
    sharedDemo: "deny",
    storefrontCustomer: "admit",
    public: "deny",
  },
});

function ctxWith(rows: Record<string, Record<string, unknown> | null>) {
  return {
    db: {
      get: vi.fn(async (table: string, id: string) => rows[`${table}:${id}`] ?? null),
    },
  };
}

const claim = (value: Record<string, unknown>) => ({
  [OPERATION_INGRESS_CLAIM_ARG]: value,
});

describe("storefront customer adapter", () => {
  it("admits a valid claim with bearer assurance and the store from the claim row", async () => {
    const ctx = ctxWith({ "storeFrontUser:user-1": { storeId: "store-1" } });

    await expect(
      createStorefrontCustomerOperationAdapter().resolve(
        ctx as never,
        { ...claim({ storeFrontUserId: "user-1", storeId: "store-1" }) },
        customerWrite,
      ),
    ).resolves.toMatchObject({
      actor: {
        kind: "storefront_customer",
        assurance: "bearer_id",
        storeFrontUserId: "user-1",
        storeId: "store-1",
      },
      constraints: { storeId: "store-1" },
    });
  });

  it("derives the store from the row, not the store_id cookie", async () => {
    const ctx = ctxWith({ "storeFrontUser:user-1": { storeId: "store-1" } });

    await expect(
      createStorefrontCustomerOperationAdapter().resolve(
        ctx as never,
        { ...claim({ storeFrontUserId: "user-1", storeId: "store-2" }) },
        customerWrite,
      ),
    ).resolves.toMatchObject({ kind: "denied", reason: "scope_denied" });
  });

  it("denies an unknown claim id", async () => {
    await expect(
      createStorefrontCustomerOperationAdapter().resolve(
        ctxWith({}) as never,
        { ...claim({ storeFrontUserId: "ghost" }) },
        customerWrite,
      ),
    ).resolves.toMatchObject({ kind: "denied", reason: "unknown_claim" });
  });

  it("denies a guest row that carries no store", async () => {
    const ctx = ctxWith({ "guest:guest-1": { marker: "abc" } });

    await expect(
      createStorefrontCustomerOperationAdapter().resolve(
        ctx as never,
        { ...claim({ guestId: "guest-1" }) },
        customerWrite,
      ),
    ).resolves.toMatchObject({ kind: "denied", reason: "unknown_claim" });
  });

  it("denies a request for another store's resource", async () => {
    const ctx = ctxWith({ "storeFrontUser:user-1": { storeId: "store-1" } });

    await expect(
      createStorefrontCustomerOperationAdapter().resolve(
        ctx as never,
        { storeId: "store-2", ...claim({ storeFrontUserId: "user-1" }) },
        customerWrite,
      ),
    ).resolves.toMatchObject({ kind: "denied", reason: "scope_denied" });
  });

  it("treats a cookieless customer write as a terminal denial", async () => {
    await expect(
      createStorefrontCustomerOperationAdapter().resolve(
        ctxWith({}) as never,
        {},
        customerWrite,
      ),
    ).resolves.toMatchObject({ kind: "denied", reason: "claim_missing" });
  });

  it("lets a cookieless browse read fall through to the public adapter", async () => {
    await expect(
      createStorefrontCustomerReadOperationAdapter().resolve(
        ctxWith({}) as never,
        {},
        customerRead,
      ),
    ).resolves.toEqual({ kind: "unauthenticated" });
  });

  it("is not applicable when the definition does not admit customers", async () => {
    await expect(
      createStorefrontCustomerOperationAdapter().resolve(
        ctxWith({}) as never,
        { ...claim({ storeFrontUserId: "user-1" }) },
        { ...customerWrite, actors: { ...customerWrite.actors, storefrontCustomer: "deny" } },
      ),
    ).resolves.toEqual({ kind: "not_applicable" });
  });
});
