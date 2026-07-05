import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeft, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { z } from "zod";

import { useAuth } from "@/hooks/useAuth";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { FadeIn } from "~/src/components/common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
} from "~/src/components/common/PageLevelHeader";
import { SkuActivityTimeline } from "~/src/components/operations/SkuActivityTimeline";
import { SkuActivityUntrustedSales } from "~/src/components/operations/SkuActivityUntrustedSales";
import {
  buildSkuActivityTimelineViewModel,
  type SkuActivityQueryResult,
} from "~/src/components/operations/skuActivityTimelineAdapter";
import {
  buildSkuActivityUntrustedSalesViewModel,
  type SkuActivityUntrustedSalesQueryResult,
  type SkuActivityUntrustedSalesReviewStatus,
  type SkuActivityUntrustedSalesSourceFilter,
  type SkuActivityUntrustedSalesSourceType,
} from "~/src/components/operations/skuActivityUntrustedSalesAdapter";
import { NoPermissionView } from "~/src/components/states/no-permission/NoPermissionView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";
import { Button } from "~/src/components/ui/button";
import { Input } from "~/src/components/ui/input";
import { Label } from "~/src/components/ui/label";
import { cn } from "~/src/lib/utils";
import View from "~/src/components/View";

const UNTRUSTED_SOURCE_PAGE_SIZE = 50;
const UNTRUSTED_TRANSACTION_PAGE_SIZE = 100;
const UNTRUSTED_MAX_LIMIT = 500;
const DEFAULT_SKU_ACTIVITY_DESCRIPTION =
  "Look up a known SKU or review untrusted products with sale activity.";

type SkuActivityHeaderSummary = {
  openCount: number;
  reviewedCount: number;
  totalQuantitySold: number;
  totalSourceCount: number;
  visibleSourceCount: number;
};

function formatHeaderCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function formatSkuActivityHeaderTitle(summary?: SkuActivityHeaderSummary) {
  if (!summary) {
    return "SKU activity";
  }

  const soldUnits = formatHeaderCount(summary.totalQuantitySold, "unit");

  return `${soldUnits} sold`;
}

function formatSkuActivityHeaderDescription(
  summary?: SkuActivityHeaderSummary,
) {
  if (!summary) {
    return DEFAULT_SKU_ACTIVITY_DESCRIPTION;
  }

  return "From completed sales tied to provisional catalog and pending checkout sources.";
}

const skuActivitySearchSchema = z.object({
  evidenceQuery: z.string().optional(),
  o: z.string().optional(),
  productSkuId: z.string().optional(),
  reviewStatus: z.enum(["open", "reviewed", "all"]).optional(),
  selectedSourceId: z.string().optional(),
  selectedSourceType: z
    .enum(["inventoryImportProvisionalSku", "posPendingCheckoutItem"])
    .optional(),
  sku: z.string().optional(),
  source: z.enum(["all", "legacy_import", "pending_checkout"]).optional(),
  transactionPage: z.coerce.number().int().positive().optional(),
});

function SkuActivitySearchForm({
  buttonLabel = "Inspect",
  buttonType = "submit",
  className,
  inputClassName,
  inputId,
  inputLabel = "SKU",
  onClearInput,
  onSubmit,
  onButtonClick,
  placeholder = "Enter SKU",
  setSkuInput,
  skuInput,
}: {
  buttonLabel?: string;
  buttonType?: "button" | "submit";
  className?: string;
  inputClassName?: string;
  inputId: string;
  inputLabel?: string;
  onClearInput?: () => void;
  onButtonClick?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  placeholder?: string;
  setSkuInput: (value: string) => void;
  skuInput: string;
}) {
  const canClearInput = Boolean(onClearInput && skuInput);

  return (
    <form className={className} onSubmit={onSubmit}>
      <div className={inputClassName}>
        <Label className="sr-only" htmlFor={inputId}>
          {inputLabel}
        </Label>
        <div className="relative">
          <Input
            className={cn(canClearInput && "pr-10")}
            id={inputId}
            onChange={(event) => setSkuInput(event.target.value)}
            placeholder={placeholder}
            value={skuInput}
          />
          {canClearInput ? (
            <Button
              aria-label="Clear evidence search"
              className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClearInput}
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <Button
        className="gap-layout-xs md:w-auto"
        onClick={onButtonClick}
        type={buttonType}
        variant="workflow"
      >
        <Search className="h-4 w-4" />
        {buttonLabel}
      </Button>
    </form>
  );
}

function SkuActivityEntryState({
  onInspectSku,
  setSkuInput,
  skuInput,
}: {
  onInspectSku: () => void;
  setSkuInput: (value: string) => void;
  skuInput: string;
}) {
  function handleEvidenceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <section className="py-layout-sm md:py-layout-md">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <SkuActivitySearchForm
          buttonLabel="Inspect SKU"
          buttonType="button"
          className="grid w-full gap-layout-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
          inputClassName="min-w-0 space-y-layout-xs text-left"
          inputId="sku-activity-entry-search"
          inputLabel="Evidence search"
          onButtonClick={onInspectSku}
          onClearInput={() => setSkuInput("")}
          onSubmit={handleEvidenceSubmit}
          placeholder="Search evidence or enter SKU"
          setSkuInput={setSkuInput}
          skuInput={skuInput}
        />
      </div>
    </section>
  );
}

function SkuActivityUntrustedSalesQuery({
  evidenceQuery,
  onHeaderSummaryChange,
  orgUrlSlug,
  reviewStatus,
  selectedSourceId,
  selectedSourceType,
  sourceFilter,
  storeId,
  storeUrlSlug,
  transactionPage,
}: {
  evidenceQuery?: string;
  onHeaderSummaryChange?: (summary: SkuActivityHeaderSummary) => void;
  orgUrlSlug: string;
  reviewStatus: SkuActivityUntrustedSalesReviewStatus;
  selectedSourceId?: string;
  selectedSourceType?: SkuActivityUntrustedSalesSourceType;
  sourceFilter: SkuActivityUntrustedSalesSourceFilter;
  storeId: Id<"store">;
  storeUrlSlug: string;
  transactionPage?: number;
}) {
  const navigate = Route.useNavigate();
  const [sourceLimit, setSourceLimit] = useState(UNTRUSTED_SOURCE_PAGE_SIZE);
  const [transactionLimit, setTransactionLimit] = useState(
    UNTRUSTED_TRANSACTION_PAGE_SIZE,
  );
  const lastUntrustedSkuSalesRef = useRef<
    SkuActivityUntrustedSalesQueryResult | undefined
  >(undefined);
  const selectedSource =
    selectedSourceId && selectedSourceType
      ? { sourceId: selectedSourceId, sourceType: selectedSourceType }
      : undefined;

  useEffect(() => {
    setSourceLimit(UNTRUSTED_SOURCE_PAGE_SIZE);
  }, [reviewStatus, sourceFilter]);

  useEffect(() => {
    setTransactionLimit(UNTRUSTED_TRANSACTION_PAGE_SIZE);
  }, [selectedSourceId, selectedSourceType]);

  const untrustedSkuSales = useQuery(
    api.operations.skuActivity.getUntrustedSkuSaleEvidence,
    {
      limit: sourceLimit,
      reviewStatus,
      selectedSource,
      sourceFilter,
      storeId,
      transactionLimit,
    },
  ) as SkuActivityUntrustedSalesQueryResult | undefined;
  const displayUntrustedSkuSales =
    untrustedSkuSales === undefined
      ? lastUntrustedSkuSalesRef.current
      : untrustedSkuSales;
  const viewModel = useMemo(
    () =>
      displayUntrustedSkuSales === undefined
        ? undefined
        : buildSkuActivityUntrustedSalesViewModel(displayUntrustedSkuSales, {
            selectedSourceId,
            sourceFilter,
          }),
    [displayUntrustedSkuSales, selectedSourceId, sourceFilter],
  );
  const headerSummary = viewModel?.summary;

  useEffect(() => {
    if (untrustedSkuSales !== undefined) {
      lastUntrustedSkuSalesRef.current = untrustedSkuSales;
    }
  }, [untrustedSkuSales]);

  useEffect(() => {
    if (!headerSummary) {
      return;
    }

    onHeaderSummaryChange?.({
      openCount: headerSummary.openCount,
      reviewedCount: headerSummary.reviewedCount,
      totalQuantitySold: headerSummary.totalQuantitySold,
      totalSourceCount: headerSummary.totalSourceCount,
      visibleSourceCount: headerSummary.visibleSourceCount,
    });
  }, [
    headerSummary?.openCount,
    headerSummary?.reviewedCount,
    headerSummary?.totalQuantitySold,
    headerSummary?.totalSourceCount,
    headerSummary?.visibleSourceCount,
    onHeaderSummaryChange,
  ]);

  function handleChangeReviewStatus(
    nextReviewStatus: SkuActivityUntrustedSalesReviewStatus,
  ) {
    void navigate({
      search: (current) => ({
        ...current,
        reviewStatus:
          nextReviewStatus === "open" ? undefined : nextReviewStatus,
        selectedSourceId: undefined,
        selectedSourceType: undefined,
        transactionPage: undefined,
      }),
    });
  }

  function handleChangeSourceFilter(
    nextSourceFilter: SkuActivityUntrustedSalesSourceFilter,
  ) {
    void navigate({
      search: (current) => ({
        ...current,
        selectedSourceId: undefined,
        selectedSourceType: undefined,
        source: nextSourceFilter === "all" ? undefined : nextSourceFilter,
        transactionPage: undefined,
      }),
    });
  }

  function handleSelectSource(source: {
    id: string;
    sourceType: SkuActivityUntrustedSalesSourceType;
  }) {
    void navigate({
      search: (current) => ({
        ...current,
        selectedSourceId: source.id,
        selectedSourceType: source.sourceType,
        transactionPage: undefined,
      }),
    });
  }

  function handleChangeTransactionPage(nextTransactionPage: number) {
    void navigate({
      search: (current) => ({
        ...current,
        transactionPage:
          nextTransactionPage <= 1 ? undefined : nextTransactionPage,
      }),
    });
  }

  function handleLoadMoreSources(minimumSourceCount?: number) {
    setSourceLimit((current) =>
      Math.min(
        Math.max(
          current + UNTRUSTED_SOURCE_PAGE_SIZE,
          minimumSourceCount ?? 0,
        ),
        UNTRUSTED_MAX_LIMIT,
      ),
    );
  }

  function handleLoadMoreTransactions() {
    setTransactionLimit((current) =>
      Math.min(current + UNTRUSTED_TRANSACTION_PAGE_SIZE, UNTRUSTED_MAX_LIMIT),
    );
  }

  return (
    <SkuActivityUntrustedSales
      evidenceQuery={evidenceQuery}
      isLoading={untrustedSkuSales === undefined}
      onChangeReviewStatus={handleChangeReviewStatus}
      onChangeSourceFilter={handleChangeSourceFilter}
      onLoadMoreSources={
        viewModel?.hasMoreSources && sourceLimit < UNTRUSTED_MAX_LIMIT
          ? handleLoadMoreSources
          : undefined
      }
      onLoadMoreTransactions={
        viewModel?.selected?.transactionsAreTruncated &&
        transactionLimit < UNTRUSTED_MAX_LIMIT
          ? handleLoadMoreTransactions
          : undefined
      }
      onChangeTransactionPage={handleChangeTransactionPage}
      onSelectSource={handleSelectSource}
      orgUrlSlug={orgUrlSlug}
      storeUrlSlug={storeUrlSlug}
      transactionPage={transactionPage}
      viewModel={viewModel}
    />
  );
}

function SkuActivityRouteContent({
  evidenceQuery,
  orgUrlSlug,
  productSkuId,
  reviewStatus = "open",
  selectedSourceId,
  selectedSourceType,
  showBackButton,
  sku,
  sourceFilter = "all",
  storeId,
  storeUrlSlug,
  transactionPage,
}: {
  evidenceQuery?: string;
  orgUrlSlug: string;
  productSkuId?: string;
  reviewStatus?: SkuActivityUntrustedSalesReviewStatus;
  selectedSourceId?: string;
  selectedSourceType?: SkuActivityUntrustedSalesSourceType;
  showBackButton: boolean;
  sku?: string;
  sourceFilter?: SkuActivityUntrustedSalesSourceFilter;
  storeId: Id<"store">;
  storeUrlSlug: string;
  transactionPage?: number;
}) {
  const navigate = Route.useNavigate();
  const [skuInput, setSkuInput] = useState(sku ?? evidenceQuery ?? "");
  const [untrustedHeaderSummary, setUntrustedHeaderSummary] =
    useState<SkuActivityHeaderSummary>();
  const trimmedSku = sku?.trim();
  const selectedProductSkuId = productSkuId?.trim();
  const hasSelection = Boolean(trimmedSku || selectedProductSkuId);
  const skuSearch = useQuery(
    api.inventory.skuSearch.searchProductSkus,
    trimmedSku && !selectedProductSkuId
      ? { limit: 5, query: trimmedSku, storeId }
      : "skip",
  ) as
    | {
        results: Array<{
          productSkuId: Id<"productSku">;
          sku: string | null;
        }>;
      }
    | undefined;
  const matchedProductSkuId = skuSearch?.results[0]?.productSkuId;
  const canFallbackToDirectSku =
    Boolean(trimmedSku) &&
    !selectedProductSkuId &&
    skuSearch !== undefined &&
    !matchedProductSkuId;
  const activityProductSkuId = selectedProductSkuId
    ? (selectedProductSkuId as Id<"productSku">)
    : matchedProductSkuId;

  const skuActivity = useQuery(
    api.operations.skuActivity.getSkuActivityForProductSku,
    hasSelection && (activityProductSkuId || canFallbackToDirectSku)
      ? {
          productSkuId: activityProductSkuId,
          sku: activityProductSkuId ? undefined : trimmedSku,
          storeId,
        }
      : "skip",
  ) as SkuActivityQueryResult | undefined;

  const viewModel = useMemo(
    () =>
      hasSelection && skuActivity !== undefined
        ? buildSkuActivityTimelineViewModel(skuActivity)
        : null,
    [hasSelection, skuActivity],
  );
  const untrustedHeaderTitle = formatSkuActivityHeaderTitle(
    hasSelection ? undefined : untrustedHeaderSummary,
  );
  const untrustedHeaderDescription = formatSkuActivityHeaderDescription(
    hasSelection ? undefined : untrustedHeaderSummary,
  );
  const untrustedHeaderContentKey = untrustedHeaderSummary
    ? [
        "untrusted-loaded",
        untrustedHeaderSummary.visibleSourceCount,
        untrustedHeaderSummary.totalQuantitySold,
        untrustedHeaderSummary.openCount,
        untrustedHeaderSummary.reviewedCount,
      ].join(":")
    : "untrusted-loading";
  const handleUntrustedHeaderSummaryChange = useCallback(
    (summary: SkuActivityHeaderSummary) => {
      setUntrustedHeaderSummary(summary);
    },
    [],
  );

  useEffect(() => {
    if (hasSelection) {
      setUntrustedHeaderSummary(undefined);
    }
  }, [hasSelection]);

  useEffect(() => {
    setSkuInput(hasSelection ? (sku ?? "") : (evidenceQuery ?? ""));
  }, [evidenceQuery, hasSelection, sku]);

  function handleEvidenceQueryChange(nextQuery: string) {
    setSkuInput(nextQuery);

    void navigate({
      search: (current) => ({
        ...current,
        evidenceQuery: nextQuery.trim() ? nextQuery : undefined,
        selectedSourceId: undefined,
        selectedSourceType: undefined,
        transactionPage: undefined,
      }),
    });
  }

  function inspectSkuInput() {
    const nextSku = skuInput.trim();

    void navigate({
      search: (current) => {
        const next = {
          ...current,
          productSkuId: undefined,
          evidenceQuery: undefined,
          reviewStatus: undefined,
          selectedSourceId: undefined,
          selectedSourceType: undefined,
          sku: nextSku || undefined,
          source: undefined,
          transactionPage: undefined,
        };

        return next;
      },
    });
  }

  function returnToEvidenceWorkflow() {
    void navigate({
      search: (current) => ({
        ...current,
        productSkuId: undefined,
        sku: undefined,
        transactionPage: undefined,
      }),
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    inspectSkuInput();
  }

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            animateContent={!hasSelection}
            contentKey={hasSelection ? "sku-selected" : untrustedHeaderContentKey}
            eyebrow="Store Ops"
            title={hasSelection ? "SKU activity" : untrustedHeaderTitle}
            description={
              hasSelection
                ? DEFAULT_SKU_ACTIVITY_DESCRIPTION
                : untrustedHeaderDescription
            }
            showBackButton={showBackButton}
          />

          {hasSelection ? (
            <>
              <section className="py-layout-sm md:py-layout-md">
                <div className="mx-auto grid w-full max-w-3xl gap-layout-sm md:max-w-[51.25rem] md:grid-cols-[2.5rem_minmax(0,1fr)] md:items-center">
                  <Button
                    aria-label="Back to evidence"
                    className="h-10 w-10 p-0 text-muted-foreground hover:text-foreground"
                    onClick={returnToEvidenceWorkflow}
                    type="button"
                    variant="ghost"
                  >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <SkuActivitySearchForm
                    buttonLabel="Inspect SKU"
                    className="grid w-full gap-layout-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
                    inputClassName="min-w-0 space-y-layout-xs text-left"
                    inputId="sku-activity-search"
                    onSubmit={handleSubmit}
                    setSkuInput={setSkuInput}
                    skuInput={skuInput}
                  />
                </div>
              </section>

              <SkuActivityTimeline
                isLoading={
                  hasSelection &&
                  ((!selectedProductSkuId && skuSearch === undefined) ||
                    skuActivity === undefined)
                }
                viewModel={viewModel}
              />
            </>
          ) : (
            <>
              <SkuActivityEntryState
                onInspectSku={inspectSkuInput}
                setSkuInput={handleEvidenceQueryChange}
                skuInput={skuInput}
              />
              <SkuActivityUntrustedSalesQuery
                evidenceQuery={skuInput}
                onHeaderSummaryChange={handleUntrustedHeaderSummaryChange}
                orgUrlSlug={orgUrlSlug}
                reviewStatus={reviewStatus}
                selectedSourceId={selectedSourceId}
                selectedSourceType={selectedSourceType}
                sourceFilter={sourceFilter}
                storeId={storeId}
                storeUrlSlug={storeUrlSlug}
                transactionPage={transactionPage}
              />
            </>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export function SkuActivityRouteShell({
  evidenceQuery,
  orgUrlSlug,
  productSkuId,
  reviewStatus,
  selectedSourceId,
  selectedSourceType,
  showBackButton = false,
  sku,
  source,
  storeUrlSlug,
  transactionPage,
}: {
  evidenceQuery?: string;
  orgUrlSlug: string;
  productSkuId?: string;
  reviewStatus?: SkuActivityUntrustedSalesReviewStatus;
  selectedSourceId?: string;
  selectedSourceType?: SkuActivityUntrustedSalesSourceType;
  showBackButton?: boolean;
  sku?: string;
  source?: SkuActivityUntrustedSalesSourceFilter;
  storeUrlSlug: string;
  transactionPage?: number;
}) {
  const { user, isLoading: isLoadingAuth } = useAuth();
  const {
    canAccessProtectedSurface,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState({ surface: "store_day" });
  const canAccessSurface = canAccessProtectedSurface ?? hasFullAdminAccess;
  const organizations = useQuery(
    api.inventory.organizations.getAll,
    user?._id && isAuthenticated && canAccessSurface
      ? { userId: user._id }
      : "skip",
  );
  const organization = organizations?.find((org) => org.slug === orgUrlSlug);
  const stores = useQuery(
    api.inventory.stores.getAll,
    organization?._id ? { organizationId: organization._id } : "skip",
  );

  if (isLoadingAuth || isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated || !canAccessSurface) {
    return <NoPermissionView />;
  }

  if (organizations === undefined) {
    return null;
  }

  if (!organization) {
    return <NotFoundView entity="organization" entityIdentifier={orgUrlSlug} />;
  }

  if (stores === undefined) {
    return null;
  }

  const store = stores.find((candidate) => candidate.slug === storeUrlSlug);

  if (!store) {
    return <NotFoundView entity="store" entityIdentifier={storeUrlSlug} />;
  }

  return (
    <SkuActivityRouteContent
      evidenceQuery={evidenceQuery}
      orgUrlSlug={orgUrlSlug}
      productSkuId={productSkuId}
      reviewStatus={reviewStatus}
      selectedSourceId={selectedSourceId}
      selectedSourceType={selectedSourceType}
      showBackButton={showBackButton}
      sku={sku}
      sourceFilter={source}
      storeId={store._id}
      storeUrlSlug={storeUrlSlug}
      transactionPage={transactionPage}
    />
  );
}

function SkuActivityRoute() {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const {
    evidenceQuery,
    o,
    productSkuId,
    reviewStatus,
    selectedSourceId,
    selectedSourceType,
    sku,
    source,
    transactionPage,
  } = Route.useSearch();

  return (
    <SkuActivityRouteShell
      orgUrlSlug={orgUrlSlug}
      evidenceQuery={evidenceQuery}
      productSkuId={productSkuId}
      reviewStatus={reviewStatus}
      selectedSourceId={selectedSourceId}
      selectedSourceType={selectedSourceType}
      showBackButton={typeof o === "string" && o.length > 0}
      sku={sku}
      source={source}
      storeUrlSlug={storeUrlSlug}
      transactionPage={transactionPage}
    />
  );
}

function SkuActivityRouteErrorView() {
  const { productSkuId, sku } = Route.useSearch();
  const hasSelection = Boolean(sku?.trim() || productSkuId?.trim());

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="SKU activity"
            description="Look up a known SKU or review untrusted products with sale activity."
          />
          {hasSelection ? (
            <SkuActivityTimeline error={true} viewModel={null} />
          ) : (
            <SkuActivityUntrustedSales
              error={true}
              onChangeReviewStatus={() => undefined}
              onChangeSourceFilter={() => undefined}
              onSelectSource={() => undefined}
              orgUrlSlug=""
              storeUrlSlug=""
              viewModel={null}
            />
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/sku-activity",
)({
  component: SkuActivityRoute,
  errorComponent: SkuActivityRouteErrorView,
  validateSearch: skuActivitySearchSchema,
});
