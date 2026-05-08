import { DatabaseReader, DatabaseWriter } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

/**
 * POS inventory holds are a ledger over durable SKU inventory. Cart editing
 * writes hold rows; completion is the only POS sale path that consumes SKU
 * quantityAvailable/inventoryCount.
 */

export interface InventoryHoldResult {
  success: boolean;
  message?: string;
  available?: number;
}

type HoldDoc = {
  _id: Id<"inventoryHold">;
  storeId: Id<"store">;
  productSkuId: Id<"productSku">;
  sourceSessionId: Id<"posSession">;
  status: "active" | "released" | "consumed" | "expired";
  quantity: number;
  expiresAt: number;
};

type HoldContext = {
  storeId: Id<"store">;
  sessionId: Id<"posSession">;
  skuId: Id<"productSku">;
  now?: number;
};

type AcquireHoldArgs = HoldContext & {
  quantity: number;
  expiresAt: number;
};

type AdjustHoldArgs = HoldContext & {
  oldQuantity: number;
  newQuantity: number;
  expiresAt: number;
};

type ReleaseHoldArgs = {
  sessionId: Id<"posSession">;
  skuId: Id<"productSku">;
  quantity?: number;
  now?: number;
};

export type ActiveInventoryHoldDetail = {
  holdId: Id<"inventoryHold">;
  productSkuId: Id<"productSku">;
  sku?: string;
  productName?: string;
  quantity: number;
  expiresAt: number;
  isExpired: boolean;
};

export type ReleasedInventoryHoldSummary = {
  releasedHoldCount: number;
  releasedQuantity: number;
  releasedHolds: Array<{
    holdId: Id<"inventoryHold">;
    productSkuId: Id<"productSku">;
    quantity: number;
  }>;
};

const ACTIVE_HOLD_SUM_LIMIT = 250;
const ACTIVE_SESSION_HOLD_LIST_LIMIT = 500;

/**
 * Validates if sufficient inventory is available for a product SKU.
 */
export async function validateInventoryAvailability(
  db: DatabaseReader,
  skuId: Id<"productSku">,
  requiredQuantity: number,
  options?: {
    storeId?: Id<"store">;
    sessionId?: Id<"posSession">;
    now?: number;
  },
): Promise<InventoryHoldResult> {
  const sku = await db.get("productSku", skuId);

  if (!sku) {
    return {
      success: false,
      message: "Product information is missing. Please scan again.",
    };
  }

  if (
    !("quantityAvailable" in sku) ||
    !("sku" in sku) ||
    typeof sku.quantityAvailable !== "number"
  ) {
    return {
      success: false,
      message: "Invalid product data. Please contact support.",
    };
  }

  const storeId = options?.storeId ?? sku.storeId;
  const heldByOtherSessions = storeId
    ? await sumActiveHeldQuantity(db, {
        storeId,
        skuId,
        now: options?.now ?? Date.now(),
        excludeSessionId: options?.sessionId,
      })
    : 0;
  const available = Math.max(0, sku.quantityAvailable - heldByOtherSessions);

  if (available === 0) {
    return {
      success: false,
      message: "No more units available for this product",
      available: 0,
    };
  }

  if (available < requiredQuantity) {
    return {
      success: false,
      message: `Only ${available} unit${available !== 1 ? "s" : ""} available`,
      available,
    };
  }

  return {
    success: true,
    available,
  };
}

export async function acquireInventoryHold(
  db: DatabaseWriter,
  args: AcquireHoldArgs,
): Promise<InventoryHoldResult> {
  const now = args.now ?? Date.now();
  const validation = await validateInventoryAvailability(
    db,
    args.skuId,
    args.quantity,
    {
      storeId: args.storeId,
      sessionId: args.sessionId,
      now,
    },
  );
  if (!validation.success) {
    return validation;
  }

  const existingHold = await getActiveHoldForSessionSku(db, {
    sessionId: args.sessionId,
    skuId: args.skuId,
    now,
  });

  if (existingHold) {
    await db.patch("inventoryHold", existingHold._id, {
      quantity: existingHold.quantity + args.quantity,
      expiresAt: args.expiresAt,
      updatedAt: now,
    });
  } else {
    await db.insert("inventoryHold", {
      storeId: args.storeId,
      productSkuId: args.skuId,
      sourceType: "posSession",
      sourceSessionId: args.sessionId,
      status: "active",
      quantity: args.quantity,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    success: true,
    message: `Successfully held ${args.quantity} units`,
  };
}

export async function releaseInventoryHold(
  db: DatabaseWriter,
  args: ReleaseHoldArgs,
): Promise<InventoryHoldResult> {
  const now = args.now ?? Date.now();
  let remainingQuantity = args.quantity;
  const activeHolds = await listActiveSessionHolds(db, {
    sessionId: args.sessionId,
    skuId: args.skuId,
  });

  for (const hold of activeHolds) {
    if (hold.expiresAt <= now) {
      await markHoldExpired(db, hold._id, now);
      if (remainingQuantity !== undefined) {
        remainingQuantity = Math.max(0, remainingQuantity - hold.quantity);
      }
      continue;
    }

    if (remainingQuantity !== undefined) {
      if (remainingQuantity <= 0) {
        break;
      }

      if (hold.quantity > remainingQuantity) {
        await db.patch("inventoryHold", hold._id, {
          quantity: hold.quantity - remainingQuantity,
          updatedAt: now,
        });
        remainingQuantity = 0;
        break;
      }

      remainingQuantity -= hold.quantity;
    }

    await db.patch("inventoryHold", hold._id, {
      status: "released",
      releasedAt: now,
      updatedAt: now,
    });
  }

  return {
    success: true,
    message: "Successfully released inventory hold",
  };
}

export async function adjustInventoryHold(
  db: DatabaseWriter,
  args: AdjustHoldArgs,
): Promise<InventoryHoldResult> {
  const now = args.now ?? Date.now();

  if (args.newQuantity <= 0) {
    return releaseInventoryHold(db, {
      sessionId: args.sessionId,
      skuId: args.skuId,
      now,
    });
  }

  if (args.oldQuantity === args.newQuantity) {
    const existingHold = await getActiveHoldForSessionSku(db, {
      sessionId: args.sessionId,
      skuId: args.skuId,
      now,
    });

    if (existingHold && existingHold.expiresAt !== args.expiresAt) {
      await db.patch("inventoryHold", existingHold._id, {
        expiresAt: args.expiresAt,
        updatedAt: now,
      });
    }

    return { success: true, message: "No quantity change" };
  }

  const validation = await validateInventoryAvailability(
    db,
    args.skuId,
    args.newQuantity,
    {
      storeId: args.storeId,
      sessionId: args.sessionId,
      now,
    },
  );
  if (!validation.success) {
    return validation;
  }

  const existingHold = await getActiveHoldForSessionSku(db, {
    sessionId: args.sessionId,
    skuId: args.skuId,
    now,
  });

  if (existingHold) {
    await db.patch("inventoryHold", existingHold._id, {
      quantity: args.newQuantity,
      expiresAt: args.expiresAt,
      updatedAt: now,
    });
  } else {
    await db.insert("inventoryHold", {
      storeId: args.storeId,
      productSkuId: args.skuId,
      sourceType: "posSession",
      sourceSessionId: args.sessionId,
      status: "active",
      quantity: args.newQuantity,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    success: true,
    message: "Successfully adjusted inventory hold",
  };
}

export async function acquireInventoryHoldsBatch(
  db: DatabaseWriter,
  items: Array<{ skuId: Id<"productSku">; quantity: number; name?: string }>,
): Promise<{
  success: boolean;
  unavailableItems: string[];
}> {
  const unavailableItems: string[] = [];

  for (const item of items) {
    const validation = await validateInventoryAvailability(
      db,
      item.skuId,
      item.quantity,
    );
    if (!validation.success) {
      const itemName = item.name || "Unknown Product";
      unavailableItems.push(
        `${itemName}: ${validation.message} (Available: ${validation.available || 0}, Need: ${item.quantity})`,
      );
    }
  }

  return {
    success: unavailableItems.length === 0,
    unavailableItems,
  };
}

export async function releaseInventoryHoldsBatch(
  db: DatabaseWriter,
  input: {
    sessionId: Id<"posSession">;
    items: Array<{ skuId: Id<"productSku">; quantity: number }>;
    now?: number;
  },
): Promise<void> {
  await Promise.all(
    input.items.map((item) =>
      releaseInventoryHold(db, {
        sessionId: input.sessionId,
        skuId: item.skuId,
        quantity: item.quantity,
        now: input.now,
      }),
    ),
  );
}

export async function releaseLegacyExpenseQuantityPatchHolds(
  db: DatabaseWriter,
  items: Array<{ skuId: Id<"productSku">; quantity: number }>,
): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      const sku = await db.get("productSku", item.skuId);
      if (!sku || typeof sku.quantityAvailable !== "number") {
        return;
      }

      await db.patch("productSku", item.skuId, {
        quantityAvailable: sku.quantityAvailable + item.quantity,
      });
    }),
  );
}

export async function releaseInventoryHoldsForSession(
  db: DatabaseWriter,
  args: {
    sessionId: Id<"posSession">;
    now?: number;
  },
): Promise<void> {
  const now = args.now ?? Date.now();
  const activeHolds = await listActiveSessionHolds(db, {
    sessionId: args.sessionId,
  });

  await Promise.all(
    activeHolds.map((hold) =>
      db.patch("inventoryHold", hold._id, {
        status: hold.expiresAt <= now ? "expired" : "released",
        releasedAt: hold.expiresAt <= now ? undefined : now,
        expiredAt: hold.expiresAt <= now ? now : undefined,
        updatedAt: now,
      }),
    ),
  );
}

export async function releaseActiveInventoryHoldsForSession(
  db: DatabaseWriter,
  args: {
    sessionId: Id<"posSession">;
    now?: number;
  },
): Promise<ReleasedInventoryHoldSummary> {
  const now = args.now ?? Date.now();
  const activeHolds = await listActiveSessionHolds(db, {
    sessionId: args.sessionId,
  });
  const releasedHolds: ReleasedInventoryHoldSummary["releasedHolds"] = [];
  let releasedQuantity = 0;

  for (const hold of activeHolds) {
    releasedQuantity += hold.quantity;
    releasedHolds.push({
      holdId: hold._id,
      productSkuId: hold.productSkuId,
      quantity: hold.quantity,
    });

    await db.patch("inventoryHold", hold._id, {
      status: "released",
      releasedAt: now,
      updatedAt: now,
    });
  }

  return {
    releasedHoldCount: releasedHolds.length,
    releasedQuantity,
    releasedHolds,
  };
}

export async function consumeInventoryHoldsForSession(
  db: DatabaseWriter,
  args: {
    sessionId: Id<"posSession">;
    items: Array<{ skuId: Id<"productSku">; quantity: number }>;
    now?: number;
  },
): Promise<Map<Id<"productSku">, number>> {
  const now = args.now ?? Date.now();
  const requiredSkuIds = new Set(args.items.map((item) => item.skuId));
  const consumedQuantities = new Map<Id<"productSku">, number>();
  const activeHolds = await listActiveSessionHolds(db, {
    sessionId: args.sessionId,
  });

  for (const hold of activeHolds) {
    if (hold.expiresAt <= now) {
      await markHoldExpired(db, hold._id, now);
      continue;
    }

    if (!requiredSkuIds.has(hold.productSkuId)) {
      await db.patch("inventoryHold", hold._id, {
        status: "released",
        releasedAt: now,
        updatedAt: now,
      });
      continue;
    }

    consumedQuantities.set(
      hold.productSkuId,
      (consumedQuantities.get(hold.productSkuId) ?? 0) + hold.quantity,
    );
    await db.patch("inventoryHold", hold._id, {
      status: "consumed",
      consumedAt: now,
      updatedAt: now,
    });
  }

  return consumedQuantities;
}

export async function readActiveInventoryHoldQuantitiesForSession(
  db: DatabaseReader,
  args: {
    sessionId: Id<"posSession">;
    now?: number;
  },
): Promise<Map<Id<"productSku">, number>> {
  const now = args.now ?? Date.now();
  const quantities = new Map<Id<"productSku">, number>();
  const activeHolds = await listActiveSessionHolds(db, {
    sessionId: args.sessionId,
  });

  for (const hold of activeHolds) {
    if (hold.expiresAt <= now) {
      continue;
    }

    quantities.set(
      hold.productSkuId,
      (quantities.get(hold.productSkuId) ?? 0) + hold.quantity,
    );
  }

  return quantities;
}

export async function readActiveInventoryHoldDetailsForSession(
  db: DatabaseReader,
  args: {
    sessionId: Id<"posSession">;
    now?: number;
  },
): Promise<ActiveInventoryHoldDetail[]> {
  const now = args.now ?? Date.now();
  const activeHolds = await listActiveSessionHolds(db, {
    sessionId: args.sessionId,
  });
  const details: ActiveInventoryHoldDetail[] = [];

  for (const hold of activeHolds) {
    const sku = await db.get("productSku", hold.productSkuId);

    details.push({
      holdId: hold._id,
      productSkuId: hold.productSkuId,
      sku: sku?.sku,
      productName: sku?.productName,
      quantity: hold.quantity,
      expiresAt: hold.expiresAt,
      isExpired: hold.expiresAt <= now,
    });
  }

  return details;
}

export async function readActiveHeldQuantitiesForSkus(
  db: DatabaseReader,
  args: {
    storeId: Id<"store">;
    skuIds: Id<"productSku">[];
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  const heldQuantities = new Map<Id<"productSku">, number>();
  const uniqueSkuIds = Array.from(new Set(args.skuIds));

  for (const skuId of uniqueSkuIds) {
    const heldQuantity = await sumActiveHeldQuantity(db, {
      storeId: args.storeId,
      skuId,
      now,
    });

    if (heldQuantity === Number.POSITIVE_INFINITY) {
      throw new Error(
        "Too many active POS inventory holds to summarize product availability. Expire stale POS sessions and retry.",
      );
    }

    heldQuantities.set(skuId, heldQuantity);
  }

  return heldQuantities;
}

async function sumActiveHeldQuantity(
  db: DatabaseReader,
  args: {
    storeId: Id<"store">;
    skuId: Id<"productSku">;
    now: number;
    excludeSessionId?: Id<"posSession">;
  },
) {
  const holds = await db
    .query("inventoryHold")
    .withIndex("by_storeId_productSkuId_status_expiresAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("productSkuId", args.skuId)
        .eq("status", "active")
        .gt("expiresAt", args.now),
    )
    .take(ACTIVE_HOLD_SUM_LIMIT + 1);

  if (holds.length > ACTIVE_HOLD_SUM_LIMIT) {
    return Number.POSITIVE_INFINITY;
  }

  return holds.reduce((sum, hold) => {
    if (hold.sourceSessionId === args.excludeSessionId) {
      return sum;
    }

    return sum + hold.quantity;
  }, 0);
}

async function getActiveHoldForSessionSku(
  db: DatabaseReader,
  args: {
    sessionId: Id<"posSession">;
    skuId: Id<"productSku">;
    now: number;
  },
) {
  const hold = await db
    .query("inventoryHold")
    .withIndex("by_sourceSessionId_status_productSkuId", (q) =>
      q
        .eq("sourceSessionId", args.sessionId)
        .eq("status", "active")
        .eq("productSkuId", args.skuId),
    )
    .first();

  if (!hold) {
    return null;
  }

  if (hold.expiresAt <= args.now) {
    return null;
  }

  return hold as HoldDoc;
}

async function listActiveSessionHolds(
  db: DatabaseReader,
  args: {
    sessionId: Id<"posSession">;
    skuId?: Id<"productSku">;
  },
) {
  const query = db
    .query("inventoryHold")
    .withIndex("by_sourceSessionId_status_productSkuId", (q) => {
      const indexed = q
        .eq("sourceSessionId", args.sessionId)
        .eq("status", "active");

      return args.skuId ? indexed.eq("productSkuId", args.skuId) : indexed;
    });

  const holds = await query.take(ACTIVE_SESSION_HOLD_LIST_LIMIT + 1);

  if (holds.length > ACTIVE_SESSION_HOLD_LIST_LIMIT) {
    throw new Error(
      "POS session has too many active inventory holds. Please retry or contact support.",
    );
  }

  return holds as HoldDoc[];
}

async function markHoldExpired(
  db: DatabaseWriter,
  holdId: Id<"inventoryHold">,
  now: number,
) {
  await db.patch("inventoryHold", holdId, {
    status: "expired",
    expiredAt: now,
    updatedAt: now,
  });
}
