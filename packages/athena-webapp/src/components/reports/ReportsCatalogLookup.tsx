import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AnimatedHeight } from "@/components/common/AnimatedHeight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useDebounce } from "@/hooks/useDebounce";
import { getOrigin } from "@/lib/navigationUtils";
import {
  buildAdminSkuSearchOptions,
  groupAdminSkuSearchOptionsByProduct,
  type ProductSkuSearchResultLike,
} from "@/lib/skuSearch/productSkuSearchAdapters";
import { api } from "~/convex/_generated/api";
import { formatOptionalMoney } from "./reportFormat";

type ProductSkuSearchResponse = {
  candidateOverflow: boolean;
  limit: number;
  results: ProductSkuSearchResultLike[];
  truncated: boolean;
};

function capitalizeProductName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  const lowercase = trimmed.toLocaleLowerCase();
  const uppercase = trimmed.toLocaleUpperCase();
  const isUniformCase = trimmed === lowercase || trimmed === uppercase;

  if (!isUniformCase) return trimmed;

  return lowercase
    .split(/([\s/-]+)/)
    .map((segment) =>
      /\d/u.test(segment)
        ? segment
        : segment.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase()),
    )
    .join("");
}

export function ReportsCatalogLookup({
  endDate,
  startDate,
}: {
  endDate: string;
  startDate: string;
}) {
  const { activeStore } = useGetActiveStore();
  const navigate = useNavigate();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 200);
  const trimmedQuery = query.trim();
  const trimmedDebouncedQuery = debouncedQuery.trim();

  const searchResult = useQuery(
    api.inventory.skuSearch.searchProductSkus,
    activeStore?._id && trimmedDebouncedQuery
      ? {
          limit: 25,
          query: trimmedDebouncedQuery,
          storeId: activeStore._id,
        }
      : "skip",
  ) as ProductSkuSearchResponse | undefined;

  const groups = useMemo(
    () =>
      groupAdminSkuSearchOptionsByProduct(
        buildAdminSkuSearchOptions(
          (searchResult?.results ?? []).filter(
            (result) => result.storeId === activeStore?._id,
          ),
        ),
      ),
    [activeStore?._id, searchResult?.results],
  );

  useEffect(() => {
    setQuery("");
  }, [activeStore?._id]);

  const hasQuery = trimmedQuery.length > 0;
  const isWaitingForDebounce = trimmedQuery !== trimmedDebouncedQuery;
  const isLoading =
    hasQuery && (isWaitingForDebounce || searchResult === undefined);
  const isLimited =
    Boolean(searchResult?.truncated) || Boolean(searchResult?.candidateOverflow);

  function clearQuery() {
    setQuery("");
    searchInputRef.current?.focus();
  }

  function inspectSku(productSkuId: string) {
    const origin = getOrigin();
    setQuery("");
    void navigate({
      params: {
        orgUrlSlug: orgUrlSlug!,
        productSkuId,
        storeUrlSlug: storeUrlSlug!,
      },
      search: {
        endDate,
        o: origin,
        startDate,
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
    });
  }

  return (
    <section
      aria-label="Find a product"
      className="max-w-2xl"
      data-testid="reports-catalog-lookup"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-controls={hasQuery ? "reports-product-matches" : undefined}
            aria-label="Search products"
            className="h-11 rounded-none border-0 bg-transparent pl-10 pr-11 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-search-cancel-button]:appearance-none"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                clearQuery();
              }
            }}
            placeholder="Search by product name, SKU, or barcode"
            ref={searchInputRef}
            type="search"
            value={query}
          />
          {hasQuery ? (
            <Button
              aria-label="Clear product search"
              className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full p-0 text-muted-foreground transition-[background-color,transform] duration-100 hover:bg-accent hover:text-foreground active:scale-95 motion-reduce:transition-none"
              onClick={clearQuery}
              type="button"
              variant="clear"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        <AnimatedHeight
          animateFromZero
          testId="reports-search-results-transition"
        >
          {hasQuery ? (
            <div
              aria-busy={isLoading}
              className="max-h-[28rem] overflow-y-auto overscroll-contain border-t border-border"
              id="reports-product-matches"
            >
              {isLoading ? (
              <p
                className="px-layout-md py-layout-md text-sm text-muted-foreground"
                role="status"
              >
                Searching…
              </p>
            ) : groups.length === 0 ? (
              <div className="px-layout-md py-layout-md">
                <p className="text-sm font-medium text-foreground">
                  No matching products
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Check the product name, SKU, or barcode and try again.
                </p>
              </div>
            ) : (
              <div aria-label="Product matches">
                {groups.map((group, groupIndex) => {
                  const productName = capitalizeProductName(group.productName);

                  return (
                    <div
                      className={
                        groupIndex === 0 ? undefined : "border-t border-border"
                      }
                      key={group.productId}
                    >
                      <div className="flex items-baseline justify-between gap-layout-sm px-layout-md pb-1 pt-layout-sm">
                        <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
                          {productName}
                        </h3>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {group.skus.length}{" "}
                          {group.skus.length === 1 ? "variant" : "variants"}
                        </span>
                      </div>
                      <div className="px-1.5 pb-1.5">
                        {group.skus.map((option) => {
                          const skuLabel =
                            option.sku?.trim() || String(option.productSkuId);
                          const netPrice = formatOptionalMoney(
                            option.searchResult.netPrice,
                            activeStore?.currency ?? "USD",
                          );

                          return (
                            <button
                              aria-label={`View report for ${productName}, ${skuLabel}, net price ${netPrice}`}
                              className="group flex min-h-12 w-full items-center justify-between gap-layout-md rounded-lg px-layout-sm py-layout-sm text-left outline-none transition-[background-color,transform] duration-100 hover:bg-accent active:scale-[0.99] active:bg-accent focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                              key={option.productSkuId}
                              onClick={() => inspectSku(option.productSkuId)}
                              type="button"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-medium tabular-nums text-muted-foreground">
                                  {skuLabel}
                                </span>
                                {option.subtitle ? (
                                  <span className="mt-0.5 block truncate text-xs leading-relaxed text-muted-foreground">
                                    {option.subtitle}
                                  </span>
                                ) : null}
                              </span>
                              <span className="flex shrink-0 items-center gap-layout-sm">
                                <span className="font-numeric text-sm tabular-nums text-foreground">
                                  {netPrice}
                                </span>
                                <ChevronRight
                                  aria-hidden="true"
                                  className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
                                />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {isLimited ? (
                  <p className="border-t border-border px-layout-md py-layout-sm text-xs leading-relaxed text-muted-foreground">
                    Showing the closest matches. Refine your search to narrow
                    the list.
                  </p>
                ) : null}
              </div>
              )}
            </div>
          ) : null}
        </AnimatedHeight>
      </div>
    </section>
  );
}
