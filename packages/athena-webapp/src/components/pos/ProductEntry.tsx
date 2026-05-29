import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  QuickAddProductDialog,
  type QuickAddAttachBarcodePayload,
  type QuickAddExistingSkuOption,
} from "@/components/product/QuickAddProductDialog";
import { normalizeQuickAddInitialLookupCode } from "@/components/product/quickAddProductDialogUtils";
import type { QuickAddProductSubmitPayload } from "@/components/product/QuickAddProductDialog";
import { ScanBarcode, Search, Wrench } from "lucide-react";
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
import { cn } from "@/lib/utils";
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
  className?: string;
  inputClassName?: string;
  placeholder?: string;
}

interface ProductEntryProps extends ProductSearchInputProps {
  showProductLookup: boolean;
  setShowProductLookup: (value: boolean) => void;
  onAddProduct: (product: Product) => boolean | Promise<boolean>;
  searchResults: Product[];
  isSearchLoading: boolean;
  isSearchReady: boolean;
  canQuickAddProduct?: boolean;
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

function ServiceSearchResults({
  formatter,
  isLoading,
  serviceEntry,
}: {
  formatter: Intl.NumberFormat;
  isLoading: boolean;
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
            <Wrench className="h-6 w-6 text-gray-400" />
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
    <div className="max-h-[586px] space-y-2 overflow-y-auto pr-1 scrollbar-hide">
      {serviceEntry.searchResults.map((service) => {
        const requiresAmount =
          service.pricingModel === "starting_at" ||
          service.pricingModel === "quote_after_consultation";
        const amountInput = amountInputs[service.id] ?? "";
        const parsedAmount = amountInput.trim()
          ? parseDisplayAmountInput(amountInput)
          : undefined;
        const canAdd = !requiresAmount || (parsedAmount ?? 0) > 0;
        const priceLabel =
          service.basePrice === undefined
            ? pricingModelLabels[service.pricingModel]
            : `${pricingModelLabels[service.pricingModel]} · ${formatStoredAmount(
                formatter,
                service.basePrice,
              )}`;
        const amountHelp =
          service.pricingModel === "starting_at"
            ? "Enter the service amount before adding."
            : service.pricingModel === "quote_after_consultation"
              ? "Enter the quoted amount before adding."
              : null;

        return (
          <div
            key={service.id}
            className="rounded-lg border border-border bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {service.name}
                  </p>
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {serviceModeLabels[service.serviceMode]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{priceLabel}</p>
                {service.description ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {service.description}
                  </p>
                ) : null}
              </div>
              {!requiresAmount ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={serviceEntry.disabled}
                  onClick={() => void handleAddService(service)}
                >
                  Add service
                </Button>
              ) : null}
            </div>

            {requiresAmount ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-1">
                  <Input
                    aria-label={`${service.name} amount`}
                    inputMode="decimal"
                    placeholder="Amount"
                    value={amountInput}
                    disabled={serviceEntry.disabled}
                    onChange={(event) =>
                      handleAmountChange(service.id, event.target.value)
                    }
                  />
                  {amountHelp ? (
                    <p className="text-xs text-muted-foreground">
                      {amountHelp}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={serviceEntry.disabled || !canAdd}
                  onClick={() => void handleAddService(service)}
                >
                  Add service
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
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
    placeholder = "Lookup product by name, bar/qr code, sku, or product url...",
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

  return (
    <div className={cn("relative", className)}>
      <div className="absolute text-gray-500 z-10 left-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
        <Search className="w-4 h-4" />
        <ScanBarcode className="w-4 h-4" />
      </div>
      <Input
        ref={searchInputRef}
        placeholder={placeholder}
        value={productSearchQuery}
        disabled={disabled}
        onChange={(e) => setProductSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && productSearchQuery.trim()) {
            e.preventDefault();
            onBarcodeSubmit(e);
          }
        }}
        className={cn(
          "h-12 pl-20 pr-10 border-gray-200 focus:border-blue-400 rounded-lg text-sm font-medium bg-white/80 backdrop-blur-sm",
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
      showSearchInput = true,
      containerClassName,
      lookupPanelClassName,
      resultsClassName,
      onQuickAddOpenChange,
      forceQuickAddHost = false,
      lookupMode = "product",
      setLookupMode,
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

    const formatter = currencyFormatter(activeStore?.currency || "GHS");
    const activeLookupMode: RegisterLookupMode =
      serviceEntry && lookupMode === "service" ? "service" : "product";
    const activeSearchQuery =
      activeLookupMode === "service"
        ? serviceEntry?.serviceSearchQuery ?? ""
        : productSearchQuery;
    const setActiveSearchQuery =
      activeLookupMode === "service" && serviceEntry
        ? serviceEntry.setServiceSearchQuery
        : setProductSearchQuery;

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

    const handleOpenQuickAdd = useCallback((selectedProduct?: Product) => {
      if (!canQuickAddProduct) {
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
    }, [
      canQuickAddProduct,
      inputIsUrlOrBarcode,
      onQuickAddOpenChange,
      productSearchQuery,
    ]);

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
          if (!canQuickAddProduct) {
            return false;
          }

          handleOpenQuickAdd();
          return true;
        },
      }),
      [canQuickAddProduct, handleOpenQuickAdd],
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
        !serviceEntry?.serviceSearchQuery &&
        !isQuickAddOpen &&
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
                {serviceEntry ? (
                  <div className="inline-flex rounded-lg border border-border bg-white p-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        activeLookupMode === "product" ? "default" : "ghost"
                      }
                      onClick={() => setLookupMode?.("product")}
                    >
                      Products
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        activeLookupMode === "service" ? "default" : "ghost"
                      }
                      onClick={() => setLookupMode?.("service")}
                    >
                      Services
                    </Button>
                  </div>
                ) : null}
                <ProductSearchInput
                  ref={productSearchInputRef}
                  disabled={
                    activeLookupMode === "service"
                      ? serviceEntry?.disabled
                      : disabled || isQuickAddOpen
                  }
                  productSearchQuery={activeSearchQuery}
                  setProductSearchQuery={setActiveSearchQuery}
                  onBarcodeSubmit={
                    activeLookupMode === "service"
                      ? (event) => event.preventDefault()
                      : onBarcodeSubmit
                  }
                  placeholder={
                    activeLookupMode === "service"
                      ? "Search services by name or service type..."
                      : undefined
                  }
                />
              </div>
            )}

            {activeLookupMode === "service" &&
            serviceEntry &&
            activeSearchQuery ? (
              <ServiceSearchResults
                formatter={formatter}
                isLoading={serviceEntry.isSearchLoading}
                serviceEntry={serviceEntry}
              />
            ) : null}

            {activeLookupMode === "product" && productSearchQuery && (
              <SearchResultsSection
                isLoading={isSearchLoading}
                products={searchResults}
                onAddProduct={onAddProduct}
                formatter={formatter}
                onClearSearch={handleClearSearch}
                onQuickAddProduct={
                  isSearchReady && canQuickAddProduct
                    ? handleOpenQuickAdd
                    : undefined
                }
                quickAddQuery={isSearchReady ? productSearchQuery : ""}
                quickAddShortcutDisabled={isQuickAddOpen}
                className={resultsClassName}
              />
            )}
          </div>
        </div>

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
          referenceVariant={quickAddSourceProduct}
          submitErrorMessage="Could not quick add this product. Try again."
        />
      </div>
    );
  },
);

ProductEntry.displayName = "ProductEntry";
