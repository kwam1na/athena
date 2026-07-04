import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CircleDot,
  History,
  ListPlus,
  PackageSearch,
  ReceiptText,
} from "lucide-react";

import { getOrigin } from "~/src/lib/navigationUtils";
import { cn, getRelativeTime } from "~/src/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  SkuActivityUntrustedSalesReviewStatus,
  SkuActivityUntrustedSalesSourceFilter,
  SkuActivityUntrustedSalesSourceRow,
  SkuActivityUntrustedSalesSourceType,
  SkuActivityUntrustedSalesViewModel,
} from "./skuActivityUntrustedSalesAdapter";

type SkuActivityUntrustedSalesProps = {
  error?: unknown;
  isLoading?: boolean;
  onChangeReviewStatus: (status: SkuActivityUntrustedSalesReviewStatus) => void;
  onChangeSourceFilter: (filter: SkuActivityUntrustedSalesSourceFilter) => void;
  onLoadMoreSources?: () => void;
  onLoadMoreTransactions?: () => void;
  onSelectSource: (source: {
    id: string;
    sourceType: SkuActivityUntrustedSalesSourceType;
  }) => void;
  orgUrlSlug: string;
  storeUrlSlug: string;
  viewModel: SkuActivityUntrustedSalesViewModel | null | undefined;
};

const SOURCE_FILTER_OPTIONS: Array<{
  label: string;
  value: SkuActivityUntrustedSalesSourceFilter;
}> = [
  { label: "All sources", value: "all" },
  { label: "Legacy import", value: "legacy_import" },
  { label: "POS pending checkout", value: "pending_checkout" },
];

const REVIEW_STATUS_OPTIONS: Array<{
  label: string;
  value: SkuActivityUntrustedSalesReviewStatus;
}> = [
  { label: "Open", value: "open" },
  { label: "Reviewed", value: "reviewed" },
  { label: "All", value: "all" },
];

function InlineState({
  description,
  title,
}: {
  description?: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
      <div className="flex items-start gap-layout-sm">
        <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function FilterButton<TValue extends string>({
  isSelected,
  label,
  onSelect,
  value,
}: {
  isSelected: boolean;
  label: string;
  onSelect: (value: TValue) => void;
  value: TValue;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
      onClick={() => onSelect(value)}
      type="button"
    >
      {label}
    </button>
  );
}

function SourceToneBadge({ source }: { source: SkuActivityUntrustedSalesSourceRow }) {
  return (
    <Badge
      className={
        source.sourceType === "inventoryImportProvisionalSku"
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "border-warning/30 bg-warning/10 text-foreground"
      }
      variant="outline"
    >
      {source.sourceTypeLabel}
    </Badge>
  );
}

function ReviewStateBadge({ source }: { source: SkuActivityUntrustedSalesSourceRow }) {
  return (
    <Badge
      className={
        source.reviewState === "open"
          ? "border-warning/30 bg-warning/10 text-foreground"
          : "border-success/30 bg-success/10 text-foreground"
      }
      variant="outline"
    >
      {source.reviewLabel}
    </Badge>
  );
}

function SourceReviewLink({
  orgUrlSlug,
  source,
  storeUrlSlug,
}: {
  orgUrlSlug: string;
  source: SkuActivityUntrustedSalesSourceRow;
  storeUrlSlug: string;
}) {
  if (source.sourceType === "posPendingCheckoutItem") {
    return (
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        params={{ orgUrlSlug, storeUrlSlug }}
        search={{ categorySlug: "pos-pending-checkout", o: getOrigin() }}
        to="/$orgUrlSlug/store/$storeUrlSlug/products"
      >
        Review pending checkout
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (source.productId && source.productSkuId) {
    return (
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        params={{
          orgUrlSlug,
          productSlug: source.productId,
          storeUrlSlug,
        }}
        search={{ o: getOrigin(), variant: source.productSkuId }}
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
      >
        Review SKU
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (source.sourceType === "inventoryImportProvisionalSku") {
    return (
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        params={{ orgUrlSlug, storeUrlSlug }}
        search={{ filter: "review" }}
        to="/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import/review"
      >
        Review import
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  return null;
}

function SourceList({
  onSelectSource,
  sources,
}: {
  onSelectSource: SkuActivityUntrustedSalesProps["onSelectSource"];
  sources: SkuActivityUntrustedSalesSourceRow[];
}) {
  return (
    <ul aria-label="Untrusted SKU sale evidence" className="space-y-layout-sm">
      {sources.map((source) => (
        <li key={`${source.sourceType}:${source.id}`}>
          <button
            aria-pressed={source.isSelected}
            className={cn(
              "w-full rounded-md border bg-background px-layout-md py-layout-sm text-left transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              source.isSelected
                ? "border-primary/40 bg-primary/5"
                : "border-border hover:border-primary/30",
            )}
            onClick={() =>
              onSelectSource({ id: source.id, sourceType: source.sourceType })
            }
            type="button"
          >
            <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-layout-xs">
                  <SourceToneBadge source={source} />
                  <ReviewStateBadge source={source} />
                  <Badge variant="outline">{source.statusLabel}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">
                  {source.title}
                </p>
                <p className="mt-1 break-all text-sm leading-6 text-muted-foreground">
                  {source.lookupLabel ?? "No lookup code recorded"}
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="text-sm font-medium tabular-nums text-foreground">
                  {source.evidenceLabel}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {getRelativeTime(source.lastActivityAt)}
                </p>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function SelectedSourceDetail({
  onLoadMoreTransactions,
  orgUrlSlug,
  selected,
  storeUrlSlug,
}: {
  onLoadMoreTransactions?: () => void;
  orgUrlSlug: string;
  selected: NonNullable<SkuActivityUntrustedSalesViewModel["selected"]> | null;
  storeUrlSlug: string;
}) {
  if (!selected) {
    return (
      <aside className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
        <div className="flex items-start gap-layout-sm">
          <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Select a source to inspect transactions.
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Completed sale lines will load after a source is selected.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const hasTransactionMismatch =
    selected.source.totalQuantitySold > 0 &&
    selected.transactionRows.length === 0;

  return (
    <aside className="space-y-layout-md rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
      <div className="flex flex-col gap-layout-sm border-b border-border pb-layout-md">
        <div className="flex flex-wrap items-center gap-layout-xs">
          <SourceToneBadge source={selected.source} />
          <ReviewStateBadge source={selected.source} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Source detail
          </p>
          <h2 className="mt-1 line-clamp-2 text-base font-medium text-foreground">
            {selected.source.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {selected.source.evidenceLabel}
          </p>
        </div>
        <SourceReviewLink
          orgUrlSlug={orgUrlSlug}
          source={selected.source}
          storeUrlSlug={storeUrlSlug}
        />
      </div>

      <div className="space-y-layout-sm">
        <div className="flex items-center justify-between gap-layout-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Transactions
          </p>
          {selected.transactionsAreTruncated ? (
            <Badge variant="outline">Showing latest records</Badge>
          ) : null}
        </div>

        {selected.transactionRows.length > 0 ? (
          <ol className="space-y-layout-sm">
            {selected.transactionRows.map((row) => (
              <li
                className="rounded-md border border-border bg-background px-layout-md py-layout-sm"
                key={row.id}
              >
                <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link
                      className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      params={{
                        orgUrlSlug,
                        storeUrlSlug,
                        transactionId: row.transactionId,
                      }}
                      search={{ o: getOrigin() }}
                      to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
                    >
                      <ReceiptText
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                      />
                      <span className="min-w-0 break-all">
                        {row.receiptLabel}
                      </span>
                    </Link>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {row.productLabel}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getRelativeTime(row.completedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-layout-xs sm:justify-end">
                    <Badge variant="outline">{row.statusLabel}</Badge>
                    {row.refundedQuantity > 0 ? (
                      <Badge
                        className="border-warning/30 bg-warning/10 text-foreground"
                        variant="outline"
                      >
                        Refunded {row.refundedQuantity}
                      </Badge>
                    ) : null}
                    {row.adjustmentLabel ? (
                      <Badge variant="outline">{row.adjustmentLabel}</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="mt-layout-sm grid gap-layout-xs sm:grid-cols-2">
                  <SummaryMetric
                    label="Gross quantity"
                    value={row.grossQuantity.toLocaleString()}
                  />
                  <SummaryMetric
                    label="Net quantity"
                    value={row.netQuantity.toLocaleString()}
                  />
                </div>
              </li>
            ))}
          </ol>
        ) : hasTransactionMismatch ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm">
            <p className="text-sm font-medium text-foreground">
              Transaction history needs review.
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This source has sale evidence, but no completed sale lines matched
              this store.
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-border bg-muted/30 px-layout-md py-layout-sm text-sm leading-6 text-muted-foreground">
            No completed transaction lines were found for this source.
          </p>
        )}

        {selected.transactionsAreTruncated && onLoadMoreTransactions ? (
          <Button
            className="w-full"
            onClick={onLoadMoreTransactions}
            type="button"
            variant="utility"
          >
            <ListPlus aria-hidden="true" className="h-4 w-4" />
            Load more transactions
          </Button>
        ) : selected.transactionsAreTruncated ? (
          <p className="rounded-md border border-border bg-muted/30 px-layout-md py-layout-sm text-sm leading-6 text-muted-foreground">
            Showing the latest bounded transaction records. Use the review link
            and transaction links for deeper audit.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

export function SkuActivityUntrustedSales({
  error,
  isLoading = false,
  onChangeReviewStatus,
  onChangeSourceFilter,
  onLoadMoreSources,
  onLoadMoreTransactions,
  onSelectSource,
  orgUrlSlug,
  storeUrlSlug,
  viewModel,
}: SkuActivityUntrustedSalesProps) {
  if (isLoading || viewModel === undefined) {
    return (
      <InlineState
        title="Loading untrusted SKU sales."
        description="Sale evidence and transaction history will appear here."
      />
    );
  }

  if (error) {
    return (
      <InlineState
        title="Untrusted SKU sales unavailable."
        description="Refresh the workspace or try again from Store Ops."
      />
    );
  }

  if (!viewModel) {
    return (
      <InlineState
        title="Untrusted SKU sales unavailable."
        description="Refresh the workspace or try again from Store Ops."
      />
    );
  }

  return (
    <section className="space-y-layout-md">
      <div className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
        <div className="flex flex-col gap-layout-md lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-layout-xs">
              <History className="h-4 w-4 text-muted-foreground" />
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Untrusted SKU sales
              </p>
            </div>
            <h2 className="mt-2 text-base font-medium text-foreground">
              Products with completed sales before trust review
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review provisional catalog and pending checkout items that already
              have completed sales in circulation.
            </p>
          </div>
          <div className="grid gap-layout-xs sm:grid-cols-3 lg:min-w-[360px]">
            <SummaryMetric
              label="Sources"
              value={viewModel.summary.visibleSourceCount.toLocaleString()}
            />
            <SummaryMetric
              label="Units sold"
              value={viewModel.summary.totalQuantitySold.toLocaleString()}
            />
            <SummaryMetric
              label="Open"
              value={viewModel.summary.openCount.toLocaleString()}
            />
          </div>
        </div>

        <div className="mt-layout-md flex flex-col gap-layout-sm border-t border-border pt-layout-md">
          <div className="flex flex-wrap gap-layout-xs">
            {SOURCE_FILTER_OPTIONS.map((option) => (
              <FilterButton
                isSelected={viewModel.sourceFilter === option.value}
                key={option.value}
                label={option.label}
                onSelect={onChangeSourceFilter}
                value={option.value}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-layout-xs">
            {REVIEW_STATUS_OPTIONS.map((option) => (
              <FilterButton
                isSelected={viewModel.reviewStatus === option.value}
                key={option.value}
                label={option.label}
                onSelect={onChangeReviewStatus}
                value={option.value}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-layout-md xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        {viewModel.selected ? (
          <div className="xl:hidden">
            <SelectedSourceDetail
              onLoadMoreTransactions={onLoadMoreTransactions}
              orgUrlSlug={orgUrlSlug}
              selected={viewModel.selected}
              storeUrlSlug={storeUrlSlug}
            />
          </div>
        ) : null}

        <div className="space-y-layout-sm">
          {viewModel.sourceRows.length > 0 ? (
            <SourceList
              onSelectSource={onSelectSource}
              sources={viewModel.sourceRows}
            />
          ) : (
            <InlineState
              title="No sale evidence found."
              description={viewModel.emptyMessage}
            />
          )}

          {viewModel.hasMoreSources && onLoadMoreSources ? (
            <Button
              className="w-full"
              onClick={onLoadMoreSources}
              type="button"
              variant="utility"
            >
              <ListPlus aria-hidden="true" className="h-4 w-4" />
              Load more sources
            </Button>
          ) : viewModel.hasMoreSources ? (
            <p className="rounded-md border border-border bg-muted/30 px-layout-md py-layout-sm text-sm leading-6 text-muted-foreground">
              Showing the first {viewModel.sourceLimit.toLocaleString()} source
              records. Narrow the filters to inspect a smaller set.
            </p>
          ) : null}
        </div>

        <div className={viewModel.selected ? "hidden xl:block" : ""}>
          <SelectedSourceDetail
            onLoadMoreTransactions={onLoadMoreTransactions}
            orgUrlSlug={orgUrlSlug}
            selected={viewModel.selected}
            storeUrlSlug={storeUrlSlug}
          />
        </div>
      </div>
    </section>
  );
}
