import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContext } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks (must be hoisted above all other imports)
// ---------------------------------------------------------------------------

vi.mock("@athena/webapp", () => ({}));

vi.mock("@/hooks/useGetActiveCheckoutSession", () => ({
  useGetActiveCheckoutSession: vi.fn(),
}));

vi.mock("@/hooks/useShoppingBag", () => ({
  useShoppingBag: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStoreContext: vi.fn(),
}));

vi.mock("@/contexts/NavigationBarProvider", () => ({
  useNavigationBarContext: vi.fn(),
}));

vi.mock("@/lib/queries/onlineOrder", () => ({
  useOnlineOrderQueries: vi.fn(),
}));

// Partial mock: keep QueryClient/QueryClientProvider real but stub useQuery
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQuery: vi.fn().mockReturnValue({ data: null }) };
});

// Stub out the early-return UI components
vi.mock("../states/checkout-expired/CheckoutExpired", () => ({
  CheckoutExpired: () => null,
  NoCheckoutSession: () => null,
}));

vi.mock("../states/checkout unavailable/CheckoutUnavailable", () => ({
  CheckoutUnavailable: () => null,
}));

// ---------------------------------------------------------------------------
// Imports that depend on mocked modules
// ---------------------------------------------------------------------------

import {
  CheckoutContext,
  CheckoutProvider,
  webOrderSchema,
} from "./CheckoutProvider";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useStoreContext } from "@/contexts/StoreContext";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_KEY = "checkoutState";

const mockBag = {
  _id: "bag-1",
  items: [
    { _id: "item-1", productSkuId: "sku-1", quantity: 1, price: 100 },
  ],
};

const mockSession = { _id: "session-1", placedOrderId: undefined };

function setupDefaultMocks() {
  vi.mocked(useGetActiveCheckoutSession).mockReturnValue({
    data: mockSession as any,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data: mockSession }),
  } as any);

  vi.mocked(useShoppingBag).mockReturnValue({ bag: mockBag } as any);

  vi.mocked(useStoreContext).mockReturnValue({
    user: null,
    store: { config: {} },
    userId: "user-1",
  } as any);

  vi.mocked(useNavigationBarContext).mockReturnValue({
    setNavBarLayout: vi.fn(),
    setAppLocation: vi.fn(),
  } as any);

  vi.mocked(useOnlineOrderQueries).mockReturnValue({
    detail: () => ({
      queryKey: ["online-order", ""],
      queryFn: async () => null,
    }),
  } as any);
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CheckoutProvider>{children}</CheckoutProvider>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// webOrderSchema
// ---------------------------------------------------------------------------

describe("webOrderSchema", () => {
  const validCustomer = {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phoneNumber: "5555551234",
  };

  describe("pickup orders", () => {
    it("accepts a valid pickup order", () => {
      const result = webOrderSchema.safeParse({
        customerDetails: validCustomer,
        deliveryMethod: "pickup",
        deliveryOption: null,
        deliveryFee: null,
        pickupLocation: "wigclub-hair-studio",
        deliveryDetails: null,
        discount: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects pickup with empty pickupLocation", () => {
      const result = webOrderSchema.safeParse({
        customerDetails: validCustomer,
        deliveryMethod: "pickup",
        deliveryOption: null,
        deliveryFee: null,
        pickupLocation: "   ",
        deliveryDetails: null,
        discount: null,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("pickupLocation");
    });

    it("rejects pickup with null pickupLocation", () => {
      const result = webOrderSchema.safeParse({
        customerDetails: validCustomer,
        deliveryMethod: "pickup",
        deliveryOption: null,
        deliveryFee: null,
        pickupLocation: null,
        deliveryDetails: null,
        discount: null,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("pickupLocation");
    });
  });

  describe("delivery orders — Ghana (GH)", () => {
    const ghBase = {
      customerDetails: validCustomer,
      deliveryMethod: "delivery",
      deliveryOption: "within-accra",
      deliveryFee: 30,
      pickupLocation: null,
      discount: null,
    };

    it("accepts a valid GH delivery order", () => {
      const result = webOrderSchema.safeParse({
        ...ghBase,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          street: "Liberation Road",
          neighborhood: "east_legon",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects GH delivery missing region", () => {
      const result = webOrderSchema.safeParse({
        ...ghBase,
        deliveryDetails: {
          country: "GH",
          street: "Liberation Road",
          neighborhood: "east_legon",
        },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails.region");
    });

    it("rejects GH delivery missing street", () => {
      const result = webOrderSchema.safeParse({
        ...ghBase,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          neighborhood: "east_legon",
        },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails.street");
    });

    it("rejects GH delivery missing neighborhood", () => {
      const result = webOrderSchema.safeParse({
        ...ghBase,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          street: "Liberation Road",
        },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails.neighborhood");
    });

    it("rejects delivery with null deliveryFee", () => {
      const result = webOrderSchema.safeParse({
        ...ghBase,
        deliveryFee: null,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          street: "Liberation Road",
          neighborhood: "east_legon",
        },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryFee");
    });

    it("rejects delivery with no deliveryDetails", () => {
      const result = webOrderSchema.safeParse({
        ...ghBase,
        deliveryDetails: null,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails");
    });
  });

  describe("delivery orders — United States (US)", () => {
    const usBase = {
      customerDetails: validCustomer,
      deliveryMethod: "delivery",
      deliveryOption: "intl",
      deliveryFee: 800,
      pickupLocation: null,
      discount: null,
    };

    it("accepts a valid US delivery order", () => {
      const result = webOrderSchema.safeParse({
        ...usBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "San Francisco",
          state: "CA",
          zip: "94105",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects US delivery missing state", () => {
      const result = webOrderSchema.safeParse({
        ...usBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "San Francisco",
          zip: "94105",
        },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails.state");
    });

    it("rejects US delivery with invalid zip format", () => {
      const result = webOrderSchema.safeParse({
        ...usBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "San Francisco",
          state: "CA",
          zip: "9410", // only 4 digits
        },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails.zip");
    });

    it("rejects US delivery with non-numeric zip", () => {
      const result = webOrderSchema.safeParse({
        ...usBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "San Francisco",
          state: "CA",
          zip: "ABCDE",
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("delivery orders — rest of world (ROW)", () => {
    const rowBase = {
      customerDetails: validCustomer,
      deliveryMethod: "delivery",
      deliveryOption: "intl",
      deliveryFee: 800,
      pickupLocation: null,
      discount: null,
    };

    it("accepts a valid ROW delivery order", () => {
      const result = webOrderSchema.safeParse({
        ...rowBase,
        deliveryDetails: {
          country: "GB",
          address: "10 Downing Street",
          city: "London",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects ROW delivery missing address", () => {
      const result = webOrderSchema.safeParse({
        ...rowBase,
        deliveryDetails: {
          country: "GB",
          city: "London",
        },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails.address");
    });

    it("rejects ROW delivery missing city", () => {
      const result = webOrderSchema.safeParse({
        ...rowBase,
        deliveryDetails: {
          country: "GB",
          address: "10 Downing Street",
        },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails.city");
    });

    it("rejects ROW delivery missing country", () => {
      const result = webOrderSchema.safeParse({
        ...rowBase,
        deliveryDetails: {
          address: "10 Downing Street",
          city: "London",
        } as any,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("deliveryDetails.country");
    });
  });
});

// ---------------------------------------------------------------------------
// CheckoutProvider — component behaviour
// ---------------------------------------------------------------------------

describe("CheckoutProvider", () => {
  beforeEach(() => {
    setupDefaultMocks();
    // Seed sessionStorage so the provider sees a non-null bag and renders children
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        bag: mockBag,
        deliveryMethod: "pickup",
        pickupLocation: "wigclub-hair-studio",
        paymentMethod: "online_payment",
      })
    );
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  it("exposes a context value to children", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );
    expect(result.current).not.toBeNull();
    expect(result.current?.checkoutState).toBeDefined();
    expect(result.current?.updateState).toBeInstanceOf(Function);
  });

  it("restores checkout state from sessionStorage", () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        bag: mockBag,
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        deliveryFee: 30,
        paymentMethod: "online_payment",
      })
    );

    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    expect(result.current?.checkoutState.deliveryMethod).toBe("delivery");
    expect(result.current?.checkoutState.deliveryFee).toBe(30);
  });

  // -------------------------------------------------------------------------
  // updateState — order-type flags
  // -------------------------------------------------------------------------

  it("sets isPickupOrder/isDeliveryOrder when deliveryMethod changes", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({ deliveryMethod: "delivery" });
    });

    expect(result.current?.checkoutState.isDeliveryOrder).toBe(true);
    expect(result.current?.checkoutState.isPickupOrder).toBe(false);

    act(() => {
      result.current?.updateState({ deliveryMethod: "pickup" });
    });

    expect(result.current?.checkoutState.isPickupOrder).toBe(true);
    expect(result.current?.checkoutState.isDeliveryOrder).toBe(false);
  });

  it("marks isGhanaOrder true for GH delivery", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryDetails: { country: "GH", region: "GA" },
      });
    });

    expect(result.current?.checkoutState.isGhanaOrder).toBe(true);
    expect(result.current?.checkoutState.isUSOrder).toBe(false);
    expect(result.current?.checkoutState.isROWOrder).toBe(false);
  });

  it("marks isUSOrder true for US delivery", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryDetails: {
          country: "US",
          address: "1 Apple Park Way",
          city: "Cupertino",
          state: "CA",
          zip: "95014",
        },
      });
    });

    expect(result.current?.checkoutState.isUSOrder).toBe(true);
    expect(result.current?.checkoutState.isGhanaOrder).toBe(false);
    expect(result.current?.checkoutState.isROWOrder).toBe(false);
  });

  it("marks isROWOrder true for non-GH, non-US delivery", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryDetails: { country: "GB", address: "1 Street", city: "London" },
      });
    });

    expect(result.current?.checkoutState.isROWOrder).toBe(true);
    expect(result.current?.checkoutState.isGhanaOrder).toBe(false);
    expect(result.current?.checkoutState.isUSOrder).toBe(false);
  });

  it("marks isGhanaOrder true for pickup orders regardless of address", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "pickup",
        pickupLocation: "wigclub-hair-studio",
      });
    });

    expect(result.current?.checkoutState.isGhanaOrder).toBe(true);
  });

  // -------------------------------------------------------------------------
  // updateState — auto-override deliveryOption to intl for non-GH countries
  // -------------------------------------------------------------------------

  it("overrides deliveryOption to 'intl' when country is not GH", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryOption: "within-accra", // wrong option for a UK address
        deliveryDetails: { country: "GB", address: "1 St", city: "London" },
      });
    });

    expect(result.current?.checkoutState.deliveryOption).toBe("intl");
  });

  it("does NOT override deliveryOption for GH addresses", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryOption: "outside-accra",
        deliveryDetails: { country: "GH", region: "WR" },
      });
    });

    expect(result.current?.checkoutState.deliveryOption).toBe("outside-accra");
  });

  // -------------------------------------------------------------------------
  // updateState — didEnterDeliveryDetails
  // -------------------------------------------------------------------------

  it("sets didEnterDeliveryDetails for a complete GH address", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        deliveryDetails: {
          country: "GH",
          region: "GA",
          street: "Liberation Road",
          neighborhood: "east_legon",
        },
      });
    });

    expect(result.current?.checkoutState.didEnterDeliveryDetails).toBe(true);
  });

  it("does NOT set didEnterDeliveryDetails when GH address is incomplete", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        deliveryDetails: {
          country: "GH",
          region: "GA",
          // missing street and neighborhood
        },
      });
    });

    expect(result.current?.checkoutState.didEnterDeliveryDetails).toBe(false);
  });

  it("sets didEnterDeliveryDetails for a complete US address", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryOption: "intl",
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "San Francisco",
          state: "CA",
          zip: "94105",
        },
      });
    });

    expect(result.current?.checkoutState.didEnterDeliveryDetails).toBe(true);
  });

  it("does NOT set didEnterDeliveryDetails when US address is missing zip", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryOption: "intl",
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "San Francisco",
          state: "CA",
          // no zip
        },
      });
    });

    expect(result.current?.checkoutState.didEnterDeliveryDetails).toBe(false);
  });

  it("sets didEnterDeliveryDetails for a complete ROW address", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        deliveryOption: "intl",
        deliveryDetails: {
          country: "GB",
          address: "10 Downing Street",
          city: "London",
        },
      });
    });

    expect(result.current?.checkoutState.didEnterDeliveryDetails).toBe(true);
  });

  // -------------------------------------------------------------------------
  // updateState — didSelectPickupLocation
  // -------------------------------------------------------------------------

  it("sets didSelectPickupLocation when a pickup location is provided", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "pickup",
        pickupLocation: "wigclub-hair-studio",
      });
    });

    expect(result.current?.checkoutState.didSelectPickupLocation).toBe(true);
  });

  it("clears didSelectPickupLocation when switching to delivery", () => {
    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    act(() => {
      result.current?.updateState({
        deliveryMethod: "delivery",
        pickupLocation: null,
      });
    });

    expect(result.current?.checkoutState.didSelectPickupLocation).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Fulfillment availability guards
  // -------------------------------------------------------------------------

  it("blocks switching to pickup when pickup is disabled", () => {
    vi.mocked(useStoreContext).mockReturnValue({
      user: null,
      store: {
        config: {
          fulfillment: { enableStorePickup: false, enableDelivery: true },
        },
      },
      userId: "user-1",
    } as any);

    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    const before = result.current?.checkoutState.deliveryMethod;

    act(() => {
      result.current?.updateState({ deliveryMethod: "pickup" });
    });

    // State should not have changed to pickup
    expect(result.current?.checkoutState.deliveryMethod).toBe(before);
  });

  it("blocks switching to delivery when delivery is disabled", () => {
    vi.mocked(useStoreContext).mockReturnValue({
      user: null,
      store: {
        config: {
          fulfillment: { enableStorePickup: true, enableDelivery: false },
        },
      },
      userId: "user-1",
    } as any);

    const { result } = renderHook(
      () => useContext(CheckoutContext),
      { wrapper: makeWrapper() }
    );

    const initialMethod = result.current?.checkoutState.deliveryMethod;

    act(() => {
      result.current?.updateState({ deliveryMethod: "delivery" });
    });

    expect(result.current?.checkoutState.deliveryMethod).toBe(initialMethod);
  });
});
