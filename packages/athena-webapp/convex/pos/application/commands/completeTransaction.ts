import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { capitalizeWords, generateTransactionNumber } from "../../../utils";
import {
  recordRetailSalePaymentAllocations,
  recordRetailVoidPaymentAllocations,
} from "../../infrastructure/integrations/paymentAllocationService";
import { updateCustomerStats } from "../../infrastructure/repositories/customerRepository";
import {
  createPosTransaction,
  createPosTransactionItem,
  getPosSessionById,
  getRegisterSessionById,
  getPosTransactionById,
  getProductSkuById,
  getStoreById,
  listSessionItems,
  listTransactionItems,
  patchPosSession,
  patchPosTransaction,
  patchProductSku,
} from "../../infrastructure/repositories/transactionRepository";
import { ok, userError, type CommandResult } from "../../../../shared/commandResult";
import { isPosUsableRegisterSessionStatus } from "../../../../shared/registerSessionStatus";

type PosPaymentInput = {
  method: string;
  amount: number;
  timestamp: number;
};

type DirectTransactionItemInput = {
  skuId: Id<"productSku">;
  quantity: number;
  price: number;
  name: string;
  barcode?: string;
  sku: string;
  image?: string;
};

export function buildCompleteTransactionResult(input: {
  transactionId: Id<"posTransaction"> | null;
  transactionNumber: string | null;
  paymentAllocated: boolean;
}) {
  if (!input.transactionId || !input.transactionNumber) {
    return {
      status: "validationFailed" as const,
      message: "Transaction completion did not finish cleanly",
    };
  }

  return {
    status: "ok" as const,
    data: {
      transactionId: input.transactionId,
      transactionNumber: input.transactionNumber,
    },
  };
}

function calculateTotalPaid(payments: PosPaymentInput[]) {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

function registerSessionMatchesIdentity(
  registerSession: {
    terminalId?: Id<"posTerminal">;
  },
  identity: {
    terminalId?: Id<"posTerminal">;
  },
) {
  if (!identity.terminalId || !registerSession.terminalId) {
    return false;
  }

  return identity.terminalId === registerSession.terminalId;
}

function isUsableRegisterSession(registerSession: { status: string }) {
  return isPosUsableRegisterSessionStatus(registerSession.status);
}

async function resolveSessionRegisterSessionId(
  ctx: MutationCtx,
  args: {
    session: NonNullable<Awaited<ReturnType<typeof getPosSessionById>>>;
    providedRegisterSessionId?: Id<"registerSession">;
  },
): Promise<CommandResult<Id<"registerSession">>> {
  const resolvedRegisterSessionId =
    args.session.registerSessionId ?? args.providedRegisterSessionId;

  if (!resolvedRegisterSessionId) {
    return userError({
      code: "precondition_failed",
      message: "Open the cash drawer before completing this sale.",
    });
  }

  if (
    args.session.registerSessionId &&
    args.providedRegisterSessionId &&
    args.session.registerSessionId !== args.providedRegisterSessionId
  ) {
    return userError({
      code: "precondition_failed",
      message: "Open the cash drawer before completing this sale.",
    });
  }

  const registerSession = await getRegisterSessionById(
    ctx,
    resolvedRegisterSessionId,
  );

  if (
    !registerSession ||
    registerSession.storeId !== args.session.storeId ||
    !isUsableRegisterSession(registerSession) ||
    !registerSessionMatchesIdentity(registerSession, {
      terminalId: args.session.terminalId,
    })
  ) {
    return userError({
      code: "precondition_failed",
      message: "Open the cash drawer before completing this sale.",
    });
  }

  return ok(resolvedRegisterSessionId);
}

export async function recordRegisterSessionSale(
  ctx: MutationCtx,
  args: {
    changeGiven?: number;
    payments: PosPaymentInput[];
    registerSessionId: Id<"registerSession">;
    registerNumber?: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  await ctx.runMutation(
    internal.operations.registerSessions.recordRegisterSessionTransaction,
    {
      adjustmentKind: "sale",
      changeGiven: args.changeGiven,
      payments: args.payments,
      registerSessionId: args.registerSessionId,
      registerNumber: args.registerNumber,
      storeId: args.storeId,
      terminalId: args.terminalId,
    },
  );
}

async function recordRegisterSessionVoid(
  ctx: MutationCtx,
  args: {
    changeGiven?: number;
    payments: PosPaymentInput[];
    registerSessionId: Id<"registerSession">;
    registerNumber?: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  await ctx.runMutation(
    internal.operations.registerSessions.recordRegisterSessionTransaction,
    {
      adjustmentKind: "void",
      changeGiven: args.changeGiven,
      payments: args.payments,
      registerSessionId: args.registerSessionId,
      registerNumber: args.registerNumber,
      storeId: args.storeId,
      terminalId: args.terminalId,
    },
  );
}

export async function updateInventory(
  ctx: MutationCtx,
  args: {
    skuId: Id<"productSku">;
    quantityToSubtract: number;
  },
) {
  const sku = await getProductSkuById(ctx, args.skuId);
  if (!sku) {
    throw new Error("Product SKU not found");
  }

  if (sku.quantityAvailable < args.quantityToSubtract) {
    throw new Error("Insufficient inventory");
  }

  const newQuantity = sku.quantityAvailable - args.quantityToSubtract;
  const newInventoryCount = Math.max(
    0,
    sku.inventoryCount - args.quantityToSubtract,
  );

  await patchProductSku(ctx, args.skuId, {
    quantityAvailable: newQuantity,
    inventoryCount: newInventoryCount,
  });

  return { success: true, newQuantity };
}

export async function completeTransaction(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    items: DirectTransactionItemInput[];
    payments: PosPaymentInput[];
    subtotal: number;
    tax: number;
    total: number;
    customerId?: Id<"posCustomer">;
    customerInfo?: {
      name?: string;
      email?: string;
      phone?: string;
    };
    registerNumber?: string;
    terminalId?: Id<"posTerminal">;
    staffProfileId?: Id<"staffProfile">;
    registerSessionId?: Id<"registerSession">;
  },
): Promise<
  CommandResult<{
    transactionId: Id<"posTransaction">;
    transactionNumber: string;
    transactionItems: Array<Id<"posTransactionItem">>;
  }>
> {
  const skuQuantityMap = new Map<Id<"productSku">, number>();

  for (const item of args.items) {
    skuQuantityMap.set(item.skuId, (skuQuantityMap.get(item.skuId) || 0) + item.quantity);
  }

  for (const [skuId, totalQuantity] of skuQuantityMap) {
    const sku = await getProductSkuById(ctx, skuId);
    if (!sku) {
      return userError({
        code: "not_found",
        message: `Product SKU ${skuId} not found.`,
      });
    }

    if (sku.quantityAvailable < totalQuantity) {
      const itemName =
        args.items.find((item) => item.skuId === skuId)?.name || "Unknown Product";
      return userError({
        code: "conflict",
        message: `Insufficient inventory for ${capitalizeWords(itemName)} (${sku.sku}). Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
      });
    }
  }

  if (args.payments.length === 0) {
    return userError({
      code: "validation_failed",
      message: "At least one payment is required.",
    });
  }

  if (args.registerSessionId && !args.terminalId) {
    return userError({
      code: "precondition_failed",
      message: "Register session transactions must include a terminal.",
    });
  }

  const totalPaid = calculateTotalPaid(args.payments);
  if (totalPaid < args.total) {
    return userError({
      code: "validation_failed",
      message: `Insufficient payment. Total: ${args.total.toFixed(2)}, Paid: ${totalPaid.toFixed(2)}`,
    });
  }

  const changeGiven = totalPaid > args.total ? totalPaid - args.total : undefined;
  const primaryPaymentMethod = args.payments[0]?.method || "cash";
  const transactionNumber = generateTransactionNumber();
  const completedAt = Date.now();

  const transactionId = await createPosTransaction(ctx, {
    transactionNumber,
    storeId: args.storeId,
    sessionId: undefined,
    registerSessionId: args.registerSessionId,
    customerId: args.customerId,
    staffProfileId: args.staffProfileId,
    registerNumber: args.registerNumber,
    terminalId: args.terminalId,
    subtotal: args.subtotal,
    tax: args.tax,
    total: args.total,
    payments: args.payments,
    totalPaid,
    changeGiven,
    paymentMethod: primaryPaymentMethod,
    status: "completed",
    completedAt,
    customerInfo: args.customerInfo,
    receiptPrinted: false,
  });
  const store = await getStoreById(ctx, args.storeId);

  if (args.registerSessionId) {
    const sessionTerminalId = args.terminalId;

    if (!sessionTerminalId) {
      return userError({
        code: "precondition_failed",
        message: "Register session transactions must include a terminal.",
      });
    }

    await recordRegisterSessionSale(ctx, {
      changeGiven,
      payments: args.payments,
      registerSessionId: args.registerSessionId,
      registerNumber: args.registerNumber,
      storeId: args.storeId,
      terminalId: sessionTerminalId,
    });
  }

  const completionResult = buildCompleteTransactionResult({
    transactionId,
    transactionNumber,
    paymentAllocated: await recordRetailSalePaymentAllocations(ctx, {
      changeGiven,
      organizationId: store?.organizationId,
      payments: args.payments,
      posTransactionId: transactionId,
      registerSessionId: args.registerSessionId,
      storeId: args.storeId,
      transactionNumber,
    }),
  });

  if (completionResult.status !== "ok") {
    throw new Error(completionResult.message);
  }

  if (args.customerId) {
    await updateCustomerStats(ctx, {
      customerId: args.customerId,
      transactionAmount: args.total,
      updatedAt: completedAt,
    });
  }

  const transactionItems = await Promise.all(
    args.items.map(async (item) => {
      const sku = await getProductSkuById(ctx, item.skuId);
      if (!sku) {
        throw new Error(`SKU ${item.skuId} not found during transaction processing`);
      }

      const image = item.image ?? sku.images?.[0];
      const transactionItemId = await createPosTransactionItem(ctx, {
        transactionId,
        productId: sku.productId,
        productSkuId: item.skuId,
        productName: item.name,
        productSku: item.sku,
        barcode: item.barcode,
        ...(image ? { image } : {}),
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.price * item.quantity,
      });

      await patchProductSku(ctx, item.skuId, {
        quantityAvailable: sku.quantityAvailable - item.quantity,
        inventoryCount: Math.max(0, sku.inventoryCount - item.quantity),
      });

      return transactionItemId;
    }),
  );

  return ok({
    transactionId: completionResult.data.transactionId,
    transactionNumber: completionResult.data.transactionNumber,
    transactionItems,
  });
}

export async function voidTransaction(
  ctx: MutationCtx,
  args: {
    transactionId: Id<"posTransaction">;
    reason: string;
    staffProfileId?: Id<"staffProfile">;
  },
) {
  const transaction = await getPosTransactionById(ctx, args.transactionId);
  if (!transaction) {
    return {
      success: false,
      error: "Transaction not found",
    };
  }

  if (transaction.status !== "completed") {
    return {
      success: false,
      error: "Can only void completed transactions",
    };
  }

  if (transaction.registerSessionId) {
    if (!transaction.terminalId) {
      return {
        success: false,
        error: "Register session transactions must include a terminal.",
      };
    }

    await recordRegisterSessionVoid(ctx, {
      changeGiven: transaction.changeGiven,
      payments: transaction.payments,
      registerSessionId: transaction.registerSessionId,
      registerNumber: transaction.registerNumber,
      storeId: transaction.storeId,
      terminalId: transaction.terminalId,
    });
  }

  const store = await getStoreById(ctx, transaction.storeId);
  await recordRetailVoidPaymentAllocations(ctx, {
    changeGiven: transaction.changeGiven,
    organizationId: store?.organizationId,
    payments: transaction.payments,
    posTransactionId: transaction._id,
    registerSessionId: transaction.registerSessionId,
    storeId: transaction.storeId,
    transactionNumber: transaction.transactionNumber,
  });

  await patchPosTransaction(ctx, args.transactionId, {
    status: "void",
    voidedAt: Date.now(),
    notes: args.reason,
  });

  const items = await listTransactionItems(ctx, args.transactionId);
  await Promise.all(
    items.map(async (item) => {
      const sku = await getProductSkuById(ctx, item.productSkuId);
      if (!sku) {
        return;
      }

      await patchProductSku(ctx, item.productSkuId, {
        quantityAvailable: sku.quantityAvailable + item.quantity,
        inventoryCount: sku.inventoryCount + item.quantity,
      });
    }),
  );

  return { success: true };
}

export async function createTransactionFromSessionHandler(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"posSession">;
    payments: PosPaymentInput[];
    registerSessionId?: Id<"registerSession">;
    recordRegisterSale?: boolean;
    notes?: string;
  },
): Promise<
  CommandResult<{
    transactionId: Id<"posTransaction">;
    transactionNumber: string;
    transactionItems: Array<Id<"posTransactionItem">>;
  }>
> {
  const session = await getPosSessionById(ctx, args.sessionId);
  if (!session) {
    return userError({
      code: "not_found",
      message: "Session not found.",
    });
  }

  const items = await listSessionItems(ctx, args.sessionId);
  if (items.length === 0) {
    return userError({
      code: "precondition_failed",
      message: "Cannot complete session with no items.",
    });
  }

  const resolvedRegisterSessionId = await resolveSessionRegisterSessionId(ctx, {
    session,
    providedRegisterSessionId: args.registerSessionId,
  });
  if (resolvedRegisterSessionId.kind === "user_error") {
    return resolvedRegisterSessionId;
  }

  const skuQuantityMap = new Map<Id<"productSku">, number>();
  for (const item of items) {
    skuQuantityMap.set(
      item.productSkuId,
      (skuQuantityMap.get(item.productSkuId) || 0) + item.quantity,
    );
  }

  for (const [skuId, totalQuantity] of skuQuantityMap) {
    const sku = await getProductSkuById(ctx, skuId);
    if (!sku) {
      return userError({
        code: "not_found",
        message: `Product SKU ${skuId} not found.`,
      });
    }

    if (sku.inventoryCount < totalQuantity) {
      const item = items.find((sessionItem) => sessionItem.productSkuId === skuId);
      return userError({
        code: "conflict",
        message: `Insufficient inventory for ${capitalizeWords(item?.productName || "Unknown Product")} (${sku.sku}). In Stock: ${sku.inventoryCount}, Needed: ${totalQuantity}`,
      });
    }
  }

  if (args.payments.length === 0) {
    return userError({
      code: "validation_failed",
      message: "At least one payment is required.",
    });
  }

  const totalPaid = calculateTotalPaid(args.payments);
  const subtotal = session.subtotal || 0;
  const tax = session.tax || 0;
  const total = session.total || 0;

  if (totalPaid < total) {
    return userError({
      code: "validation_failed",
      message: `Insufficient payment. Total: ${total.toFixed(2)}, Paid: ${totalPaid.toFixed(2)}`,
    });
  }

  const changeGiven = totalPaid > total ? totalPaid - total : undefined;
  const primaryPaymentMethod = args.payments[0]?.method || "cash";
  const transactionNumber = generateTransactionNumber();
  const completedAt = Date.now();

  const transactionId = await createPosTransaction(ctx, {
    transactionNumber,
    storeId: session.storeId,
    sessionId: args.sessionId,
    registerSessionId: resolvedRegisterSessionId.data,
    customerId: session.customerId,
    staffProfileId: session.staffProfileId,
    registerNumber: session.registerNumber,
    terminalId: session.terminalId,
    subtotal,
    tax,
    total,
    payments: args.payments,
    totalPaid,
    changeGiven,
    paymentMethod: primaryPaymentMethod,
    status: "completed",
    completedAt,
    customerInfo: session.customerInfo,
    receiptPrinted: false,
    notes: args.notes,
  });
  const store = await getStoreById(ctx, session.storeId);

  if (args.recordRegisterSale !== false) {
    await recordRegisterSessionSale(ctx, {
      changeGiven,
      payments: args.payments,
      registerSessionId: resolvedRegisterSessionId.data,
      registerNumber: session.registerNumber,
      storeId: session.storeId,
      terminalId: session.terminalId,
    });
  }

  const completionResult = buildCompleteTransactionResult({
    transactionId,
    transactionNumber,
    paymentAllocated: await recordRetailSalePaymentAllocations(ctx, {
      changeGiven,
      organizationId: store?.organizationId,
      payments: args.payments,
      posTransactionId: transactionId,
      registerSessionId: resolvedRegisterSessionId.data,
      storeId: session.storeId,
      transactionNumber,
    }),
  });

  if (completionResult.status !== "ok") {
    throw new Error(completionResult.message);
  }

  if (session.customerId) {
    await updateCustomerStats(ctx, {
      customerId: session.customerId,
      transactionAmount: total,
      updatedAt: completedAt,
    });
  }

  const transactionItems = await Promise.all(
    items.map(async (item) => {
      const sku = await getProductSkuById(ctx, item.productSkuId);
      if (!sku) {
        throw new Error(
          `SKU ${item.productSkuId} not found during transaction processing`,
        );
      }

      const image = item.image ?? sku.images?.[0];
      const transactionItemId = await createPosTransactionItem(ctx, {
        transactionId,
        productId: item.productId,
        productSkuId: item.productSkuId,
        productName: item.productName,
        productSku: item.productSku ?? "",
        barcode: item.barcode,
        ...(image ? { image } : {}),
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.price * item.quantity,
      });

      await patchProductSku(ctx, item.productSkuId, {
        inventoryCount: Math.max(0, sku.inventoryCount - item.quantity),
      });

      return transactionItemId;
    }),
  );

  await patchPosSession(ctx, args.sessionId, {
    transactionId,
    registerSessionId: resolvedRegisterSessionId.data,
  });

  return ok({
    transactionId: completionResult.data.transactionId,
    transactionNumber: completionResult.data.transactionNumber,
    transactionItems,
  });
}
