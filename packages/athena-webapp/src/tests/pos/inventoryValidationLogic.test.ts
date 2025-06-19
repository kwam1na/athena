import { describe, it, expect } from "vitest";

describe("Inventory Validation Logic for Transaction Completion", () => {
  // Mock types to represent the data structures
  interface MockCartItem {
    skuId: string;
    quantity: number;
    name: string;
    barcode: string;
  }

  interface MockProductSku {
    _id: string;
    quantityAvailable: number;
    sku: string;
    inventoryCount: number;
  }

  // Simulate the inventory validation logic from the backend
  const validateInventoryForTransaction = async (
    items: MockCartItem[],
    mockGetSku: (skuId: string) => MockProductSku | null
  ) => {
    // Aggregate quantities by SKU to handle multiple items of the same product
    const skuQuantityMap = new Map<string, number>();

    for (const item of items) {
      const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
      skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
    }

    // Validate each unique SKU against its total required quantity
    for (const [skuId, totalQuantity] of skuQuantityMap) {
      const sku = mockGetSku(skuId);
      if (!sku) {
        return {
          success: false,
          error: `Product SKU ${skuId} not found`,
        };
      }

      if (sku.quantityAvailable < totalQuantity) {
        const itemName =
          items.find((item) => item.skuId === skuId)?.name || "Unknown Product";
        return {
          success: false,
          error: `Insufficient inventory for ${itemName} (${sku.sku}). Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
        };
      }
    }

    return { success: true };
  };

  describe("Single Item Validation", () => {
    it("should pass validation when sufficient inventory is available", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 3,
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 10, // Sufficient inventory
            sku: "123456789",
            inventoryCount: 10,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(true);
    });

    it("should fail validation when insufficient inventory", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 5,
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 2, // Insufficient inventory
            sku: "123456789",
            inventoryCount: 2,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient inventory");
      expect(result.error).toContain("Test Product");
      expect(result.error).toContain("Available: 2");
      expect(result.error).toContain("Total Requested: 5");
    });

    it("should handle exact inventory match", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 3,
          name: "Limited Product",
          barcode: "789012345",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 3, // Exactly what's requested
            sku: "789012345",
            inventoryCount: 3,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(true);
    });

    it("should fail when SKU is not found", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-missing",
          quantity: 1,
          name: "Missing Product",
          barcode: "000000000",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        return null; // SKU not found
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Product SKU sku-missing not found");
    });
  });

  describe("Multiple Items Validation", () => {
    it("should validate multiple different products", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 2,
          name: "Product A",
          barcode: "123456789",
        },
        {
          skuId: "sku-456",
          quantity: 1,
          name: "Product B",
          barcode: "987654321",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 5,
            sku: "123456789",
            inventoryCount: 5,
          };
        }
        if (skuId === "sku-456") {
          return {
            _id: "sku-456",
            quantityAvailable: 3,
            sku: "987654321",
            inventoryCount: 3,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(true);
    });

    it("should fail when one product has insufficient inventory", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 2,
          name: "Product A",
          barcode: "123456789",
        },
        {
          skuId: "sku-456",
          quantity: 5, // Exceeds available inventory
          name: "Product B",
          barcode: "987654321",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 5,
            sku: "123456789",
            inventoryCount: 5,
          };
        }
        if (skuId === "sku-456") {
          return {
            _id: "sku-456",
            quantityAvailable: 2, // Insufficient for requested 5
            sku: "987654321",
            inventoryCount: 2,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Product B");
      expect(result.error).toContain("Available: 2");
      expect(result.error).toContain("Total Requested: 5");
    });
  });

  describe("Quantity Aggregation", () => {
    it("should aggregate quantities for same SKU", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 2,
          name: "Test Product",
          barcode: "123456789",
        },
        {
          skuId: "sku-123",
          quantity: 3, // Same SKU, different cart item
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 10, // Sufficient for total 5
            sku: "123456789",
            inventoryCount: 10,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(true);
    });

    it("should fail when aggregated quantity exceeds inventory", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 3,
          name: "Test Product",
          barcode: "123456789",
        },
        {
          skuId: "sku-123",
          quantity: 4, // Total: 7, exceeds available 5
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 5, // Insufficient for total 7
            sku: "123456789",
            inventoryCount: 5,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Available: 5");
      expect(result.error).toContain("Total Requested: 7");
    });

    it("should handle complex aggregation with multiple SKUs", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 2,
          name: "Product A",
          barcode: "123456789",
        },
        {
          skuId: "sku-456",
          quantity: 1,
          name: "Product B",
          barcode: "987654321",
        },
        {
          skuId: "sku-123",
          quantity: 1, // Additional quantity for sku-123
          name: "Product A",
          barcode: "123456789",
        },
        {
          skuId: "sku-789",
          quantity: 2,
          name: "Product C",
          barcode: "456789123",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 3, // Total requested: 3 (2+1)
            sku: "123456789",
            inventoryCount: 3,
          };
        }
        if (skuId === "sku-456") {
          return {
            _id: "sku-456",
            quantityAvailable: 2, // Total requested: 1
            sku: "987654321",
            inventoryCount: 2,
          };
        }
        if (skuId === "sku-789") {
          return {
            _id: "sku-789",
            quantityAvailable: 5, // Total requested: 2
            sku: "456789123",
            inventoryCount: 5,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero inventory", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: 1,
          name: "Out of Stock Product",
          barcode: "000000001",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 0, // No inventory
            sku: "000000001",
            inventoryCount: 0,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Available: 0");
      expect(result.error).toContain("Total Requested: 1");
    });

    it("should handle empty cart", async () => {
      const cartItems: MockCartItem[] = [];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(true); // Empty cart should pass validation
    });

    it("should handle negative quantities gracefully", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-123",
          quantity: -1, // Negative quantity (shouldn't happen in real usage)
          name: "Test Product",
          barcode: "123456789",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-123") {
          return {
            _id: "sku-123",
            quantityAvailable: 5,
            sku: "123456789",
            inventoryCount: 5,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      // Negative quantities should be treated as 0 or pass validation
      expect(result.success).toBe(true);
    });
  });

  describe("Real-world Scenarios", () => {
    it("should handle large order with mixed inventory levels", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-high-stock",
          quantity: 10,
          name: "High Stock Product",
          barcode: "111111111",
        },
        {
          skuId: "sku-medium-stock",
          quantity: 5,
          name: "Medium Stock Product",
          barcode: "222222222",
        },
        {
          skuId: "sku-low-stock",
          quantity: 2,
          name: "Low Stock Product",
          barcode: "333333333",
        },
        {
          skuId: "sku-high-stock",
          quantity: 5, // Additional quantity for high stock
          name: "High Stock Product",
          barcode: "111111111",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-high-stock") {
          return {
            _id: "sku-high-stock",
            quantityAvailable: 100, // Total requested: 15
            sku: "111111111",
            inventoryCount: 100,
          };
        }
        if (skuId === "sku-medium-stock") {
          return {
            _id: "sku-medium-stock",
            quantityAvailable: 10, // Total requested: 5
            sku: "222222222",
            inventoryCount: 10,
          };
        }
        if (skuId === "sku-low-stock") {
          return {
            _id: "sku-low-stock",
            quantityAvailable: 3, // Total requested: 2
            sku: "333333333",
            inventoryCount: 3,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(true);
    });

    it("should fail when one item in large order exceeds inventory", async () => {
      const cartItems: MockCartItem[] = [
        {
          skuId: "sku-high-stock",
          quantity: 10,
          name: "High Stock Product",
          barcode: "111111111",
        },
        {
          skuId: "sku-medium-stock",
          quantity: 5,
          name: "Medium Stock Product",
          barcode: "222222222",
        },
        {
          skuId: "sku-low-stock",
          quantity: 5, // Exceeds available inventory
          name: "Low Stock Product",
          barcode: "333333333",
        },
      ];

      const mockGetSku = (skuId: string): MockProductSku | null => {
        if (skuId === "sku-high-stock") {
          return {
            _id: "sku-high-stock",
            quantityAvailable: 100,
            sku: "111111111",
            inventoryCount: 100,
          };
        }
        if (skuId === "sku-medium-stock") {
          return {
            _id: "sku-medium-stock",
            quantityAvailable: 10,
            sku: "222222222",
            inventoryCount: 10,
          };
        }
        if (skuId === "sku-low-stock") {
          return {
            _id: "sku-low-stock",
            quantityAvailable: 3, // Insufficient for requested 5
            sku: "333333333",
            inventoryCount: 3,
          };
        }
        return null;
      };

      const result = await validateInventoryForTransaction(
        cartItems,
        mockGetSku
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Low Stock Product");
      expect(result.error).toContain("Available: 3");
      expect(result.error).toContain("Total Requested: 5");
    });
  });
});
