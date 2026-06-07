import { useGetUnresolvedProducts } from "~/src/hooks/useGetProducts";
import {
  usePOSPendingCheckoutItemsForReview,
  usePOSRegisterCatalog,
  usePOSResolvePendingCheckoutItemReview,
} from "~/src/hooks/usePOSProducts";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import {
  ArrowLeftIcon,
  CircleCheck,
  CircleHelp,
} from "lucide-react";
import { EmptyState } from "../states/empty/empty-state";
import { Button } from "../ui/button";
import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import { useSearch } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Input } from "../ui/input";
import type { Id } from "~/convex/_generated/dataModel";

type CatalogLinkOption = {
  label: string;
  productId: Id<"product">;
  value: string;
  skuId: Id<"productSku">;
};

const Navigation = () => {
  const navigateBack = useNavigateBack();
  const { o } = useSearch({ strict: false });

  return (
    <div className="container mx-auto flex gap-2">
      <div className="flex items-center gap-2">
        {o && (
          <Button variant="ghost" onClick={navigateBack}>
            <ArrowLeftIcon className="w-4 h-4" />
          </Button>
        )}
        <p className="font-medium">Unresolved Products</p>
      </div>
    </div>
  );
};

export const UnresolvedProducts = () => {
  const products = useGetUnresolvedProducts();
  const { activeStore } = useGetActiveStore();
  const registerCatalog = usePOSRegisterCatalog(activeStore?._id);
  const pendingCheckoutItems = usePOSPendingCheckoutItemsForReview(
    activeStore?._id,
  );
  const resolvePendingCheckoutItem = usePOSResolvePendingCheckoutItemReview();
  const [searchValue, setSearchValue] = useState("");
  const [selectedCatalogLinks, setSelectedCatalogLinks] = useState<
    Record<string, string>
  >({});

  const filteredProducts = useMemo(() => {
    if (!products) return null;
    if (!searchValue.trim()) return products;

    const searchLower = searchValue.toLowerCase();
    return products.filter((product) => {
      // Check if product name matches
      const productName = product.name.toLowerCase();
      if (productName.includes(searchLower)) {
        return true;
      }

      // Check if any SKU matches
      return product.skus.some((sku) =>
        sku.sku?.toLowerCase().includes(searchLower)
      );
    });
  }, [products, searchValue]);

  const catalogLinkOptions = useMemo<CatalogLinkOption[]>(() => {
    if (!registerCatalog) return [];

    return registerCatalog.map((row) => {
      const skuLabel = row.sku ? ` · ${row.sku}` : "";

      return {
        label: `${row.name}${skuLabel}`,
        productId: row.productId,
        skuId: row.skuId,
        value: `${row.productId}:${row.skuId}`,
      };
    });
  }, [registerCatalog]);

  const catalogOptionsByValue = useMemo(
    () =>
      new Map(
        catalogLinkOptions.map((option) => [option.value, option]),
      ),
    [catalogLinkOptions],
  );

  if (!products) return null;

  const hasSearchInput = searchValue.trim().length > 0;

  const EmptyStateIcon = hasSearchInput ? (
    <CircleHelp className="w-16 h-16 text-muted-foreground" />
  ) : (
    <CircleCheck className="w-16 h-16 text-muted-foreground" />
  );

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <FadeIn className="py-8 space-y-4">
        {pendingCheckoutItems && pendingCheckoutItems.length > 0 ? (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">
                Pending checkout items
              </h2>
              <p className="text-sm text-muted-foreground">
                Items cashiers sold before catalog review.
              </p>
            </div>
            <div className="divide-y rounded-md border bg-background">
              {pendingCheckoutItems.map((item) => (
                <div
                  key={item._id}
                  className="grid gap-3 p-4 md:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.name}</p>
                      <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">
                        {item.reviewPriority}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Sold {item.evidence.totalQuantitySold ?? 0} across{" "}
                      {item.evidence.transactionCount ?? 0} sale
                      {(item.evidence.transactionCount ?? 0) === 1 ? "" : "s"}
                      {item.lookupCode ? ` · ${item.lookupCode}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <select
                      aria-label={`Catalog SKU for ${item.name}`}
                      className="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
                      value={selectedCatalogLinks[item._id] ?? ""}
                      onChange={(event) =>
                        setSelectedCatalogLinks((current) => ({
                          ...current,
                          [item._id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose SKU</option>
                      {catalogLinkOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!selectedCatalogLinks[item._id]}
                      onClick={() => {
                        const selectedOption = catalogOptionsByValue.get(
                          selectedCatalogLinks[item._id] ?? "",
                        );
                        if (!activeStore?._id || !selectedOption) return;

                        resolvePendingCheckoutItem({
                          storeId: activeStore._id,
                          pendingCheckoutItemId: item._id,
                          status: "linked_to_catalog",
                          approvedProductId: selectedOption.productId,
                          approvedProductSkuId: selectedOption.skuId,
                        });
                      }}
                    >
                      Link
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        activeStore?._id &&
                        resolvePendingCheckoutItem({
                          storeId: activeStore._id,
                          pendingCheckoutItemId: item._id,
                          status: "flagged",
                        })
                      }
                    >
                      Flag
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        activeStore?._id &&
                        resolvePendingCheckoutItem({
                          storeId: activeStore._id,
                          pendingCheckoutItemId: item._id,
                          status: "rejected",
                        })
                      }
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <Input
          placeholder="Filter by name or SKU..."
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          className="w-[320px]"
        />
        {filteredProducts && filteredProducts.length > 0 && (
          <GenericDataTable
            data={filteredProducts}
            columns={productColumns}
            tableId="unresolved-products"
          />
        )}
        {filteredProducts && filteredProducts.length == 0 && (
          <div className="flex items-center justify-center min-h-[60vh] w-full">
            <EmptyState
              icon={EmptyStateIcon}
              title={
                <div className="flex gap-1 text-sm">
                  <p className="text-muted-foreground">
                    {hasSearchInput
                      ? "No products match your search"
                      : "You have no products pending review"}
                  </p>
                </div>
              }
            />
          </div>
        )}
      </FadeIn>
    </View>
  );
};
