import { describe, it, expect } from "vitest";

describe("POS System - Basic Tests", () => {
  describe("Cart Calculations", () => {
    it("should calculate subtotal correctly", () => {
      const items = [
        { price: 10.99, quantity: 2 },
        { price: 5.99, quantity: 1 },
      ];

      const subtotal = items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      expect(subtotal).toBe(27.97); // (10.99 * 2) + (5.99 * 1)
    });

    it("should calculate tax correctly", () => {
      const subtotal = 100.0;
      const taxRate = 0.1; // 10%
      const tax = subtotal * taxRate;

      expect(tax).toBe(10.0);
    });

    it("should calculate total correctly", () => {
      const subtotal = 100.0;
      const tax = 10.0;
      const total = subtotal + tax;

      expect(total).toBe(110.0);
    });
  });

  describe("Transaction Number Generation", () => {
    it("should generate POS transaction number with correct format", () => {
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

    it("should generate unique transaction numbers", () => {
      const generateTransactionNumber = () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const baseTransactionNumber = timestamp % 100000;
        const randomPadding = Math.floor(Math.random() * 10);
        const transactionNumber = (baseTransactionNumber * 10 + randomPadding)
          .toString()
          .padStart(6, "0");
        return `POS-${transactionNumber}`;
      };

      const numbers = new Set();
      for (let i = 0; i < 100; i++) {
        numbers.add(generateTransactionNumber());
      }

      // Should generate some unique numbers (allowing for collisions due to timing and random padding)
      expect(numbers.size).toBeGreaterThan(5);
    });
  });

  describe("Inventory Validation Logic", () => {
    it("should validate single item inventory", () => {
      const validateInventory = (
        items: Array<{ skuId: string; quantity: number }>,
        inventory: Record<string, number>
      ) => {
        for (const item of items) {
          const available = inventory[item.skuId] || 0;
          if (available < item.quantity) {
            return {
              success: false,
              error: `Insufficient inventory for ${item.skuId}. Available: ${available}, Requested: ${item.quantity}`,
            };
          }
        }
        return { success: true };
      };

      const items = [{ skuId: "sku-123", quantity: 3 }];
      const inventory = { "sku-123": 5 };

      const result = validateInventory(items, inventory);

      expect(result.success).toBe(true);
    });

    it("should reject insufficient inventory", () => {
      const validateInventory = (
        items: Array<{ skuId: string; quantity: number }>,
        inventory: Record<string, number>
      ) => {
        for (const item of items) {
          const available = inventory[item.skuId] || 0;
          if (available < item.quantity) {
            return {
              success: false,
              error: `Insufficient inventory for ${item.skuId}. Available: ${available}, Requested: ${item.quantity}`,
            };
          }
        }
        return { success: true };
      };

      const items = [{ skuId: "sku-123", quantity: 10 }];
      const inventory = { "sku-123": 5 };

      const result = validateInventory(items, inventory);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient inventory");
      expect(result.error).toContain("Available: 5");
      expect(result.error).toContain("Requested: 10");
    });

    it("should validate cumulative quantities for same SKU", () => {
      const validateInventoryWithAggregation = (
        items: Array<{ skuId: string; quantity: number }>,
        inventory: Record<string, number>
      ) => {
        // Aggregate quantities by SKU (this is the key fix)
        const skuQuantityMap = new Map<string, number>();

        for (const item of items) {
          const currentQuantity = skuQuantityMap.get(item.skuId) || 0;
          skuQuantityMap.set(item.skuId, currentQuantity + item.quantity);
        }

        // Validate each unique SKU against total required quantity
        for (const [skuId, totalQuantity] of skuQuantityMap) {
          const available = inventory[skuId] || 0;
          if (available < totalQuantity) {
            return {
              success: false,
              error: `Insufficient inventory for ${skuId}. Available: ${available}, Total Requested: ${totalQuantity}`,
            };
          }
        }

        return { success: true };
      };

      // Multiple items of same product
      const items = [
        { skuId: "sku-123", quantity: 3 },
        { skuId: "sku-123", quantity: 4 }, // Total = 7
      ];
      const inventory = { "sku-123": 5 }; // Only 5 available

      const result = validateInventoryWithAggregation(items, inventory);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Total Requested: 7");
      expect(result.error).toContain("Available: 5");
    });
  });

  describe("Currency Formatting", () => {
    it("should format currency correctly", () => {
      const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(amount);
      };

      expect(formatCurrency(10.99)).toBe("$10.99");
      expect(formatCurrency(0)).toBe("$0.00");
      expect(formatCurrency(1000.5)).toBe("$1,000.50");
    });

    it("should handle decimal precision", () => {
      const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(amount);
      };

      expect(formatCurrency(10.999)).toBe("$11.00"); // Rounds up
      expect(formatCurrency(10.001)).toBe("$10.00"); // Rounds down
      expect(formatCurrency(10.5)).toBe("$10.50");
    });
  });

  describe("Payment Method Formatting", () => {
    it("should format payment methods correctly", () => {
      const formatPaymentMethod = (method: string) => {
        switch (method) {
          case "card":
            return "Credit/Debit Card";
          case "cash":
            return "Cash";
          case "digital_wallet":
            return "Digital Wallet";
          case "check":
            return "Check";
          default:
            return method.charAt(0).toUpperCase() + method.slice(1);
        }
      };

      expect(formatPaymentMethod("card")).toBe("Credit/Debit Card");
      expect(formatPaymentMethod("cash")).toBe("Cash");
      expect(formatPaymentMethod("digital_wallet")).toBe("Digital Wallet");
      expect(formatPaymentMethod("unknown")).toBe("Unknown");
    });
  });

  describe("Date Formatting", () => {
    it("should format dates for receipts", () => {
      const formatReceiptDate = (date: Date) => {
        return {
          date: date.toLocaleDateString("en-US"),
          time: date.toLocaleTimeString("en-US"),
        };
      };

      const testDate = new Date("2024-01-15T10:30:00Z");
      const formatted = formatReceiptDate(testDate);

      expect(formatted.date).toBe("1/15/2024");
      expect(formatted.time).toBe("10:30:00 AM");
    });
  });

  describe("Cart Item Management", () => {
    it("should add items to cart correctly", () => {
      interface CartItem {
        id: string;
        name: string;
        price: number;
        quantity: number;
      }

      const addToCart = (cart: CartItem[], newItem: Omit<CartItem, "id">) => {
        const existingItem = cart.find((item) => item.name === newItem.name);

        if (existingItem) {
          return cart.map((item) =>
            item.name === newItem.name
              ? { ...item, quantity: item.quantity + newItem.quantity }
              : item
          );
        } else {
          return [...cart, { ...newItem, id: Date.now().toString() }];
        }
      };

      let cart: CartItem[] = [];

      // Add first item
      cart = addToCart(cart, { name: "Product A", price: 10.99, quantity: 1 });
      expect(cart).toHaveLength(1);
      expect(cart[0].quantity).toBe(1);

      // Add same item again
      cart = addToCart(cart, { name: "Product A", price: 10.99, quantity: 2 });
      expect(cart).toHaveLength(1);
      expect(cart[0].quantity).toBe(3);

      // Add different item
      cart = addToCart(cart, { name: "Product B", price: 5.99, quantity: 1 });
      expect(cart).toHaveLength(2);
    });

    it("should remove items from cart correctly", () => {
      interface CartItem {
        id: string;
        name: string;
        price: number;
        quantity: number;
      }

      const removeFromCart = (cart: CartItem[], itemId: string) => {
        return cart.filter((item) => item.id !== itemId);
      };

      const cart: CartItem[] = [
        { id: "1", name: "Product A", price: 10.99, quantity: 1 },
        { id: "2", name: "Product B", price: 5.99, quantity: 2 },
      ];

      const updatedCart = removeFromCart(cart, "1");

      expect(updatedCart).toHaveLength(1);
      expect(updatedCart[0].name).toBe("Product B");
    });

    it("should update item quantities correctly", () => {
      interface CartItem {
        id: string;
        name: string;
        price: number;
        quantity: number;
      }

      const updateQuantity = (
        cart: CartItem[],
        itemId: string,
        newQuantity: number
      ) => {
        if (newQuantity <= 0) {
          return cart.filter((item) => item.id !== itemId);
        }

        return cart.map((item) =>
          item.id === itemId ? { ...item, quantity: newQuantity } : item
        );
      };

      let cart: CartItem[] = [
        { id: "1", name: "Product A", price: 10.99, quantity: 1 },
      ];

      // Update to higher quantity
      cart = updateQuantity(cart, "1", 5);
      expect(cart[0].quantity).toBe(5);

      // Update to zero (should remove)
      cart = updateQuantity(cart, "1", 0);
      expect(cart).toHaveLength(0);
    });
  });
});
