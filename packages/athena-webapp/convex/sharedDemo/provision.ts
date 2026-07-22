import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { env, internalMutation, type MutationCtx } from "../_generated/server";
import {
  SHARED_DEMO_CATEGORY,
  SHARED_DEMO_OPENING_MESSAGE,
  SHARED_DEMO_PICKUP_ORDER,
  SHARED_DEMO_PRODUCT_IMAGE_VERSION,
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_STAFF_STORY,
  SHARED_DEMO_STORE_IDENTITY,
  SHARED_DEMO_SUBCATEGORIES,
  SHARED_DEMO_TERMINAL_DISPLAY_NAME,
  sharedDemoPickupOrderAmount,
  sharedDemoPickupOrderTimeline,
  sharedDemoProductBySku,
  sharedDemoProductImageUrl,
  type SharedDemoProductStory,
  type SharedDemoSubcategoryKey,
} from "../../shared/sharedDemoStory";
import {
  removeProductSkuSearchProjection,
  upsertProductSkuSearchProjection,
} from "../inventory/skuSearch";
import {
  createStaffCredentialWithCtx,
  getStaffCredentialByStaffProfileIdWithCtx,
  updateStaffCredentialWithCtx,
} from "../operations/staffCredentials";
import {
  deleteRegisterSessionWithAuthority,
  insertRegisterSessionWithAuthority,
} from "../operations/registerSessionAuthorityRevision";
import { hashPosTerminalSyncSecret } from "../pos/application/sync/terminalSyncSecret";
import {
  calculateSharedDemoExpectedCash,
  SHARED_DEMO_BASELINE_VERSION,
  SHARED_DEMO_CASH_SEED,
  SHARED_DEMO_CASHIER_STAFF_CODE,
  SHARED_DEMO_MANAGER_STAFF_CODE,
  SHARED_DEMO_REGISTER_NUMBER,
  SHARED_DEMO_TIME_ZONE,
} from "./config";
export {
  calculateSharedDemoExpectedCash,
  SHARED_DEMO_CASH_SEED,
} from "./config";
import {
  captureBaselineDocumentsWithCtx,
  countMutableDemoStoreRowsWithCtx,
  promoteBaselineDocumentsWithCtx,
  restoreMutableDemoStoreRowsWithCtx,
  SHARED_DEMO_MUTABLE_TABLES,
} from "./domainRestore";
import {
  buildSharedDemoOpeningBaseline,
  buildSharedDemoStoreDayEvent,
  rollSharedDemoOpeningBaselineWithCtx,
  sharedDemoOperatingDateRange,
} from "./openingBaseline";

export const SHARED_DEMO_SEED = {
  version: SHARED_DEMO_BASELINE_VERSION,
  domains: ["pos", "inventory", "cash", "orders", "staff", "operations"],
  organizationSlug: "demo",
  storeSlug: "central",
  ownerEmail: "store@osustudio.com",
  timeZone: SHARED_DEMO_TIME_ZONE,
} as const;

export const SHARED_DEMO_CASHIER_USERNAME =
  SHARED_DEMO_STAFF_STORY.cashier.username;
export const SHARED_DEMO_MANAGER_USERNAME =
  SHARED_DEMO_STAFF_STORY.manager.username;
export const SHARED_DEMO_STAFF_PIN_HASH =
  "4e98d5fe6eb03fb40d229e19013fc8b1505fdbacebcb225b409d75f656acc82b";

export function sharedDemoMigrationSkipTables(baselineVersion: number) {
  if (baselineVersion < 3) {
    return ["productSkuSearch", "registerSession"] as const;
  }
  return ["registerSession"] as const;
}

export function planSharedDemoMigration(baselineVersion: number) {
  const migrationClassifications = {
    11: "reset_operational_state",
    12: "reset_operational_state",
    13: "reset_operational_state",
    14: "reset_operational_state",
    15: "reset_operational_state",
    16: "preserve_operational_continuity",
    17: "preserve_operational_continuity",
    18: "preserve_operational_continuity",
  } as const;
  const mode =
    migrationClassifications[
      baselineVersion as keyof typeof migrationClassifications
    ];
  if (!mode || SHARED_DEMO_BASELINE_VERSION !== 19) {
    throw new Error(
      `Shared demo baseline migration ${baselineVersion}->${SHARED_DEMO_BASELINE_VERSION} is not registered.`,
    );
  }
  return { mode };
}

export function buildSharedDemoContinuityMigrationStatePatch(now: number) {
  return {
    baselineVersion: SHARED_DEMO_BASELINE_VERSION,
    completedAt: now,
  } as const;
}

export function transformSharedDemoStaffStoryBaselineDocument(
  row: {
    document: Record<string, unknown>;
    tableName: string;
  },
  staffProfileIds: { cashier: string; manager: string },
) {
  if (row.tableName === "staffProfile") {
    const story =
      row.document.staffCode === SHARED_DEMO_CASHIER_STAFF_CODE
        ? SHARED_DEMO_STAFF_STORY.cashier
        : row.document.staffCode === SHARED_DEMO_MANAGER_STAFF_CODE
          ? SHARED_DEMO_STAFF_STORY.manager
          : null;
    if (story) {
      return {
        ...row.document,
        firstName: story.firstName,
        fullName: story.fullName,
        jobTitle: story.jobTitle,
        lastName: story.lastName,
      };
    }
  }
  if (row.tableName === "staffCredential") {
    const username =
      row.document.staffProfileId === staffProfileIds.cashier
        ? SHARED_DEMO_CASHIER_USERNAME
        : row.document.staffProfileId === staffProfileIds.manager
          ? SHARED_DEMO_MANAGER_USERNAME
          : null;
    if (username) {
      return {
        ...row.document,
        pinHash: SHARED_DEMO_STAFF_PIN_HASH,
        status: "active",
        username,
      };
    }
  }
  if (row.tableName === "staffMessage") {
    return { ...row.document, body: SHARED_DEMO_OPENING_MESSAGE };
  }
  return row.document;
}

export function transformSharedDemoCatalogImageBaselineDocument(row: {
  document: Record<string, unknown>;
  tableName: string;
}) {
  if (
    row.tableName !== "productSku" &&
    row.tableName !== "productSkuSearch"
  ) {
    return row.document;
  }
  const product = SHARED_DEMO_PRODUCTS.find(
    (candidate) => candidate.sku === row.document.sku,
  );
  if (!product) return row.document;
  const images = Array.isArray(row.document.images)
    ? row.document.images.map((image) =>
        typeof image === "string"
          ? image.replace(
              /\/products\/shared-demo\/v\d+\//,
              `/products/shared-demo/${SHARED_DEMO_PRODUCT_IMAGE_VERSION}/`,
            )
          : image,
      )
    : row.document.images;
  return { ...row.document, images };
}

export function validateSharedDemoSeed(seed: typeof SHARED_DEMO_SEED) {
  const errors: string[] = [];
  if (new Set(seed.domains).size !== 6) errors.push("six domains required");
  if (seed.ownerEmail !== "store@osustudio.com")
    errors.push("Osu Studio owner email required");
  if (!seed.organizationSlug || !seed.storeSlug)
    errors.push("stable slugs required");
  return errors;
}

export function sharedDemoBootstrapSeedMatches(input: {
  inventoryMovementCount: number;
  messageBodies: string[];
  openingCount: number;
  orderItems: Array<{
    isReady?: boolean;
    price: number;
    productSku: string;
    quantity: number;
  }>;
  orders: Array<{
    amount: number;
    hasVerifiedPayment?: boolean;
    orderNumber: string;
    paymentDue?: number;
    status: string;
  }>;
  posTransactionCount: number;
  productSkus: Array<{
    images: string[];
    inventoryCount: number;
    price: number;
    quantityAvailable: number;
    sku?: string;
    unitCost?: number;
  }>;
  products: Array<{
    inventoryCount: number;
    name: string;
    quantityAvailable?: number;
    slug: string;
  }>;
  registerSessions: Array<{
    expectedCash: number;
    openingFloat: number;
    registerNumber?: string;
    status: string;
  }>;
  seedEventCount: number;
  staffCredentials: Array<{
    authenticationLockedUntil?: number;
    failedAuthenticationAttempts?: number;
    lastAuthenticatedAt?: number;
    pinHash?: string;
    status: string;
    username: string;
  }>;
  staffProfiles: Array<{
    fullName: string;
    staffCode?: string;
    status: string;
  }>;
}) {
  const [order] = input.orders;
  const [item] = input.orderItems;
  const [session] = input.registerSessions;
  const credentialsArePristine =
    input.staffCredentials.length === 2 &&
    [SHARED_DEMO_CASHIER_USERNAME, SHARED_DEMO_MANAGER_USERNAME].every(
      (username) =>
        input.staffCredentials.some(
          (credential) =>
            credential.username === username &&
            credential.pinHash === SHARED_DEMO_STAFF_PIN_HASH &&
            credential.status === "active" &&
            credential.failedAuthenticationAttempts === undefined &&
            credential.authenticationLockedUntil === undefined &&
            credential.lastAuthenticatedAt === undefined,
        ),
    );
  const orderAmount = sharedDemoPickupOrderAmount();
  const catalogIsPristine =
    input.products.length === SHARED_DEMO_PRODUCTS.length &&
    input.productSkus.length === SHARED_DEMO_PRODUCTS.length &&
    SHARED_DEMO_PRODUCTS.every(
      (storyProduct) =>
        input.products.some(
          (candidate) =>
            candidate.slug === storyProduct.slug &&
            candidate.name === storyProduct.name &&
            candidate.inventoryCount === storyProduct.inventoryCount &&
            candidate.quantityAvailable === storyProduct.inventoryCount,
        ) &&
        input.productSkus.some(
          (candidate) =>
            candidate.sku === storyProduct.sku &&
            candidate.images.length === 1 &&
            candidate.images[0]?.endsWith(
              `/products/shared-demo/${SHARED_DEMO_PRODUCT_IMAGE_VERSION}/${storyProduct.imageFilename}`,
            ) &&
            candidate.price === storyProduct.price &&
            candidate.unitCost === storyProduct.unitCost &&
            candidate.inventoryCount === storyProduct.inventoryCount &&
            candidate.quantityAvailable === storyProduct.inventoryCount,
        ),
    );
  return (
    catalogIsPristine &&
    input.orders.length === 1 &&
    order?.orderNumber === SHARED_DEMO_PICKUP_ORDER.orderNumber &&
    order.status === "ready" &&
    order.amount === orderAmount &&
    order.paymentDue === orderAmount &&
    order.hasVerifiedPayment === true &&
    input.orderItems.length === 1 &&
    item?.productSku === SHARED_DEMO_PICKUP_ORDER.sku &&
    item.quantity === SHARED_DEMO_PICKUP_ORDER.quantity &&
    item.price === orderAmount &&
    item.isReady === true &&
    input.registerSessions.length === 1 &&
    session?.registerNumber === SHARED_DEMO_REGISTER_NUMBER &&
    session.status === "active" &&
    session.openingFloat === SHARED_DEMO_CASH_SEED.openingFloat &&
    session.expectedCash ===
      calculateSharedDemoExpectedCash(SHARED_DEMO_CASH_SEED) &&
    input.messageBodies.length === 1 &&
    input.messageBodies[0] === SHARED_DEMO_OPENING_MESSAGE &&
    input.openingCount === 1 &&
    input.seedEventCount === 1 &&
    input.staffProfiles.length === 3 &&
    input.staffProfiles.some(
      (profile) =>
        profile.fullName === SHARED_DEMO_STAFF_STORY.owner.fullName &&
        profile.status === "active",
    ) &&
    input.staffProfiles.some(
      (profile) =>
        profile.staffCode === SHARED_DEMO_CASHIER_STAFF_CODE &&
        profile.fullName === SHARED_DEMO_STAFF_STORY.cashier.fullName &&
        profile.status === "active",
    ) &&
    input.staffProfiles.some(
      (profile) =>
        profile.staffCode === SHARED_DEMO_MANAGER_STAFF_CODE &&
        profile.fullName === SHARED_DEMO_STAFF_STORY.manager.fullName &&
        profile.status === "active",
    ) &&
    credentialsArePristine &&
    input.posTransactionCount === 0 &&
    input.inventoryMovementCount === 0
  );
}

export const SHARED_DEMO_PRISTINE_TABLE_COUNTS: Record<string, number> = {
  ...Object.fromEntries(
    SHARED_DEMO_MUTABLE_TABLES.map(({ tableName }) => [tableName, 0]),
  ),
  dailyOpening: 1,
  onlineOrder: 1,
  onlineOrderItem: 1,
  operationalEvent: 1,
  product: SHARED_DEMO_PRODUCTS.length,
  productSku: SHARED_DEMO_PRODUCTS.length,
  productSkuSearch: SHARED_DEMO_PRODUCTS.length,
  registerSession: 1,
  staffCredential: 2,
  staffMessage: 1,
  staffProfile: 3,
};

export function sharedDemoPristineTableCountsMatch(
  counts: Record<string, number>,
) {
  const tableNames = SHARED_DEMO_MUTABLE_TABLES.map(
    ({ tableName }) => tableName,
  );
  return (
    Object.keys(counts).length === tableNames.length &&
    tableNames.every(
      (tableName) =>
        counts[tableName] === SHARED_DEMO_PRISTINE_TABLE_COUNTS[tableName],
    )
  );
}

export function sharedDemoCheckoutSessionMatchesOrder(
  checkoutSession: { placedOrderId?: string; storeId: string } | null,
  order: { _id: string; storeId: string },
) {
  return (
    checkoutSession?.storeId === order.storeId &&
    checkoutSession.placedOrderId === order._id
  );
}

function sharedDemoProductImages(
  product: SharedDemoProductStory,
  storeId: Id<"store">,
) {
  const publicUrl = env.R2_PUBLIC_URL;
  if (!publicUrl) {
    throw new Error("The shared demo product image host is not configured.");
  }
  return [sharedDemoProductImageUrl({ product, publicUrl, storeId })];
}

async function ensureDemoRoleAssignmentWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Id<"organization">;
    role: "cashier" | "manager";
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    now: number;
  },
) {
  const assignments = await ctx.db
    .query("staffRoleAssignment")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", args.staffProfileId),
    )
    .take(20);
  const existing = assignments.find(
    (assignment) => assignment.role === args.role,
  );
  if (existing) {
    if (existing.status !== "active" || !existing.isPrimary) {
      await ctx.db.patch("staffRoleAssignment", existing._id, {
        isPrimary: true,
        status: "active",
      });
    }
    return;
  }

  await ctx.db.insert("staffRoleAssignment", {
    assignedAt: args.now,
    isPrimary: true,
    organizationId: args.organizationId,
    role: args.role,
    staffProfileId: args.staffProfileId,
    status: "active",
    storeId: args.storeId,
  });
}

async function ensureDemoCredentialWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Id<"organization">;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    username: string;
  },
) {
  const existing = await getStaffCredentialByStaffProfileIdWithCtx(
    ctx,
    args.staffProfileId,
  );
  if (!existing) {
    await createStaffCredentialWithCtx(ctx, {
      ...args,
      pinHash: SHARED_DEMO_STAFF_PIN_HASH,
    });
    return;
  }

  if (
    existing.username !== args.username ||
    existing.pinHash !== SHARED_DEMO_STAFF_PIN_HASH ||
    existing.status !== "active"
  ) {
    await updateStaffCredentialWithCtx(ctx, {
      organizationId: args.organizationId,
      pinHash: SHARED_DEMO_STAFF_PIN_HASH,
      staffCredentialId: existing._id,
      status: "active",
      storeId: args.storeId,
      username: args.username,
    });
  }
}

async function ensureDemoStaffAccessWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    now: number;
    organizationId: Id<"organization">;
    ownerUserId: Id<"athenaUser">;
    storeId: Id<"store">;
  },
) {
  const staffProfiles = await ctx.db
    .query("staffProfile")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(100);
  const cashier = staffProfiles.find(
    (profile) => profile.staffCode === SHARED_DEMO_CASHIER_STAFF_CODE,
  );
  if (!cashier) throw new Error("Demo cashier is missing.");

  let manager = staffProfiles.find(
    (profile) => profile.staffCode === SHARED_DEMO_MANAGER_STAFF_CODE,
  );
  if (!manager) {
    const managerId = await ctx.db.insert("staffProfile", {
      createdByUserId: args.ownerUserId,
      firstName: SHARED_DEMO_STAFF_STORY.manager.firstName,
      fullName: SHARED_DEMO_STAFF_STORY.manager.fullName,
      jobTitle: SHARED_DEMO_STAFF_STORY.manager.jobTitle,
      lastName: SHARED_DEMO_STAFF_STORY.manager.lastName,
      memberRole: "full_admin",
      organizationId: args.organizationId,
      staffCode: SHARED_DEMO_MANAGER_STAFF_CODE,
      status: "active",
      storeId: args.storeId,
    });
    const createdManager = await ctx.db.get("staffProfile", managerId);
    if (!createdManager) throw new Error("Demo manager is missing.");
    manager = createdManager;
  }
  if (!manager) throw new Error("Demo manager is missing.");

  await ensureDemoRoleAssignmentWithCtx(ctx, {
    ...args,
    role: "cashier",
    staffProfileId: cashier._id,
  });
  await ensureDemoRoleAssignmentWithCtx(ctx, {
    ...args,
    role: "manager",
    staffProfileId: manager._id,
  });
  await ensureDemoCredentialWithCtx(ctx, {
    organizationId: args.organizationId,
    staffProfileId: cashier._id,
    storeId: args.storeId,
    username: SHARED_DEMO_CASHIER_USERNAME,
  });
  await ensureDemoCredentialWithCtx(ctx, {
    organizationId: args.organizationId,
    staffProfileId: manager._id,
    storeId: args.storeId,
    username: SHARED_DEMO_MANAGER_USERNAME,
  });
  return { cashier, manager };
}

async function reconcileSharedDemoCatalogWithCtx(
  ctx: MutationCtx,
  args: {
    ownerUserId: Id<"athenaUser">;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
  },
) {
  const categories = await ctx.db
    .query("category")
    .withIndex("by_storeId_slug", (q) => q.eq("storeId", args.storeId))
    .take(50);
  let category =
    categories.find((row) => row.slug === SHARED_DEMO_CATEGORY.slug) ??
    categories[0];
  if (!category) {
    const categoryId = await ctx.db.insert("category", {
      name: SHARED_DEMO_CATEGORY.name,
      showOnStorefront: true,
      slug: SHARED_DEMO_CATEGORY.slug,
      storeId: args.storeId,
    });
    const createdCategory = await ctx.db.get("category", categoryId);
    if (!createdCategory) throw new Error("Demo category is missing.");
    category = createdCategory;
  } else if (
    category.name !== SHARED_DEMO_CATEGORY.name ||
    category.slug !== SHARED_DEMO_CATEGORY.slug
  ) {
    await ctx.db.patch("category", category._id, {
      name: SHARED_DEMO_CATEGORY.name,
      slug: SHARED_DEMO_CATEGORY.slug,
    });
  }

  const subcategories = await ctx.db
    .query("subcategory")
    .withIndex("by_categoryId_slug", (q) => q.eq("categoryId", category._id))
    .take(50);
  const claimed = new Set<string>();
  const subcategoryIds = new Map<SharedDemoSubcategoryKey, Id<"subcategory">>();
  for (const target of SHARED_DEMO_SUBCATEGORIES) {
    const existing =
      subcategories.find((row) => row.slug === target.slug) ??
      subcategories.find(
        (row) =>
          !claimed.has(String(row._id)) &&
          !SHARED_DEMO_SUBCATEGORIES.some((entry) => entry.slug === row.slug),
      );
    if (existing) {
      claimed.add(String(existing._id));
      if (existing.name !== target.name || existing.slug !== target.slug) {
        await ctx.db.patch("subcategory", existing._id, {
          name: target.name,
          slug: target.slug,
        });
      }
      subcategoryIds.set(target.key, existing._id);
      continue;
    }
    subcategoryIds.set(
      target.key,
      await ctx.db.insert("subcategory", {
        categoryId: category._id,
        name: target.name,
        slug: target.slug,
        storeId: args.storeId,
      }),
    );
  }

  // Replace the catalog wholesale rather than patching rows in place: SKU
  // inventory fields are owned by the reporting pipeline, and the pickup
  // order is repointed at the fresh identities right after this runs.
  const products = await ctx.db
    .query("product")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(500);
  const productSkus = await ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(500);
  for (const row of productSkus) {
    await removeProductSkuSearchProjection(ctx, row._id);
    await ctx.db.delete("productSku", row._id);
  }
  for (const row of products) {
    await ctx.db.delete("product", row._id);
  }

  const identityBySku = new Map<
    string,
    { productId: Id<"product">; productSkuId: Id<"productSku"> }
  >();
  for (const storyProduct of SHARED_DEMO_PRODUCTS) {
    const subcategoryId = subcategoryIds.get(storyProduct.subcategoryKey);
    if (!subcategoryId) throw new Error("Demo subcategory is missing.");
    const productId = await ctx.db.insert("product", {
      availability: "live" as const,
      categoryId: category._id,
      createdByUserId: args.ownerUserId,
      currency: SHARED_DEMO_STORE_IDENTITY.currency,
      inventoryCount: storyProduct.inventoryCount,
      isVisible: true,
      name: storyProduct.name,
      organizationId: args.organizationId,
      posVisible: true,
      quantityAvailable: storyProduct.inventoryCount,
      slug: storyProduct.slug,
      storeId: args.storeId,
      subcategoryId,
    });
    const productSkuId = await ctx.db.insert("productSku", {
      images: sharedDemoProductImages(storyProduct, args.storeId),
      inventoryCount: storyProduct.inventoryCount,
      isVisible: true,
      posVisible: true,
      price: storyProduct.price,
      productId,
      productName: storyProduct.name,
      quantityAvailable: storyProduct.inventoryCount,
      sku: storyProduct.sku,
      storeId: args.storeId,
      unitCost: storyProduct.unitCost,
    });
    await upsertProductSkuSearchProjection(ctx, productSkuId);
    identityBySku.set(storyProduct.sku, { productId, productSkuId });
  }
  return identityBySku;
}

async function migrateSharedDemoStoryWithCtx(
  ctx: MutationCtx,
  args: {
    ownerUserId: Id<"athenaUser">;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
  },
) {
  await ctx.db.patch("organization", args.organizationId, {
    name: SHARED_DEMO_STORE_IDENTITY.organizationName,
  });
  await ctx.db.patch("store", args.storeId, {
    name: SHARED_DEMO_STORE_IDENTITY.storeName,
  });
  await ctx.db.patch("athenaUser", args.ownerUserId, {
    firstName: SHARED_DEMO_STAFF_STORY.owner.firstName,
    lastName: SHARED_DEMO_STAFF_STORY.owner.lastName,
  });

  const staffProfiles = await ctx.db
    .query("staffProfile")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(100);
  const staffPatches: Array<{
    profile: (typeof staffProfiles)[number] | undefined;
    story: {
      firstName: string;
      fullName: string;
      jobTitle: string;
      lastName: string;
    };
  }> = [
    {
      profile: staffProfiles.find(
        (row) => row.linkedUserId === args.ownerUserId,
      ),
      story: SHARED_DEMO_STAFF_STORY.owner,
    },
    {
      profile: staffProfiles.find(
        (row) => row.staffCode === SHARED_DEMO_CASHIER_STAFF_CODE,
      ),
      story: SHARED_DEMO_STAFF_STORY.cashier,
    },
    {
      profile: staffProfiles.find(
        (row) => row.staffCode === SHARED_DEMO_MANAGER_STAFF_CODE,
      ),
      story: SHARED_DEMO_STAFF_STORY.manager,
    },
  ];
  for (const { profile, story } of staffPatches) {
    if (!profile) continue;
    await ctx.db.patch("staffProfile", profile._id, {
      firstName: story.firstName,
      fullName: story.fullName,
      jobTitle: story.jobTitle,
      lastName: story.lastName,
    });
  }

  const messages = await ctx.db
    .query("staffMessage")
    .withIndex("by_storeId_createdAt", (q) => q.eq("storeId", args.storeId))
    .take(10);
  if (messages[0] && messages[0].body !== SHARED_DEMO_OPENING_MESSAGE) {
    await ctx.db.patch("staffMessage", messages[0]._id, {
      body: SHARED_DEMO_OPENING_MESSAGE,
    });
  }

  const terminals = await ctx.db
    .query("posTerminal")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(50);
  const templateTerminal = terminals.find(
    (terminal) => terminal.fingerprintHash === "shared-demo-terminal",
  );
  for (const terminal of terminals) {
    if (
      terminal._id !== templateTerminal?._id &&
      terminal.registerNumber === SHARED_DEMO_REGISTER_NUMBER
    ) {
      await ctx.db.patch("posTerminal", terminal._id, {
        registerNumber: undefined,
      });
    }
  }
  if (templateTerminal) {
    await ctx.db.patch("posTerminal", templateTerminal._id, {
      displayName: SHARED_DEMO_TERMINAL_DISPLAY_NAME,
      registerNumber: SHARED_DEMO_REGISTER_NUMBER,
    });
  }

  const identityBySku = await reconcileSharedDemoCatalogWithCtx(ctx, args);
  const orderProduct = sharedDemoProductBySku(SHARED_DEMO_PICKUP_ORDER.sku);
  const orderIdentity = identityBySku.get(SHARED_DEMO_PICKUP_ORDER.sku);
  if (!orderIdentity) throw new Error("Demo pickup order product is missing.");
  const orderAmount = sharedDemoPickupOrderAmount();
  const orders = await ctx.db
    .query("onlineOrder")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(20);
  const pickupOrder = orders.find(
    (row) => row.orderNumber === SHARED_DEMO_PICKUP_ORDER.orderNumber,
  );
  if (!pickupOrder) throw new Error("Demo order is missing.");
  await ctx.db.patch("onlineOrder", pickupOrder._id, {
    amount: orderAmount,
    customerDetails: {
      email: SHARED_DEMO_PICKUP_ORDER.customerEmail,
      firstName: SHARED_DEMO_PICKUP_ORDER.customerFirstName,
      lastName: SHARED_DEMO_PICKUP_ORDER.customerLastName,
      phoneNumber: SHARED_DEMO_PICKUP_ORDER.customerPhoneNumber,
    },
    paymentDue: orderAmount,
  });
  const orderItems = await ctx.db
    .query("onlineOrderItem")
    .withIndex("by_orderId", (q) => q.eq("orderId", pickupOrder._id))
    .take(20);
  for (const orderItem of orderItems) {
    await ctx.db.patch("onlineOrderItem", orderItem._id, {
      price: orderProduct.price,
      productId: orderIdentity.productId,
      productName: orderProduct.name,
      productSku: orderProduct.sku,
      productSkuId: orderIdentity.productSkuId,
      quantity: SHARED_DEMO_PICKUP_ORDER.quantity,
    });
  }
  const checkoutSession = await ctx.db.get(
    "checkoutSession",
    pickupOrder.checkoutSessionId,
  );
  if (checkoutSession && checkoutSession.amount !== orderAmount) {
    await ctx.db.patch("checkoutSession", pickupOrder.checkoutSessionId, {
      amount: orderAmount,
    });
  }
}

export const provisionSharedDemo = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const existingOrganization = await ctx.db
      .query("organization")
      .withIndex("by_slug", (q) =>
        q.eq("slug", SHARED_DEMO_SEED.organizationSlug),
      )
      .unique();
    const existingStore = existingOrganization
      ? await ctx.db
          .query("store")
          .withIndex("by_organizationId_slug", (q) =>
            q
              .eq("organizationId", existingOrganization._id)
              .eq("slug", SHARED_DEMO_SEED.storeSlug),
          )
          .unique()
      : null;
    if (existingOrganization || existingStore) {
      if (
        !existingOrganization ||
        !existingStore ||
        existingStore.config?.sharedDemo !== true
      )
        throw new Error("Demo foundation is incomplete.");
      const owner = await ctx.db
        .query("athenaUser")
        .withIndex("by_normalizedEmail", (q) =>
          q.eq("normalizedEmail", SHARED_DEMO_SEED.ownerEmail),
        )
        .unique();
      if (!owner) throw new Error("Demo owner is missing.");
      const state = await ctx.db
        .query("sharedDemoRestoreState")
        .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
        .unique();
      if (!state) {
        await ensureDemoStaffAccessWithCtx(ctx, {
          now,
          organizationId: existingOrganization._id,
          ownerUserId: owner._id,
          storeId: existingStore._id,
        });
        const [
          products,
          productSkus,
          orders,
          terminals,
          sessions,
          openings,
          events,
          messages,
          transactions,
          movements,
          staffProfiles,
          staffCredentials,
        ] = await Promise.all([
          ctx.db
            .query("product")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("productSku")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("onlineOrder")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("posTerminal")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("registerSession")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("dailyOpening")
            .withIndex("by_storeId_operatingDate", (q) =>
              q.eq("storeId", existingStore._id),
            )
            .take(500),
          ctx.db
            .query("operationalEvent")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("staffMessage")
            .withIndex("by_storeId_createdAt", (q) =>
              q.eq("storeId", existingStore._id),
            )
            .take(500),
          ctx.db
            .query("posTransaction")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("inventoryMovement")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("staffProfile")
            .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
            .take(500),
          ctx.db
            .query("staffCredential")
            .withIndex("by_storeId_status", (q) =>
              q.eq("storeId", existingStore._id),
            )
            .take(500),
        ]);
        const demoOrder = orders.find(
          (order) => order.orderNumber === "DEMO-ORDER-001",
        );
        const orderItems = demoOrder
          ? await ctx.db
              .query("onlineOrderItem")
              .withIndex("by_orderId", (q) => q.eq("orderId", demoOrder._id))
              .take(500)
          : [];
        for (const storyProduct of SHARED_DEMO_PRODUCTS) {
          const demoSku = productSkus.find(
            (sku) => sku.sku === storyProduct.sku,
          );
          if (demoSku) await upsertProductSkuSearchProjection(ctx, demoSku._id);
        }
        await rollSharedDemoOpeningBaselineWithCtx(ctx, {
          now,
          storeId: existingStore._id,
        });
        const mutableTableCounts = await countMutableDemoStoreRowsWithCtx(
          ctx,
          existingStore._id,
        );
        const foundationIsComplete =
          sharedDemoPristineTableCountsMatch(mutableTableCounts) &&
          sharedDemoBootstrapSeedMatches({
            inventoryMovementCount: movements.length,
            messageBodies: messages.map((message) => message.body),
            openingCount: openings.length,
            orderItems,
            orders,
            posTransactionCount: transactions.length,
            products,
            productSkus,
            registerSessions: sessions,
            seedEventCount: events.filter(
              (event) =>
                event.eventType === "demo.store_day_started" ||
                event.eventType === "demo.store_ready",
            ).length,
            staffCredentials,
            staffProfiles,
          }) &&
          terminals.some(
            (terminal) =>
              terminal.registerNumber === SHARED_DEMO_REGISTER_NUMBER,
          ) &&
          terminals.filter(
            (terminal) =>
              terminal.registerNumber === SHARED_DEMO_REGISTER_NUMBER,
          ).length === 1;
        if (!foundationIsComplete)
          throw new Error("Demo foundation is incomplete.");
        await ctx.db.insert("sharedDemoRestoreState", {
          baselineVersion: SHARED_DEMO_BASELINE_VERSION,
          completedAt: now,
          epoch: 0,
          status: "ready",
          storeId: existingStore._id,
        });
        const captured = await captureBaselineDocumentsWithCtx(ctx, {
          storeId: existingStore._id,
        });
        if (captured.captured === 0)
          throw new Error("Demo baseline capture is empty.");
        return {
          athenaUserId: owner._id,
          kind: "bootstrapped" as const,
          organizationId: existingOrganization._id,
          storeId: existingStore._id,
        };
      }
      if (state.baselineVersion > SHARED_DEMO_BASELINE_VERSION)
        throw new Error("Demo baseline version is invalid.");
      if (state.baselineVersion < SHARED_DEMO_BASELINE_VERSION) {
        const migrationPlan = planSharedDemoMigration(state.baselineVersion);
        if (migrationPlan.mode === "preserve_operational_continuity") {
          const { cashier, manager } = await ensureDemoStaffAccessWithCtx(ctx, {
            now,
            organizationId: existingOrganization._id,
            ownerUserId: owner._id,
            storeId: existingStore._id,
          });
          await ctx.db.patch("staffProfile", cashier._id, {
            firstName: SHARED_DEMO_STAFF_STORY.cashier.firstName,
            fullName: SHARED_DEMO_STAFF_STORY.cashier.fullName,
            jobTitle: SHARED_DEMO_STAFF_STORY.cashier.jobTitle,
            lastName: SHARED_DEMO_STAFF_STORY.cashier.lastName,
          });
          await ctx.db.patch("staffProfile", manager._id, {
            firstName: SHARED_DEMO_STAFF_STORY.manager.firstName,
            fullName: SHARED_DEMO_STAFF_STORY.manager.fullName,
            jobTitle: SHARED_DEMO_STAFF_STORY.manager.jobTitle,
            lastName: SHARED_DEMO_STAFF_STORY.manager.lastName,
          });
          const messages = await ctx.db
            .query("staffMessage")
            .withIndex("by_storeId_createdAt", (q) =>
              q.eq("storeId", existingStore._id),
            )
            .take(10);
          if (messages[0]) {
            await ctx.db.patch("staffMessage", messages[0]._id, {
              body: SHARED_DEMO_OPENING_MESSAGE,
            });
          }
          await reconcileSharedDemoCatalogWithCtx(ctx, {
            organizationId: existingOrganization._id,
            ownerUserId: owner._id,
            storeId: existingStore._id,
          });
          const promotedStaffStoryRows = new Set<string>();
          const promoted = await promoteBaselineDocumentsWithCtx(ctx, {
            fromVersion: state.baselineVersion,
            storeId: existingStore._id,
            transformDocument: (row) => {
              if (row.tableName === "staffProfile") {
                if (row.document.staffCode === SHARED_DEMO_CASHIER_STAFF_CODE) {
                  promotedStaffStoryRows.add("cashier-profile");
                }
                if (row.document.staffCode === SHARED_DEMO_MANAGER_STAFF_CODE) {
                  promotedStaffStoryRows.add("manager-profile");
                }
              }
              if (row.tableName === "staffCredential") {
                if (row.document.staffProfileId === cashier._id) {
                  promotedStaffStoryRows.add("cashier-credential");
                }
                if (row.document.staffProfileId === manager._id) {
                  promotedStaffStoryRows.add("manager-credential");
                }
              }
              if (row.tableName === "staffMessage") {
                promotedStaffStoryRows.add("opening-message");
              }
              return transformSharedDemoCatalogImageBaselineDocument({
                ...row,
                document: transformSharedDemoStaffStoryBaselineDocument(row, {
                  cashier: cashier._id,
                  manager: manager._id,
                }),
              });
            },
          });
          if (promoted.promoted === 0 || promotedStaffStoryRows.size !== 5) {
            throw new Error("Demo staff story baseline could not be promoted.");
          }
          const baselineRows = await ctx.db
            .query("sharedDemoBaselineRow")
            .withIndex("by_storeId", (q) =>
              q.eq("storeId", existingStore._id),
            )
            .take(20);
          for (const baselineRow of baselineRows) {
            await ctx.db.patch("sharedDemoBaselineRow", baselineRow._id, {
              baselineVersion: SHARED_DEMO_BASELINE_VERSION,
            });
          }
          await ctx.db.patch("sharedDemoRestoreState", state._id, {
            ...buildSharedDemoContinuityMigrationStatePatch(now),
          });
          return {
            athenaUserId: owner._id,
            kind: "migrated" as const,
            organizationId: existingOrganization._id,
            storeId: existingStore._id,
          };
        }
        await restoreMutableDemoStoreRowsWithCtx(ctx, existingStore._id, {
          baselineVersion: state.baselineVersion,
          skipTables: sharedDemoMigrationSkipTables(state.baselineVersion),
        });
        await migrateSharedDemoStoryWithCtx(ctx, {
          organizationId: existingOrganization._id,
          ownerUserId: owner._id,
          storeId: existingStore._id,
        });
        const orders = await ctx.db
          .query("onlineOrder")
          .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
          .take(20);
        const demoOrder = orders.find(
          (order) => order.orderNumber === "DEMO-ORDER-001",
        );
        if (!demoOrder) throw new Error("Demo order is missing.");
        const demoCardPaymentMethod = {
          bank: "Demo Bank",
          brand: "Visa",
          channel: "card",
          last4: "4242",
          type: "online_payment" as const,
        };
        await ctx.db.patch("onlineOrder", demoOrder._id, {
          externalTransactionId: "shared-demo-card-payment-001",
          hasVerifiedPayment: true,
          isPODOrder: false,
          paymentCollected: undefined,
          paymentCollectedAt: undefined,
          paymentDue: sharedDemoPickupOrderAmount(),
          paymentMethod: demoCardPaymentMethod,
          podPaymentMethod: undefined,
        });
        let checkoutSessionId = demoOrder.checkoutSessionId;
        const existingCheckoutSession = await ctx.db.get(
          "checkoutSession",
          checkoutSessionId,
        );
        if (
          !sharedDemoCheckoutSessionMatchesOrder(
            existingCheckoutSession,
            demoOrder,
          )
        ) {
          checkoutSessionId = await ctx.db.insert("checkoutSession", {
            amount: demoOrder.amount,
            bagId: demoOrder.bagId,
            billingDetails: demoOrder.billingDetails,
            customerDetails: demoOrder.customerDetails,
            deliveryDetails: demoOrder.deliveryDetails,
            deliveryFee: demoOrder.deliveryFee,
            deliveryInstructions: demoOrder.deliveryInstructions,
            deliveryMethod:
              demoOrder.deliveryMethod === "delivery" ||
              demoOrder.deliveryMethod === "pickup"
                ? demoOrder.deliveryMethod
                : undefined,
            deliveryOption: demoOrder.deliveryOption,
            discount: demoOrder.discount,
            expiresAt: now + 86_400_000,
            hasCompletedCheckoutSession: true,
            hasCompletedPayment: true,
            hasVerifiedPayment: true,
            isFinalizingPayment: false,
            isPODOrder: false,
            paymentMethod: demoCardPaymentMethod,
            pickupLocation: demoOrder.pickupLocation,
            placedOrderId: demoOrder._id,
            storeFrontUserId: demoOrder.storeFrontUserId,
            storeId: existingStore._id,
          });
          await ctx.db.patch("onlineOrder", demoOrder._id, {
            checkoutSessionId,
          });
        }
        await ctx.db.patch("checkoutSession", checkoutSessionId, {
          hasCompletedPayment: true,
          hasVerifiedPayment: true,
          isPODOrder: false,
          paymentMethod: demoCardPaymentMethod,
        });
        const productSkus = await ctx.db
          .query("productSku")
          .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
          .take(500);
        for (const productSku of productSkus) {
          await upsertProductSkuSearchProjection(ctx, productSku._id);
          const reportingPositions = await ctx.db
            .query("reportingInventoryPosition")
            .withIndex("by_storeId_productSkuId", (q) =>
              q
                .eq("storeId", existingStore._id)
                .eq("productSkuId", productSku._id),
            )
            .take(2);
          if (reportingPositions.length > 1) {
            throw new Error("Demo reporting inventory is ambiguous.");
          }
          if (reportingPositions[0]) {
            await ctx.db.patch(
              "reportingInventoryPosition",
              reportingPositions[0]._id,
              {
                onHandQuantity: productSku.inventoryCount,
                sellableQuantity: productSku.quantityAvailable,
                updatedAt: now,
              },
            );
          }
        }
        const { manager } = await ensureDemoStaffAccessWithCtx(ctx, {
          now,
          organizationId: existingOrganization._id,
          ownerUserId: owner._id,
          storeId: existingStore._id,
        });
        const transactions = await ctx.db
          .query("posTransaction")
          .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
          .take(500);
        const seededTransactions = transactions.filter(
          (transaction) =>
            transaction.registerNumber === SHARED_DEMO_REGISTER_NUMBER,
        );
        const inventoryMovements = await ctx.db
          .query("inventoryMovement")
          .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
          .take(500);
        for (const transaction of seededTransactions) {
          const items = await ctx.db
            .query("posTransactionItem")
            .withIndex("by_transactionId", (q) =>
              q.eq("transactionId", transaction._id),
            )
            .take(500);
          for (const item of items) {
            await ctx.db.delete("posTransactionItem", item._id);
          }
          for (const movement of inventoryMovements) {
            if (movement.posTransactionId === transaction._id) {
              await ctx.db.delete("inventoryMovement", movement._id);
            }
          }
          await ctx.db.delete("posTransaction", transaction._id);
        }
        const registerSessions = await ctx.db
          .query("registerSession")
          .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
          .take(500);
        for (const session of registerSessions) {
          await deleteRegisterSessionWithAuthority(ctx, session._id);
        }
        const terminals = await ctx.db
          .query("posTerminal")
          .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
          .take(500);
        let templateTerminal = terminals.find(
          (terminal) =>
            terminal.fingerprintHash === "shared-demo-terminal" &&
            terminal.status === "active",
        );
        if (
          templateTerminal &&
          templateTerminal.registerNumber !== SHARED_DEMO_REGISTER_NUMBER
        ) {
          await ctx.db.patch("posTerminal", templateTerminal._id, {
            registerNumber: SHARED_DEMO_REGISTER_NUMBER,
          });
          templateTerminal = {
            ...templateTerminal,
            registerNumber: SHARED_DEMO_REGISTER_NUMBER,
          };
        }
        if (!templateTerminal) {
          const terminalId = await ctx.db.insert("posTerminal", {
            browserInfo: {
              platform: "shared_demo",
              userAgent: "Athena Demo",
            },
            displayName: SHARED_DEMO_TERMINAL_DISPLAY_NAME,
            fingerprintHash: "shared-demo-terminal",
            heartbeatEnabled: false,
            loginMode: "pos_only",
            registerNumber: SHARED_DEMO_REGISTER_NUMBER,
            registeredAt: now,
            registeredByUserId: owner._id,
            status: "active",
            storeId: existingStore._id,
            syncSecretHash: await hashPosTerminalSyncSecret(
              "shared-demo-non-secret-terminal-seed",
            ),
            transactionCapability: "products_and_services",
          });
          const createdTerminal = await ctx.db.get("posTerminal", terminalId);
          if (!createdTerminal) throw new Error("Demo register is missing.");
          templateTerminal = createdTerminal;
        }
        if (!templateTerminal) throw new Error("Demo register is missing.");
        const registerSessionRange = sharedDemoOperatingDateRange(now);
        await insertRegisterSessionWithAuthority(ctx, {
          expectedCash: calculateSharedDemoExpectedCash(SHARED_DEMO_CASH_SEED),
          openedAt: Math.max(registerSessionRange.startAt, now - 14_400_000),
          openedByStaffProfileId: manager._id,
          openedByUserId: owner._id,
          openedOperatingDate: registerSessionRange.operatingDate,
          openedOperatingDateEndAt: registerSessionRange.endAt,
          openedOperatingDateStartAt: registerSessionRange.startAt,
          openingFloat: SHARED_DEMO_CASH_SEED.openingFloat,
          organizationId: existingOrganization._id,
          registerNumber: SHARED_DEMO_REGISTER_NUMBER,
          status: "active",
          storeId: existingStore._id,
          terminalId: templateTerminal._id,
        });
        const cashActivities = await ctx.db
          .query("posRegisterSessionActivity")
          .withIndex("by_store_registerSession_sequence", (q) =>
            q.eq("storeId", existingStore._id),
          )
          .take(500);
        for (const activity of cashActivities) {
          if (activity.activityKey === "shared-demo:cash:opening") {
            await ctx.db.delete("posRegisterSessionActivity", activity._id);
          }
        }
        const openings = await ctx.db
          .query("dailyOpening")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", existingStore._id),
          )
          .take(500);
        for (const opening of openings)
          await ctx.db.delete("dailyOpening", opening._id);
        const dailyOpeningId = await ctx.db.insert(
          "dailyOpening",
          buildSharedDemoOpeningBaseline({
            actorStaffProfileId: manager._id,
            actorUserId: owner._id,
            now,
            organizationId: existingOrganization._id,
            storeId: existingStore._id,
          }),
        );
        const events = await ctx.db
          .query("operationalEvent")
          .withIndex("by_storeId", (q) => q.eq("storeId", existingStore._id))
          .take(500);
        const seedEvent = events.find(
          (event) =>
            event.eventType === "daily_opening_acknowledged" ||
            event.eventType === "demo.store_day_started" ||
            event.eventType === "demo.store_ready",
        );
        if (!seedEvent)
          throw new Error("Demo operating narrative is incomplete.");
        await ctx.db.replace(
          "operationalEvent",
          seedEvent._id,
          buildSharedDemoStoreDayEvent({
            actorStaffProfileId: manager._id,
            actorUserId: owner._id,
            dailyOpeningId,
            now,
            organizationId: existingOrganization._id,
            storeId: existingStore._id,
          }),
        );
        await ctx.db.patch("sharedDemoRestoreState", state._id, {
          appliedAt: undefined,
          baselineVersion: SHARED_DEMO_BASELINE_VERSION,
          cleanupTerminalIds: undefined,
          completedAt: now,
          epoch: state.epoch + 1,
          failureCode: undefined,
          idempotencyKey: undefined,
          phase: undefined,
          restoredDocuments: undefined,
          restoreSource: undefined,
          startedAt: undefined,
          status: "ready",
        });
        await captureBaselineDocumentsWithCtx(ctx, {
          storeId: existingStore._id,
        });
        return {
          athenaUserId: owner._id,
          kind: "migrated" as const,
          organizationId: existingOrganization._id,
          storeId: existingStore._id,
        };
      }
      return {
        athenaUserId: owner._id,
        kind: "existing" as const,
        organizationId: existingOrganization._id,
        storeId: existingStore._id,
      };
    }

    const ownerUserId = await ctx.db.insert("athenaUser", {
      email: SHARED_DEMO_SEED.ownerEmail,
      normalizedEmail: SHARED_DEMO_SEED.ownerEmail,
      firstName: SHARED_DEMO_STAFF_STORY.owner.firstName,
      lastName: SHARED_DEMO_STAFF_STORY.owner.lastName,
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: ownerUserId,
      name: SHARED_DEMO_STORE_IDENTITY.organizationName,
      slug: SHARED_DEMO_SEED.organizationSlug,
    });
    await ctx.db.patch("athenaUser", ownerUserId, { organizationId });
    await ctx.db.insert("organizationMember", {
      organizationId,
      operationalRoles: ["manager"],
      role: "full_admin",
      userId: ownerUserId,
    });
    const storeId = await ctx.db.insert("store", {
      config: {
        // Osu Studio's cash policy: any drawer variance — even a few cedis —
        // waits for a manager's signoff. This is what gates the story's GH₵5
        // shortage into "manager approval pending" (see the register session
        // scene on the landing page); without it the closeout gate would clear
        // a sub-threshold variance on its own.
        operations: {
          cashControls: { requireManagerSignoffForAnyVariance: true },
        },
        sharedDemo: true,
        timeZone: SHARED_DEMO_SEED.timeZone,
      },
      createdByUserId: ownerUserId,
      currency: SHARED_DEMO_STORE_IDENTITY.currency,
      name: SHARED_DEMO_STORE_IDENTITY.storeName,
      organizationId,
      slug: SHARED_DEMO_SEED.storeSlug,
    });
    const ownerStaffId = await ctx.db.insert("staffProfile", {
      createdByUserId: ownerUserId,
      firstName: SHARED_DEMO_STAFF_STORY.owner.firstName,
      fullName: SHARED_DEMO_STAFF_STORY.owner.fullName,
      jobTitle: SHARED_DEMO_STAFF_STORY.owner.jobTitle,
      lastName: SHARED_DEMO_STAFF_STORY.owner.lastName,
      linkedUserId: ownerUserId,
      memberRole: "full_admin",
      organizationId,
      status: "active",
      storeId,
    });
    await ctx.db.insert("staffProfile", {
      createdByUserId: ownerUserId,
      firstName: SHARED_DEMO_STAFF_STORY.cashier.firstName,
      fullName: SHARED_DEMO_STAFF_STORY.cashier.fullName,
      jobTitle: SHARED_DEMO_STAFF_STORY.cashier.jobTitle,
      lastName: SHARED_DEMO_STAFF_STORY.cashier.lastName,
      memberRole: "pos_only",
      organizationId,
      staffCode: SHARED_DEMO_CASHIER_STAFF_CODE,
      status: "active",
      storeId,
    });
    const { manager } = await ensureDemoStaffAccessWithCtx(ctx, {
      now,
      organizationId,
      ownerUserId,
      storeId,
    });
    await ctx.db.insert("staffMessage", {
      authorUserId: ownerUserId,
      body: SHARED_DEMO_OPENING_MESSAGE,
      createdAt: now - 2_700_000,
      organizationId,
      storeId,
      updatedAt: now - 2_700_000,
    });
    const categoryId = await ctx.db.insert("category", {
      name: SHARED_DEMO_CATEGORY.name,
      showOnStorefront: true,
      slug: SHARED_DEMO_CATEGORY.slug,
      storeId,
    });
    const subcategoryIds = new Map<
      SharedDemoSubcategoryKey,
      Id<"subcategory">
    >();
    for (const subcategory of SHARED_DEMO_SUBCATEGORIES) {
      subcategoryIds.set(
        subcategory.key,
        await ctx.db.insert("subcategory", {
          categoryId,
          name: subcategory.name,
          slug: subcategory.slug,
          storeId,
        }),
      );
    }
    const identityBySku = new Map<
      string,
      { productId: Id<"product">; productSkuId: Id<"productSku"> }
    >();
    for (const storyProduct of SHARED_DEMO_PRODUCTS) {
      const subcategoryId = subcategoryIds.get(storyProduct.subcategoryKey);
      if (!subcategoryId) throw new Error("Demo subcategory is missing.");
      const productId = await ctx.db.insert("product", {
        availability: "live",
        categoryId,
        createdByUserId: ownerUserId,
        currency: SHARED_DEMO_STORE_IDENTITY.currency,
        inventoryCount: storyProduct.inventoryCount,
        isVisible: true,
        name: storyProduct.name,
        organizationId,
        posVisible: true,
        quantityAvailable: storyProduct.inventoryCount,
        slug: storyProduct.slug,
        storeId,
        subcategoryId,
      });
      const productSkuId = await ctx.db.insert("productSku", {
        images: sharedDemoProductImages(storyProduct, storeId),
        inventoryCount: storyProduct.inventoryCount,
        isVisible: true,
        posVisible: true,
        price: storyProduct.price,
        productId,
        productName: storyProduct.name,
        quantityAvailable: storyProduct.inventoryCount,
        sku: storyProduct.sku,
        storeId,
        unitCost: storyProduct.unitCost,
      });
      await upsertProductSkuSearchProjection(ctx, productSkuId);
      identityBySku.set(storyProduct.sku, { productId, productSkuId });
    }
    const orderProduct = sharedDemoProductBySku(SHARED_DEMO_PICKUP_ORDER.sku);
    const orderIdentity = identityBySku.get(SHARED_DEMO_PICKUP_ORDER.sku);
    if (!orderIdentity)
      throw new Error("Demo pickup order product is missing.");
    const orderAmount = sharedDemoPickupOrderAmount();
    const pickupOrderTimeline = sharedDemoPickupOrderTimeline(now);
    const terminalId = await ctx.db.insert("posTerminal", {
      browserInfo: { platform: "shared_demo", userAgent: "Athena Demo" },
      displayName: SHARED_DEMO_TERMINAL_DISPLAY_NAME,
      fingerprintHash: "shared-demo-terminal",
      heartbeatEnabled: false,
      loginMode: "pos_only",
      registerNumber: SHARED_DEMO_REGISTER_NUMBER,
      registeredAt: now,
      registeredByUserId: ownerUserId,
      status: "active",
      storeId,
      syncSecretHash: await hashPosTerminalSyncSecret(
        "shared-demo-non-secret-terminal-seed",
      ),
      transactionCapability: "products_and_services",
    });
    const registerSessionRange = sharedDemoOperatingDateRange(now);
    const registerOpenedAt = Math.max(
      registerSessionRange.startAt,
      now - 14_400_000,
    );
    await insertRegisterSessionWithAuthority(ctx, {
      expectedCash: calculateSharedDemoExpectedCash(SHARED_DEMO_CASH_SEED),
      openedAt: registerOpenedAt,
      openedByStaffProfileId: manager._id,
      openedByUserId: ownerUserId,
      openedOperatingDate: registerSessionRange.operatingDate,
      openedOperatingDateEndAt: registerSessionRange.endAt,
      openedOperatingDateStartAt: registerSessionRange.startAt,
      openingFloat: SHARED_DEMO_CASH_SEED.openingFloat,
      organizationId,
      registerNumber: SHARED_DEMO_REGISTER_NUMBER,
      status: "active",
      storeId,
      terminalId,
    });
    const guestId = await ctx.db.insert("guest", {
      creationOrigin: "shared_demo",
      marker: "shared-demo-customer",
      organizationId,
      storeId,
    });
    const bagId = await ctx.db.insert("bag", {
      items: [],
      storeFrontUserId: guestId,
      storeId,
      updatedAt: now,
    });
    const checkoutSessionId = await ctx.db.insert("checkoutSession", {
      amount: orderAmount,
      bagId,
      billingDetails: null,
      customerDetails: null,
      deliveryDetails: null,
      deliveryFee: 0,
      deliveryInstructions: null,
      deliveryMethod: "pickup",
      deliveryOption: null,
      discount: null,
      expiresAt: now + 86_400_000,
      hasCompletedCheckoutSession: true,
      hasCompletedPayment: true,
      hasVerifiedPayment: true,
      isFinalizingPayment: false,
      isPODOrder: false,
      paymentMethod: {
        bank: "Demo Bank",
        brand: "Visa",
        channel: "card",
        last4: "4242",
        type: "online_payment",
      },
      pickupLocation: "Demo counter",
      storeFrontUserId: guestId,
      storeId,
    });
    const orderId = await ctx.db.insert("onlineOrder", {
      amount: orderAmount,
      bagId,
      billingDetails: null,
      checkoutSessionId,
      customerDetails: {
        email: SHARED_DEMO_PICKUP_ORDER.customerEmail,
        firstName: SHARED_DEMO_PICKUP_ORDER.customerFirstName,
        lastName: SHARED_DEMO_PICKUP_ORDER.customerLastName,
        phoneNumber: SHARED_DEMO_PICKUP_ORDER.customerPhoneNumber,
      },
      deliveryDetails: null,
      deliveryFee: 0,
      deliveryInstructions: null,
      deliveryMethod: "pickup",
      deliveryOption: null,
      didSendConfirmationEmail: true,
      discount: null,
      externalTransactionId: "shared-demo-card-payment-001",
      hasVerifiedPayment: true,
      isPODOrder: false,
      orderNumber: SHARED_DEMO_PICKUP_ORDER.orderNumber,
      orderReceivedEmailSentAt:
        pickupOrderTimeline.orderReceivedEmailSentAt,
      paymentDue: orderAmount,
      paymentMethod: {
        bank: "Demo Bank",
        brand: "Visa",
        channel: "card",
        last4: "4242",
        type: "online_payment",
      },
      pickupLocation: "Demo counter",
      placedAt: pickupOrderTimeline.placedAt,
      readyAt: now - 1_800_000,
      status: "ready",
      storeFrontUserId: guestId,
      storeId,
      updatedAt: now,
    });
    await ctx.db.patch("checkoutSession", checkoutSessionId, {
      placedOrderId: orderId,
    });
    await ctx.db.insert("onlineOrderItem", {
      isReady: true,
      orderId,
      price: orderProduct.price,
      productId: orderIdentity.productId,
      productName: orderProduct.name,
      productSku: orderProduct.sku,
      productSkuId: orderIdentity.productSkuId,
      quantity: SHARED_DEMO_PICKUP_ORDER.quantity,
      storeFrontUserId: guestId,
    });
    const dailyOpeningId = await ctx.db.insert(
      "dailyOpening",
      buildSharedDemoOpeningBaseline({
        actorStaffProfileId: manager._id,
        actorUserId: ownerUserId,
        now,
        organizationId,
        storeId,
      }),
    );
    await ctx.db.insert(
      "operationalEvent",
      buildSharedDemoStoreDayEvent({
        actorStaffProfileId: manager._id,
        actorUserId: ownerUserId,
        dailyOpeningId,
        now,
        organizationId,
        storeId,
      }),
    );
    await ctx.db.insert("sharedDemoRestoreState", {
      baselineVersion: SHARED_DEMO_BASELINE_VERSION,
      completedAt: now,
      epoch: 0,
      status: "ready",
      storeId,
    });
    await captureBaselineDocumentsWithCtx(ctx, { storeId });
    return {
      athenaUserId: ownerUserId,
      kind: "created" as const,
      organizationId,
      storeId,
    };
  },
});
