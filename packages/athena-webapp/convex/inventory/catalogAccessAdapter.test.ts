/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import { defineReadOperation } from "../operationAdmission/domains/_shapes";
import {
  OPERATION_INGRESS_CLAIM_ARG,
  type OperationReadDefinition,
} from "../operationAdmission/types";
import schema from "../schema";
import { createCatalogReaderReadOperationAdapter } from "./catalogAccessAdapter";
import { hashCatalogAccessTokenValue } from "./catalogAccess";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./inventory/"),
    loader,
  ]),
);

const TOKEN = `athcat_${"A".repeat(43)}`;
const OTHER_TOKEN = `athcat_${"B".repeat(43)}`;

const admittingRead = defineReadOperation({
  kind: "http_read" as const,
  operationId: "test.catalogReader.admit",
  route: { method: "GET", path: "/assistant/search" },
  access: { kind: "read" as const, intent: "storefront.catalog.view" },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  actors: {
    normalUser: "deny" as const,
    sharedDemo: "deny" as const,
    storefrontCustomer: "deny" as const,
    catalogReader: "admit" as const,
    public: "deny" as const,
  },
}) as OperationReadDefinition;

const denyingRead = defineReadOperation({
  kind: "http_read" as const,
  operationId: "test.catalogReader.deny",
  route: { method: "GET", path: "/categories" },
  access: { kind: "read" as const, intent: "storefront.catalog.view" },
  scope: { kind: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    storefrontCustomer: "deny" as const,
    catalogReader: "deny" as const,
    public: "admit" as const,
  },
}) as OperationReadDefinition;

const adapter = createCatalogReaderReadOperationAdapter();

const claim = (value: Record<string, unknown>) => ({
  [OPERATION_INGRESS_CLAIM_ARG]: value,
});

type Fixture = {
  storeA: Id<"store">;
  storeB: Id<"store">;
  activeToken: Id<"catalogAccessToken">;
  revokedToken: Id<"catalogAccessToken">;
};

async function seed(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  return t.run(async (ctx) => {
    const createdByUserId = await ctx.db.insert("athenaUser", {
      email: "admin@example.com",
      normalizedEmail: "admin@example.com",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId,
      name: "Org",
      slug: "org",
    });
    const storeA = await ctx.db.insert("store", {
      createdByUserId,
      currency: "GHS",
      name: "Store A",
      organizationId,
      slug: "store-a",
    });
    const storeB = await ctx.db.insert("store", {
      createdByUserId,
      currency: "GHS",
      name: "Store B",
      organizationId,
      slug: "store-b",
    });

    const activeToken = await ctx.db.insert("catalogAccessToken", {
      storeId: storeA,
      tokenHash: hashCatalogAccessTokenValue(TOKEN),
      label: "reader",
      status: "active" as const,
      createdAt: 1,
      createdByUserId,
      lastUsedAt: 4242,
    });
    const revokedToken = await ctx.db.insert("catalogAccessToken", {
      storeId: storeA,
      tokenHash: hashCatalogAccessTokenValue(OTHER_TOKEN),
      label: "retired",
      status: "revoked" as const,
      createdAt: 1,
      createdByUserId,
      revokedAt: 2,
    });
    return { storeA, storeB, activeToken, revokedToken };
  });
}

/**
 * `t.run` only returns Convex values, and a denial carries an `Error`, so the
 * outcome is flattened to plain data inside the transaction.
 */
async function resolve(
  t: ReturnType<typeof convexTest>,
  args: Record<string, unknown>,
  definition: OperationReadDefinition = admittingRead,
) {
  return t.run(async (ctx) => {
    const outcome = await adapter.resolve(ctx as never, args, definition);
    return "error" in outcome && outcome.error
      ? { ...outcome, error: outcome.error.message }
      : outcome;
  });
}

describe("catalogue reader admission", () => {
  it("is not this adapter's caller when the claim carries no token hash", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    expect(await resolve(t, {})).toEqual({ kind: "not_applicable" });
    expect(await resolve(t, claim({ storeFrontUserId: "user_1" }))).toEqual({
      kind: "not_applicable",
    });
  });

  it("admits a live token under the store the token row names", async () => {
    const t = convexTest(schema, modules);
    const { storeA, activeToken } = await seed(t);

    expect(
      await resolve(
        t,
        claim({ catalogAccessTokenHash: hashCatalogAccessTokenValue(TOKEN) }),
      ),
    ).toEqual({
      actor: {
        kind: "catalog_reader",
        assurance: "bearer_token",
        storeId: storeA,
        tokenId: activeToken,
      },
      constraints: { storeId: storeA },
      decision: { adapter: "catalog_reader", outcome: "admitted" },
      provenance: {
        kind: "catalog_reader",
        assurance: "bearer_token",
        operationId: admittingRead.operationId,
        lastUsedAt: 4242,
      },
    });
  });

  it("admits when the storeId argument names the token's own store", async () => {
    const t = convexTest(schema, modules);
    const { storeA } = await seed(t);

    expect(
      await resolve(t, {
        storeId: storeA,
        ...claim({ catalogAccessTokenHash: hashCatalogAccessTokenValue(TOKEN) }),
      }),
    ).toMatchObject({ constraints: { storeId: storeA } });
  });

  it("denies scope when the storeId argument names another store", async () => {
    const t = convexTest(schema, modules);
    const { storeB } = await seed(t);

    expect(
      await resolve(t, {
        storeId: storeB,
        ...claim({ catalogAccessTokenHash: hashCatalogAccessTokenValue(TOKEN) }),
      }),
    ).toMatchObject({ kind: "denied", recognized: true, reason: "scope_denied" });
  });

  it("answers an unknown and a revoked token identically", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const revoked = await resolve(
      t,
      claim({ catalogAccessTokenHash: hashCatalogAccessTokenValue(OTHER_TOKEN) }),
    );
    const unknown = await resolve(
      t,
      claim({ catalogAccessTokenHash: "0".repeat(64) }),
    );

    expect(revoked).toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "unknown_claim",
    });
    expect((revoked as { error: string }).error).toBe(
      (unknown as { error: string }).error,
    );
    expect((unknown as { reason: string }).reason).toBe("unknown_claim");
  });

  /**
   * A presented credential is recognised identity: a route that does not take
   * this caller refuses it outright rather than letting it read on as an
   * anonymous visitor. The refusal comes before the lookup, so a valid token
   * and a forged one are indistinguishable on such a route — and the token
   * table is never touched.
   */
  it("denies a token on a route that does not admit it, before any lookup", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    for (const hash of [hashCatalogAccessTokenValue(TOKEN), "0".repeat(64)]) {
      expect(
        await resolve(t, claim({ catalogAccessTokenHash: hash }), denyingRead),
      ).toMatchObject({
        kind: "denied",
        recognized: true,
        reason: "actor_denied",
      });
    }
  });
});
