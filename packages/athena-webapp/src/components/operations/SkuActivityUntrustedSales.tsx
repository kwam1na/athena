import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ListPlus,
  PackageSearch,
} from "lucide-react";

import { getOrigin } from "~/src/lib/navigationUtils";
import { cn, getRelativeTime } from "~/src/lib/utils";
import { ListPagination } from "../common/ListPagination";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";
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
  onChangeTransactionPage?: (page: number) => void;
  evidenceQuery?: string;
  isLoading?: boolean;
  onChangeReviewStatus: (status: SkuActivityUntrustedSalesReviewStatus) => void;
  onChangeSourceFilter: (filter: SkuActivityUntrustedSalesSourceFilter) => void;
  onLoadMoreSources?: (minimumSourceCount?: number) => void;
  onLoadMoreTransactions?: () => void;
  onSelectSource: (source: {
    id: string;
    sourceType: SkuActivityUntrustedSalesSourceType;
  }) => void;
  orgUrlSlug: string;
  storeUrlSlug: string;
  transactionPage?: number;
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
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Reviewed", value: "reviewed" },
];

const DETAIL_ENTRY_ANIMATION_CLASS =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-right-1 motion-safe:duration-200 motion-safe:ease-out";
const DETAIL_STICKY_CLASS =
  "xl:sticky xl:top-[var(--sku-activity-detail-sticky-top)]";
const DETAIL_STICKY_VIEWPORT_PADDING_PX = 24;
const SOURCE_LIST_PAGE_SIZE = 10;
const TRANSACTION_LIST_PAGE_SIZE = 3;

type DetailStickyStyle = CSSProperties & {
  "--sku-activity-detail-sticky-top": string;
};

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function useDetailStickyPosition() {
  const detailRef = useRef<HTMLElement | null>(null);
  const [stickyTop, setStickyTop] = useState(
    `${DETAIL_STICKY_VIEWPORT_PADDING_PX}px`,
  );

  useIsomorphicLayoutEffect(() => {
    const detailElement = detailRef.current;

    if (!detailElement || typeof window === "undefined") {
      return;
    }

    let animationFrame = 0;

    const updateStickyTop = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const detailHeight = detailElement.getBoundingClientRect().height;
        const centeredTop = (window.innerHeight - detailHeight) / 2;
        const clampedTop = Math.max(
          DETAIL_STICKY_VIEWPORT_PADDING_PX,
          centeredTop,
        );
        const nextStickyTop = `${Math.round(clampedTop)}px`;

        setStickyTop((currentStickyTop) =>
          currentStickyTop === nextStickyTop ? currentStickyTop : nextStickyTop,
        );
      });
    };

    updateStickyTop();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateStickyTop);

    resizeObserver?.observe(detailElement);
    window.addEventListener("resize", updateStickyTop);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateStickyTop);
    };
  }, []);

  const stickyStyle: DetailStickyStyle = {
    "--sku-activity-detail-sticky-top": stickyTop,
  };

  return { detailRef, stickyStyle };
}

function formatCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function sourceMatchesEvidenceQuery(
  source: SkuActivityUntrustedSalesSourceRow,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    source.title,
    source.lookupLabel,
    source.sourceTypeLabel,
    source.reviewLabel,
    source.statusLabel,
    source.evidenceLabel,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

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
        "inline-flex h-8 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected
          ? "border-border bg-muted/55 text-foreground"
          : "border-border/80 bg-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground",
      )}
      onClick={() => onSelect(value)}
      type="button"
    >
      {label}
    </button>
  );
}

function SourceMetadataLine({
  includeStatus = false,
  source,
}: {
  includeStatus?: boolean;
  source: SkuActivityUntrustedSalesSourceRow;
}) {
  const items = [
    source.sourceTypeLabel,
    source.reviewLabel,
    ...(includeStatus ? [source.statusLabel] : []),
  ];

  return (
    <p className="text-xs font-medium leading-5 text-muted-foreground">
      {items.map((item, index) => (
        <span key={`${item}:${index}`}>
          {index > 0 ? <span className="mx-1.5 text-border">/</span> : null}
          {item}
        </span>
      ))}
    </p>
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
    if (source.productId) {
      return (
        <Button
          asChild
          className="-mr-2 h-8 px-2 text-muted-foreground hover:text-foreground"
          size="sm"
          variant="ghost"
        >
          <Link
            params={{
              orgUrlSlug,
              productSlug: source.productId,
              storeUrlSlug,
            }}
            search={{
              o: getOrigin(),
              variant: source.productSkuId ?? undefined,
            }}
            to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
          >
            Review pending checkout
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </Button>
      );
    }

    return (
      <Button
        asChild
        className="-mr-2 h-8 px-2 text-muted-foreground hover:text-foreground"
        size="sm"
        variant="ghost"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          search={{ categorySlug: "pos-pending-checkout", o: getOrigin() }}
          to="/$orgUrlSlug/store/$storeUrlSlug/products"
        >
          Review pending checkout
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </Button>
    );
  }

  if (source.productId && source.productSkuId) {
    return (
      <Button
        asChild
        className="-mr-2 h-8 px-2 text-muted-foreground hover:text-foreground"
        size="sm"
        variant="ghost"
      >
        <Link
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
      </Button>
    );
  }

  if (source.sourceType === "inventoryImportProvisionalSku") {
    return (
      <Button
        asChild
        className="-mr-2 h-8 px-2 text-muted-foreground hover:text-foreground"
        size="sm"
        variant="ghost"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          search={{ filter: "review" }}
          to="/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import/review"
        >
          Review import
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </Button>
    );
  }

  return null;
}

function SourceList({
  className,
  onSelectSource,
  sources,
}: {
  className?: string;
  onSelectSource: SkuActivityUntrustedSalesProps["onSelectSource"];
  sources: SkuActivityUntrustedSalesSourceRow[];
}) {
  return (
    <ul
      aria-label="Untrusted SKU sale evidence"
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface",
        className,
      )}
    >
      {sources.map((source) => (
        <li
          className="border-b border-border last:border-b-0"
          key={`${source.sourceType}:${source.id}`}
        >
          <button
            aria-pressed={source.isSelected}
            className={cn(
              "group w-full bg-background px-layout-md py-layout-lg text-left transition-[background-color,transform] duration-150 ease-out active:scale-[0.998] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              source.isSelected
                ? "bg-action-workflow-soft/55 hover:bg-action-workflow-soft/70"
                : "hover:bg-muted/40",
            )}
            onClick={() =>
              onSelectSource({ id: source.id, sourceType: source.sourceType })
            }
            type="button"
          >
            <div className="flex flex-col gap-layout-lg lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-layout-sm">
                <p className="line-clamp-2 text-sm font-medium text-foreground">
                  {source.title}
                </p>
                <div>
                  <SourceMetadataLine includeStatus source={source} />
                </div>
                <div className="flex flex-wrap items-center gap-x-layout-md gap-y-layout-xs text-xs leading-5 text-muted-foreground">
                  <span className="tabular-nums">
                    <span className="font-medium text-foreground">
                      {formatCountLabel(source.totalQuantitySold, "unit")}
                    </span>{" "}
                    sold
                  </span>
                  <span className="tabular-nums">
                    <span className="font-medium text-foreground">
                      {formatCountLabel(source.saleCount, "sale")}
                    </span>{" "}
                    completed
                  </span>
                  <span>Latest sale {getRelativeTime(source.lastActivityAt)}</span>
                </div>
                <p className="break-all text-xs leading-5 text-muted-foreground">
                  {source.lookupLabel ?? "No lookup recorded"}
                </p>
              </div>
              <div className="shrink-0 text-left lg:text-right">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Evidence
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {source.evidenceLabel}
                </p>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SummaryMetric({
  helper,
  label,
  value,
}: {
  helper?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background/70 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
        {value}
      </p>
      {helper ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}

function SelectedSourceDetail({
  isLoading = false,
  loadingSource,
  onChangeTransactionPage,
  onLoadMoreTransactions,
  orgUrlSlug,
  selected,
  storeUrlSlug,
  transactionPage = 1,
}: {
  isLoading?: boolean;
  loadingSource?: SkuActivityUntrustedSalesSourceRow | null;
  onChangeTransactionPage?: (page: number) => void;
  onLoadMoreTransactions?: () => void;
  orgUrlSlug: string;
  selected: NonNullable<SkuActivityUntrustedSalesViewModel["selected"]> | null;
  storeUrlSlug: string;
  transactionPage?: number;
}) {
  const { detailRef, stickyStyle } = useDetailStickyPosition();
  const transactionRows = selected?.transactionRows ?? [];
  const transactionPageCount = Math.max(
    1,
    Math.ceil(transactionRows.length / TRANSACTION_LIST_PAGE_SIZE),
  );
  const clampedTransactionPage = Math.min(
    Math.max(1, transactionPage),
    transactionPageCount,
  );
  const transactionPageStart =
    (clampedTransactionPage - 1) * TRANSACTION_LIST_PAGE_SIZE;
  const transactionPageEnd = transactionPageStart + TRANSACTION_LIST_PAGE_SIZE;
  const pagedTransactionRows = transactionRows.slice(
    transactionPageStart,
    transactionPageEnd,
  );

  useEffect(() => {
    if (selected && transactionPage !== clampedTransactionPage) {
      onChangeTransactionPage?.(clampedTransactionPage);
    }
  }, [
    clampedTransactionPage,
    onChangeTransactionPage,
    selected,
    transactionPage,
  ]);

  if (!selected && loadingSource) {
    return (
      <aside
        aria-busy="true"
        className={cn(
          "overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface",
          DETAIL_STICKY_CLASS,
          DETAIL_ENTRY_ANIMATION_CLASS,
        )}
        ref={detailRef}
        style={stickyStyle}
      >
        <div className="space-y-layout-md border-b border-border bg-muted/20 px-layout-md py-layout-md">
          <div className="flex flex-col gap-layout-md sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-layout-xs">
              <h2 className="line-clamp-2 text-base font-medium text-foreground">
                {loadingSource.title}
              </h2>
              <div>
                <SourceMetadataLine source={loadingSource} />
              </div>
              <p className="break-all text-xs leading-5 text-muted-foreground">
                {loadingSource.lookupLabel ?? "No lookup recorded"}
              </p>
            </div>
            <SourceReviewLink
              orgUrlSlug={orgUrlSlug}
              source={loadingSource}
              storeUrlSlug={storeUrlSlug}
            />
          </div>

          <div className="grid gap-layout-xs sm:grid-cols-2">
            <SummaryMetric
              helper={formatCountLabel(loadingSource.saleCount, "completed sale")}
              label="Units sold"
              value={loadingSource.totalQuantitySold.toLocaleString()}
            />
            <SummaryMetric
              helper="Completed sale evidence"
              label="Latest sale"
              value={getRelativeTime(loadingSource.lastActivityAt)}
            />
          </div>
        </div>

        <div className="space-y-layout-md px-layout-md py-layout-md">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Full transaction history
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Completed sale lines tied to this source.
            </p>
          </div>

          <div
            aria-label="Loading transaction history"
            className="overflow-hidden rounded-md border border-border bg-background"
          >
            <div className="px-layout-md py-layout-sm">
              <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-28 rounded bg-muted motion-safe:animate-pulse" />
                  <div className="h-4 w-3/4 rounded bg-muted/80 motion-safe:animate-pulse" />
                  <div className="h-3 w-20 rounded bg-muted/70 motion-safe:animate-pulse" />
                </div>
                <div className="shrink-0 space-y-2 sm:w-24">
                  <div className="h-4 rounded bg-muted motion-safe:animate-pulse" />
                  <div className="h-3 rounded bg-muted/70 motion-safe:animate-pulse" />
                </div>
              </div>
              <div className="mt-layout-sm h-6 w-20 rounded-md bg-muted/70 motion-safe:animate-pulse" />
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (!selected) {
    return (
      <aside
        className={cn(
          "flex min-h-[220px] items-center px-layout-md py-layout-md",
          DETAIL_STICKY_CLASS,
          DETAIL_ENTRY_ANIMATION_CLASS,
        )}
        ref={detailRef}
        style={stickyStyle}
      >
        <div className="mx-auto max-w-sm text-center">
          <p className="text-sm font-medium text-foreground">
            {isLoading
              ? "Loading transaction history."
              : "Select an evidence source."}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {isLoading
              ? "Completed sale lines are loading for the selected source."
              : "Full transaction history loads here after selection."}
          </p>
        </div>
      </aside>
    );
  }

  const hasTransactionMismatch =
    selected.source.totalQuantitySold > 0 &&
    selected.transactionRows.length === 0;

  return (
    <aside
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface",
        DETAIL_STICKY_CLASS,
        DETAIL_ENTRY_ANIMATION_CLASS,
      )}
      ref={detailRef}
      style={stickyStyle}
    >
      <div className="space-y-layout-md border-b border-border bg-muted/20 px-layout-md py-layout-md">
        <div className="flex flex-col gap-layout-md sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-layout-xs">
            <h2 className="line-clamp-2 text-base font-medium text-foreground">
              {selected.source.title}
            </h2>
            <div>
              <SourceMetadataLine source={selected.source} />
            </div>
            <p className="break-all text-xs leading-5 text-muted-foreground">
              {selected.source.lookupLabel ?? "No lookup recorded"}
            </p>
          </div>
          <SourceReviewLink
            orgUrlSlug={orgUrlSlug}
            source={selected.source}
            storeUrlSlug={storeUrlSlug}
          />
        </div>

        <div className="grid gap-layout-xs sm:grid-cols-2">
          <SummaryMetric
            helper={formatCountLabel(
              selected.source.saleCount,
              "completed sale",
            )}
            label="Units sold"
            value={selected.source.totalQuantitySold.toLocaleString()}
          />
          <SummaryMetric
            helper="Completed sale evidence"
            label="Latest sale"
            value={getRelativeTime(selected.source.lastActivityAt)}
          />
        </div>
      </div>

      <div className="space-y-layout-md px-layout-md py-layout-md">
        <div className="flex items-start justify-between gap-layout-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Full transaction history
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Completed sale lines tied to this source.
            </p>
          </div>
          {selected.transactionsAreTruncated ? (
            <Badge variant="outline">Showing latest records</Badge>
          ) : null}
        </div>

        {selected.transactionRows.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-border bg-background">
            <ol>
              {pagedTransactionRows.map((row) => (
                <li
                  className="border-b border-border px-layout-md py-layout-sm last:border-b-0"
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
                        <span className="min-w-0 break-all">
                          {row.receiptLabel}
                        </span>
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {getRelativeTime(row.completedAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <p className="text-sm font-medium tabular-nums text-foreground">
                        {formatCountLabel(row.netQuantity, "net unit")}
                      </p>
                      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                        {formatCountLabel(row.grossQuantity, "gross unit")}
                      </p>
                    </div>
                  </div>
                  {row.refundedQuantity > 0 || row.adjustmentLabel ? (
                    <div className="mt-layout-sm flex flex-wrap items-center gap-layout-xs">
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
                  ) : null}
                </li>
              ))}
            </ol>
            {selected.transactionRows.length > TRANSACTION_LIST_PAGE_SIZE ? (
              <ListPagination
                onPageChange={(nextPage) => onChangeTransactionPage?.(nextPage)}
                page={clampedTransactionPage}
                pageCount={transactionPageCount}
                pageSize={TRANSACTION_LIST_PAGE_SIZE}
                totalItems={selected.transactionRows.length}
              />
            ) : null}
          </div>
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
  evidenceQuery = "",
  error,
  isLoading = false,
  onChangeTransactionPage,
  onChangeReviewStatus,
  onChangeSourceFilter,
  onLoadMoreSources,
  onLoadMoreTransactions,
  onSelectSource,
  orgUrlSlug,
  storeUrlSlug,
  transactionPage,
  viewModel,
}: SkuActivityUntrustedSalesProps) {
  const [sourcePage, setSourcePage] = useState(1);
  const [pendingSourcePage, setPendingSourcePage] = useState<number | null>(
    null,
  );
  const lastAppliedSelectedPageKeyRef = useRef<string | null>(null);
  const lastRequestedSelectedSourceCountRef = useRef(0);
  const selectedSourceIndex =
    viewModel?.sourceRows.findIndex((source) => source.isSelected) ?? -1;
  const trimmedEvidenceQuery = evidenceQuery.trim();
  const hasEvidenceQuery = trimmedEvidenceQuery.length > 0;
  const filteredSourceRows =
    viewModel?.sourceRows.filter((source) =>
      sourceMatchesEvidenceQuery(source, trimmedEvidenceQuery),
    ) ?? [];
  const selectedSourcePage =
    selectedSourceIndex >= 0
      ? Math.floor(selectedSourceIndex / SOURCE_LIST_PAGE_SIZE) + 1
      : null;
  const selectedSourcePageKey =
    viewModel?.selected?.source.id && selectedSourcePage
      ? `${viewModel.selected.source.id}:${selectedSourcePage}`
      : null;
  const totalSourceItems = hasEvidenceQuery
    ? filteredSourceRows.length
    : (viewModel?.summary.totalSourceCount ?? 0);
  const sourcePageCount = Math.max(
    1,
    Math.ceil(totalSourceItems / SOURCE_LIST_PAGE_SIZE),
  );
  const clampedSourcePage = Math.min(sourcePage, sourcePageCount);
  const sourcePageStart = (clampedSourcePage - 1) * SOURCE_LIST_PAGE_SIZE;
  const sourcePageEnd = sourcePageStart + SOURCE_LIST_PAGE_SIZE;
  const sourceRowsForList = hasEvidenceQuery
    ? filteredSourceRows
    : (viewModel?.sourceRows ?? []);
  const pagedSourceRows = sourceRowsForList.slice(
    sourcePageStart,
    sourcePageEnd,
  );

  useEffect(() => {
    setSourcePage(1);
    setPendingSourcePage(null);
    lastAppliedSelectedPageKeyRef.current = null;
    lastRequestedSelectedSourceCountRef.current = 0;
  }, [trimmedEvidenceQuery, viewModel?.reviewStatus, viewModel?.sourceFilter]);

  useEffect(() => {
    if (
      selectedSourcePage &&
      selectedSourcePageKey &&
      selectedSourcePageKey !== lastAppliedSelectedPageKeyRef.current
    ) {
      lastAppliedSelectedPageKeyRef.current = selectedSourcePageKey;
      setSourcePage(selectedSourcePage);
      setPendingSourcePage(null);
    }
  }, [selectedSourcePage, selectedSourcePageKey]);

  useEffect(() => {
    if (
      isLoading ||
      !viewModel?.selected ||
      selectedSourceIndex >= 0 ||
      !viewModel.hasMoreSources
    ) {
      return;
    }

    const requestedSourceCount =
      viewModel.sourceRows.length + SOURCE_LIST_PAGE_SIZE;

    if (requestedSourceCount <= lastRequestedSelectedSourceCountRef.current) {
      return;
    }

    lastRequestedSelectedSourceCountRef.current = requestedSourceCount;
    onLoadMoreSources?.(requestedSourceCount);
  }, [isLoading, onLoadMoreSources, selectedSourceIndex, viewModel]);

  useEffect(() => {
    if (!pendingSourcePage || !viewModel) {
      return;
    }

    const pendingPageStart = (pendingSourcePage - 1) * SOURCE_LIST_PAGE_SIZE;
    const hasPendingPageRows = viewModel.sourceRows.length > pendingPageStart;

    if (hasPendingPageRows || !viewModel.hasMoreSources) {
      setSourcePage(pendingSourcePage);
      setPendingSourcePage(null);
    }
  }, [pendingSourcePage, viewModel]);

  useEffect(() => {
    if (sourcePage > sourcePageCount) {
      setSourcePage(sourcePageCount);
    }
  }, [sourcePage, sourcePageCount]);

  if (viewModel === undefined) {
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

  const loadedViewModel = viewModel;

  const isLoadingSelectedSource =
    isLoading &&
    loadedViewModel.selected === null &&
    loadedViewModel.sourceRows.some((source) => source.isSelected);
  const loadingSelectedSource =
    isLoadingSelectedSource
      ? (loadedViewModel.sourceRows.find((source) => source.isSelected) ?? null)
      : null;

  function handleSourcePageChange(nextPage: number) {
    const clampedNextPage = Math.min(Math.max(1, nextPage), sourcePageCount);
    const requestedSourceCount = clampedNextPage * SOURCE_LIST_PAGE_SIZE;

    if (
      requestedSourceCount > loadedViewModel.sourceRows.length &&
      loadedViewModel.hasMoreSources
    ) {
      setPendingSourcePage(clampedNextPage);
      onLoadMoreSources?.(requestedSourceCount);
      return;
    }

    setSourcePage(clampedNextPage);
  }

  return (
    <section
      aria-busy={isLoading}
      className="space-y-layout-2xl md:space-y-layout-3xl"
    >
      <div className="rounded-lg border border-border bg-surface-raised shadow-surface">
        <div className="flex flex-col gap-layout-md lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 px-layout-md pt-layout-md lg:max-w-3xl">
            <h2 className="text-base font-medium text-foreground">
              Products moving before trust review
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review provisional catalog and pending checkout items that already
              have completed sales in circulation.
            </p>
          </div>
          <div className="grid gap-layout-xs px-layout-md pb-layout-md sm:grid-cols-2 lg:min-w-[520px] lg:grid-cols-4 lg:pt-layout-md">
            <OperationsSummaryMetric
              helper={`${viewModel.summary.totalSourceCount.toLocaleString()} total`}
              label="Visible"
              tone="quiet"
              value={viewModel.summary.visibleSourceCount.toLocaleString()}
            />
            <OperationsSummaryMetric
              label="Units sold"
              tone="quiet"
              value={viewModel.summary.totalQuantitySold.toLocaleString()}
            />
            <OperationsSummaryMetric
              label="Open"
              tone="quiet"
              value={viewModel.summary.openCount.toLocaleString()}
            />
            <OperationsSummaryMetric
              label="Reviewed"
              tone="quiet"
              value={viewModel.summary.reviewedCount.toLocaleString()}
            />
          </div>
        </div>

        <div className="flex flex-col gap-layout-md border-t border-border px-layout-md py-layout-md md:flex-row md:items-start md:gap-layout-xl">
          <div className="space-y-layout-xs">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Source
            </p>
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
          </div>
          <div className="space-y-layout-xs md:border-l md:border-border md:pl-layout-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Review state
            </p>
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
      </div>

      <div className="space-y-layout-lg">
        <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Evidence sources
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Select an item to inspect the completed sales behind it.
            </p>
          </div>
        </div>

        <div className="grid gap-layout-md xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          {viewModel.selected ? (
            <div className="xl:hidden">
              <SelectedSourceDetail
                isLoading={isLoadingSelectedSource}
                loadingSource={loadingSelectedSource}
                onChangeTransactionPage={onChangeTransactionPage}
                onLoadMoreTransactions={onLoadMoreTransactions}
                orgUrlSlug={orgUrlSlug}
                selected={viewModel.selected}
                storeUrlSlug={storeUrlSlug}
                transactionPage={transactionPage}
              />
            </div>
          ) : null}

          <div className="space-y-layout-sm">
            {sourceRowsForList.length > 0 ? (
              totalSourceItems > SOURCE_LIST_PAGE_SIZE ? (
                <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
                  <SourceList
                    className="rounded-none border-0 shadow-none"
                    onSelectSource={onSelectSource}
                    sources={pagedSourceRows}
                  />
                  <ListPagination
                    onPageChange={handleSourcePageChange}
                    page={clampedSourcePage}
                    pageCount={sourcePageCount}
                    pageSize={SOURCE_LIST_PAGE_SIZE}
                    totalItems={totalSourceItems}
                  />
                </div>
              ) : (
                <SourceList
                  onSelectSource={onSelectSource}
                  sources={pagedSourceRows}
                />
              )
            ) : (
              <InlineState
                title={
                  hasEvidenceQuery
                    ? "No evidence sources match."
                    : "No sale evidence found."
                }
                description={
                  hasEvidenceQuery
                    ? "Adjust the evidence search or clear it to return to the full view."
                    : viewModel.emptyMessage
                }
              />
            )}
          </div>

          <div className={viewModel.selected ? "hidden xl:block" : ""}>
            <SelectedSourceDetail
              isLoading={isLoadingSelectedSource}
              loadingSource={loadingSelectedSource}
              onChangeTransactionPage={onChangeTransactionPage}
              onLoadMoreTransactions={onLoadMoreTransactions}
              orgUrlSlug={orgUrlSlug}
              selected={viewModel.selected}
              storeUrlSlug={storeUrlSlug}
              transactionPage={transactionPage}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
