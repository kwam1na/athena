import { DatabaseReader, DatabaseWriter } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import {
  recordSkuActivityEventWithDb,
  type RecordSkuActivityEventArgs,
} from "../../operations/skuActivity";

export type { RecordSkuActivityEventArgs } from "../../operations/skuActivity";

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
  activityContext?: PosSkuActivityContext;
  recordSkuActivityEvent?: SkuActivityRecorder;
};

type AdjustHoldArgs = HoldContext & {
  oldQuantity: number;
  newQuantity: number;
  expiresAt: number;
  activityContext?: PosSkuActivityContext;
  recordSkuActivityEvent?: SkuActivityRecorder;
};

type ReleaseHoldArgs = {
  sessionId: Id<"posSession">;
  skuId: Id<"productSku">;
  quantity?: number;
  now?: number;
  activityContext?: PosSkuActivityContext;
  recordSkuActivityEvent?: SkuActivityRecorder;
};

type PosSkuActivityType =
  | "pos_reservation_acquired"
  | "pos_reservation_adjusted"
  | "pos_reservation_released"
  | "pos_reservation_expired"
  | "pos_reservation_consumed";

type PosSkuActivityStatus = "active" | "released" | "expired" | "consumed";

export type SkuActivityRecorder = (
  db: DatabaseWriter,
  args: RecordSkuActivityEventArgs,
) => Promise<unknown>;

type PosSkuActivityContext = {
  actorStaffProfileId?: Id<"staffProfile">;
  posSessionItemId?: Id<"posSessionItem">;
  registerSessionId?: Id<"registerSession">;
  terminalId?: Id<"posTerminal">;
  posTransactionId?: Id<"posTransaction">;
  workflowTraceId?: string;
  metadata?: Record<string, unknown>;
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

  let inventoryHoldId: Id<"inventoryHold">;
  let previousQuantity = 0;
  if (existingHold) {
    inventoryHoldId = existingHold._id;
    previousQuantity = existingHold.quantity;
    await db.patch("inventoryHold", existingHold._id, {
      quantity: existingHold.quantity + args.quantity,
      expiresAt: args.expiresAt,
      updatedAt: now,
    });
  } else {
    inventoryHoldId = (await db.insert("inventoryHold", {
      storeId: args.storeId,
      productSkuId: args.skuId,
      sourceType: "posSession",
      sourceSessionId: args.sessionId,
      status: "active",
      quantity: args.quantity,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    })) as Id<"inventoryHold">;
  }

  await recordSkuActivityBestEffort(db, args.recordSkuActivityEvent, {
    storeId: args.storeId,
    productSkuId: args.skuId,
    activityType: "pos_reservation_acquired",
    occurredAt: now,
    sourceType: "posSession",
    sourceId: args.sessionId,
    sourceLineId: args.activityContext?.posSessionItemId,
    inventoryHoldId,
    reservationQuantity: args.quantity,
    quantityDelta: args.quantity,
    status: "active",
    actorStaffProfileId: args.activityContext?.actorStaffProfileId,
    registerSessionId: args.activityContext?.registerSessionId,
    terminalId: args.activityContext?.terminalId,
    posTransactionId: args.activityContext?.posTransactionId,
    workflowTraceId: args.activityContext?.workflowTraceId,
    idempotencyKey: buildSkuActivityIdempotencyKey({
      activityType: "pos_reservation_acquired",
      sessionId: args.sessionId,
      skuId: args.skuId,
      inventoryHoldId,
      occurredAt: now,
      quantity: args.quantity,
    }),
    metadata: {
      ...args.activityContext?.metadata,
      previousQuantity,
      newQuantity: previousQuantity + args.quantity,
      expiresAt: args.expiresAt,
    },
  });

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
      await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
        hold,
        activityType: "pos_reservation_expired",
        status: "expired",
        occurredAt: now,
        quantity: hold.quantity,
        quantityDelta: -hold.quantity,
        context: args.activityContext,
        metadata: {
          requestedReleaseQuantity: args.quantity,
          expiresAt: hold.expiresAt,
        },
      });
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
        const releasedQuantity = remainingQuantity;
        const previousQuantity = hold.quantity;
        await db.patch("inventoryHold", hold._id, {
          quantity: hold.quantity - releasedQuantity,
          updatedAt: now,
        });
        await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
          hold,
          activityType: "pos_reservation_released",
          status: "released",
          occurredAt: now,
          quantity: releasedQuantity,
          quantityDelta: -releasedQuantity,
          context: args.activityContext,
          metadata: {
            previousQuantity,
            remainingQuantity: previousQuantity - releasedQuantity,
          },
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
    await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
      hold,
      activityType: "pos_reservation_released",
      status: "released",
      occurredAt: now,
      quantity: hold.quantity,
      quantityDelta: -hold.quantity,
      context: args.activityContext,
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
      activityContext: args.activityContext,
      recordSkuActivityEvent: args.recordSkuActivityEvent,
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
    await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
      hold: existingHold,
      activityType: "pos_reservation_adjusted",
      status: "active",
      occurredAt: now,
      quantity: Math.abs(args.newQuantity - args.oldQuantity),
      quantityDelta: args.newQuantity - args.oldQuantity,
      context: args.activityContext,
      metadata: {
        previousQuantity: args.oldQuantity,
        newQuantity: args.newQuantity,
        expiresAt: args.expiresAt,
      },
    });
  } else {
    const inventoryHoldId = (await db.insert("inventoryHold", {
      storeId: args.storeId,
      productSkuId: args.skuId,
      sourceType: "posSession",
      sourceSessionId: args.sessionId,
      status: "active",
      quantity: args.newQuantity,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    })) as Id<"inventoryHold">;
    await recordSkuActivityBestEffort(db, args.recordSkuActivityEvent, {
      storeId: args.storeId,
      productSkuId: args.skuId,
      activityType: "pos_reservation_acquired",
      occurredAt: now,
      sourceType: "posSession",
      sourceId: args.sessionId,
      sourceLineId: args.activityContext?.posSessionItemId,
      inventoryHoldId,
      reservationQuantity: args.newQuantity,
      quantityDelta: args.newQuantity,
      status: "active",
      actorStaffProfileId: args.activityContext?.actorStaffProfileId,
      registerSessionId: args.activityContext?.registerSessionId,
      terminalId: args.activityContext?.terminalId,
      posTransactionId: args.activityContext?.posTransactionId,
      workflowTraceId: args.activityContext?.workflowTraceId,
      idempotencyKey: buildSkuActivityIdempotencyKey({
        activityType: "pos_reservation_acquired",
        sessionId: args.sessionId,
        skuId: args.skuId,
        inventoryHoldId,
        occurredAt: now,
        quantity: args.newQuantity,
      }),
      metadata: {
        ...args.activityContext?.metadata,
        previousQuantity: args.oldQuantity,
        newQuantity: args.newQuantity,
        expiresAt: args.expiresAt,
      },
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
    activityContext?: PosSkuActivityContext;
    recordSkuActivityEvent?: SkuActivityRecorder;
  },
): Promise<void> {
  await Promise.all(
    input.items.map((item) =>
      releaseInventoryHold(db, {
        sessionId: input.sessionId,
        skuId: item.skuId,
        quantity: item.quantity,
        now: input.now,
        activityContext: input.activityContext,
        recordSkuActivityEvent: input.recordSkuActivityEvent,
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
    activityContext?: PosSkuActivityContext;
    recordSkuActivityEvent?: SkuActivityRecorder;
  },
): Promise<void> {
  const now = args.now ?? Date.now();
  const activeHolds = await listActiveSessionHolds(db, {
    sessionId: args.sessionId,
  });

  await Promise.all(
    activeHolds.map(async (hold) => {
      const status = hold.expiresAt <= now ? "expired" : "released";
      await db.patch("inventoryHold", hold._id, {
        status,
        releasedAt: status === "released" ? now : undefined,
        expiredAt: status === "expired" ? now : undefined,
        updatedAt: now,
      });
      await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
        hold,
        activityType:
          status === "expired"
            ? "pos_reservation_expired"
            : "pos_reservation_released",
        status,
        occurredAt: now,
        quantity: hold.quantity,
        quantityDelta: -hold.quantity,
        context: args.activityContext,
        metadata: { expiresAt: hold.expiresAt },
      });
    }),
  );
}

export async function releaseActiveInventoryHoldsForSession(
  db: DatabaseWriter,
  args: {
    sessionId: Id<"posSession">;
    now?: number;
    activityContext?: PosSkuActivityContext;
    recordSkuActivityEvent?: SkuActivityRecorder;
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
    await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
      hold,
      activityType: "pos_reservation_released",
      status: "released",
      occurredAt: now,
      quantity: hold.quantity,
      quantityDelta: -hold.quantity,
      context: args.activityContext,
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
    activityContext?: PosSkuActivityContext;
    recordSkuActivityEvent?: SkuActivityRecorder;
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
      await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
        hold,
        activityType: "pos_reservation_expired",
        status: "expired",
        occurredAt: now,
        quantity: hold.quantity,
        quantityDelta: -hold.quantity,
        context: args.activityContext,
        metadata: { expiresAt: hold.expiresAt },
      });
      continue;
    }

    if (!requiredSkuIds.has(hold.productSkuId)) {
      await db.patch("inventoryHold", hold._id, {
        status: "released",
        releasedAt: now,
        updatedAt: now,
      });
      await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
        hold,
        activityType: "pos_reservation_released",
        status: "released",
        occurredAt: now,
        quantity: hold.quantity,
        quantityDelta: -hold.quantity,
        context: args.activityContext,
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
    await recordHoldSkuActivity(db, args.recordSkuActivityEvent, {
      hold,
      activityType: "pos_reservation_consumed",
      status: "consumed",
      occurredAt: now,
      quantity: hold.quantity,
      quantityDelta: -hold.quantity,
      context: args.activityContext,
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

export async function readActiveHeldQuantitiesForStoreSkus(
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
  const requestedSkuIds = new Set(uniqueSkuIds);

  for (const skuId of uniqueSkuIds) {
    heldQuantities.set(skuId, 0);
  }

  if (uniqueSkuIds.length === 0) {
    return heldQuantities;
  }

  const holds = await db
    .query("inventoryHold")
    .withIndex("by_storeId_status_expiresAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "active")
        .gt("expiresAt", now),
    )
    .take(ACTIVE_SESSION_HOLD_LIST_LIMIT + 1);

  if (holds.length > ACTIVE_SESSION_HOLD_LIST_LIMIT) {
    throw new Error(
      "Too many active POS inventory holds to summarize register availability. Expire stale POS sessions and retry.",
    );
  }

  for (const hold of holds) {
    if (!requestedSkuIds.has(hold.productSkuId)) {
      continue;
    }

    heldQuantities.set(
      hold.productSkuId,
      (heldQuantities.get(hold.productSkuId) ?? 0) + hold.quantity,
    );
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

async function recordSkuActivityBestEffort(
  db: DatabaseWriter,
  recorder: SkuActivityRecorder | undefined,
  event: RecordSkuActivityEventArgs,
) {
  const resolvedRecorder = recorder ?? recordSkuActivityEventWithDb;
  await resolvedRecorder(db, event);
}

async function recordHoldSkuActivity(
  db: DatabaseWriter,
  recorder: SkuActivityRecorder | undefined,
  input: {
    hold: HoldDoc;
    activityType: PosSkuActivityType;
    status: PosSkuActivityStatus;
    occurredAt: number;
    quantity: number;
    quantityDelta: number;
    context?: PosSkuActivityContext;
    metadata?: Record<string, unknown>;
  },
) {
  if (input.quantity <= 0) {
    return;
  }

  await recordSkuActivityBestEffort(db, recorder, {
    storeId: input.hold.storeId,
    productSkuId: input.hold.productSkuId,
    activityType: input.activityType,
    occurredAt: input.occurredAt,
    sourceType: "posSession",
    sourceId: input.hold.sourceSessionId,
    sourceLineId: input.context?.posSessionItemId,
    inventoryHoldId: input.hold._id,
    reservationQuantity: input.quantity,
    quantityDelta: input.quantityDelta,
    status: input.status,
    actorStaffProfileId: input.context?.actorStaffProfileId,
    registerSessionId: input.context?.registerSessionId,
    terminalId: input.context?.terminalId,
    posTransactionId: input.context?.posTransactionId,
    workflowTraceId: input.context?.workflowTraceId,
    idempotencyKey: buildSkuActivityIdempotencyKey({
      activityType: input.activityType,
      sessionId: input.hold.sourceSessionId,
      skuId: input.hold.productSkuId,
      inventoryHoldId: input.hold._id,
      occurredAt: input.occurredAt,
      quantity: input.quantity,
    }),
    metadata: {
      ...input.context?.metadata,
      ...input.metadata,
    },
  });
}

function buildSkuActivityIdempotencyKey(args: {
  activityType: PosSkuActivityType;
  sessionId: Id<"posSession">;
  skuId: Id<"productSku">;
  inventoryHoldId: Id<"inventoryHold">;
  occurredAt: number;
  quantity: number;
}) {
  return [
    "pos",
    args.activityType,
    args.sessionId,
    args.skuId,
    args.inventoryHoldId,
    args.occurredAt,
    args.quantity,
  ].join(":");
}
