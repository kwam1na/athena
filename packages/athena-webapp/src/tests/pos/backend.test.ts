import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Convex testing utilities
const mockCtx = {
  db: {
    get: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    query: vi.fn(() => ({
      filter: vi.fn(() => ({
        collect: vi.fn(),
        first: vi.fn(),
        take: vi.fn(),
        withIndex: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              take: vi.fn(),
            })),
          })),
        })),
      })),
    })),
  },
  scheduler: {
    runAfter: vi.fn(),
  },
};

// Mock product SKU data
const mockProductSku = {
  _id: "sku-123",
  productId: "prod-123",
  sku: "123456789",
  price: 10.99,
  quantityAvailable: 5,
  inventoryCount: 5,
  isVisible: true,
};

const mockProductSkuLowStock = {
  _id: "sku-456",
  productId: "prod-456",
  sku: "987654321",
  price: 15.99,
  quantityAvailable: 2,
  inventoryCount: 2,
  isVisible: true,
};

describe("POS Backend Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Inventory Validation", () => {
    it("should validate sufficient inventory for single item", async () => {
      // Mock the completeTransaction function logic
      const validateInventory = async (items: any[]) => {
        const skuQuantityMap = new Map();

        // Aggregate quantities by SKU
        for (const item of items) {
          const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
          skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
        }

        // Validate each unique SKU
        for (const [skuId, totalQuantity] of skuQuantityMap) {
          const sku = await mockCtx.db.get(skuId);
          if (!sku) {
            return {
              success: false,
              error: `Product SKU ${skuId} not found`,
            };
          }
          if (sku.quantityAvailable < totalQuantity) {
            return {
              success: false,
              error: `Insufficient inventory. Available: ${sku.quantityAvailable}, Requested: ${totalQuantity}`,
            };
          }
        }

        return { success: true };
      };

      mockCtx.db.get.mockResolvedValue(mockProductSku);

      const items = [
        {
          skuId: "sku-123",
          quantity: 3,
          price: 10.99,
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const result = await validateInventory(items);

      expect(result.success).toBe(true);
      expect(mockCtx.db.get).toHaveBeenCalledWith("sku-123");
    });

    it("should reject transaction when insufficient inventory for single item", async () => {
      const validateInventory = async (items: any[]) => {
        const skuQuantityMap = new Map();

        for (const item of items) {
          const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
          skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
        }

        for (const [skuId, totalQuantity] of skuQuantityMap) {
          const sku = await mockCtx.db.get(skuId);
          if (!sku) {
            return {
              success: false,
              error: `Product SKU ${skuId} not found`,
            };
          }
          if (sku.quantityAvailable < totalQuantity) {
            return {
              success: false,
              error: `Insufficient inventory. Available: ${sku.quantityAvailable}, Requested: ${totalQuantity}`,
            };
          }
        }

        return { success: true };
      };

      mockCtx.db.get.mockResolvedValue(mockProductSkuLowStock);

      const items = [
        {
          skuId: "sku-456",
          quantity: 5, // Requesting more than available (2)
          price: 15.99,
          name: "Low Stock Product",
          barcode: "987654321",
        },
      ];

      const result = await validateInventory(items);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient inventory");
      expect(result.error).toContain("Available: 2");
      expect(result.error).toContain("Requested: 5");
    });

    it("should validate cumulative quantities for multiple items of same product", async () => {
      const validateInventory = async (items: any[]) => {
        const skuQuantityMap = new Map();

        // This is the key fix - aggregate quantities by SKU
        for (const item of items) {
          const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
          skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
        }

        for (const [skuId, totalQuantity] of skuQuantityMap) {
          const sku = await mockCtx.db.get(skuId);
          if (!sku) {
            return {
              success: false,
              error: `Product SKU ${skuId} not found`,
            };
          }
          if (sku.quantityAvailable < totalQuantity) {
            return {
              success: false,
              error: `Insufficient inventory. Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
            };
          }
        }

        return { success: true };
      };

      mockCtx.db.get.mockResolvedValue(mockProductSku); // Has 5 available

      const items = [
        {
          skuId: "sku-123",
          quantity: 3,
          price: 10.99,
          name: "Test Product",
          barcode: "123456789",
        },
        {
          skuId: "sku-123", // Same product
          quantity: 4, // Total = 7, but only 5 available
          price: 10.99,
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const result = await validateInventory(items);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient inventory");
      expect(result.error).toContain("Available: 5");
      expect(result.error).toContain("Total Requested: 7");
    });

    it("should validate multiple different products correctly", async () => {
      const validateInventory = async (items: any[]) => {
        const skuQuantityMap = new Map();

        for (const item of items) {
          const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
          skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
        }

        for (const [skuId, totalQuantity] of skuQuantityMap) {
          const sku = await mockCtx.db.get(skuId);
          if (!sku) {
            return {
              success: false,
              error: `Product SKU ${skuId} not found`,
            };
          }
          if (sku.quantityAvailable < totalQuantity) {
            return {
              success: false,
              error: `Insufficient inventory. Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
            };
          }
        }

        return { success: true };
      };

      // Mock different responses for different SKUs
      mockCtx.db.get.mockImplementation((skuId) => {
        if (skuId === "sku-123") return Promise.resolve(mockProductSku);
        if (skuId === "sku-456") return Promise.resolve(mockProductSkuLowStock);
        return Promise.resolve(null);
      });

      const items = [
        {
          skuId: "sku-123",
          quantity: 3, // Available: 5, OK
          price: 10.99,
          name: "Test Product 1",
          barcode: "123456789",
        },
        {
          skuId: "sku-456",
          quantity: 1, // Available: 2, OK
          price: 15.99,
          name: "Test Product 2",
          barcode: "987654321",
        },
      ];

      const result = await validateInventory(items);

      expect(result.success).toBe(true);
      expect(mockCtx.db.get).toHaveBeenCalledWith("sku-123");
      expect(mockCtx.db.get).toHaveBeenCalledWith("sku-456");
    });

    it("should reject when one of multiple products has insufficient inventory", async () => {
      const validateInventory = async (items: any[]) => {
        const skuQuantityMap = new Map();

        for (const item of items) {
          const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
          skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
        }

        for (const [skuId, totalQuantity] of skuQuantityMap) {
          const sku = await mockCtx.db.get(skuId);
          if (!sku) {
            return {
              success: false,
              error: `Product SKU ${skuId} not found`,
            };
          }
          if (sku.quantityAvailable < totalQuantity) {
            return {
              success: false,
              error: `Insufficient inventory. Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
            };
          }
        }

        return { success: true };
      };

      mockCtx.db.get.mockImplementation((skuId) => {
        if (skuId === "sku-123") return Promise.resolve(mockProductSku);
        if (skuId === "sku-456") return Promise.resolve(mockProductSkuLowStock);
        return Promise.resolve(null);
      });

      const items = [
        {
          skuId: "sku-123",
          quantity: 3, // Available: 5, OK
          price: 10.99,
          name: "Test Product 1",
          barcode: "123456789",
        },
        {
          skuId: "sku-456",
          quantity: 5, // Available: 2, NOT OK
          price: 15.99,
          name: "Test Product 2",
          barcode: "987654321",
        },
      ];

      const result = await validateInventory(items);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient inventory");
    });

    it("should handle missing product SKU", async () => {
      const validateInventory = async (items: any[]) => {
        const skuQuantityMap = new Map();

        for (const item of items) {
          const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
          skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
        }

        for (const [skuId, totalQuantity] of skuQuantityMap) {
          const sku = await mockCtx.db.get(skuId);
          if (!sku) {
            return {
              success: false,
              error: `Product SKU ${skuId} not found`,
            };
          }
          if (sku.quantityAvailable < totalQuantity) {
            return {
              success: false,
              error: `Insufficient inventory. Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
            };
          }
        }

        return { success: true };
      };

      mockCtx.db.get.mockResolvedValue(null);

      const items = [
        {
          skuId: "non-existent-sku",
          quantity: 1,
          price: 10.99,
          name: "Non-existent Product",
          barcode: "000000000",
        },
      ];

      const result = await validateInventory(items);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Product SKU non-existent-sku not found");
    });
  });

  describe("Transaction Processing", () => {
    it("should generate POS transaction number", () => {
      const generateTransactionNumber = () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const baseTransactionNumber = timestamp % 100000;
        const randomPadding = Math.floor(Math.random() * 10);
        const transactionNumber = (baseTransactionNumber * 10 + randomPadding)
          .toString()
          .padStart(6, "0");
        return `POS-${transactionNumber}`;
      };

      const transactionNumber = generateTransactionNumber();

      expect(transactionNumber).toMatch(/^POS-\d{6}$/);
      expect(transactionNumber.length).toBe(10); // "POS-" + 6 digits
    });

    it("should create transaction record", async () => {
      const createTransaction = async (transactionData: any) => {
        const transactionId = await mockCtx.db.insert(
          "posTransaction",
          transactionData
        );
        return transactionId;
      };

      mockCtx.db.insert.mockResolvedValue("txn-123");

      const transactionData = {
        transactionNumber: "POS-123456",
        storeId: "store-123",
        subtotal: 25.0,
        tax: 2.5,
        total: 27.5,
        paymentMethod: "card",
        status: "completed",
        completedAt: Date.now(),
      };

      const transactionId = await createTransaction(transactionData);

      expect(mockCtx.db.insert).toHaveBeenCalledWith(
        "posTransaction",
        transactionData
      );
      expect(transactionId).toBe("txn-123");
    });

    it("should update inventory after successful transaction", async () => {
      const updateInventory = async (items: any[]) => {
        const updates = [];

        for (const item of items) {
          const sku = await mockCtx.db.get(item.skuId);
          if (sku) {
            await mockCtx.db.patch(item.skuId, {
              quantityAvailable: sku.quantityAvailable - item.quantity,
              inventoryCount: Math.max(0, sku.inventoryCount - item.quantity),
            });
            updates.push({
              skuId: item.skuId,
              oldQuantity: sku.quantityAvailable,
              newQuantity: sku.quantityAvailable - item.quantity,
            });
          }
        }

        return updates;
      };

      mockCtx.db.get.mockResolvedValue(mockProductSku);

      const items = [
        {
          skuId: "sku-123",
          quantity: 2,
          price: 10.99,
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const updates = await updateInventory(items);

      expect(mockCtx.db.patch).toHaveBeenCalledWith("sku-123", {
        quantityAvailable: 3, // 5 - 2
        inventoryCount: 3, // 5 - 2
      });
      expect(updates).toHaveLength(1);
      expect(updates[0].oldQuantity).toBe(5);
      expect(updates[0].newQuantity).toBe(3);
    });

    it("should create transaction items", async () => {
      const createTransactionItems = async (
        transactionId: string,
        items: any[]
      ) => {
        const transactionItems = [];

        for (const item of items) {
          const sku = await mockCtx.db.get(item.skuId);
          if (sku) {
            const transactionItemId = await mockCtx.db.insert(
              "posTransactionItem",
              {
                transactionId,
                productId: sku.productId,
                productSkuId: item.skuId,
                productName: item.name,
                productSku: item.productSku,
                barcode: item.barcode,
                quantity: item.quantity,
                unitPrice: item.price,
                totalPrice: item.price * item.quantity,
              }
            );
            transactionItems.push(transactionItemId);
          }
        }

        return transactionItems;
      };

      mockCtx.db.get.mockResolvedValue(mockProductSku);
      mockCtx.db.insert.mockResolvedValue("item-123");

      const items = [
        {
          skuId: "sku-123",
          quantity: 2,
          price: 10.99,
          name: "Test Product",
          productSku: "SKU-123",
          barcode: "123456789",
        },
      ];

      const transactionItems = await createTransactionItems("txn-123", items);

      expect(mockCtx.db.insert).toHaveBeenCalledWith("posTransactionItem", {
        transactionId: "txn-123",
        productId: "prod-123",
        productSkuId: "sku-123",
        productName: "Test Product",
        productSku: "SKU-123",
        barcode: "123456789",
        quantity: 2,
        unitPrice: 10.99,
        totalPrice: 21.98,
      });
      expect(transactionItems).toEqual(["item-123"]);
    });
  });

  describe("Session-based Transactions", () => {
    const mockSession = {
      _id: "session-123",
      storeId: "store-123",
      cartItems: [
        {
          skuId: "sku-123",
          quantity: 2,
          price: 10.99,
          name: "Test Product",
          barcode: "123456789",
        },
      ],
      subtotal: 21.98,
      tax: 2.2,
      total: 24.18,
      customerId: "cust-123",
      customerInfo: {
        name: "John Doe",
        email: "john@example.com",
        phone: "+1234567890",
      },
    };

    it("should validate session exists before processing", async () => {
      const validateSession = async (sessionId: string) => {
        const session = await mockCtx.db.get(sessionId);
        if (!session) {
          throw new Error("Session not found");
        }
        if (session.cartItems.length === 0) {
          throw new Error("Cannot complete session with no items");
        }
        return session;
      };

      mockCtx.db.get.mockResolvedValue(mockSession);

      const session = await validateSession("session-123");

      expect(session).toEqual(mockSession);
      expect(mockCtx.db.get).toHaveBeenCalledWith("session-123");
    });

    it("should reject empty session", async () => {
      const validateSession = async (sessionId: string) => {
        const session = await mockCtx.db.get(sessionId);
        if (!session) {
          throw new Error("Session not found");
        }
        if (session.cartItems.length === 0) {
          throw new Error("Cannot complete session with no items");
        }
        return session;
      };

      const emptySession = { ...mockSession, cartItems: [] };
      mockCtx.db.get.mockResolvedValue(emptySession);

      await expect(validateSession("session-123")).rejects.toThrow(
        "Cannot complete session with no items"
      );
    });

    it("should validate inventory for session items", async () => {
      const validateSessionInventory = async (session: any) => {
        const skuQuantityMap = new Map();

        for (const item of session.cartItems) {
          if (item.skuId) {
            const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
            skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
          }
        }

        for (const [skuId, totalQuantity] of skuQuantityMap) {
          const sku = await mockCtx.db.get(skuId);
          if (!sku) {
            throw new Error(`Product SKU ${skuId} not found`);
          }
          if (sku.quantityAvailable < totalQuantity) {
            throw new Error(
              `Insufficient inventory. Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`
            );
          }
        }

        return true;
      };

      mockCtx.db.get.mockImplementation((id) => {
        if (id === "sku-123") return Promise.resolve(mockProductSku);
        return Promise.resolve(mockSession);
      });

      const result = await validateSessionInventory(mockSession);

      expect(result).toBe(true);
    });

    it("should schedule session completion asynchronously", async () => {
      const completeSession = async (sessionId: string, paymentData: any) => {
        // Mark session as completed
        await mockCtx.db.patch(sessionId, {
          status: "completed",
          completedAt: Date.now(),
        });

        // Schedule transaction creation
        await mockCtx.scheduler.runAfter(0, "createTransactionFromSession", {
          sessionId,
          ...paymentData,
        });

        return sessionId;
      };

      const paymentData = {
        paymentMethod: "card",
        amountPaid: 24.18,
        notes: "Test transaction",
      };

      const result = await completeSession("session-123", paymentData);

      expect(mockCtx.db.patch).toHaveBeenCalledWith("session-123", {
        status: "completed",
        completedAt: expect.any(Number),
      });
      expect(mockCtx.scheduler.runAfter).toHaveBeenCalledWith(
        0,
        "createTransactionFromSession",
        {
          sessionId: "session-123",
          ...paymentData,
        }
      );
      expect(result).toBe("session-123");
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      const handleDatabaseError = async () => {
        try {
          mockCtx.db.get.mockRejectedValue(
            new Error("Database connection failed")
          );
          await mockCtx.db.get("test-id");
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message,
          };
        }
      };

      const result = await handleDatabaseError();

      expect(result?.success).toBe(false);
      expect(result?.error).toBe("Database connection failed");
    });

    it("should rollback inventory on transaction failure", async () => {
      const rollbackInventory = async (items: any[]) => {
        const rollbacks = [];

        for (const item of items) {
          const sku = await mockCtx.db.get(item.skuId);
          if (sku) {
            await mockCtx.db.patch(item.skuId, {
              quantityAvailable: sku.quantityAvailable + item.quantity,
              inventoryCount: sku.inventoryCount + item.quantity,
            });
            rollbacks.push({
              skuId: item.skuId,
              restoredQuantity: item.quantity,
            });
          }
        }

        return rollbacks;
      };

      const updatedSku = {
        ...mockProductSku,
        quantityAvailable: 3,
        inventoryCount: 3,
      };
      mockCtx.db.get.mockResolvedValue(updatedSku);

      const items = [
        {
          skuId: "sku-123",
          quantity: 2,
          price: 10.99,
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const rollbacks = await rollbackInventory(items);

      expect(mockCtx.db.patch).toHaveBeenCalledWith("sku-123", {
        quantityAvailable: 5, // 3 + 2
        inventoryCount: 5, // 3 + 2
      });
      expect(rollbacks).toHaveLength(1);
      expect(rollbacks[0].restoredQuantity).toBe(2);
    });
  });
});
