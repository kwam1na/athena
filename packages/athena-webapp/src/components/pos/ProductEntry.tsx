import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  QuickAddProductDialog,
  type QuickAddAttachBarcodePayload,
  type QuickAddExistingSkuOption,
} from "@/components/product/QuickAddProductDialog";
import { normalizeQuickAddInitialLookupCode } from "@/components/product/quickAddProductDialogUtils";
import type { QuickAddProductSubmitPayload } from "@/components/product/QuickAddProductDialog";
import { ScanBarcode, Scissors, Search } from "lucide-react";
import type { Product } from "./types";
import type {
  RegisterLookupMode,
  RegisterServiceEntryState,
  RegisterServicePricingModel,
  RegisterServiceSearchResult,
} from "@/lib/pos/presentation/register/registerUiState";
import {
  usePOSQuickAddProductSku,
  usePOSRegisterCatalog,
} from "@/hooks/usePOSProducts";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import type { Id } from "~/convex/_generated/dataModel";
import {
  extractBarcodeFromInput,
  isUrlOrBarcode,
} from "@/lib/pos/barcodeUtils";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import { SearchResultsSection } from "./SearchResultsSection";
import { capitalizeWords, cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  formatStoredAmount,
  parseDisplayAmountInput,
} from "@/lib/pos/displayAmounts";

interface ProductSearchInputProps {
  productSearchQuery: string;
  setProductSearchQuery: (query: string) => void;
  onBarcodeSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
  lookupKind?: "products_services" | "products" | "services";
  onActivate?: () => void;
  readOnly?: boolean;
  submitOnEnter?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
}

interface ProductEntryProps extends ProductSearchInputProps {
  showProductLookup: boolean;
  setShowProductLookup: (value: boolean) => void;
  onAddProduct: (
    product: Product,
    quantity?: number,
  ) => boolean | Promise<boolean>;
  searchResults: Product[];
  isSearchLoading: boolean;
  isSearchReady: boolean;
  canSearchProducts?: boolean;
  canSearchServices?: boolean;
  canQuickAddProduct?: boolean;
  canAddPendingCheckoutItem?: boolean;
  pendingCheckoutContext?: {
    createdByStaffProfileId: Id<"staffProfile">;
    registerSessionId: Id<"registerSession">;
    terminalId: Id<"posTerminal">;
  };
  showSearchInput?: boolean;
  containerClassName?: string;
  lookupPanelClassName?: string;
  resultsClassName?: string;
  onQuickAddOpenChange?: (open: boolean) => void;
  forceQuickAddHost?: boolean;
  lookupMode?: RegisterLookupMode;
  setLookupMode?: (mode: RegisterLookupMode) => void;
  serviceEntry?: RegisterServiceEntryState;
}

const serviceModeLabels: Record<
  RegisterServiceSearchResult["serviceMode"],
  string
> = {
  same_day: "Same day",
  consultation: "Consultation",
  repair: "Repair",
  revamp: "Revamp",
};

const pricingModelLabels: Record<RegisterServicePricingModel, string> = {
  fixed: "Fixed price",
  starting_at: "Starting at",
  quote_after_consultation: "Quote after consultation",
};

function serviceSearchResultIsInCart(
  serviceEntry: RegisterServiceEntryState,
  service: RegisterServiceSearchResult,
) {
  const serviceCatalogId = service.serviceCatalogId?.toString();
  const normalizedName = service.name.trim().toLowerCase();

  return serviceEntry.items.some((item) => {
    const itemCatalogId = item.serviceCatalogId?.toString();

    if (serviceCatalogId && itemCatalogId) {
      return serviceCatalogId === itemCatalogId;
    }

    if (serviceCatalogId || itemCatalogId) {
      return false;
    }

    return (
      item.name.trim().toLowerCase() === normalizedName &&
      item.serviceMode === service.serviceMode &&
      item.pricingModel === service.pricingModel
    );
  });
}

function ServiceSearchResults({
  formatter,
  isLoading,
  onServiceAdded,
  serviceEntry,
}: {
  formatter: Intl.NumberFormat;
  isLoading: boolean;
  onServiceAdded?: () => void;
  serviceEntry: RegisterServiceEntryState;
}) {
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({});

  const handleAmountChange = (serviceId: string, value: string) => {
    setAmountInputs((current) => ({
      ...current,
      [serviceId]: value,
    }));
  };

  const handleAddService = async (service: RegisterServiceSearchResult) => {
    const amountInput = amountInputs[service.id] ?? "";
    const parsedAmount = amountInput.trim()
      ? parseDisplayAmountInput(amountInput)
      : undefined;
    const added = await serviceEntry.onAddService(service, parsedAmount);

    if (added !== false) {
      serviceEntry.setServiceSearchQuery("");
      setAmountInputs((current) => {
        const next = { ...current };
        delete next[service.id];
        return next;
      });
      onServiceAdded?.();
    }
  };

  if (isLoading) {
    return null;
  }

  if (serviceEntry.searchResults.length === 0) {
    return (
      <div className="max-h-[586px] space-y-1 overflow-y-auto scrollbar-hide">
        <div className="flex h-full flex-col items-center justify-center py-8 text-center text-gray-500">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <Scissors className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium">No services found</p>
          <p className="mt-1 text-xs text-gray-400">
            Search by service name or service type
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-h-[586px] overflow-y-auto scrollbar-hide">
      <div className="space-y-8 py-8">
        {serviceEntry.searchResults.map((service) => {
          const requiresAmount =
            service.pricingModel === "starting_at" ||
            service.pricingModel === "quote_after_consultation";
          const amountInput = amountInputs[service.id] ?? "";
          const parsedAmount = amountInput.trim()
            ? parseDisplayAmountInput(amountInput)
            : undefined;
          const isAlreadyAdded = serviceSearchResultIsInCart(
            serviceEntry,
            service,
          );
          const canAdd =
            !isAlreadyAdded && (!requiresAmount || (parsedAmount ?? 0) > 0);
          const isDisabled = serviceEntry.disabled || isAlreadyAdded || !canAdd;
          const priceLabel = pricingModelLabels[service.pricingModel];
          const amountHelp =
            service.pricingModel === "starting_at"
              ? "Enter the service amount before adding."
              : service.pricingModel === "quote_after_consultation"
                ? "Enter the quoted amount before adding."
                : null;
          const handleCardClick = () => {
            if (isDisabled) {
              return;
            }
            void handleAddService(service);
          };
          const handleCardKeyDown = (
            event: React.KeyboardEvent<HTMLDivElement>,
          ) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            event.preventDefault();
            handleCardClick();
          };

          return (
            <div
              key={service.id}
              role="button"
              tabIndex={isDisabled ? -1 : 0}
              aria-disabled={isDisabled}
              aria-label={`Add ${service.name} service`}
              className={cn(
                "group rounded-lg border bg-white/80 p-4 shadow-sm backdrop-blur-sm transition-all duration-200",
                isDisabled
                  ? "cursor-not-allowed border-gray-200 opacity-75"
                  : "cursor-pointer border-gray-200 hover:border-blue-200 hover:shadow-md hover:shadow-blue-100/50",
              )}
              onClick={handleCardClick}
              onKeyDown={handleCardKeyDown}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  <Scissors className="h-5 w-5 text-muted-foreground" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-md font-semibold text-gray-600 group-hover:text-gray-900">
                          {capitalizeWords(service.name)}
                        </p>
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {serviceModeLabels[service.serviceMode]}
                        </span>
                        {isAlreadyAdded ? (
                          <span className="rounded-full border border-action-workflow-border bg-action-workflow-soft px-2 py-0.5 text-[11px] font-medium text-action-workflow">
                            Already added
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {priceLabel}
                      </p>
                    </div>
                    {service.basePrice !== undefined ? (
                      <p className="flex-shrink-0 px-4 text-lg font-medium">
                        {formatStoredAmount(formatter, service.basePrice)}
                      </p>
                    ) : null}
                  </div>
                  {service.description ? (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {service.description}
                    </p>
                  ) : null}
                </div>
              </div>

              {requiresAmount ? (
                <div
                  className="mt-4 pl-20"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="space-y-1">
                    <Input
                      aria-label={`${service.name} amount`}
                      inputMode="decimal"
                      placeholder="Amount"
                      value={amountInput}
                      disabled={serviceEntry.disabled || isAlreadyAdded}
                      onChange={(event) =>
                        handleAmountChange(service.id, event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && canAdd) {
                          event.preventDefault();
                          void handleAddService(service);
                        }
                      }}
                    />
                    {amountHelp ? (
                      <p className="text-xs text-muted-foreground">
                        {amountHelp}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ProductSearchInput = forwardRef<
  HTMLInputElement | null,
  ProductSearchInputProps
>(function ProductSearchInput(
  {
    disabled,
    productSearchQuery,
    setProductSearchQuery,
    onBarcodeSubmit,
    className,
    inputClassName,
    lookupKind = "products_services",
    onActivate,
    placeholder,
    readOnly = false,
    submitOnEnter = true,
  },
  ref,
) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(
    ref,
    () => searchInputRef.current,
  );

  useEffect(() => {
    if (!disabled) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [disabled]);

  const handleClearSearch = () => {
    setProductSearchQuery("");
  };
  const resolvedPlaceholder =
    placeholder ??
    (lookupKind === "services"
      ? "Lookup service by name or service type..."
      : lookupKind === "products"
        ? "Lookup product by name, barcode, SKU, or product URL..."
        : "Lookup product or service by name, bar/qr code, SKU, or product URL...");

  return (
    <div className={cn("relative", className)}>
      <div className="absolute text-gray-500 z-10 left-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
        {lookupKind === "services" ? (
          <Scissors className="w-4 h-4" />
        ) : (
          <>
            <Search className="w-4 h-4" />
            <ScanBarcode className="w-4 h-4" />
          </>
        )}
      </div>
      <Input
        ref={searchInputRef}
        placeholder={resolvedPlaceholder}
        value={productSearchQuery}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => setProductSearchQuery(e.target.value)}
        onPointerDown={onActivate}
        onKeyDown={(e) => {
          if (submitOnEnter && e.key === "Enter" && productSearchQuery.trim()) {
            e.preventDefault();
            onBarcodeSubmit(e);
          }
        }}
        className={cn(
          cn(
            "h-12 pr-10 border-gray-200 focus:border-blue-400 rounded-lg text-sm font-medium bg-white/80 backdrop-blur-sm",
            lookupKind === "services" ? "pl-12" : "pl-20",
          ),
          inputClassName,
        )}
        autoFocus
        autoComplete="off"
      />
      {productSearchQuery && (
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-1.5 top-1/2 h-10 w-10 -translate-y-1/2 transform hover:bg-gray-100"
          onClick={handleClearSearch}
        >
          ×
        </Button>
      )}
    </div>
  );
});

ProductSearchInput.displayName = "ProductSearchInput";

export interface ProductEntryHandle {
  focusProductSearchInput: () => boolean;
  openQuickAddProduct: () => boolean;
}

export const ProductEntry = forwardRef<ProductEntryHandle, ProductEntryProps>(
  function ProductEntry(
    {
      disabled,
      showProductLookup,
      productSearchQuery,
      setProductSearchQuery,
      onBarcodeSubmit,
      onAddProduct,
      searchResults,
      isSearchLoading,
      isSearchReady,
      canQuickAddProduct = false,
      canSearchProducts = true,
      canSearchServices,
      showSearchInput = true,
      canAddPendingCheckoutItem = false,
      containerClassName,
      lookupPanelClassName,
      resultsClassName,
      onQuickAddOpenChange,
      forceQuickAddHost = false,
      serviceEntry,
    },
    ref,
  ) {
    const { activeStore } = useGetActiveStore();
    const { user } = useAuth();
    const quickAddProductSku = usePOSQuickAddProductSku();
    const registerCatalog = usePOSRegisterCatalog(activeStore?._id);
    const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
    const [quickAddInitialName, setQuickAddInitialName] = useState("");
    const [quickAddInitialLookupCode, setQuickAddInitialLookupCode] =
      useState("");
    const [quickAddSourceProduct, setQuickAddSourceProduct] =
      useState<Product | null>(null);
    const productSearchInputRef = useRef<HTMLInputElement>(null);

    const inputIsUrlOrBarcode = isUrlOrBarcode(productSearchQuery);
    const productLookupEnabled = canSearchProducts;
    const serviceLookupEnabled =
      Boolean(serviceEntry) && canSearchServices !== false;
    const lookupKind =
      productLookupEnabled && serviceLookupEnabled
        ? "products_services"
        : serviceLookupEnabled
          ? "services"
          : "products";

    const formatter = currencyFormatter(activeStore?.currency || "GHS");
    const serviceSearchQuery = serviceEntry?.serviceSearchQuery ?? "";
    const shouldShowServiceResults =
      serviceLookupEnabled &&
      serviceSearchQuery.trim().length > 0 &&
      serviceEntry!.searchResults.length > 0 &&
      (!inputIsUrlOrBarcode || !productLookupEnabled);
    const shouldShowProductResults =
      productLookupEnabled &&
      Boolean(productSearchQuery) &&
      (!shouldShowServiceResults ||
        searchResults.length > 0 ||
        isSearchLoading);
    const isPendingCheckoutShortcut =
      canAddPendingCheckoutItem && !canQuickAddProduct;

    // Handler to clear search after adding product
    const handleClearSearch = () => {
      setProductSearchQuery("");
    };

    const isAddingVariant = Boolean(quickAddSourceProduct?.productId);
    const existingSkuOptions = useMemo<QuickAddExistingSkuOption[]>(
      () =>
        (registerCatalog ?? [])
          .filter((item) => !item.barcode)
          .map((item) => ({
            productSkuId: String(item.productSkuId),
            name: item.name,
            sku: item.sku,
            priceLabel:
              typeof item.price === "number"
                ? `Price ${formatStoredAmount(formatter, item.price)}`
                : undefined,
            category: item.category,
            barcode: item.barcode,
            variantAttributes: [
              item.color,
              item.size,
              item.length === null || item.length === undefined
                ? undefined
                : `${item.length}"`,
            ].filter((value): value is string => Boolean(value?.trim())),
          })),
      [formatter, registerCatalog],
    );

    const handleOpenQuickAdd = useCallback(
      (selectedProduct?: Product) => {
        if (
          !productLookupEnabled ||
          (!canQuickAddProduct && !canAddPendingCheckoutItem)
        ) {
          return;
        }

        const rawQuery = productSearchQuery.trim();
        const extractedQuery = extractBarcodeFromInput(rawQuery).value.trim();

        setQuickAddInitialName(
          selectedProduct?.name || (inputIsUrlOrBarcode ? "" : rawQuery),
        );
        setQuickAddInitialLookupCode(
          normalizeQuickAddInitialLookupCode(extractedQuery),
        );
        setQuickAddSourceProduct(
          selectedProduct && selectedProduct.productId ? selectedProduct : null,
        );
        setIsQuickAddOpen(true);
        onQuickAddOpenChange?.(true);
      },
      [
        canQuickAddProduct,
        canAddPendingCheckoutItem,
        inputIsUrlOrBarcode,
        onQuickAddOpenChange,
        productLookupEnabled,
        productSearchQuery,
      ],
    );

    const refocusProductSearchInput = useCallback(() => {
      productSearchInputRef.current?.focus();
      productSearchInputRef.current?.select();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focusProductSearchInput: () => {
          if (!productSearchInputRef.current) {
            return false;
          }

          productSearchInputRef.current.focus();
          productSearchInputRef.current.select();

          return true;
        },
        openQuickAddProduct: () => {
          if (
            !productLookupEnabled ||
            (!canQuickAddProduct && !canAddPendingCheckoutItem)
          ) {
            return false;
          }

          handleOpenQuickAdd();
          return true;
        },
      }),
      [
        canAddPendingCheckoutItem,
        canQuickAddProduct,
        handleOpenQuickAdd,
        productLookupEnabled,
      ],
    );

    const handleQuickAddOpenChange = (open: boolean) => {
      if (!open) {
        setQuickAddSourceProduct(null);
      }
      onQuickAddOpenChange?.(open);
      setIsQuickAddOpen(open);
    };

    const handleQuickAddSubmit = async ({
      name,
      variants,
      usesMultipleVariants,
    }: QuickAddProductSubmitPayload) => {
      if (!activeStore?._id || !user?._id) {
        throw new Error(
          "Store sign-in is still loading. Try again in a moment.",
        );
      }

      const [primaryVariant, ...extraVariants] = variants;
      const isPendingCheckoutFlow =
        canAddPendingCheckoutItem && !canQuickAddProduct && !isAddingVariant;

      if (isPendingCheckoutFlow) {
        const localPendingProduct = buildLocalPendingCheckoutProduct({
          lookupCode: primaryVariant.lookupCode,
          name,
          price: primaryVariant.price,
          quantitySold: primaryVariant.quantityAvailable,
        });
        handleClearSearch();
        const added = await onAddProduct(
          localPendingProduct,
          primaryVariant.quantityAvailable,
        );
        if (added === false) {
          return false;
        }

        return;
      }

      const createdProduct = await quickAddProductSku({
        storeId: activeStore._id,
        createdByUserId: user._id,
        name,
        lookupCode: primaryVariant.lookupCode,
        price: primaryVariant.price,
        quantityAvailable: primaryVariant.quantityAvailable,
        productId: quickAddSourceProduct?.productId,
      });

      let productId = quickAddSourceProduct?.productId;
      if (!productId && createdProduct.productId) {
        productId = createdProduct.productId;
      }

      if (extraVariants.length && !productId) {
        throw new Error("Quick add product id missing");
      }

      if (productId) {
        for (const variant of extraVariants) {
          await quickAddProductSku({
            storeId: activeStore._id,
            createdByUserId: user._id,
            name,
            lookupCode: variant.lookupCode,
            price: variant.price,
            quantityAvailable: variant.quantityAvailable,
            productId,
          });
        }
      }

      handleClearSearch();
      const added = await onAddProduct(createdProduct);
      if (added === false) {
        return false;
      }

      toast.success(
        usesMultipleVariants
          ? "Product variants added to catalog"
          : "Product added to catalog",
      );
    };

    const handleAttachBarcodeSubmit = async ({
      lookupCode,
      productSkuId,
    }: QuickAddAttachBarcodePayload) => {
      if (!activeStore?._id || !user?._id) {
        throw new Error(
          "Store sign-in is still loading. Try again in a moment.",
        );
      }

      const attachedProduct = await quickAddProductSku({
        storeId: activeStore._id,
        createdByUserId: user._id,
        name: "",
        lookupCode,
        price: 0,
        quantityAvailable: 0,
        productSkuId: productSkuId as Id<"productSku">,
      });
      const attachedQuantityAvailable =
        typeof attachedProduct.quantityAvailable === "number"
          ? Math.trunc(attachedProduct.quantityAvailable)
          : undefined;
      const attachedAvailabilityStatus =
        attachedQuantityAvailable === undefined
          ? "unknown"
          : attachedProduct.inStock && attachedQuantityAvailable > 0
            ? "available"
            : "out_of_stock";

      handleClearSearch();
      const added = await onAddProduct({
        ...attachedProduct,
        availabilityStatus: attachedAvailabilityStatus,
        quantityAvailable: attachedQuantityAvailable,
      });
      if (added === false) {
        return false;
      }

      toast.success("Barcode attached to SKU");
    };

    if (
      !showProductLookup ||
      (!showSearchInput &&
        !productSearchQuery &&
        !serviceSearchQuery &&
        (!productLookupEnabled || !isQuickAddOpen) &&
        !forceQuickAddHost)
    ) {
      return null;
    }

    return (
      <div className={containerClassName}>
        <div className={cn("space-y-6", containerClassName && "h-full")}>
          {/* Product Lookup Section */}
          <div
            className={cn(
              "space-y-4 rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50/50 to-gray-100/30 p-5",
              lookupPanelClassName,
            )}
          >
            {showSearchInput && (
              <div className="space-y-3">
                <ProductSearchInput
                  ref={productSearchInputRef}
                  disabled={disabled || isQuickAddOpen}
                  lookupKind={lookupKind}
                  productSearchQuery={productSearchQuery}
                  setProductSearchQuery={setProductSearchQuery}
                  onBarcodeSubmit={onBarcodeSubmit}
                  submitOnEnter={productLookupEnabled}
                />
              </div>
            )}

            {shouldShowServiceResults && serviceEntry ? (
              <ServiceSearchResults
                formatter={formatter}
                isLoading={serviceEntry.isSearchLoading}
                onServiceAdded={refocusProductSearchInput}
                serviceEntry={serviceEntry}
              />
            ) : null}

            {shouldShowProductResults ? (
              <SearchResultsSection
                isLoading={isSearchLoading}
                products={searchResults}
                onAddProduct={onAddProduct}
                formatter={formatter}
                onClearSearch={handleClearSearch}
                onQuickAddProduct={
                  productLookupEnabled &&
                  isSearchReady &&
                  (canQuickAddProduct || canAddPendingCheckoutItem)
                    ? handleOpenQuickAdd
                    : undefined
                }
                quickAddQuery={isSearchReady ? productSearchQuery : ""}
                quickAddLabel={
                  isPendingCheckoutShortcut
                    ? "Add item for review"
                    : "Quick add product"
                }
                quickAddShortcutDisabled={isQuickAddOpen}
                className={resultsClassName}
              />
            ) : null}
          </div>
        </div>

        {productLookupEnabled ? (
          <QuickAddProductDialog
            open={isQuickAddOpen}
            onOpenChange={handleQuickAddOpenChange}
            onSubmit={handleQuickAddSubmit}
            onAttachBarcode={
              isAddingVariant ? undefined : handleAttachBarcodeSubmit
            }
            existingSkuOptions={existingSkuOptions}
            initialName={quickAddInitialName}
            initialLookupCode={quickAddInitialLookupCode}
            lockProductName={isAddingVariant}
            quantityLabel={
              isPendingCheckoutShortcut ? "Quantity sold" : undefined
            }
            referenceVariant={quickAddSourceProduct}
            submitErrorMessage="Could not quick add this product. Try again."
          />
        ) : null}
      </div>
    );
  },
);

ProductEntry.displayName = "ProductEntry";

function buildLocalPendingCheckoutProduct(input: {
  lookupCode?: string;
  name: string;
  price: number;
  quantitySold: number;
}): Product {
  const localPendingCheckoutItemId = createLocalPendingCheckoutId(
    "local-pending-checkout-item",
  );
  const localProductId = createLocalPendingCheckoutId("local-pending-product");
  const localProductSkuId = createLocalPendingCheckoutId("local-pending-sku");
  const lookupCode = input.lookupCode ?? "";

  return {
    id: localProductSkuId,
    name: input.name,
    barcode: lookupCode,
    sku: formatLocalPendingCheckoutSku(localPendingCheckoutItemId),
    price: input.price,
    category: "Pending checkout",
    description: "Pending owner review",
    image: null,
    inStock: true,
    availabilityStatus: "available",
    productId: localProductId as Id<"product">,
    skuId: localProductSkuId as Id<"productSku">,
    pendingCheckoutItemId:
      localPendingCheckoutItemId as Id<"posPendingCheckoutItem">,
    pendingCheckoutItemLocalDefinition: {
      localPendingCheckoutItemId,
      name: input.name,
      lookupCode: lookupCode || undefined,
      price: input.price,
      quantitySold: input.quantitySold,
      localMetadata: {
        schema: "pos_pending_checkout_item_local_metadata_v1",
        createdOffline: true,
        cloudValidation: "uncertain",
      },
    },
    quantityAvailable: undefined,
  };
}

function createLocalPendingCheckoutId(kind: string) {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${randomId}`;
}

function formatLocalPendingCheckoutSku(localPendingCheckoutItemId: string) {
  const code = localPendingCheckoutItemId
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(-10)
    .padStart(10, "0");

  return `${code.slice(0, 4)}-${code.slice(4, 7)}-${code.slice(7, 10)}`;
}
