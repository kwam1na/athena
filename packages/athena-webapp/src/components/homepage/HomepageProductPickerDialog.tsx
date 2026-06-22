import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ImageIcon, PackagePlus, Tag } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { SkuSearchFilterBar } from "../stock-ops/SkuSearchFilterBar";
import { formatStoredCurrencyAmount } from "~/src/lib/pos/displayAmounts";
import {
  matchesSkuSearchTerms,
  normalizeSkuSearchQuery,
} from "~/src/lib/stockOps/skuSearch";
import { cn } from "~/src/lib/utils";
import { getProductName } from "~/src/lib/productUtils";
import type { Category, Product, ProductSku, Subcategory } from "~/types";

const ALL_CATEGORY_FILTER_KEY = "all";

type HomepageProductPickerAvailabilityFilter =
  | "all"
  | "available"
  | "out_of_stock";

const HOMEPAGE_PRODUCT_PICKER_AVAILABILITY_OPTIONS: Array<{
  label: string;
  value: HomepageProductPickerAvailabilityFilter;
}> = [
  { label: "All stock", value: "all" },
  { label: "Available", value: "available" },
  { label: "Out of stock", value: "out_of_stock" },
];

type HomepageProductPickerDialogProps = {
  categories?: Category[];
  currency: string;
  description: string;
  emptyLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSelectCategory?: (category: Category) => Promise<void> | void;
  onSelectProduct?: (product: Product) => Promise<void> | void;
  onSelectSku?: (sku: ProductSku) => Promise<void> | void;
  onSelectSubcategory?: (subcategory: Subcategory) => Promise<void> | void;
  open: boolean;
  products?: Product[];
  searchId: string;
  selectLabel: string;
  showCollections?: boolean;
  subcategories?: Subcategory[];
  title: string;
};

export function HomepageProductPickerDialog({
  categories = [],
  currency,
  description,
  emptyLabel = "No products match the current search.",
  onOpenChange,
  onSelectCategory,
  onSelectProduct,
  onSelectSku,
  onSelectSubcategory,
  open,
  products,
  searchId,
  selectLabel,
  showCollections = false,
  subcategories = [],
  title,
}: HomepageProductPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<HomepageProductPickerAvailabilityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORY_FILTER_KEY);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [pendingSelectionKey, setPendingSelectionKey] = useState<string | null>(
    null,
  );
  const previousOpenRef = useRef(open);
  const isSkuSelection = !!onSelectSku;

  const skuOptions = useMemo(() => {
    return (products ?? []).flatMap((product) =>
      product.skus.map((sku) => ({ product, sku })),
    );
  }, [products]);

  const categoryFilterOptions = useMemo(() => {
    const counts = new Map<string, { itemCount: number; label: string }>();

    for (const product of products ?? []) {
      const key = product.categorySlug || product.categoryName;
      if (!key) continue;

      const existing = counts.get(key);
      counts.set(key, {
        itemCount:
          (existing?.itemCount ?? 0) +
          (isSkuSelection ? product.skus.length : 1),
        label: product.categoryName ?? key,
      });
    }

    return [...counts.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [isSkuSelection, products]);

  const normalizedQuery = normalizeSkuSearchQuery(query);
  const productOptions = useMemo(() => products ?? [], [products]);
  const filteredSkuOptions = skuOptions.filter(({ product, sku }) => {
    if (!skuMatchesAvailabilityFilter(sku, availabilityFilter)) {
      return false;
    }

    if (
      categoryFilter !== ALL_CATEGORY_FILTER_KEY &&
      product.categorySlug !== categoryFilter &&
      product.categoryName !== categoryFilter
    ) {
      return false;
    }

    return matchesSkuSearchTerms(getHomepageSkuSearchTerms(product, sku), normalizedQuery);
  });
  const filteredProductOptions = productOptions.filter((product) => {
    if (
      categoryFilter !== ALL_CATEGORY_FILTER_KEY &&
      product.categorySlug !== categoryFilter &&
      product.categoryName !== categoryFilter
    ) {
      return false;
    }

    if (
      availabilityFilter !== "all" &&
      !product.skus.some((sku) =>
        skuMatchesAvailabilityFilter(sku, availabilityFilter),
      )
    ) {
      return false;
    }

    return matchesSkuSearchTerms(
      getHomepageProductSearchTerms(product),
      normalizedQuery,
    );
  });
  const visibleItemCount = isSkuSelection
    ? filteredSkuOptions.length
    : filteredProductOptions.length;
  const totalItemCount = isSkuSelection ? skuOptions.length : productOptions.length;

  const hasActiveFilters =
    query.trim().length > 0 ||
    availabilityFilter !== "all" ||
    categoryFilter !== ALL_CATEGORY_FILTER_KEY;
  const isLoading = products === undefined;
  const isSelecting = pendingSelectionKey !== null;

  const handleClearFilters = useCallback(() => {
    setQuery("");
    setAvailabilityFilter("all");
    setCategoryFilter(ALL_CATEGORY_FILTER_KEY);
  }, []);

  const resetDialogState = useCallback(() => {
    handleClearFilters();
    setSelectionError(null);
    setPendingSelectionKey(null);
  }, [handleClearFilters]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetDialogState();
    }

    onOpenChange(nextOpen);
  };

  useEffect(() => {
    if (previousOpenRef.current && !open) {
      resetDialogState();
    }

    previousOpenRef.current = open;
  }, [open, resetDialogState]);

  const unavailableCopy = isSkuSelection
    ? "Restock this SKU before adding it to best sellers."
    : "Restock this product before adding it to the homepage.";

  const emptyStateCopy = isLoading
    ? "Loading products..."
    : totalItemCount === 0
      ? "No products are available for homepage placement yet."
      : hasActiveFilters
        ? "No products match the current filters. Clear filters or try a different search."
        : emptyLabel;

  const handleSelection = async (
    key: string,
    callback: (() => Promise<void> | void) | undefined,
  ) => {
    if (!callback || isSelecting) return;

    setSelectionError(null);
    setPendingSelectionKey(key);
    try {
      await callback();
    } catch (error) {
      console.error("Failed to update homepage placement:", error);
      setSelectionError(
        "Homepage placement was not saved. Check the item and try again.",
      );
    } finally {
      setPendingSelectionKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,860px)] w-[min(calc(100vw-2rem),72rem)] max-w-none flex-col gap-0 overflow-hidden border-border bg-surface-raised p-0 shadow-overlay">
        <DialogHeader className="border-b border-border px-layout-lg py-layout-md text-left">
          <DialogTitle className="font-display text-2xl font-medium tracking-normal">
            {title}
          </DialogTitle>
          <DialogDescription className="max-w-3xl leading-6">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-layout-md overflow-hidden p-layout-md lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="flex min-h-0 flex-col gap-layout-md">
            <SkuSearchFilterBar
              ariaLabel={`${title} product search`}
              className="bg-background"
              filterId={`${searchId}-availability`}
              filterLabel="Filter by availability"
              filterOptions={HOMEPAGE_PRODUCT_PICKER_AVAILABILITY_OPTIONS}
              filterValue={availabilityFilter}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={handleClearFilters}
              onFilterChange={setAvailabilityFilter}
              onQueryChange={setQuery}
              query={query}
              searchId={searchId}
              searchLabel="Search products, SKUs, or barcodes"
              searchPlaceholder="Search product, SKU, or barcode"
              secondaryFilters={
                categoryFilterOptions.length > 0 ? (
                  <div
                    aria-label="Filter by category"
                    className="flex flex-col gap-2 sm:flex-row sm:items-center"
                    role="group"
                  >
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Categories
                    </span>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {[
                        {
                          itemCount: totalItemCount,
                          key: ALL_CATEGORY_FILTER_KEY,
                          label: "All categories",
                        },
                        ...categoryFilterOptions,
                      ].map((category) => {
                        const isSelected = categoryFilter === category.key;

                        return (
                          <button
                            aria-pressed={isSelected}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                              isSelected
                                ? "border-action-workflow-border bg-action-workflow-soft text-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                            key={category.key}
                            onClick={() =>
                              setCategoryFilter(
                                isSelected
                                  ? ALL_CATEGORY_FILTER_KEY
                                  : category.key,
                              )
                            }
                            type="button"
                          >
                            {category.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null
              }
              summary={
                isLoading
                  ? "Loading catalog..."
                  : `${visibleItemCount} of ${totalItemCount} ${
                      isSkuSelection ? "SKUs" : "products"
                    } shown`
              }
            />

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-background">
              {isLoading ? (
                <div className="flex min-h-[18rem] items-center justify-center px-layout-md py-layout-xl text-sm text-muted-foreground">
                  {emptyStateCopy}
                </div>
              ) : visibleItemCount === 0 ? (
                <div className="flex min-h-[18rem] items-center justify-center px-layout-md py-layout-xl text-center text-sm text-muted-foreground">
                  {emptyStateCopy}
                </div>
              ) : !isSkuSelection ? (
                <div className="divide-y divide-border">
                  {filteredProductOptions.map((product) => {
                    const primarySku = product.skus[0];
                    const productIsUnavailable =
                      getProductAvailableUnits(product) <= 0;
                    const selectionKey = `product-${product._id}`;
                    const productStatusId = `${searchId}-${selectionKey}-status`;

                    return (
                      <button
                        aria-describedby={
                          productIsUnavailable ? productStatusId : undefined
                        }
                        className={cn(
                          "grid w-full grid-cols-[4.5rem_minmax(0,1fr)] gap-layout-md px-layout-md py-layout-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:grid-cols-[4.5rem_minmax(0,1fr)_auto]",
                          productIsUnavailable || isSelecting
                            ? "cursor-not-allowed opacity-60"
                            : "hover:bg-surface",
                        )}
                        disabled={productIsUnavailable || isSelecting}
                        key={product._id}
                        onClick={() =>
                          handleSelection(selectionKey, () =>
                            onSelectProduct?.(product),
                          )
                        }
                        type="button"
                      >
                        <HomepageProductThumb
                          alt={product.name}
                          src={primarySku?.images[0]}
                        />
                        <div className="min-w-0 space-y-layout-xs">
                          <div>
                            <p className="truncate text-sm font-medium text-foreground">
                              {product.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {product.categoryName ?? "Uncategorized"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                            {product.skus.length > 1 ? (
                              <MetadataPill>{product.skus.length} SKUs</MetadataPill>
                            ) : null}
                            {primarySku?.sku ? (
                              <MetadataPill>SKU {primarySku.sku}</MetadataPill>
                            ) : null}
                            {primarySku?.barcode ? (
                              <MetadataPill>Barcode {primarySku.barcode}</MetadataPill>
                            ) : null}
                            {primarySku?.colorName ? (
                              <MetadataPill>{primarySku.colorName}</MetadataPill>
                            ) : null}
                            {primarySku?.size ? (
                              <MetadataPill>{primarySku.size}</MetadataPill>
                            ) : null}
                          </div>
                          {productIsUnavailable ? (
                            <p
                              className="text-xs text-muted-foreground"
                              id={productStatusId}
                            >
                              {unavailableCopy}
                            </p>
                          ) : null}
                        </div>
                        <div className="col-span-2 flex flex-wrap items-center gap-layout-sm text-sm md:col-span-1 md:justify-end">
                          <span className="font-numeric text-foreground">
                            {formatStoredCurrencyAmount(
                              currency,
                              primarySku?.price ?? 0,
                              { revealMinorUnits: true },
                            )}
                          </span>
                          {primarySku ? (
                            <span className="rounded-full border border-border bg-surface px-layout-sm py-layout-2xs text-xs text-muted-foreground">
                              {getProductAvailabilityLabel(product)}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1 rounded-md bg-action-workflow-soft px-layout-sm py-layout-2xs text-xs font-medium text-action-workflow">
                            <PackagePlus className="h-3 w-3" />
                            {pendingSelectionKey === selectionKey
                              ? "Saving..."
                              : selectLabel}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredSkuOptions.map(({ product, sku }) => {
                    const skuIsUnavailable = getSkuAvailableUnits(sku) <= 0;
                    const selectionKey = `sku-${sku._id}`;
                    const skuStatusId = `${searchId}-${selectionKey}-status`;

                    return (
                      <button
                        aria-describedby={
                          skuIsUnavailable ? skuStatusId : undefined
                        }
                        className={cn(
                          "grid w-full grid-cols-[4.5rem_minmax(0,1fr)] gap-layout-md px-layout-md py-layout-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:grid-cols-[4.5rem_minmax(0,1fr)_auto]",
                          skuIsUnavailable || isSelecting
                            ? "cursor-not-allowed opacity-60"
                            : "hover:bg-surface",
                        )}
                        disabled={skuIsUnavailable || isSelecting}
                        key={sku._id}
                        onClick={() =>
                          handleSelection(selectionKey, () =>
                            onSelectSku
                              ? onSelectSku(sku)
                              : onSelectProduct?.(product),
                          )
                        }
                        type="button"
                      >
                        <HomepageProductThumb
                          alt={getProductName(sku) || product.name}
                          src={sku.images[0]}
                        />
                        <div className="min-w-0 space-y-layout-xs">
                          <div>
                            <p className="truncate text-sm font-medium text-foreground">
                              {getProductName(sku) || product.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {product.categoryName ?? "Uncategorized"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                            {sku.sku ? <MetadataPill>SKU {sku.sku}</MetadataPill> : null}
                            {sku.barcode ? (
                              <MetadataPill>Barcode {sku.barcode}</MetadataPill>
                            ) : null}
                            {sku.colorName ? (
                              <MetadataPill>{sku.colorName}</MetadataPill>
                            ) : null}
                            {sku.size ? <MetadataPill>{sku.size}</MetadataPill> : null}
                          </div>
                          {skuIsUnavailable ? (
                            <p
                              className="text-xs text-muted-foreground"
                              id={skuStatusId}
                            >
                              {unavailableCopy}
                            </p>
                          ) : null}
                        </div>
                        <div className="col-span-2 flex flex-wrap items-center gap-layout-sm text-sm md:col-span-1 md:justify-end">
                          <span className="font-numeric text-foreground">
                            {formatStoredCurrencyAmount(currency, sku.price, {
                              revealMinorUnits: true,
                            })}
                          </span>
                          <span className="rounded-full border border-border bg-surface px-layout-sm py-layout-2xs text-xs text-muted-foreground">
                            {getSkuAvailabilityLabel(sku)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-action-workflow-soft px-layout-sm py-layout-2xs text-xs font-medium text-action-workflow">
                            <PackagePlus className="h-3 w-3" />
                            {pendingSelectionKey === selectionKey
                              ? "Saving..."
                              : selectLabel}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <aside className="min-h-0 space-y-layout-md overflow-y-auto rounded-md border border-border bg-background p-layout-md">
            <div>
              <p className="text-sm font-medium text-foreground">Selection</p>
              <p className="mt-layout-xs text-xs leading-5 text-muted-foreground">
                Search by product name, SKU, barcode, color, size, or category,
                then select the row to add it.
              </p>
            </div>

            {showCollections ? (
              <div className="space-y-layout-md border-t border-border pt-layout-md">
                <CollectionPicker
                  getSelectionKey={(category) => `category-${category._id}`}
                  icon={<Tag className="h-4 w-4" />}
                  items={categories}
                  label="Categories"
                  onSelect={(category) =>
                    handleSelection(`category-${category._id}`, () =>
                      onSelectCategory?.(category),
                    )
                  }
                  pendingSelectionKey={pendingSelectionKey}
                />
                <CollectionPicker
                  getSelectionKey={(subcategory) =>
                    `subcategory-${subcategory._id}`
                  }
                  icon={<Tag className="h-4 w-4" />}
                  items={subcategories}
                  label="Subcategories"
                  onSelect={(subcategory) =>
                    handleSelection(`subcategory-${subcategory._id}`, () =>
                      onSelectSubcategory?.(subcategory),
                    )
                  }
                  pendingSelectionKey={pendingSelectionKey}
                />
              </div>
            ) : (
              <div className="rounded-md border border-border bg-surface px-layout-md py-layout-sm text-xs leading-5 text-muted-foreground">
                This picker only changes the storefront homepage placement. It
                does not edit catalog stock or product details.
              </div>
            )}

            {selectionError ? (
              <p className="rounded-md border border-danger/30 bg-danger/5 px-layout-sm py-layout-xs text-xs leading-5 text-danger">
                {selectionError}
              </p>
            ) : null}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CollectionPicker<TItem extends Category | Subcategory>({
  getSelectionKey,
  icon,
  items,
  label,
  onSelect,
  pendingSelectionKey,
}: {
  getSelectionKey: (item: TItem) => string;
  icon: ReactNode;
  items: TItem[];
  label: string;
  onSelect?: (item: TItem) => Promise<void> | void;
  pendingSelectionKey: string | null;
}) {
  if (!onSelect) return null;

  return (
    <div className="space-y-layout-xs">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <div className="space-y-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No {label.toLowerCase()} found.</p>
        ) : (
          items.map((item) => {
            const selectionKey = getSelectionKey(item);
            const isPending = pendingSelectionKey === selectionKey;

            return (
              <button
                className="w-full rounded-md border border-border bg-surface px-layout-sm py-layout-xs text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pendingSelectionKey !== null}
                key={item._id}
                onClick={() => onSelect(item)}
                type="button"
              >
                {isPending ? "Saving..." : item.name}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function HomepageProductThumb({
  alt,
  src,
}: {
  alt: string;
  src?: string;
}) {
  return src ? (
    <img
      alt={alt}
      className="h-[4.5rem] w-[4.5rem] rounded-md object-cover"
      src={src}
    />
  ) : (
    <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-md border border-border bg-surface text-muted-foreground">
      <ImageIcon className="h-5 w-5" />
    </div>
  );
}

function MetadataPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-surface px-layout-xs py-layout-2xs">
      {children}
    </span>
  );
}

function getHomepageSkuSearchTerms(product: Product, sku: ProductSku) {
  return [
    product.name,
    product.categoryName,
    product.subcategoryName,
    product.categorySlug,
    product.subcategorySlug,
    sku.sku,
    sku.barcode,
    sku.productCategory,
    sku.productName,
    sku.colorName,
    sku.size,
    sku.length === null || sku.length === undefined
      ? undefined
      : String(sku.length),
  ];
}

function getHomepageProductSearchTerms(product: Product) {
  return [
    product.name,
    product.categoryName,
    product.subcategoryName,
    product.categorySlug,
    product.subcategorySlug,
    ...product.skus.flatMap((sku) => getHomepageSkuSearchTerms(product, sku)),
  ];
}

function skuMatchesAvailabilityFilter(
  sku: ProductSku,
  filter: HomepageProductPickerAvailabilityFilter,
) {
  if (filter === "available") return getSkuAvailableUnits(sku) > 0;
  if (filter === "out_of_stock") return getSkuAvailableUnits(sku) <= 0;

  return true;
}

function getSkuAvailabilityLabel(sku: ProductSku) {
  const units = getSkuAvailableUnits(sku);
  if (units <= 0) return "Out of stock";
  if (units === 1) return "1 available";
  return `${units} available`;
}

function getProductAvailabilityLabel(product: Product) {
  const units = getProductAvailableUnits(product);

  if (units <= 0) return "Out of stock";
  if (units === 1) return "1 available";
  return `${units} available`;
}

function getProductAvailableUnits(product: Product) {
  return product.skus.reduce(
    (total, sku) => total + getSkuAvailableUnits(sku),
    0,
  );
}

function getSkuAvailableUnits(sku: ProductSku) {
  return typeof sku.quantityAvailable === "number"
    ? sku.quantityAvailable
    : sku.inventoryCount;
}
