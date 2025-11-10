import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { capitalizeWords, generateTransactionNumber } from "../utils";

export const searchProducts = query({
  args: {
    storeId: v.id("store"),
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.searchQuery.trim()) {
      return [];
    }

    const query = args.searchQuery.toLowerCase().trim();

    // Get all products for the store
    const allProducts = await ctx.db
      .query("product")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    // Get all SKUs for the store
    const allSkus = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    // Create a map of products by ID for easy lookup
    const productMap = new Map();
    allProducts.forEach((product) => {
      productMap.set(product._id, product);
    });

    // Find matching SKUs (by SKU code, barcode, or product name)
    const matchingSkus = allSkus.filter((sku) => {
      const product = productMap.get(sku.productId);
      if (!product) return false;

      // Search in barcode field
      const barcodeMatches = sku.barcode?.toLowerCase().includes(query);

      // Search in SKU code
      const skuMatches = sku.sku?.toLowerCase().includes(query);

      // Search in product name
      const nameMatches = product.name.toLowerCase().includes(query);

      const productIdMatches = product._id.toLowerCase().includes(query);

      // Search in product description
      const descriptionMatches = product.description
        ?.toLowerCase()
        .includes(query);

      return (
        barcodeMatches ||
        skuMatches ||
        nameMatches ||
        descriptionMatches ||
        productIdMatches
      );
    });

    // Transform to POS-friendly format
    const results = await Promise.all(
      matchingSkus
        // .filter((sku) => sku.quantityAvailable > 0) // Only show available items
        .slice(0, 20) // Limit results for performance
        .map(async (sku) => {
          const product = productMap.get(sku.productId);
          if (!product) return null;

          // Get category name
          let categoryName = "";
          if (product.categoryId) {
            const category = await ctx.db.get(product.categoryId);
            categoryName = (category as any)?.name || "";
          }

          // Get color name if exists
          let colorName = "";
          if (sku.color) {
            const color = await ctx.db.get(sku.color);
            colorName = color?.name || "";
          }

          return {
            id: sku._id,
            name: product.name,
            sku: sku.sku || "",
            barcode: sku.barcode || "",
            price: sku.netPrice || sku.price, // Use netPrice if available, fallback to price
            category: categoryName,
            description: product.description || "",
            inStock: sku.quantityAvailable > 0,
            quantityAvailable: sku.quantityAvailable,
            image: sku.images?.[0] || null,
            size: sku.size || "",
            length: sku.length || null,
            color: colorName,
            productId: product._id,
            skuId: sku._id,
            areProcessingFeesAbsorbed:
              product.areProcessingFeesAbsorbed || false,
          };
        })
    );

    // Filter out null results
    return results.filter((result) => result !== null);
  },
});

export const lookupByBarcode = query({
  args: {
    storeId: v.id("store"),
    barcode: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("productSku"),
      name: v.string(),
      sku: v.string(),
      barcode: v.string(),
      price: v.number(),
      category: v.string(),
      description: v.string(),
      inStock: v.boolean(),
      quantityAvailable: v.number(),
      image: v.union(v.string(), v.null()),
      size: v.string(),
      length: v.union(v.number(), v.null()),
      color: v.string(),
      productId: v.id("product"),
      skuId: v.id("productSku"),
      areProcessingFeesAbsorbed: v.boolean(),
    }),
    v.array(
      v.object({
        id: v.id("productSku"),
        name: v.string(),
        sku: v.string(),
        barcode: v.string(),
        price: v.number(),
        category: v.string(),
        description: v.string(),
        inStock: v.boolean(),
        quantityAvailable: v.number(),
        image: v.union(v.string(), v.null()),
        size: v.string(),
        length: v.union(v.number(), v.null()),
        color: v.string(),
        productId: v.id("product"),
        skuId: v.id("productSku"),
        areProcessingFeesAbsorbed: v.boolean(),
      })
    )
  ),
  handler: async (ctx, args) => {
    if (!args.barcode.trim()) {
      return null;
    }

    console.log("requesting lookup by barcode", args.barcode);

    // Find SKU by barcode field using index
    let sku = await ctx.db
      .query("productSku")
      .withIndex("by_storeId_barcode", (q) =>
        q.eq("storeId", args.storeId).eq("barcode", args.barcode)
      )
      .first();

    console.log("sku", sku);

    // Fallback: search by sku field if barcode field is not populated
    if (!sku) {
      sku = await ctx.db
        .query("productSku")
        .filter((q) =>
          q.and(
            q.eq(q.field("storeId"), args.storeId),
            q.eq(q.field("sku"), args.barcode)
          )
        )
        .first();
    }

    // Fallback: Search by product ID - return all SKUs for the product
    if (!sku) {
      const product = await ctx.db
        .query("product")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) => q.eq(q.field("_id"), args.barcode))
        .first();

      if (product) {
        // Get all SKUs for this product
        const allSkus = await ctx.db
          .query("productSku")
          .withIndex("by_productId", (q) => q.eq("productId", product._id))
          .collect();

        // Get category name
        let categoryName = "";
        if (product.categoryId) {
          const category = await ctx.db.get(product.categoryId);
          categoryName = category?.name || "";
        }

        // Transform SKUs to POS-friendly format
        const results = await Promise.all(
          allSkus.map(async (sku) => {
            // Get color name if exists
            let colorName = "";
            if (sku.color) {
              const color = await ctx.db.get(sku.color);
              colorName = color?.name || "";
            }

            return {
              id: sku._id,
              name: product.name,
              sku: sku.sku || "",
              barcode: sku.barcode || "",
              price: sku.netPrice || sku.price,
              category: categoryName,
              description: product.description || "",
              inStock: sku.quantityAvailable > 0,
              quantityAvailable: sku.quantityAvailable,
              image: sku.images?.[0] || null,
              size: sku.size || "",
              length: sku.length || null,
              color: colorName,
              productId: product._id,
              skuId: sku._id,
              areProcessingFeesAbsorbed:
                product.areProcessingFeesAbsorbed || false,
            };
          })
        );

        return results;
      }
    }

    if (!sku) {
      return null;
    }

    // Get the product details
    const product = await ctx.db.get(sku.productId);

    if (!product) return null;

    // Get category name
    let categoryName = "";
    if (product.categoryId) {
      const category = await ctx.db.get(product.categoryId);
      categoryName = category?.name || "";
    }

    // Get color name if exists
    let colorName = "";
    if (sku.color) {
      const color = await ctx.db.get(sku.color);
      colorName = color?.name || "";
    }

    return {
      id: sku._id,
      name: product.name,
      sku: sku.sku || "",
      barcode: sku.barcode || "",
      price: sku.netPrice || sku.price, // Use netPrice if available, fallback to price
      category: categoryName,
      description: product.description || "",
      inStock: sku.quantityAvailable > 0,
      quantityAvailable: sku.quantityAvailable,
      image: sku.images?.[0] || null,
      size: sku.size || "",
      length: sku.length || null,
      color: colorName,
      productId: product._id,
      skuId: sku._id,
      areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed || false,
    };
  },
});

export const updateInventory = mutation({
  args: {
    skuId: v.id("productSku"),
    quantityToSubtract: v.number(),
  },
  handler: async (ctx, args) => {
    const sku = await ctx.db.get(args.skuId);
    if (!sku) {
      throw new Error("Product SKU not found");
    }

    if (sku.quantityAvailable < args.quantityToSubtract) {
      throw new Error("Insufficient inventory");
    }

    const newQuantity = sku.quantityAvailable - args.quantityToSubtract;
    const newInventoryCount = Math.max(
      0,
      sku.inventoryCount - args.quantityToSubtract
    );

    await ctx.db.patch(args.skuId, {
      quantityAvailable: newQuantity,
      inventoryCount: newInventoryCount,
    });

    return { success: true, newQuantity };
  },
});

export const completeTransaction = mutation({
  args: {
    storeId: v.id("store"),
    items: v.array(
      v.object({
        skuId: v.id("productSku"),
        quantity: v.number(),
        price: v.number(),
        name: v.string(),
        barcode: v.optional(v.string()),
        sku: v.string(),
        image: v.optional(v.string()),
      })
    ),
    paymentMethod: v.string(), // "cash", "card", "mobile_money"
    subtotal: v.number(),
    tax: v.number(),
    total: v.number(),
    customerId: v.optional(v.id("posCustomer")), // Link to customer if selected
    customerInfo: v.optional(
      v.object({
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
      })
    ),
    registerNumber: v.optional(v.string()),
    cashierId: v.optional(v.id("cashier")),
  },
  handler: async (ctx, args) => {
    // Validate inventory availability with cumulative quantity tracking
    const skuQuantityMap = new Map<Id<"productSku">, number>();

    // First, aggregate quantities by SKU to handle multiple items of the same product
    for (const item of args.items) {
      const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
      skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
    }

    // Then validate each unique SKU against its total required quantity
    for (const [skuId, totalQuantity] of skuQuantityMap) {
      const sku = await ctx.db.get(skuId);
      if (!sku) {
        return {
          success: false,
          error: `Product SKU ${skuId} not found`,
        };
      }

      // Type guard to ensure we have a productSku
      if (!("quantityAvailable" in sku) || !("sku" in sku)) {
        return {
          success: false,
          error: `Invalid product SKU data for ${skuId}`,
        };
      }

      if (sku.quantityAvailable < totalQuantity) {
        const itemName =
          args.items.find((item) => item.skuId === skuId)?.name ||
          "Unknown Product";
        return {
          success: false,
          error: `Insufficient inventory for ${capitalizeWords(itemName)} (${sku.sku}). Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
        };
      }
    }

    // Generate transaction number using shared utility
    const transactionNumber = generateTransactionNumber();

    // Create the POS transaction
    const transactionId = await ctx.db.insert("posTransaction", {
      transactionNumber,
      storeId: args.storeId,
      sessionId: undefined, // Direct transaction - no session
      customerId: args.customerId,
      cashierId: args.cashierId,
      registerNumber: args.registerNumber,
      subtotal: args.subtotal,
      tax: args.tax,
      total: args.total,
      paymentMethod: args.paymentMethod,
      status: "completed",
      completedAt: Date.now(),
      customerInfo: args.customerInfo,
      receiptPrinted: false,
    });

    // Update customer statistics if customer is linked
    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId);
      if (customer) {
        await ctx.db.patch(args.customerId, {
          totalSpent: (customer.totalSpent || 0) + args.total,
          transactionCount: (customer.transactionCount || 0) + 1,
          lastTransactionAt: Date.now(),
        });
      }
    }

    // Create transaction items and update inventory
    const transactionItems = await Promise.all(
      args.items.map(async (item) => {
        // Get product details
        const sku = await ctx.db.get(item.skuId);
        if (!sku) {
          return {
            success: false,
            error: `SKU ${item.skuId} not found during transaction processing`,
          };
        }

        const image = item.image ?? sku.images?.[0];

        // Create transaction item
        const transactionItemId = await ctx.db.insert("posTransactionItem", {
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

        // Update inventory
        await ctx.db.patch(item.skuId, {
          quantityAvailable: sku.quantityAvailable - item.quantity,
          inventoryCount: Math.max(0, sku.inventoryCount - item.quantity),
        });

        return transactionItemId;
      })
    );

    return {
      success: true,
      transactionId,
      transactionNumber,
      transactionItems,
    };
  },
});

export const getTransaction = query({
  args: {
    transactionId: v.id("posTransaction"),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) return null;

    const items = await ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", args.transactionId)
      )
      .collect();

    return { ...transaction, items };
  },
});

export const getTransactionsByStore = query({
  args: {
    storeId: v.id("store"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const transactions = await ctx.db
      .query("posTransaction")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(args.limit || 50);

    return transactions;
  },
});

export const getCompletedTransactions = query({
  args: {
    storeId: v.id("store"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posTransaction"),
      transactionNumber: v.string(),
      total: v.number(),
      paymentMethod: v.string(),
      completedAt: v.number(),
      cashierName: v.union(v.string(), v.null()),
      customerName: v.union(v.string(), v.null()),
      itemCount: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const transactions = await ctx.db
      .query("posTransaction")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(limit);

    const completedTransactions = transactions.filter(
      (transaction) => transaction.status === "completed"
    );

    return Promise.all(
      completedTransactions.map(async (transaction) => {
        let cashierName: string | null = null;
        if (transaction.cashierId) {
          const cashier = await ctx.db.get(transaction.cashierId);
          if (cashier) {
            cashierName = [cashier.firstName, `${cashier.lastName.charAt(0)}.`]
              .filter(Boolean)
              .join(" ")
              .trim();
          }
        }

        let customerName: string | null = null;
        if (transaction.customerId) {
          const customer = await ctx.db.get(transaction.customerId);
          customerName = customer?.name ?? null;
        } else if (transaction.customerInfo?.name) {
          customerName = transaction.customerInfo.name;
        }

        const items = await ctx.db
          .query("posTransactionItem")
          .withIndex("by_transactionId", (q) =>
            q.eq("transactionId", transaction._id)
          )
          .collect();

        const itemCount = items.reduce((acc, item) => acc + item.quantity, 0);

        return {
          _id: transaction._id,
          transactionNumber: transaction.transactionNumber,
          total: transaction.total,
          paymentMethod: transaction.paymentMethod,
          completedAt: transaction.completedAt,
          cashierName: cashierName || null,
          customerName: customerName || null,
          itemCount,
        };
      })
    );
  },
});

export const getTransactionById = query({
  args: {
    transactionId: v.id("posTransaction"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("posTransaction"),
      transactionNumber: v.string(),
      subtotal: v.number(),
      tax: v.number(),
      total: v.number(),
      paymentMethod: v.string(),
      amountPaid: v.optional(v.number()),
      changeGiven: v.optional(v.number()),
      status: v.string(),
      completedAt: v.number(),
      notes: v.optional(v.string()),
      cashier: v.union(
        v.null(),
        v.object({
          _id: v.id("cashier"),
          firstName: v.string(),
          lastName: v.string(),
        })
      ),
      customer: v.union(
        v.null(),
        v.object({
          _id: v.optional(v.id("posCustomer")),
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
        })
      ),
      customerInfo: v.optional(
        v.object({
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
        })
      ),
      items: v.array(
        v.object({
          _id: v.id("posTransactionItem"),
          productId: v.id("product"),
          productSkuId: v.id("productSku"),
          productName: v.string(),
          productSku: v.string(),
          barcode: v.optional(v.string()),
          image: v.optional(v.string()),
          quantity: v.number(),
          unitPrice: v.number(),
          totalPrice: v.number(),
          discount: v.optional(v.number()),
          discountReason: v.optional(v.string()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) {
      return null;
    }

    const cashier = transaction.cashierId
      ? await ctx.db.get(transaction.cashierId)
      : null;

    const customer = transaction.customerId
      ? await ctx.db.get(transaction.customerId)
      : null;

    const items = await ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id)
      )
      .collect();

    return {
      _id: transaction._id,
      transactionNumber: transaction.transactionNumber,
      subtotal: transaction.subtotal ?? 0,
      tax: transaction.tax ?? 0,
      total: transaction.total,
      paymentMethod: transaction.paymentMethod,
      amountPaid: transaction.amountPaid,
      changeGiven: transaction.changeGiven,
      status: transaction.status,
      completedAt: transaction.completedAt,
      notes: transaction.notes,
      cashier: cashier
        ? {
            _id: cashier._id,
            firstName: cashier.firstName,
            lastName: cashier.lastName,
          }
        : null,
      customer: customer
        ? {
            _id: customer._id,
            name: customer.name ?? undefined,
            email: customer.email ?? undefined,
            phone: customer.phone ?? undefined,
          }
        : transaction.customerInfo
          ? {
              _id: undefined,
              name: transaction.customerInfo.name,
              email: transaction.customerInfo.email,
              phone: transaction.customerInfo.phone,
            }
          : null,
      customerInfo: transaction.customerInfo,
      items: items.map((item) => ({
        _id: item._id,
        productId: item.productId,
        productSkuId: item.productSkuId,
        productName: item.productName,
        productSku: item.productSku,
        barcode: item.barcode,
        image: item.image,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        discount: item.discount,
        discountReason: item.discountReason,
      })),
    };
  },
});

export const voidTransaction = mutation({
  args: {
    transactionId: v.id("posTransaction"),
    reason: v.string(),
    cashierId: v.optional(v.id("cashier")),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
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

    // Update transaction status
    await ctx.db.patch(args.transactionId, {
      status: "void",
      voidedAt: Date.now(),
      notes: args.reason,
    });

    // Restore inventory for all items
    const items = await ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", args.transactionId)
      )
      .collect();

    await Promise.all(
      items.map(async (item) => {
        const sku = await ctx.db.get(item.productSkuId);
        if (sku) {
          await ctx.db.patch(item.productSkuId, {
            quantityAvailable: sku.quantityAvailable + item.quantity,
            inventoryCount: sku.inventoryCount + item.quantity,
          });
        }
      })
    );

    return { success: true };
  },
});

// Create transaction from session (used by session completion)
export const createTransactionFromSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    paymentMethod: v.string(),
    amountPaid: v.number(),
    changeGiven: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    // Query all items for this session from posSessionItem table
    const items = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (items.length === 0) {
      throw new Error("Cannot complete session with no items");
    }

    // Note: Inventory is already held via quantityAvailable reduction
    // We only need to deduct from inventoryCount (actual stock)

    // Aggregate quantities by SKU to handle multiple items of the same product
    const skuQuantityMap = new Map<Id<"productSku">, number>();
    for (const item of items) {
      const currentQuantity = skuQuantityMap.get(item.productSkuId) || 0;
      skuQuantityMap.set(item.productSkuId, currentQuantity + item.quantity);
    }

    // Validate SKUs exist (holds should already be in place)
    for (const [skuId, totalQuantity] of skuQuantityMap) {
      const sku = await ctx.db.get(skuId);
      if (!sku) {
        throw new Error(`Product SKU ${skuId} not found`);
      }

      // Type guard to ensure we have a productSku
      if (!("inventoryCount" in sku) || !("sku" in sku)) {
        throw new Error(`Invalid product SKU data for ${skuId}`);
      }

      // Check inventoryCount (actual stock) is sufficient
      if (sku.inventoryCount < totalQuantity) {
        const item = items.find((item) => item.productSkuId === skuId);
        const itemName = item?.productName || "Unknown Product";
        throw new Error(
          `Insufficient inventory for ${capitalizeWords(itemName)} (${sku.sku}). In Stock: ${sku.inventoryCount}, Needed: ${totalQuantity}`
        );
      }
    }

    // Generate transaction number using shared utility
    const transactionNumber = generateTransactionNumber();

    // Calculate totals from session data
    const subtotal = session.subtotal || 0;
    const tax = session.tax || 0;
    const total = session.total || 0;

    // Create the POS transaction
    const transactionId = await ctx.db.insert("posTransaction", {
      transactionNumber,
      storeId: session.storeId,
      sessionId: args.sessionId, // Link to the session for audit trail
      customerId: session.customerId,
      cashierId: session.cashierId,
      registerNumber: session.registerNumber,
      subtotal,
      tax,
      total,
      paymentMethod: args.paymentMethod,
      amountPaid: args.amountPaid,
      changeGiven: args.changeGiven,
      status: "completed",
      completedAt: Date.now(),
      customerInfo: session.customerInfo,
      receiptPrinted: false,
      notes: args.notes,
    });

    // Update customer statistics if customer is linked
    if (session.customerId) {
      const customer = await ctx.db.get(session.customerId);
      if (customer) {
        await ctx.db.patch(session.customerId, {
          totalSpent: (customer.totalSpent || 0) + total,
          transactionCount: (customer.transactionCount || 0) + 1,
          lastTransactionAt: Date.now(),
        });
      }
    }

    // Create transaction items and update inventory
    const transactionItems = await Promise.all(
      items.map(async (item) => {
        // Get product details
        const sku = await ctx.db.get(item.productSkuId);
        if (!sku) {
          throw new Error(
            `SKU ${item.productSkuId} not found during transaction processing`
          );
        }

        const image = item.image ?? sku.images?.[0];

        // Create transaction item
        const transactionItemId = await ctx.db.insert("posTransactionItem", {
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

        // Update inventory
        // Note: quantityAvailable was already reduced when item was added to session (hold)
        // Now we need to:
        // 1. Reduce inventoryCount (actual stock)
        await ctx.db.patch(item.productSkuId, {
          inventoryCount: Math.max(0, sku.inventoryCount - item.quantity),
        });

        return transactionItemId;
      })
    );

    // Note: We preserve posSessionItem records and session data for audit purposes
    // They are NOT deleted after transaction completion

    // Link the transaction back to the session for bidirectional audit trail
    await ctx.db.patch(args.sessionId, {
      transactionId,
    });

    return {
      success: true,
      transactionId,
      transactionNumber,
      transactionItems: transactionItems.filter((item) => item !== null),
    };
  },
});

// Debug query to check recent transactions and their customer links
export const getRecentTransactionsWithCustomers = query({
  args: {
    storeId: v.id("store"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posTransaction"),
      transactionNumber: v.string(),
      total: v.number(),
      status: v.string(),
      completedAt: v.number(),
      customerId: v.optional(v.id("posCustomer")),
      customerInfo: v.optional(
        v.object({
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
        })
      ),
      customerName: v.union(v.string(), v.null()),
      hasCustomerLink: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const transactions = await ctx.db
      .query("posTransaction")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(args.limit || 10);

    // Enrich with customer data
    const enrichedTransactions = await Promise.all(
      transactions.map(async (transaction) => {
        let customerName = null;
        if (transaction.customerId) {
          const customer = await ctx.db.get(transaction.customerId);
          customerName = customer?.name || null;
        }

        return {
          _id: transaction._id,
          transactionNumber: transaction.transactionNumber,
          total: transaction.total,
          status: transaction.status,
          completedAt: transaction.completedAt,
          customerId: transaction.customerId,
          customerInfo: transaction.customerInfo,
          customerName,
          hasCustomerLink: !!transaction.customerId,
        };
      })
    );

    return enrichedTransactions;
  },
});

// Get all SKUs for a product

// Get today's transaction summary for POS dashboard
export const getTodaySummary = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.object({
    totalTransactions: v.number(),
    totalSales: v.number(),
    totalItemsSold: v.number(),
    averageTransaction: v.number(),
    date: v.string(),
  }),
  handler: async (ctx, args) => {
    // Get start and end of today in milliseconds
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

    // Get all completed transactions for today
    const todayTransactions = await ctx.db
      .query("posTransaction")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "completed"),
          q.gte(q.field("completedAt"), startOfDay),
          q.lte(q.field("completedAt"), endOfDay)
        )
      )
      .collect();

    // Calculate metrics
    const totalTransactions = todayTransactions.length;
    const totalSales = todayTransactions.reduce(
      (sum, transaction) => sum + transaction.total,
      0
    );

    // Get total items sold by summing transaction items
    let totalItemsSold = 0;
    for (const transaction of todayTransactions) {
      const transactionItems = await ctx.db
        .query("posTransactionItem")
        .withIndex("by_transactionId", (q) =>
          q.eq("transactionId", transaction._id)
        )
        .collect();

      totalItemsSold += transactionItems.reduce(
        (sum, item) => sum + item.quantity,
        0
      );
    }

    const averageTransaction =
      totalTransactions > 0 ? totalSales / totalTransactions : 0;

    return {
      totalTransactions,
      totalSales,
      totalItemsSold,
      averageTransaction,
      date: now.toISOString().split("T")[0], // YYYY-MM-DD format
    };
  },
});

// Debug query to check recent transactions and their customer links
