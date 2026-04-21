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
  getPosTransactionById,
  getProductSkuById,
  getStoreById,
  listSessionItems,
  listTransactionItems,
  patchPosSession,
  patchPosTransaction,
  patchProductSku,
} from "../../infrastructure/repositories/transactionRepository";

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
  transactionId: string | null;
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

async function recordRegisterSessionSale(
  ctx: MutationCtx,
  args: {
    changeGiven?: number;
    payments: PosPaymentInput[];
    registerSessionId: Id<"registerSession">;
    registerNumber?: string;
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
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
    terminalId?: Id<"posTerminal">;
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
    cashierId?: Id<"cashier">;
    registerSessionId?: Id<"registerSession">;
  },
) {
  const skuQuantityMap = new Map<Id<"productSku">, number>();

  for (const item of args.items) {
    skuQuantityMap.set(item.skuId, (skuQuantityMap.get(item.skuId) || 0) + item.quantity);
  }

  for (const [skuId, totalQuantity] of skuQuantityMap) {
    const sku = await getProductSkuById(ctx, skuId);
    if (!sku) {
      return {
        success: false,
        error: `Product SKU ${skuId} not found`,
      };
    }

    if (sku.quantityAvailable < totalQuantity) {
      const itemName =
        args.items.find((item) => item.skuId === skuId)?.name || "Unknown Product";
      return {
        success: false,
        error: `Insufficient inventory for ${capitalizeWords(itemName)} (${sku.sku}). Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
      };
    }
  }

  if (args.payments.length === 0) {
    return {
      success: false,
      error: "At least one payment is required",
    };
  }

  const totalPaid = calculateTotalPaid(args.payments);
  if (totalPaid < args.total) {
    return {
      success: false,
      error: `Insufficient payment. Total: ${args.total.toFixed(2)}, Paid: ${totalPaid.toFixed(2)}`,
    };
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
    cashierId: args.cashierId,
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

  if (args.registerSessionId) {
    await recordRegisterSessionSale(ctx, {
      changeGiven,
      payments: args.payments,
      registerSessionId: args.registerSessionId,
      registerNumber: args.registerNumber,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
  }

  const store = await getStoreById(ctx, args.storeId);
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
    return {
      success: false,
      error: completionResult.message,
    };
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
        return {
          success: false,
          error: `SKU ${item.skuId} not found during transaction processing`,
        };
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

  return {
    success: true,
    transactionId: completionResult.data.transactionId,
    transactionNumber: completionResult.data.transactionNumber,
    transactionItems,
  };
}

export async function voidTransaction(
  ctx: MutationCtx,
  args: {
    transactionId: Id<"posTransaction">;
    reason: string;
    cashierId?: Id<"cashier">;
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
    notes?: string;
  },
) {
  const session = await getPosSessionById(ctx, args.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const items = await listSessionItems(ctx, args.sessionId);
  if (items.length === 0) {
    throw new Error("Cannot complete session with no items");
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
      throw new Error(`Product SKU ${skuId} not found`);
    }

    if (sku.inventoryCount < totalQuantity) {
      const item = items.find((sessionItem) => sessionItem.productSkuId === skuId);
      throw new Error(
        `Insufficient inventory for ${capitalizeWords(item?.productName || "Unknown Product")} (${sku.sku}). In Stock: ${sku.inventoryCount}, Needed: ${totalQuantity}`,
      );
    }
  }

  if (args.payments.length === 0) {
    throw new Error("At least one payment is required");
  }

  const totalPaid = calculateTotalPaid(args.payments);
  const subtotal = session.subtotal || 0;
  const tax = session.tax || 0;
  const total = session.total || 0;

  if (totalPaid < total) {
    throw new Error(
      `Insufficient payment. Total: ${total.toFixed(2)}, Paid: ${totalPaid.toFixed(2)}`,
    );
  }

  const changeGiven = totalPaid > total ? totalPaid - total : undefined;
  const primaryPaymentMethod = args.payments[0]?.method || "cash";
  const transactionNumber = generateTransactionNumber();
  const completedAt = Date.now();

  const transactionId = await createPosTransaction(ctx, {
    transactionNumber,
    storeId: session.storeId,
    sessionId: args.sessionId,
    registerSessionId: args.registerSessionId,
    customerId: session.customerId,
    cashierId: session.cashierId,
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

  if (args.registerSessionId) {
    await recordRegisterSessionSale(ctx, {
      changeGiven,
      payments: args.payments,
      registerSessionId: args.registerSessionId,
      registerNumber: session.registerNumber,
      storeId: session.storeId,
      terminalId: session.terminalId,
    });
  }

  const store = await getStoreById(ctx, session.storeId);
  const completionResult = buildCompleteTransactionResult({
    transactionId,
    transactionNumber,
    paymentAllocated: await recordRetailSalePaymentAllocations(ctx, {
      changeGiven,
      organizationId: store?.organizationId,
      payments: args.payments,
      posTransactionId: transactionId,
      registerSessionId: args.registerSessionId,
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
  });

  return {
    success: true,
    transactionId: completionResult.data.transactionId,
    transactionNumber: completionResult.data.transactionNumber,
    transactionItems,
  };
}
