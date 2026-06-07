import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductEntry } from "./ProductEntry";
import type { Product } from "./types";
import type {
  RegisterLookupMode,
  RegisterServiceEntryState,
  RegisterServiceSearchResult,
} from "@/lib/pos/presentation/register/registerUiState";
import type { Id } from "~/convex/_generated/dataModel";

const quickAddProductSkuMock = vi.fn();
const pendingCheckoutItemMock = vi.fn();
const registerCatalogMock = vi.fn();

type AddProductHandler = (
  product: Product,
  quantity?: number,
) => boolean | Promise<boolean>;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;

vi.mock("@/hooks/usePOSProducts", () => ({
  usePOSPendingCheckoutItemForSale: () => pendingCheckoutItemMock,
  usePOSQuickAddProductSku: () => quickAddProductSkuMock,
  usePOSRegisterCatalog: () => registerCatalogMock(),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      _id: "store-1",
      currency: "GHS",
    },
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      _id: "user-1",
    },
  }),
}));

function buildQuickAddedProduct(): Product {
  return {
    id: "sku-1",
    barcode: "999999999999",
    category: "POS quick add",
    description: "",
    inStock: true,
    name: "Quick item",
    price: 2500,
    productId: "product-1" as Product["productId"],
    quantityAvailable: 1,
    sku: "TEMP-1",
    skuId: "sku-1" as Product["skuId"],
  };
}

function renderProductEntry(input: {
  onAddProduct: AddProductHandler;
  setProductSearchQuery: (query: string) => void;
  canAddPendingCheckoutItem?: boolean;
  canQuickAddProduct?: boolean;
}) {
  function Harness() {
    const [productSearchQuery, setProductSearchQuery] =
      useState("999999999999");

    return (
      <ProductEntry
        canAddPendingCheckoutItem={input.canAddPendingCheckoutItem}
        canQuickAddProduct={input.canQuickAddProduct ?? true}
        pendingCheckoutContext={{
          createdByStaffProfileId: "staff-1" as Id<"staffProfile">,
          registerSessionId: "register-1" as Id<"registerSession">,
          terminalId: "terminal-1" as Id<"posTerminal">,
        }}
        isSearchLoading={false}
        isSearchReady
        onAddProduct={input.onAddProduct}
        onBarcodeSubmit={vi.fn()}
        productSearchQuery={productSearchQuery}
        searchResults={[]}
        setProductSearchQuery={(query) => {
          input.setProductSearchQuery(query);
          setProductSearchQuery(query);
        }}
        setShowProductLookup={vi.fn()}
        showProductLookup
      />
    );
  }

  render(<Harness />);
}

function buildServiceResult(
  overrides: Partial<RegisterServiceSearchResult> = {},
): RegisterServiceSearchResult {
  return {
    id: "service-1",
    serviceCatalogId:
      "service-1" as RegisterServiceSearchResult["serviceCatalogId"],
    name: "Closure Repair",
    serviceMode: "repair",
    pricingModel: "fixed",
    basePrice: 4500,
    ...overrides,
  };
}

function renderProductEntryWithServices(input: {
  canSearchProducts?: boolean;
  canSearchServices?: boolean;
  lookupMode?: RegisterLookupMode;
  searchResults?: Product[];
  serviceEntry: RegisterServiceEntryState;
  setProductSearchQuery?: (query: string) => void;
  onBarcodeSubmit?: () => void;
}) {
  function Harness() {
    const [lookupMode, setLookupMode] = useState<RegisterLookupMode>(
      input.lookupMode ?? "product",
    );
    const [productSearchQuery, setProductSearchQuery] = useState("");

    return (
      <ProductEntry
        canSearchProducts={input.canSearchProducts}
        canSearchServices={input.canSearchServices}
        isSearchLoading={false}
        isSearchReady
        lookupMode={lookupMode}
        onAddProduct={vi.fn()}
        onBarcodeSubmit={input.onBarcodeSubmit ?? vi.fn()}
        productSearchQuery={productSearchQuery}
        searchResults={input.searchResults ?? []}
        serviceEntry={input.serviceEntry}
        setLookupMode={setLookupMode}
        setProductSearchQuery={(query) => {
          input.setProductSearchQuery?.(query);
          setProductSearchQuery(query);
        }}
        setShowProductLookup={vi.fn()}
        showProductLookup
      />
    );
  }

  render(<Harness />);
}

describe("ProductEntry", () => {
  beforeEach(() => {
    quickAddProductSkuMock.mockReset();
    pendingCheckoutItemMock.mockReset();
    registerCatalogMock.mockReset();
    registerCatalogMock.mockReturnValue([]);
  });

  it("clears the active search before adding a newly quick-added product to the cart", async () => {
    const user = userEvent.setup();
    const quickAddedProduct = buildQuickAddedProduct();
    const onAddProduct = vi.fn<AddProductHandler>(async () => true);
    const setProductSearchQuery = vi.fn();
    quickAddProductSkuMock.mockResolvedValueOnce(quickAddedProduct);

    renderProductEntry({ onAddProduct, setProductSearchQuery });

    await user.click(
      screen.getByRole("button", { name: /quick add product/i }),
    );
    await user.type(screen.getByLabelText(/product name/i), "Quick item");
    await user.type(screen.getByLabelText(/selling price/i), "25");
    await user.click(screen.getByRole("button", { name: /add product/i }));

    await waitFor(() =>
      expect(onAddProduct).toHaveBeenCalledWith(quickAddedProduct),
    );
    expect(setProductSearchQuery).toHaveBeenCalledWith("");
    expect(setProductSearchQuery.mock.invocationCallOrder.at(-1)).toBeLessThan(
      onAddProduct.mock.invocationCallOrder[0],
    );
  });

  it("adds a cashier pending checkout item locally for owner review without trusted catalog quick-add", async () => {
    const user = userEvent.setup();
    const onAddProduct = vi.fn<AddProductHandler>(async () => true);
    const setProductSearchQuery = vi.fn();

    renderProductEntry({
      canAddPendingCheckoutItem: true,
      canQuickAddProduct: false,
      onAddProduct,
      setProductSearchQuery,
    });

    await user.click(
      screen.getByRole("button", { name: /add item for review/i }),
    );
    expect(screen.getByLabelText(/quantity sold/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/product name/i), "Pending item");
    await user.type(screen.getByLabelText(/selling price/i), "25");
    await user.click(screen.getByRole("button", { name: /add product/i }));

    await waitFor(() =>
      expect(onAddProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Pending item",
          sku: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{3}-[A-Z0-9]{3}$/),
          pendingCheckoutItemId: expect.stringMatching(
            /^local-pending-checkout-item-/,
          ),
          productId: expect.stringMatching(/^local-pending-product-/),
          skuId: expect.stringMatching(/^local-pending-sku-/),
          pendingCheckoutItemLocalDefinition: expect.objectContaining({
            name: "Pending item",
            lookupCode: "999999999999",
            price: 2500,
            quantitySold: 1,
            localMetadata: expect.objectContaining({
              createdOffline: true,
              cloudValidation: "uncertain",
            }),
          }),
          availabilityStatus: "available",
        }),
        1,
      ),
    );
    const addedProduct = onAddProduct.mock.calls[0]?.[0];
    expect(addedProduct?.sku).not.toContain("PENDING");
    expect(pendingCheckoutItemMock).not.toHaveBeenCalled();
    expect(quickAddProductSkuMock).not.toHaveBeenCalled();
    expect(setProductSearchQuery).toHaveBeenCalledWith("");
  });

  it("queues a cashier pending checkout item locally when offline", async () => {
    const user = userEvent.setup();
    const onAddProduct = vi.fn<AddProductHandler>(async () => true);
    const setProductSearchQuery = vi.fn();
    const originalOnline = navigator.onLine;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    try {
      renderProductEntry({
        canAddPendingCheckoutItem: true,
        canQuickAddProduct: false,
        onAddProduct,
        setProductSearchQuery,
      });

      await user.click(
        screen.getByRole("button", { name: /add item for review/i }),
      );
      await user.type(screen.getByLabelText(/product name/i), "Offline item");
      await user.type(screen.getByLabelText(/selling price/i), "25");
      await user.click(screen.getByRole("button", { name: /add product/i }));

      await waitFor(() =>
        expect(onAddProduct).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Offline item",
            sku: expect.stringMatching(
              /^[A-Z0-9]{4}-[A-Z0-9]{3}-[A-Z0-9]{3}$/,
            ),
            pendingCheckoutItemId: expect.stringMatching(
              /^local-pending-checkout-item-/,
            ),
            productId: expect.stringMatching(/^local-pending-product-/),
            skuId: expect.stringMatching(/^local-pending-sku-/),
            pendingCheckoutItemLocalDefinition: expect.objectContaining({
              name: "Offline item",
              lookupCode: "999999999999",
              price: 2500,
              quantitySold: 1,
              localMetadata: expect.objectContaining({
                createdOffline: true,
                cloudValidation: "uncertain",
              }),
            }),
          }),
          1,
        ),
      );
      const addedProduct = onAddProduct.mock.calls[0]?.[0];
      expect(addedProduct?.sku).not.toContain("PENDING");
      expect(quickAddProductSkuMock).not.toHaveBeenCalled();
      expect(pendingCheckoutItemMock).not.toHaveBeenCalled();
      expect(setProductSearchQuery).toHaveBeenCalledWith("");
    } finally {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: originalOnline,
      });
    }
  });

  it("creates additional SKU variants before adding the primary quick-add product to the cart", async () => {
    const user = userEvent.setup();
    const quickAddedProduct = buildQuickAddedProduct();
    const extraVariantProduct = {
      ...quickAddedProduct,
      id: "sku-2",
      barcode: "",
      price: 3000,
      skuId: "sku-2" as Product["skuId"],
    };
    const onAddProduct = vi.fn<AddProductHandler>(async () => true);
    const setProductSearchQuery = vi.fn();
    quickAddProductSkuMock
      .mockResolvedValueOnce(quickAddedProduct)
      .mockResolvedValueOnce(extraVariantProduct);

    renderProductEntry({ onAddProduct, setProductSearchQuery });

    await user.click(
      screen.getByRole("button", { name: /quick add product/i }),
    );
    await user.type(screen.getByLabelText(/product name/i), "Quick item");
    await user.type(screen.getByLabelText(/selling price/i), "25");
    await user.click(screen.getByLabelText(/add multiple variants/i));
    await user.click(screen.getByRole("button", { name: /add variant/i }));
    await user.type(screen.getAllByLabelText(/selling price/i)[1], "30");
    await user.click(
      screen.getByRole("button", { name: /add product variants/i }),
    );

    await waitFor(() =>
      expect(quickAddProductSkuMock).toHaveBeenCalledTimes(2),
    );
    expect(quickAddProductSkuMock).toHaveBeenNthCalledWith(1, {
      storeId: "store-1",
      createdByUserId: "user-1",
      name: "Quick item",
      lookupCode: "999999999999",
      price: 2500,
      quantityAvailable: 1,
      productId: undefined,
    });
    expect(quickAddProductSkuMock).toHaveBeenNthCalledWith(2, {
      storeId: "store-1",
      createdByUserId: "user-1",
      name: "Quick item",
      lookupCode: undefined,
      price: 3000,
      quantityAvailable: 1,
      productId: "product-1",
    });
    expect(onAddProduct).toHaveBeenCalledWith(quickAddedProduct);
  });

  it("attaches a scanned barcode to an existing SKU from quick add", async () => {
    const user = userEvent.setup();
    const attachedProduct = {
      ...buildQuickAddedProduct(),
      id: "sku-existing",
      barcode: "999999999999",
      name: "Existing wig",
      sku: "EXISTING-SKU",
      skuId: "sku-existing" as Product["skuId"],
    };
    const onAddProduct = vi.fn<AddProductHandler>(async () => true);
    const setProductSearchQuery = vi.fn();
    quickAddProductSkuMock.mockResolvedValueOnce(attachedProduct);
    registerCatalogMock.mockReturnValue([
      {
        id: "sku-existing",
        productSkuId: "sku-existing",
        skuId: "sku-existing",
        productId: "product-existing",
        name: "Existing wig",
        sku: "EXISTING-SKU",
        barcode: "",
        price: 2500,
        category: "Wigs",
        description: "",
        image: null,
        size: "",
        length: null,
        color: "",
        areProcessingFeesAbsorbed: false,
      },
    ]);

    renderProductEntry({ onAddProduct, setProductSearchQuery });

    await user.click(
      screen.getByRole("button", { name: /quick add product/i }),
    );
    await user.type(screen.getByLabelText(/search existing sku/i), "existing");
    await user.click(screen.getByRole("button", { name: /existing wig/i }));
    await user.click(screen.getByRole("button", { name: /attach barcode/i }));

    await waitFor(() =>
      expect(quickAddProductSkuMock).toHaveBeenCalledWith({
        storeId: "store-1",
        createdByUserId: "user-1",
        name: "",
        lookupCode: "999999999999",
        price: 0,
        quantityAvailable: 0,
        productSkuId: "sku-existing",
      }),
    );
    expect(setProductSearchQuery).toHaveBeenCalledWith("");
    expect(onAddProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        ...attachedProduct,
        availabilityStatus: "available",
        quantityAvailable: 1,
      }),
    );
  });

  it("keeps product lookup as the default when service search is available", async () => {
    const user = userEvent.setup();
    const setProductSearchQuery = vi.fn();
    const serviceEntry: RegisterServiceEntryState = {
      disabled: false,
      serviceSearchQuery: "",
      setServiceSearchQuery: vi.fn(),
      searchResults: [buildServiceResult()],
      isSearchLoading: false,
      isSearchReady: true,
      items: [],
      onAddService: vi.fn(),
      onUpdateServiceAmount: vi.fn(),
      onRemoveService: vi.fn(),
    };

    renderProductEntryWithServices({ serviceEntry, setProductSearchQuery });

    await user.type(
      screen.getByPlaceholderText(/lookup product or service by name/i),
      "closure",
    );

    expect(setProductSearchQuery).toHaveBeenLastCalledWith("closure");
    expect(serviceEntry.setServiceSearchQuery).not.toHaveBeenCalled();
  });

  it("adds a fixed-price service from explicit service lookup", async () => {
    const user = userEvent.setup();
    const service = buildServiceResult({ name: "tokin" });
    const serviceEntry: RegisterServiceEntryState = {
      disabled: false,
      serviceSearchQuery: "closure",
      setServiceSearchQuery: vi.fn(),
      searchResults: [service],
      isSearchLoading: false,
      isSearchReady: true,
      items: [],
      onAddService: vi.fn(async () => true),
      onUpdateServiceAmount: vi.fn(),
      onRemoveService: vi.fn(),
    };

    renderProductEntryWithServices({
      lookupMode: "service",
      serviceEntry,
    });

    expect(screen.getByText("Tokin")).toBeInTheDocument();
    expect(document.querySelector(".lucide-scissors")).toBeInTheDocument();
    expect(screen.queryByText("Add service")).not.toBeInTheDocument();
    expect(screen.queryByText("No products found")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /add tokin service/i }),
    );

    expect(serviceEntry.onAddService).toHaveBeenCalledWith(service, undefined);
    expect(serviceEntry.setServiceSearchQuery).toHaveBeenCalledWith("");
  });

  it("disables service search results already in the cart", async () => {
    const user = userEvent.setup();
    const service = buildServiceResult({ name: "tokin" });
    const serviceEntry: RegisterServiceEntryState = {
      disabled: false,
      serviceSearchQuery: "tokin",
      setServiceSearchQuery: vi.fn(),
      searchResults: [service],
      isSearchLoading: false,
      isSearchReady: true,
      items: [
        {
          id: "service-line-1",
          serviceCatalogId: service.serviceCatalogId,
          name: service.name,
          serviceMode: service.serviceMode,
          pricingModel: service.pricingModel,
          price: service.basePrice ?? 0,
          quantity: 1,
          amountRequired: false,
        },
      ],
      onAddService: vi.fn(async () => true),
      onUpdateServiceAmount: vi.fn(),
      onRemoveService: vi.fn(),
    };

    renderProductEntryWithServices({
      lookupMode: "service",
      serviceEntry,
    });

    const serviceCard = screen.getByRole("button", {
      name: /add tokin service/i,
    });
    expect(serviceCard).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Already added")).toBeInTheDocument();

    await user.click(serviceCard);

    expect(serviceEntry.onAddService).not.toHaveBeenCalled();
    expect(serviceEntry.setServiceSearchQuery).not.toHaveBeenCalled();
  });

  it("adds a fixed-price service from the unified register search", async () => {
    const user = userEvent.setup();
    const service = buildServiceResult();
    const serviceEntry: RegisterServiceEntryState = {
      disabled: false,
      serviceSearchQuery: "closure",
      setServiceSearchQuery: vi.fn(),
      searchResults: [service],
      isSearchLoading: false,
      isSearchReady: true,
      items: [],
      onAddService: vi.fn(async () => true),
      onUpdateServiceAmount: vi.fn(),
      onRemoveService: vi.fn(),
    };

    renderProductEntryWithServices({
      serviceEntry,
    });

    expect(screen.queryByText("Add service")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /add closure repair service/i }),
    );

    expect(serviceEntry.onAddService).toHaveBeenCalledWith(service, undefined);
    expect(serviceEntry.setServiceSearchQuery).toHaveBeenCalledWith("");
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/lookup product or service by name/i),
      ).toHaveFocus(),
    );
  });

  it("does not surface product results or barcode submit on service-only terminals", async () => {
    const user = userEvent.setup();
    const onBarcodeSubmit = vi.fn();
    const service = buildServiceResult();
    const serviceEntry: RegisterServiceEntryState = {
      disabled: false,
      serviceSearchQuery: "closure",
      setServiceSearchQuery: vi.fn(),
      searchResults: [service],
      isSearchLoading: false,
      isSearchReady: true,
      items: [],
      onAddService: vi.fn(async () => true),
      onUpdateServiceAmount: vi.fn(),
      onRemoveService: vi.fn(),
    };

    renderProductEntryWithServices({
      canSearchProducts: false,
      serviceEntry,
      searchResults: [buildQuickAddedProduct()],
      onBarcodeSubmit,
    });

    const input = screen.getByPlaceholderText(/lookup service by name/i);
    expect(input).toBeInTheDocument();
    expect(screen.getByText("Closure Repair")).toBeInTheDocument();
    expect(screen.queryByText("Quick item")).not.toBeInTheDocument();
    expect(screen.queryByText("No products found")).not.toBeInTheDocument();

    await user.type(input, "{enter}");

    expect(onBarcodeSubmit).not.toHaveBeenCalled();
  });

  it("does not surface service results on product-only terminals", () => {
    const serviceEntry: RegisterServiceEntryState = {
      disabled: false,
      serviceSearchQuery: "closure",
      setServiceSearchQuery: vi.fn(),
      searchResults: [buildServiceResult()],
      isSearchLoading: false,
      isSearchReady: true,
      items: [],
      onAddService: vi.fn(async () => true),
      onUpdateServiceAmount: vi.fn(),
      onRemoveService: vi.fn(),
    };

    renderProductEntryWithServices({
      canSearchServices: false,
      serviceEntry,
    });

    expect(
      screen.getByPlaceholderText(/lookup product by name/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Closure Repair")).not.toBeInTheDocument();
  });

  it("requires an entered amount before adding a starting-at service", async () => {
    const user = userEvent.setup();
    const service = buildServiceResult({
      pricingModel: "starting_at",
      basePrice: 5000,
    });
    const serviceEntry: RegisterServiceEntryState = {
      disabled: false,
      serviceSearchQuery: "revamp",
      setServiceSearchQuery: vi.fn(),
      searchResults: [service],
      isSearchLoading: false,
      isSearchReady: true,
      items: [],
      onAddService: vi.fn(async () => true),
      onUpdateServiceAmount: vi.fn(),
      onRemoveService: vi.fn(),
    };

    renderProductEntryWithServices({
      lookupMode: "service",
      serviceEntry,
    });

    const serviceCard = screen.getByRole("button", {
      name: /add closure repair service/i,
    });
    expect(serviceCard).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("Add service")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/closure repair amount/i), "65");
    expect(serviceCard).toHaveAttribute("aria-disabled", "false");
    await user.click(serviceCard);

    expect(serviceEntry.onAddService).toHaveBeenCalledWith(service, 6500);
  });
});
