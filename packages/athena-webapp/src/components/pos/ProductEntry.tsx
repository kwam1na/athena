import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  QuickAddProductDialog,
  type QuickAddAttachBarcodePayload,
  type QuickAddExistingSkuOption,
} from "@/components/product/QuickAddProductDialog";
import { normalizeQuickAddInitialLookupCode } from "@/components/product/quickAddProductDialogUtils";
import type { QuickAddProductSubmitPayload } from "@/components/product/QuickAddProductDialog";
import { ScanBarcode, Search } from "lucide-react";
import type { Product } from "./types";
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

interface ProductSearchInputProps {
  productSearchQuery: string;
  setProductSearchQuery: (query: string) => void;
  onBarcodeSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
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
        placeholder="Lookup product by name, bar/qr code, sku, or product url..."
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
      [registerCatalog],
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
              <ProductSearchInput
                ref={productSearchInputRef}
                disabled={disabled || isQuickAddOpen}
                productSearchQuery={productSearchQuery}
                setProductSearchQuery={setProductSearchQuery}
                onBarcodeSubmit={onBarcodeSubmit}
              />
            )}

            {productSearchQuery && (
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
