import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, PackagePlus, ScanBarcode, Search } from "lucide-react";
import { Product } from "./types";
import {
  usePOSProductSearch,
  usePOSQuickAddProductSku,
} from "@/hooks/usePOSProducts";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { useDebounce } from "@/hooks/useDebounce";
import {
  extractBarcodeFromInput,
  isUrlOrBarcode,
} from "@/lib/pos/barcodeUtils";
import {
  POS_SEARCH_DEBOUNCE_MS,
  POS_QUERY_BUFFER_MS,
} from "@/lib/pos/constants";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
} from "react";
import { SearchResultsSection } from "./SearchResultsSection";
import { useProductSearchResults } from "@/hooks/useProductSearchResults";
import { cn } from "@/lib/utils";
import { parseDisplayAmountInput } from "@/lib/pos/displayAmounts";
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
  onAddProduct: (product: Product) => void;
  barcodeSearchResult?: Product | Product[] | null;
  productIdSearchResults?: Product[] | null;
  showSearchInput?: boolean;
  containerClassName?: string;
  lookupPanelClassName?: string;
  resultsClassName?: string;
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
  ref
) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => searchInputRef.current);

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
}

const QUICK_ADD_LOOKUP_CODE_MAX_LENGTH = 64;
const QUICK_ADD_LOOKUP_CODE_BARCODE = /^\d[\d-]*$/;
const QUICK_ADD_LOOKUP_CODE_SKU = /^[A-Za-z0-9_-]+$/;

function normalizeQuickAddLookupCode(lookupCode: string): string {
  const trimmedLookupCode = lookupCode.trim();
  if (!trimmedLookupCode) {
    return "";
  }

  const lookupCodeWithoutSpaces = trimmedLookupCode.replace(/\s+/g, "");
  if (QUICK_ADD_LOOKUP_CODE_BARCODE.test(lookupCodeWithoutSpaces)) {
    return lookupCodeWithoutSpaces;
  }

  return trimmedLookupCode;
}

function isLikelyBarcode(lookupCode: string): boolean {
  return QUICK_ADD_LOOKUP_CODE_BARCODE.test(lookupCode);
}

function isValidSku(lookupCode: string): boolean {
  return QUICK_ADD_LOOKUP_CODE_SKU.test(lookupCode);
}

function validateQuickAddLookupCode(lookupCode: string) {
  const trimmedLookupCode = lookupCode.trim();
  if (!trimmedLookupCode) {
    return null;
  }

  if (trimmedLookupCode.length > QUICK_ADD_LOOKUP_CODE_MAX_LENGTH) {
    return "Lookup code is too long.";
  }

  const lookupCodeWithoutSpaces = trimmedLookupCode.replace(/\s+/g, "");
  if (isLikelyBarcode(lookupCodeWithoutSpaces)) {
    return null;
  }

  if (/\s/.test(trimmedLookupCode)) {
    return "Lookup code cannot contain spaces.";
  }

  if (!isValidSku(lookupCodeWithoutSpaces)) {
    return "Lookup code can only contain letters, numbers, hyphens, or underscores.";
  }

  return null;
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
      barcodeSearchResult,
      productIdSearchResults,
      showSearchInput = true,
      containerClassName,
      lookupPanelClassName,
      resultsClassName,
    },
    ref
  ) {
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const quickAddProductSku = usePOSQuickAddProductSku();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddLookupCode, setQuickAddLookupCode] = useState("");
  const [quickAddPrice, setQuickAddPrice] = useState("");
  const [quickAddQuantity, setQuickAddQuantity] = useState("1");
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [isQuickAddSaving, setIsQuickAddSaving] = useState(false);
  const productSearchInputRef = useRef<HTMLInputElement>(null);

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
    }),
    []
  );

  const debouncedProductSearchQuery = useDebounce(
    productSearchQuery,
    POS_SEARCH_DEBOUNCE_MS
  );

  // Fetch search results
  const searchResults = usePOSProductSearch(
    activeStore?._id,
    debouncedProductSearchQuery
  );

  // Debounce for "no results" message to allow search query to complete
  const debouncedForNoResults = useDebounce(
    productSearchQuery,
    POS_SEARCH_DEBOUNCE_MS + POS_QUERY_BUFFER_MS
  );

  // Check if input is a URL or barcode (vs a product search term)
  const inputIsUrlOrBarcode = isUrlOrBarcode(productSearchQuery);

  // Consolidate search result logic with proper prioritization
  const { filteredProducts, isLoading } = useProductSearchResults({
    searchResults,
    barcodeSearchResult,
    productIdSearchResults,
    inputIsUrlOrBarcode,
    rawQuery: productSearchQuery,
    debouncedQuery: debouncedForNoResults,
  });
  const isWaitingForStableQuery =
    productSearchQuery.trim().length > 0 &&
    productSearchQuery.trim() !== debouncedForNoResults.trim();

  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  // Handler to clear search after adding product
  const handleClearSearch = () => {
    setProductSearchQuery("");
  };

  const handleOpenQuickAdd = () => {
    const rawQuery = productSearchQuery.trim();
    const extractedQuery = extractBarcodeFromInput(rawQuery).value.trim();
    const shouldTreatQueryAsLookup =
      inputIsUrlOrBarcode || !/\s/.test(extractedQuery);

    setQuickAddName(inputIsUrlOrBarcode ? "" : rawQuery);
    setQuickAddLookupCode(shouldTreatQueryAsLookup ? extractedQuery : "");
    setQuickAddPrice("");
    setQuickAddQuantity("1");
    setQuickAddError(null);
    setIsQuickAddOpen(true);
  };

  const handleQuickAddSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!activeStore?._id || !user?._id) {
      setQuickAddError("Store sign-in is still loading. Try again in a moment.");
      return;
    }

    const normalizedQuickAddLookupCode = normalizeQuickAddLookupCode(
      quickAddLookupCode,
    );
    const lookupCodeValidationError = validateQuickAddLookupCode(
      normalizedQuickAddLookupCode
    );

    if (lookupCodeValidationError) {
      setQuickAddError(lookupCodeValidationError);
      return;
    }

    const parsedPrice = parseDisplayAmountInput(quickAddPrice);
    if (parsedPrice === undefined || parsedPrice <= 0) {
      setQuickAddError("Enter a selling price greater than 0.");
      return;
    }

    const parsedQuantity = quickAddQuantity.trim() ? +quickAddQuantity : 0;
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
      setQuickAddError("Enter a valid quantity.");
      return;
    }

    setQuickAddError(null);
    setIsQuickAddSaving(true);

    try {
      const createdProduct = await quickAddProductSku({
        storeId: activeStore._id,
        createdByUserId: user._id,
        name: quickAddName.trim(),
        lookupCode: normalizedQuickAddLookupCode || undefined,
        price: parsedPrice,
        quantityAvailable: Math.trunc(parsedQuantity),
      });

      await onAddProduct(createdProduct);
      setIsQuickAddOpen(false);
      handleClearSearch();
      toast.success("Product added to catalog.");
    } catch (error) {
      console.error("[POS] Quick add product failed", error);
      setQuickAddError("Could not quick add this product. Try again.");
    } finally {
      setIsQuickAddSaving(false);
    }
  };

  if (!showProductLookup || (!showSearchInput && !productSearchQuery)) {
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
              disabled={disabled}
              productSearchQuery={productSearchQuery}
              setProductSearchQuery={setProductSearchQuery}
              onBarcodeSubmit={onBarcodeSubmit}
            />
          )}

          {productSearchQuery && (
            <SearchResultsSection
              isLoading={isLoading || isWaitingForStableQuery}
              products={filteredProducts}
              onAddProduct={onAddProduct}
              formatter={formatter}
              onClearSearch={handleClearSearch}
              onQuickAddProduct={handleOpenQuickAdd}
              quickAddQuery={isWaitingForStableQuery ? "" : productSearchQuery}
              className={resultsClassName}
            />
          )}
        </div>
      </div>

      <Dialog open={isQuickAddOpen} onOpenChange={setIsQuickAddOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleQuickAddSubmit} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Quick add product</DialogTitle>
              <DialogDescription>
                Add the SKU needed for this sale. You can complete catalog
                details later.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="quick-add-product-name">Product name</Label>
                <Input
                  id="quick-add-product-name"
                  value={quickAddName}
                  onChange={(event) => setQuickAddName(event.target.value)}
                  placeholder="Product name"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="quick-add-lookup-code">SKU or barcode</Label>
                <Input
                  id="quick-add-lookup-code"
                  value={quickAddLookupCode}
                  onChange={(event) =>
                    setQuickAddLookupCode(event.target.value)
                  }
                  placeholder="SKU or barcode"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quick-add-price">Selling price</Label>
                  <Input
                    id="quick-add-price"
                    inputMode="decimal"
                    value={quickAddPrice}
                    onChange={(event) => setQuickAddPrice(event.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quick-add-quantity">Available qty</Label>
                  <Input
                    id="quick-add-quantity"
                    inputMode="numeric"
                    value={quickAddQuantity}
                    onChange={(event) =>
                      setQuickAddQuantity(event.target.value)
                    }
                    placeholder="1"
                  />
                </div>
              </div>

              {quickAddError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {quickAddError}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsQuickAddOpen(false)}
                disabled={isQuickAddSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isQuickAddSaving}>
                {isQuickAddSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PackagePlus className="mr-2 h-4 w-4" />
                )}
                Add product
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
});

ProductEntry.displayName = "ProductEntry";
