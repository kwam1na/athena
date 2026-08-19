import { beforeEach, describe, expect, it, vi } from "vitest";

import { AthenaUnauthenticatedError } from "../lib/athenaUnauthenticated";
import { ATHENA_CAPABILITY_CATALOG } from "../platform/capabilityCatalog";
import { SHARED_DEMO_ALLOWED_CAPABILITIES } from "../platform/capabilityCatalog";
import { SHARED_DEMO_ALLOWED_READ_INTENTS } from "../sharedDemo/policy";
import { INVENTORY_CATALOG_DEFINITIONS } from "../operationAdmission/domains/inventoryCatalog_definitions";
import { INVENTORY_CATALOG_READ_DEFINITIONS } from "../operationAdmission/domains/inventoryCatalog_readDefinitions";
import { validateOperationDefinition } from "../operationAdmission/definitions";
import { validateReadOperationDefinition } from "../operationAdmission/readDefinitions";

const mocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  requireStoreFullAdminAccess: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/athenaUserAuth")
  >("../lib/athenaUserAuth");
  return {
    ...actual,
    requireAuthenticatedAthenaUserWithCtx:
      mocks.requireAuthenticatedAthenaUserWithCtx,
    requireOrganizationMemberRoleWithCtx:
      mocks.requireOrganizationMemberRoleWithCtx,
  };
});

vi.mock("../sharedDemo/actor", async () => {
  const actual = await vi.importActual<typeof import("../sharedDemo/actor")>(
    "../sharedDemo/actor",
  );
  return {
    ...actual,
    getSharedDemoActorWithCtx: mocks.getSharedDemoActorWithCtx,
  };
});

vi.mock("../stockOps/access", async () => {
  const actual = await vi.importActual<typeof import("../stockOps/access")>(
    "../stockOps/access",
  );
  return {
    ...actual,
    requireStoreFullAdminAccess: mocks.requireStoreFullAdminAccess,
  };
});

import * as bannerMessage from "./bannerMessage";
import * as bestSeller from "./bestSeller";
import * as categories from "./categories";
import * as colors from "./colors";
import * as complimentaryProduct from "./complimentaryProduct";
import * as featuredItem from "./featuredItem";
import * as products from "./products";
import * as productSku from "./productSku";
import * as promoCode from "./promoCode";
import * as skuSearch from "./skuSearch";
import * as storeSchedule from "./storeSchedule";
import * as subcategories from "./subcategories";
import { admitOperationWithCtx } from "../platform/operationAdmission";

const DEMO_ENV = {
  ATHENA_SHARED_DEMO_ENABLED: "true",
  ATHENA_SHARED_DEMO_ATHENA_USER_ID: "demo-user",
  ATHENA_SHARED_DEMO_ORGANIZATION_ID: "demo-org",
  ATHENA_SHARED_DEMO_STORE_ID: "demo-store",
  STAGE: "qa",
};

const DEMO_DENIAL = /shared_demo_action_denied|isn't allowed in the demo/;

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

/**
 * A context whose every row resolves to the demo foundation store, so a bound
 * `target` guard fires no matter which table the definition looks the row up in.
 */
function demoFoundationCtx() {
  const writes = {
    delete: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    replace: vi.fn(),
  };
  return {
    auth: { getUserIdentity: vi.fn().mockResolvedValue(null) },
    db: {
      ...writes,
      get: vi.fn(async (table: string, id: string) => ({
        _id: id,
        _creationTime: 1,
        storeId: "demo-store",
        organizationId: "demo-org",
        productId: "product-1",
        categoryId: "category-1",
        subcategoryId: "subcategory-1",
        images: [],
        name: table,
      })),
      normalizeId: vi.fn((_table: string, id: string) => id),
      query: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        Object.assign(chain, {
          collect: vi.fn(async () => []),
          filter: self,
          first: vi.fn(async () => null),
          order: self,
          paginate: vi.fn(async () => ({
            page: [],
            continueCursor: "",
            isDone: true,
          })),
          take: vi.fn(async () => []),
          unique: vi.fn(async () => null),
          withIndex: self,
        });
        return chain;
      }),
    },
    scheduler: { runAfter: vi.fn(), runAt: vi.fn() },
    storage: { generateUploadUrl: vi.fn() },
    writes,
  };
}

beforeEach(() => {
  for (const [key, value] of Object.entries(DEMO_ENV)) vi.stubEnv(key, value);
  // A NORMAL, fully-privileged Athena admin. The foundation guard must still
  // deny them: it protects rows, not actors.
  mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
    _id: "athena-user-1",
    email: "admin@example.com",
  } as never);
  mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
    _id: "member-1",
    role: "full_admin",
  } as never);
  mocks.requireStoreFullAdminAccess.mockResolvedValue({
    athenaUser: { _id: "athena-user-1" },
    store: { _id: "demo-store", organizationId: "demo-org" },
  } as never);
  mocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Definition contract
// ---------------------------------------------------------------------------

describe("U3 inventory catalog operation definitions", () => {
  const knownCapabilities = new Set(
    ATHENA_CAPABILITY_CATALOG.map(({ id }) => id),
  );

  it("declares 50 write definitions and 38 read definitions", () => {
    expect(INVENTORY_CATALOG_DEFINITIONS.length).toBe(50);
    expect(INVENTORY_CATALOG_READ_DEFINITIONS.length).toBe(38);
  });

  it("validates every write definition against the rail contract", () => {
    for (const definition of INVENTORY_CATALOG_DEFINITIONS) {
      expect(
        validateOperationDefinition(definition),
        definition.operationId,
      ).toEqual([]);
      expect(knownCapabilities.has(definition.capability as never)).toBe(true);
    }
  });

  it("validates every read definition against the rail contract", () => {
    for (const definition of INVENTORY_CATALOG_READ_DEFINITIONS) {
      expect(
        validateReadOperationDefinition(definition),
        definition.operationId,
      ).toEqual([]);
    }
  });

  it("denies the shared demo on every catalog write", () => {
    const granted = new Set<string>(SHARED_DEMO_ALLOWED_CAPABILITIES);
    for (const definition of INVENTORY_CATALOG_DEFINITIONS) {
      expect(definition.actors.sharedDemo, definition.operationId).toBe("deny");
      // The denial is not arbitrary: none of these capabilities is granted.
      expect(granted.has(definition.capability as string)).toBe(false);
    }
  });

  it("denies anonymous callers on every catalog write", () => {
    for (const definition of INVENTORY_CATALOG_DEFINITIONS) {
      expect(definition.actors.public, definition.operationId).toBe("deny");
    }
  });

  it("admits anonymous readers only on the reads storefront routes serve", () => {
    const anonymous = INVENTORY_CATALOG_READ_DEFINITIONS.filter(
      (definition) => definition.actors.public === "admit",
    ).map((definition) => definition.functionName);

    expect(anonymous.sort()).toEqual(
      [
        "inventory/bannerMessage:getPublicActive",
        "inventory/bestSeller:getAll",
        "inventory/categories:getAll",
        "inventory/colors:getAll",
        "inventory/featuredItem:getAll",
        "inventory/products:getByIdOrSlug",
        "inventory/promoCode:getAll",
        "inventory/subcategories:getAll",
      ].sort(),
    );
  });

  it("only admits the demo on reads whose intent is granted", () => {
    const granted = new Set<string>(SHARED_DEMO_ALLOWED_READ_INTENTS);
    for (const definition of INVENTORY_CATALOG_READ_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(granted.has(definition.access.intent), definition.operationId).toBe(
        true,
      );
    }
  });

  it("binds a target guard on every write that used to call requireNonDemoFoundation*", () => {
    const guarded = INVENTORY_CATALOG_DEFINITIONS.filter(
      (definition) => definition.target !== undefined,
    ).map((definition) => definition.functionName);

    expect(guarded.sort()).toEqual(
      [
        "inventory/categories:create",
        "inventory/categories:remove",
        "inventory/categories:update",
        "inventory/colors:create",
        "inventory/colors:remove",
        "inventory/colors:update",
        "inventory/complimentaryProduct:batchCreateComplimentaryProducts",
        "inventory/complimentaryProduct:createCollection",
        "inventory/complimentaryProduct:createComplimentaryProduct",
        "inventory/complimentaryProduct:toggleCollectionActive",
        "inventory/complimentaryProduct:toggleComplimentaryProductActive",
        "inventory/productSku:deleteImages",
        "inventory/productSku:update",
        "inventory/productSku:uploadImages",
        "inventory/products:archive",
        "inventory/products:batchUpdateSkuPrices",
        "inventory/products:create",
        "inventory/products:createSku",
        "inventory/products:removeAllProductsForStore",
        "inventory/products:removeSku",
        "inventory/products:unarchive",
        "inventory/products:update",
        "inventory/products:updateSku",
        "inventory/promoCode:create",
        "inventory/promoCode:remove",
        "inventory/promoCode:update",
        "inventory/subcategories:create",
        "inventory/subcategories:remove",
        "inventory/subcategories:update",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Target guards: a normal full admin still cannot mutate a foundation row
// ---------------------------------------------------------------------------

const FOUNDATION_GUARD_CASES: Array<[string, unknown, Record<string, unknown>]> =
  [
    ["categories:create", categories.create, { storeId: "demo-store" }],
    ["categories:update", categories.update, { id: "category-1" }],
    ["categories:remove", categories.remove, { id: "category-1" }],
    ["colors:create", colors.create, { storeId: "demo-store" }],
    ["colors:update", colors.update, { id: "color-1", name: "Red" }],
    ["colors:remove", colors.remove, { id: "color-1" }],
    [
      "complimentaryProduct:createCollection",
      complimentaryProduct.createCollection,
      {
        name: "Gifts",
        storeId: "demo-store",
        organizationId: "demo-org",
        isActive: true,
        createdByUserId: "athena-user-1",
      },
    ],
    [
      "complimentaryProduct:createComplimentaryProduct",
      complimentaryProduct.createComplimentaryProduct,
      {
        productSkuId: "sku-1",
        storeId: "demo-store",
        organizationId: "demo-org",
        isActive: true,
        createdByUserId: "athena-user-1",
      },
    ],
    [
      "complimentaryProduct:batchCreateComplimentaryProducts",
      complimentaryProduct.batchCreateComplimentaryProducts,
      {
        productSkuIds: ["sku-1"],
        storeId: "demo-store",
        organizationId: "demo-org",
        isActive: true,
        createdByUserId: "athena-user-1",
      },
    ],
    [
      "complimentaryProduct:toggleComplimentaryProductActive",
      complimentaryProduct.toggleComplimentaryProductActive,
      { complimentaryProductId: "comp-1", isActive: false },
    ],
    [
      "complimentaryProduct:toggleCollectionActive",
      complimentaryProduct.toggleCollectionActive,
      { collectionId: "collection-1", isActive: false },
    ],
    [
      "productSku:update",
      productSku.update,
      { id: "sku-1", update: { images: ["a.webp"] } },
    ],
    ["products:create", products.create, { storeId: "demo-store" }],
    ["products:createSku", products.createSku, { productId: "product-1" }],
    ["products:updateSku", products.updateSku, { id: "sku-1" }],
    ["products:update", products.update, { id: "product-1" }],
    [
      "products:archive",
      products.archive,
      { id: "product-1", storeId: "demo-store" },
    ],
    [
      "products:unarchive",
      products.unarchive,
      { id: "product-1", storeId: "demo-store" },
    ],
    ["products:removeSku", products.removeSku, { id: "sku-1" }],
    [
      "products:removeAllProductsForStore",
      products.removeAllProductsForStore,
      { storeId: "demo-store" },
    ],
    [
      "products:batchUpdateSkuPrices",
      products.batchUpdateSkuPrices,
      { updates: [{ id: "sku-1", price: 10, netPrice: 9 }] },
    ],
    [
      "promoCode:create",
      promoCode.create,
      {
        storeId: "demo-store",
        code: "SAVE",
        discountType: "amount",
        discountValue: 1,
        displayText: "Save",
        validFrom: 0,
        validTo: 1,
        span: "entire-order",
        createdByUserId: "athena-user-1",
      },
    ],
    ["promoCode:remove", promoCode.remove, { id: "promo-1" }],
    ["promoCode:update", promoCode.update, { id: "promo-1" }],
    ["subcategories:create", subcategories.create, { storeId: "demo-store" }],
    ["subcategories:update", subcategories.update, { id: "subcategory-1" }],
    ["subcategories:remove", subcategories.remove, { id: "subcategory-1" }],
  ];

describe("demo foundation rows stay unmutable for a normal full admin", () => {
  it.each(FOUNDATION_GUARD_CASES)(
    "%s denies the write and performs none of it",
    async (_name, fn, args) => {
      const ctx = demoFoundationCtx();

      await expect(getHandler(fn)(ctx, args)).rejects.toThrow(DEMO_DENIAL);

      expect(ctx.writes.insert).not.toHaveBeenCalled();
      expect(ctx.writes.patch).not.toHaveBeenCalled();
      expect(ctx.writes.delete).not.toHaveBeenCalled();
      expect(ctx.writes.replace).not.toHaveBeenCalled();
    },
  );

  // The two productSku actions admit through the registered internal mutation
  // rather than `admitPublicMutation`, so the guard is asserted there.
  it("denies uploadImages for a foundation store at the admission entry point", async () => {
    const ctx = demoFoundationCtx();

    await expect(
      admitOperationWithCtx(ctx as never, {
        operationId: "inventory.productSku.uploadImages",
        operationArgs: {
          images: [],
          storeId: "demo-store",
          productId: "product-1",
        },
      }),
    ).rejects.toThrow(DEMO_DENIAL);
  });

  it("denies deleteImages for foundation-store image refs", async () => {
    const ctx = demoFoundationCtx();

    await expect(
      admitOperationWithCtx(ctx as never, {
        operationId: "inventory.productSku.deleteImages",
        operationArgs: {
          imageUrls: ["https://cdn.example/stores/demo-store/products/a.webp"],
        },
      }),
    ).rejects.toThrow(DEMO_DENIAL);
  });

  it("leaves a non-foundation store writable", async () => {
    const ctx = demoFoundationCtx();
    ctx.db.get = vi.fn(async (_table: string, id: string) => ({
      _id: id,
      _creationTime: 1,
      storeId: "tenant-store",
      organizationId: "tenant-org",
      name: "Colour",
    })) as never;

    await expect(
      getHandler(colors.update)(ctx, { id: "color-1", name: "Red" }),
    ).resolves.toBeDefined();
    expect(ctx.writes.patch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Actor coverage
// ---------------------------------------------------------------------------

const ACTOR_CASES: Array<[string, unknown, Record<string, unknown>]> = [
  ["bannerMessage:upsert", bannerMessage.upsert, { storeId: "tenant-store" }],
  ["bannerMessage:remove", bannerMessage.remove, { id: "banner-1" }],
  ["bestSeller:create", bestSeller.create, { storeId: "tenant-store" }],
  ["bestSeller:remove", bestSeller.remove, { id: "best-1" }],
  ["bestSeller:updateRanks", bestSeller.updateRanks, { ranks: [] }],
  ["categories:create", categories.create, { storeId: "tenant-store" }],
  ["colors:create", colors.create, { storeId: "tenant-store" }],
  ["featuredItem:create", featuredItem.create, { storeId: "tenant-store" }],
  ["featuredItem:remove", featuredItem.remove, { id: "featured-1" }],
  ["products:create", products.create, { storeId: "tenant-store" }],
  [
    "productSku:generateUploadUrl",
    productSku.generateUploadUrl,
    {},
  ],
  [
    "productSku:nukeProblematicImages",
    productSku.nukeProblematicImages,
    {},
  ],
  [
    "skuSearch:repairProductSkuSearchPage",
    skuSearch.repairProductSkuSearchPage,
    { paginationOpts: { numItems: 10, cursor: null }, storeId: "tenant-store" },
  ],
  [
    "skuSearch:removeStaleProductSkuSearchPage",
    skuSearch.removeStaleProductSkuSearchPage,
    { paginationOpts: { numItems: 10, cursor: null }, storeId: "tenant-store" },
  ],
  ["subcategories:create", subcategories.create, { storeId: "tenant-store" }],
];

describe("catalog write admission by actor", () => {
  it.each(ACTOR_CASES)(
    "%s denies an unauthenticated caller before any write",
    async (_name, fn, args) => {
      const ctx = demoFoundationCtx();
      mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
        new AthenaUnauthenticatedError(),
      );

      await expect(getHandler(fn)(ctx, args)).rejects.toThrow(
        "Sign in again to continue.",
      );

      expect(ctx.writes.insert).not.toHaveBeenCalled();
      expect(ctx.writes.patch).not.toHaveBeenCalled();
      expect(ctx.writes.delete).not.toHaveBeenCalled();
    },
  );

  it.each(ACTOR_CASES)(
    "%s denies a shared-demo visitor before any write",
    async (_name, fn, args) => {
      const ctx = demoFoundationCtx();
      mocks.getSharedDemoActorWithCtx.mockResolvedValue({
        kind: "shared_demo",
        athenaUserId: "demo-user",
        authUserId: "auth-user",
        organizationId: "demo-org",
        storeId: "demo-store",
      } as never);

      await expect(getHandler(fn)(ctx, args)).rejects.toThrow(DEMO_DENIAL);

      expect(ctx.writes.insert).not.toHaveBeenCalled();
      expect(ctx.writes.patch).not.toHaveBeenCalled();
      expect(ctx.writes.delete).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// Read admission
// ---------------------------------------------------------------------------

describe("catalog read admission", () => {
  it("denies an unauthenticated reader on an operator-only read", async () => {
    const ctx = demoFoundationCtx();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError(),
    );

    await expect(
      getHandler(storeSchedule.getStoreScheduleSummary)(ctx, {
        storeId: "tenant-store",
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("admits an anonymous reader on a storefront-route read", async () => {
    const ctx = demoFoundationCtx();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError(),
    );

    await expect(
      getHandler(categories.getAll)(ctx, { storeId: "tenant-store" }),
    ).resolves.toEqual([]);
  });

  it("denies a shared-demo reader on an ungranted read intent", async () => {
    const ctx = demoFoundationCtx();
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      kind: "shared_demo",
      athenaUserId: "demo-user",
      authUserId: "auth-user",
      organizationId: "demo-org",
      storeId: "demo-store",
    } as never);

    await expect(
      getHandler(storeSchedule.getStoreScheduleSummary)(ctx, {
        storeId: "demo-store",
      }),
    ).rejects.toThrow(DEMO_DENIAL);
  });

  it("denies a shared-demo reader whose store does not match the request", async () => {
    const ctx = demoFoundationCtx();
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      kind: "shared_demo",
      athenaUserId: "demo-user",
      authUserId: "auth-user",
      organizationId: "demo-org",
      storeId: "demo-store",
    } as never);

    await expect(
      getHandler(categories.getAll)(ctx, { storeId: "other-store" }),
    ).rejects.toThrow(DEMO_DENIAL);
  });

  it("admits a shared-demo reader inside its own store", async () => {
    const ctx = demoFoundationCtx();
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      kind: "shared_demo",
      athenaUserId: "demo-user",
      authUserId: "auth-user",
      organizationId: "demo-org",
      storeId: "demo-store",
    } as never);

    await expect(
      getHandler(categories.getAll)(ctx, { storeId: "demo-store" }),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Internal siblings
// ---------------------------------------------------------------------------

describe("internal siblings behave like their public originals", () => {
  const SIBLINGS: Array<[string, unknown, unknown, Record<string, unknown>]> = [
    [
      "categories:getAll",
      categories.getAll,
      categories.getAllInternal,
      { storeId: "tenant-store" },
    ],
    [
      "colors:getAll",
      colors.getAll,
      colors.getAllInternal,
      { storeId: "tenant-store" },
    ],
    [
      "subcategories:getAll",
      subcategories.getAll,
      subcategories.getAllInternal,
      { storeId: "tenant-store" },
    ],
    [
      "promoCode:getAll",
      promoCode.getAll,
      promoCode.getAllInternal,
      { storeId: "tenant-store" },
    ],
  ];

  it.each(SIBLINGS)(
    "%s returns the same value from both exports",
    async (_name, publicFn, internalFn, args) => {
      const publicResult = await getHandler(publicFn)(
        demoFoundationCtx(),
        args,
      );
      const internalResult = await getHandler(internalFn)(
        demoFoundationCtx(),
        args,
      );

      expect(internalResult).toEqual(publicResult);
    },
  );

  it("exposes an internal sibling for every route-reached catalog read", () => {
    expect(typeof getHandler(bannerMessage.getPublicActiveInternal)).toBe(
      "function",
    );
    expect(typeof getHandler(bestSeller.getAllInternal)).toBe("function");
    expect(typeof getHandler(featuredItem.getAllInternal)).toBe("function");
    expect(typeof getHandler(products.getAllInternal)).toBe("function");
    expect(typeof getHandler(products.getByIdOrSlugInternal)).toBe("function");
  });
});
