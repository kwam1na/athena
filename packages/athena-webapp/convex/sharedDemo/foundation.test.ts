import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireNonDemoFoundationMutation } from "./foundation";
import * as organizations from "../inventory/organizations";
import * as stores from "../inventory/stores";
import * as categories from "../inventory/categories";
import * as productSku from "../inventory/productSku";
import { create as createInvite } from "../inventory/inviteCode";

const env = {
  ATHENA_SHARED_DEMO_ENABLED: "true",
  ATHENA_SHARED_DEMO_ATHENA_USER_ID: "demo-user",
  ATHENA_SHARED_DEMO_ORGANIZATION_ID: "demo-org",
  ATHENA_SHARED_DEMO_STORE_ID: "demo-store",
  STAGE: "qa",
};

describe("shared demo foundation guard", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  });
  it.each([
    { athenaUserId: "demo-user" },
    { organizationId: "demo-org" },
    { storeId: "demo-store" },
  ])("denies configured foundation IDs without relying on auth", (ids) => {
    expect(() => requireNonDemoFoundationMutation(ids as never, env)).toThrow(
      "This action isn't allowed in the demo.",
    );
  });

  it("preserves normal tenant mutations", () => {
    expect(() =>
      requireNonDemoFoundationMutation({ storeId: "normal-store" as never }, env),
    ).not.toThrow();
  });

  it.each([
    [organizations.create, { createdByUserId: "demo-user" }],
    [organizations.update, { id: "demo-org", name: "Changed" }],
    [organizations.remove, { id: "demo-org" }],
    [stores.create, { organizationId: "demo-org" }],
    [stores.update, { id: "demo-store", name: "Changed" }],
    [stores.remove, { id: "demo-store" }],
  ] as const)("protects the actual signed-out public handler", async (fn, args) => {
    const ctx = { auth: { getUserIdentity: vi.fn().mockResolvedValue(null) }, db: { delete: vi.fn(), insert: vi.fn(), patch: vi.fn() } };
    await expect((fn as any)._handler(ctx, args)).rejects.toThrow(
      /This action isn't allowed in the demo|Sign in again to continue/,
    );
    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it.each([
    [createInvite, { organizationId: "demo-org", createdByUserId: "demo-user" }],
    [stores.patchConfigV2, { id: "demo-store", patch: {} }],
    [stores.patchConfigV2Command, { id: "demo-store", patch: {} }],
    [categories.create, { storeId: "demo-store" }],
    [categories.update, { id: "category-1" }],
    [categories.remove, { id: "category-1" }],
    [productSku.update, { id: "sku-1", update: { images: ["x"] } }],
    [productSku.uploadImages, { images: [], productId: "product-1", storeId: "demo-store" }],
    [productSku.deleteImages, { imageUrls: ["https://cdn.invalid/stores/demo-store/products/x.webp"] }],
  ] as const)("denies a signed-out demo descendant/configuration handler", async (fn, args) => {
    const ctx = {
      auth: { getUserIdentity: vi.fn().mockResolvedValue(null) },
      runQuery: vi.fn().mockRejectedValue(new Error("Sign in again to continue.")),
      db: {
        get: vi.fn().mockImplementation((_table, id) =>
          id === "category-1" || id === "sku-1"
            ? Promise.resolve({ _id: id, storeId: "demo-store" })
            : Promise.resolve(null)),
        delete: vi.fn(), insert: vi.fn(), patch: vi.fn(), query: vi.fn(),
      },
    };
    await expect((fn as any)._handler(ctx, args)).rejects.toThrow(
      /This action isn't allowed in the demo|Sign in again to continue/,
    );
    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
