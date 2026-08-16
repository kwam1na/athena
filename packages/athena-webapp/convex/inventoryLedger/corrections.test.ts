/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";

/**
 * `getSharedDemoActorWithCtx` is the only seam the shared-demo adapter uses to
 * decide whether a demo principal is present. Stubbing it lets the demo-denial
 * case exercise the REAL adapter chain (capability, scope, actor policy)
 * without standing up a demo session row.
 */
const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
}));

vi.mock("../sharedDemo/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sharedDemo/actor")>()),
  getSharedDemoActorWithCtx: sharedDemoMocks.getSharedDemoActorWithCtx,
}));

import { correctSkuValuation } from "./corrections";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./inventoryLedger/"),
    loader,
  ]),
);

const REPORTS_ACCESS_DENIED = "Reports access unavailable.";

type AnyHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

function getHandler(fn: unknown): AnyHandler {
  return (fn as { _handler: AnyHandler })._handler;
}

// Injecting the admitted actor is equivalent to a signed-in session: the
// operation-admission short-circuit in lib/athenaUserAuth resolves identity
// from the actor, while every database-backed check (membership, row store)
// stays real.
function asAdmitted(ctx: MutationCtx, athenaUserId: Id<"athenaUser">) {
  return {
    ...ctx,
    operationAdmission: {
      actor: { kind: "normal_user" as const, athenaUserId },
    },
  };
}

type Fixture = {
  adminA: Id<"athenaUser">;
  adminB: Id<"athenaUser">;
  organizationA: Id<"organization">;
  storeA: Id<"store">;
  storeB: Id<"store">;
  skuA: Id<"productSku">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  async function seedUser(email: string) {
    return ctx.db.insert("athenaUser", { email, normalizedEmail: email });
  }
  const adminA = await seedUser("admin-a@example.com");
  const adminB = await seedUser("admin-b@example.com");

  const organizationA = await ctx.db.insert("organization", {
    createdByUserId: adminA,
    name: "Org A",
    slug: "org-a",
  });
  const organizationB = await ctx.db.insert("organization", {
    createdByUserId: adminB,
    name: "Org B",
    slug: "org-b",
  });
  const storeA = await ctx.db.insert("store", {
    createdByUserId: adminA,
    currency: "ghs",
    name: "Org A Store",
    organizationId: organizationA,
    slug: "org-a-store",
  });
  const storeB = await ctx.db.insert("store", {
    createdByUserId: adminB,
    currency: "ghs",
    name: "Org B Store",
    organizationId: organizationB,
    slug: "org-b-store",
  });

  await ctx.db.insert("organizationMember", {
    organizationId: organizationA,
    userId: adminA,
    role: "full_admin",
  });
  await ctx.db.insert("organizationMember", {
    organizationId: organizationB,
    userId: adminB,
    role: "full_admin",
  });

  const categoryId = await ctx.db.insert("category", {
    name: "Wigs",
    slug: "wigs",
    storeId: storeA,
  });
  const subcategoryId = await ctx.db.insert("subcategory", {
    categoryId,
    name: "Lace",
    slug: "lace",
    storeId: storeA,
  });
  const productId = await ctx.db.insert("product", {
    availability: "live" as const,
    categoryId,
    createdByUserId: adminA,
    currency: "GHS",
    inventoryCount: 10,
    name: "Lace Wig",
    organizationId: organizationA,
    slug: "lace-wig",
    storeId: storeA,
    subcategoryId,
  });
  const skuA = await ctx.db.insert("productSku", {
    images: [],
    inventoryCount: 10,
    price: 12000,
    productId,
    quantityAvailable: 10,
    storeId: storeA,
  });

  return { adminA, adminB, organizationA, storeA, storeB, skuA };
}

function correctionArgs(fixture: Fixture, overrides: Record<string, unknown>) {
  return {
    inventoryCount: 7,
    productSkuId: fixture.skuA,
    quantityAvailable: 7,
    reason: "Recount after audit.",
    requestKey: "correction-1",
    storeId: fixture.storeA,
    unitCostMinor: 4500,
    ...overrides,
  };
}

async function countCorrections(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) =>
    (await ctx.db.query("reportingSkuValuationCorrection").take(50)).length,
  );
}

describe("correctSkuValuation admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
  });

  it("admits a normal full-admin user and applies the correction", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await t.run((ctx) =>
      getHandler(correctSkuValuation)(
        asAdmitted(ctx, fixture.adminA),
        correctionArgs(fixture, {}),
      ),
    );

    const sku = await t.run((ctx) => ctx.db.get("productSku", fixture.skuA));
    expect(sku?.inventoryCount).toBe(7);
    expect(sku?.quantityAvailable).toBe(7);
    expect(await countCorrections(t)).toBe(1);
  });

  it("denies an unauthenticated caller before any row is written", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await expect(
      t.run((ctx) =>
        getHandler(correctSkuValuation)(ctx, correctionArgs(fixture, {})),
      ),
    ).rejects.toThrow("Sign in again to continue.");

    const sku = await t.run((ctx) => ctx.db.get("productSku", fixture.skuA));
    expect(sku?.inventoryCount).toBe(10);
    expect(await countCorrections(t)).toBe(0);
  });

  it("denies a shared-demo actor: reporting.maintain is not demo-granted", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.adminA,
      kind: "shared_demo",
      organizationId: fixture.organizationA,
      storeId: fixture.storeA,
    });

    await expect(
      t.run((ctx) =>
        getHandler(correctSkuValuation)(ctx, correctionArgs(fixture, {})),
      ),
    ).rejects.toThrow();

    const sku = await t.run((ctx) => ctx.db.get("productSku", fixture.skuA));
    expect(sku?.inventoryCount).toBe(10);
    expect(await countCorrections(t)).toBe(0);
  });

  it("denies a full admin from another organization", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await expect(
      t.run((ctx) =>
        getHandler(correctSkuValuation)(
          asAdmitted(ctx, fixture.adminB),
          correctionArgs(fixture, {}),
        ),
      ),
    ).rejects.toThrow(REPORTS_ACCESS_DENIED);

    expect(await countCorrections(t)).toBe(0);
  });

  it("denies a store the caller does not administer", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await expect(
      t.run((ctx) =>
        getHandler(correctSkuValuation)(
          asAdmitted(ctx, fixture.adminA),
          correctionArgs(fixture, { storeId: fixture.storeB }),
        ),
      ),
    ).rejects.toThrow(REPORTS_ACCESS_DENIED);

    expect(await countCorrections(t)).toBe(0);
  });
});
