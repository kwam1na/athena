import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePOSOperations } from "@/hooks/usePOSOperations";
import type { CartItem, CustomerInfo } from "@/components/pos/types";

// Mock Convex hooks
const mockCompleteTransaction = vi.fn();
const mockCompleteSession = vi.fn();
const mockCreateCustomer = vi.fn();

// Mock Convex hooks
vi.mock("convex/react", () => ({
  useMutation: vi.fn(() => vi.fn()),
  useQuery: vi.fn(() => null),
  useAction: vi.fn(() => vi.fn()),
}));

describe("usePOSOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Cart Operations", () => {
    it("should add product to cart", () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockProduct = {
        id: "test-product-1",
        name: "Test Product",
        barcode: "123456789",
        price: 10.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct);
      });

      expect(result.current.state.cartItems).toHaveLength(1);
      expect(result.current.state.cartItems[0].name).toBe("Test Product");
      expect(result.current.state.cartItems[0].price).toBe(10.99);
    });

    it("should update item quantity", () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockProduct = {
        id: "test-product-1",
        name: "Test Product",
        barcode: "123456789",
        price: 10.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct);
      });

      const itemId = result.current.state.cartItems[0].id;

      act(() => {
        result.current.cart.updateQuantity(itemId, 3);
      });

      expect(result.current.state.cartItems[0].quantity).toBe(3);
    });

    it("should remove item from cart", () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockProduct = {
        id: "test-product-1",
        name: "Test Product",
        barcode: "123456789",
        price: 10.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct);
      });

      const itemId = result.current.state.cartItems[0].id;

      act(() => {
        result.current.cart.removeItem(itemId);
      });

      expect(result.current.state.cartItems).toHaveLength(0);
    });

    it("should clear entire cart", () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockProduct1 = {
        id: "test-product-1",
        name: "Test Product 1",
        barcode: "123456789",
        price: 10.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      const mockProduct2 = {
        id: "test-product-2",
        name: "Test Product 2",
        barcode: "987654321",
        price: 5.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 5,
        skuId: "sku-456" as any,
        productId: "prod-456" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct1);
        result.current.cart.addProduct(mockProduct2);
      });

      expect(result.current.state.cartItems).toHaveLength(2);

      act(() => {
        result.current.cart.clearCart();
      });

      expect(result.current.state.cartItems).toHaveLength(0);
    });

    it("should add product from barcode", async () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockBarcodeResult = {
        id: "sku-123",
        name: "Barcode Product",
        barcode: "123456789",
        price: 15.99,
        category: "Scanned Category",
        description: "Scanned Description",
        inStock: true,
        quantityAvailable: 8,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      await act(async () => {
        await result.current.cart.addFromBarcode(
          "123456789",
          mockBarcodeResult
        );
      });

      expect(result.current.state.cartItems).toHaveLength(1);
      expect(result.current.state.cartItems[0].name).toBe("Barcode Product");
      expect(result.current.state.cartItems[0].barcode).toBe("123456789");
    });

    it("should add product with net price when fees are not absorbed", () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockProduct = {
        id: "test-product-1",
        name: "Test Product",
        barcode: "123456789",
        price: 100, // $100 original price
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
        areProcessingFeesAbsorbed: false, // Merchant doesn't absorb fees
      };

      act(() => {
        result.current.cart.addProduct(mockProduct);
      });

      expect(result.current.state.cartItems).toHaveLength(1);
      expect(result.current.state.cartItems[0].name).toBe("Test Product");
      // Should use net price: $100 - (1.95% of $100) = $100 - $1.95 = $98.05
      expect(result.current.state.cartItems[0].price).toBe(98.05);
      expect(result.current.state.cartItems[0].areProcessingFeesAbsorbed).toBe(
        false
      );
    });

    it("should add product with full price when fees are absorbed", () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockProduct = {
        id: "test-product-2",
        name: "Test Product 2",
        barcode: "987654321",
        price: 100, // $100 original price
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-456" as any,
        productId: "prod-456" as any,
        areProcessingFeesAbsorbed: true, // Merchant absorbs fees
      };

      act(() => {
        result.current.cart.addProduct(mockProduct);
      });

      expect(result.current.state.cartItems).toHaveLength(1);
      expect(result.current.state.cartItems[0].name).toBe("Test Product 2");
      // Should use full price: $100 (no adjustment)
      expect(result.current.state.cartItems[0].price).toBe(100);
      expect(result.current.state.cartItems[0].areProcessingFeesAbsorbed).toBe(
        true
      );
    });
  });

  describe("Customer Operations", () => {
    const mockCustomer: CustomerInfo = {
      customerId: "cust-123" as any,
      name: "John Doe",
      email: "john@example.com",
      phone: "+1234567890",
    };

    it("should select customer", () => {
      const { result } = renderHook(() => usePOSOperations());

      act(() => {
        result.current.customer.selectCustomer(mockCustomer);
      });

      expect(result.current.state.currentCustomer).toEqual(mockCustomer);
      expect(result.current.state.isCustomerPanelOpen).toBe(false);
    });

    it("should update customer info without closing panel", () => {
      const { result } = renderHook(() => usePOSOperations());

      act(() => {
        result.current.customer.updateCustomerInfo(mockCustomer);
      });

      expect(result.current.state.currentCustomer).toEqual(mockCustomer);
      // Panel state should not change when updating info
    });

    it("should clear customer", () => {
      const { result } = renderHook(() => usePOSOperations());

      act(() => {
        result.current.customer.selectCustomer(mockCustomer);
      });

      expect(result.current.state.currentCustomer).toEqual(mockCustomer);

      act(() => {
        result.current.customer.clearCustomer();
      });

      expect(result.current.state.currentCustomer).toBeNull();
    });

    it("should create new customer", async () => {
      mockCreateCustomer.mockResolvedValue({ _id: "new-cust-123" });

      const { result } = renderHook(() => usePOSOperations());

      const newCustomerData = {
        name: "Jane Smith",
        email: "jane@example.com",
        phone: "+1987654321",
      };

      await act(async () => {
        await result.current.customer.createCustomer(newCustomerData);
      });

      expect(mockCreateCustomer).toHaveBeenCalledWith({
        storeId: null, // Will be null in test environment
        name: "Jane Smith",
        email: "jane@example.com",
        phone: "+1987654321",
      });
    });
  });

  describe("Transaction Operations", () => {
    it("should validate cart before transaction", async () => {
      const { result } = renderHook(() => usePOSOperations());

      // Try to process payment with empty cart
      const transactionResult = await act(async () => {
        return await result.current.transaction.processPayment("card");
      });

      expect(transactionResult.success).toBe(false);
      expect(transactionResult.error).toBe("Cart is empty");
    });

    it("should complete direct transaction successfully", async () => {
      mockCompleteTransaction.mockResolvedValue({
        success: true,
        transactionNumber: "POS-123456",
        transactionId: "txn-123",
      });

      const { result } = renderHook(() => usePOSOperations());

      // Add item to cart first
      const mockProduct = {
        id: "test-product-1",
        name: "Test Product",
        barcode: "123456789",
        price: 10.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct);
      });

      const transactionResult = await act(async () => {
        return await result.current.transaction.processPayment("card");
      });

      expect(transactionResult.success).toBe(true);
      expect(transactionResult.transactionNumber).toBe("POS-123456");
      expect(result.current.state.isTransactionCompleted).toBe(true);
    });

    it("should handle transaction failure", async () => {
      mockCompleteTransaction.mockResolvedValue({
        success: false,
        error: "Insufficient inventory",
      });

      const { result } = renderHook(() => usePOSOperations());

      // Add item to cart first
      const mockProduct = {
        id: "test-product-1",
        name: "Test Product",
        barcode: "123456789",
        price: 10.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct);
      });

      const transactionResult = await act(async () => {
        return await result.current.transaction.processPayment("card");
      });

      expect(transactionResult.success).toBe(false);
      expect(transactionResult.error).toBe("Insufficient inventory");
      expect(result.current.state.isTransactionCompleted).toBe(false);
    });

    it("should start new transaction", () => {
      const { result } = renderHook(() => usePOSOperations());

      // Complete a transaction first
      act(() => {
        result.current.rawStore.setTransactionCompleted(true, "POS-123456", {
          paymentMethod: "card",
          completedAt: new Date(),
          cartItems: [],
          subtotal: 10.99,
          tax: 1.1,
          total: 12.09,
        });
      });

      expect(result.current.state.isTransactionCompleted).toBe(true);

      act(() => {
        result.current.transaction.startNewTransaction();
      });

      expect(result.current.state.isTransactionCompleted).toBe(false);
      expect(result.current.state.completedOrderNumber).toBeNull();
    });
  });

  describe("Session Operations", () => {
    it("should start new session", async () => {
      const { result } = renderHook(() => usePOSOperations());

      await act(async () => {
        await result.current.session.startNewSession();
      });

      // Session operations are complex and depend on backend,
      // so we mainly test that the function can be called without errors
      expect(result.current.session.startNewSession).toBeDefined();
    });
  });

  describe("UI Operations", () => {
    it("should toggle customer panel", () => {
      const { result } = renderHook(() => usePOSOperations());

      act(() => {
        result.current.ui.setShowCustomerPanel(true);
      });

      expect(result.current.state.isCustomerPanelOpen).toBe(true);

      act(() => {
        result.current.ui.setShowCustomerPanel(false);
      });

      expect(result.current.state.isCustomerPanelOpen).toBe(false);
    });

    it("should toggle product entry", () => {
      const { result } = renderHook(() => usePOSOperations());

      act(() => {
        result.current.ui.setShowProductEntry(true);
      });

      expect(result.current.state.isProductEntryOpen).toBe(true);

      act(() => {
        result.current.ui.setShowProductEntry(false);
      });

      expect(result.current.state.isProductEntryOpen).toBe(false);
    });

    it("should update barcode input", () => {
      const { result } = renderHook(() => usePOSOperations());

      act(() => {
        result.current.ui.setBarcodeInput("123456789");
      });

      expect(result.current.state.barcodeInput).toBe("123456789");
    });

    it("should update product search query", () => {
      const { result } = renderHook(() => usePOSOperations());

      act(() => {
        result.current.ui.setProductSearchQuery("test product");
      });

      expect(result.current.state.productSearchQuery).toBe("test product");
    });

    it("should toggle scanning state", () => {
      const { result } = renderHook(() => usePOSOperations());

      act(() => {
        result.current.ui.setIsScanning(true);
      });

      expect(result.current.state.isScanning).toBe(true);

      act(() => {
        result.current.ui.setIsScanning(false);
      });

      expect(result.current.state.isScanning).toBe(false);
    });
  });

  describe("Computed State", () => {
    it("should compute cart totals correctly", () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockProduct1 = {
        id: "test-product-1",
        name: "Test Product 1",
        barcode: "123456789",
        price: 10.0,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      const mockProduct2 = {
        id: "test-product-2",
        name: "Test Product 2",
        barcode: "987654321",
        price: 5.0,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 5,
        skuId: "sku-456" as any,
        productId: "prod-456" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct1);
        result.current.cart.addProduct(mockProduct2);
      });

      // Update quantities
      const item1Id = result.current.state.cartItems[0].id;
      const item2Id = result.current.state.cartItems[1].id;

      act(() => {
        result.current.cart.updateQuantity(item1Id, 2); // 2 * $10 = $20
        result.current.cart.updateQuantity(item2Id, 1); // 1 * $5 = $5
      });

      // Total should be $25 + tax
      expect(result.current.state.cartSubtotal).toBe(25.0);
      expect(result.current.state.cartTax).toBe(2.5); // 10% tax
      expect(result.current.state.cartTotal).toBe(27.5);
    });

    it("should compute cart empty state", () => {
      const { result } = renderHook(() => usePOSOperations());

      expect(result.current.state.isCartEmpty).toBe(true);

      const mockProduct = {
        id: "test-product-1",
        name: "Test Product",
        barcode: "123456789",
        price: 10.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct);
      });

      expect(result.current.state.isCartEmpty).toBe(false);
    });

    it("should compute cart item count", () => {
      const { result } = renderHook(() => usePOSOperations());

      const mockProduct1 = {
        id: "test-product-1",
        name: "Test Product 1",
        barcode: "123456789",
        price: 10.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 10,
        skuId: "sku-123" as any,
        productId: "prod-123" as any,
      };

      const mockProduct2 = {
        id: "test-product-2",
        name: "Test Product 2",
        barcode: "987654321",
        price: 5.99,
        category: "Test Category",
        description: "Test Description",
        inStock: true,
        quantityAvailable: 5,
        skuId: "sku-456" as any,
        productId: "prod-456" as any,
      };

      act(() => {
        result.current.cart.addProduct(mockProduct1);
        result.current.cart.addProduct(mockProduct2);
      });

      // Update quantities
      const item1Id = result.current.state.cartItems[0].id;
      const item2Id = result.current.state.cartItems[1].id;

      act(() => {
        result.current.cart.updateQuantity(item1Id, 3);
        result.current.cart.updateQuantity(item2Id, 2);
      });

      expect(result.current.state.cartItemCount).toBe(5); // 3 + 2
    });
  });
});
