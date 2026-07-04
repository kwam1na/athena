import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import View from "~/src/components/View";

const UNTRUSTED_SOURCE_PAGE_SIZE = 50;
const UNTRUSTED_TRANSACTION_PAGE_SIZE = 100;
const UNTRUSTED_MAX_LIMIT = 500;

const skuActivitySearchSchema = z.object({
  o: z.string().optional(),
  productSkuId: z.string().optional(),
  reviewStatus: z.enum(["open", "reviewed", "all"]).optional(),
  selectedSourceId: z.string().optional(),
  selectedSourceType: z
    .enum(["inventoryImportProvisionalSku", "posPendingCheckoutItem"])
    .optional(),
  sku: z.string().optional(),
  source: z.enum(["all", "legacy_import", "pending_checkout"]).optional(),
});

function SkuActivityUntrustedSalesQuery({
  orgUrlSlug,
  reviewStatus,
  selectedSourceId,
  selectedSourceType,
  sourceFilter,
  storeId,
  storeUrlSlug,
}: {
  orgUrlSlug: string;
  reviewStatus: SkuActivityUntrustedSalesReviewStatus;
  selectedSourceId?: string;
  selectedSourceType?: SkuActivityUntrustedSalesSourceType;
  sourceFilter: SkuActivityUntrustedSalesSourceFilter;
  storeId: Id<"store">;
  storeUrlSlug: string;
}) {
  const navigate = Route.useNavigate();
  const [sourceLimit, setSourceLimit] = useState(UNTRUSTED_SOURCE_PAGE_SIZE);
  const [transactionLimit, setTransactionLimit] = useState(
    UNTRUSTED_TRANSACTION_PAGE_SIZE,
  );
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
  const viewModel = useMemo(
    () =>
      untrustedSkuSales === undefined
        ? undefined
        : buildSkuActivityUntrustedSalesViewModel(untrustedSkuSales, {
            selectedSourceId,
            sourceFilter,
          }),
    [selectedSourceId, sourceFilter, untrustedSkuSales],
  );

  function handleChangeReviewStatus(
    nextReviewStatus: SkuActivityUntrustedSalesReviewStatus,
  ) {
    void navigate({
      search: (current) => ({
        ...current,
        reviewStatus: nextReviewStatus === "open" ? undefined : nextReviewStatus,
        selectedSourceId: undefined,
        selectedSourceType: undefined,
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
      }),
    });
  }

  function handleLoadMoreSources() {
    setSourceLimit((current) =>
      Math.min(current + UNTRUSTED_SOURCE_PAGE_SIZE, UNTRUSTED_MAX_LIMIT),
    );
  }

  function handleLoadMoreTransactions() {
    setTransactionLimit((current) =>
      Math.min(
        current + UNTRUSTED_TRANSACTION_PAGE_SIZE,
        UNTRUSTED_MAX_LIMIT,
      ),
    );
  }

  return (
    <SkuActivityUntrustedSales
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
      onSelectSource={handleSelectSource}
      orgUrlSlug={orgUrlSlug}
      storeUrlSlug={storeUrlSlug}
      viewModel={viewModel}
    />
  );
}

function SkuActivityRouteContent({
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
}: {
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
}) {
  const navigate = Route.useNavigate();
  const [skuInput, setSkuInput] = useState(sku ?? "");
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSku = skuInput.trim();

    void navigate({
      search: (current) => {
        const next = {
          ...current,
          productSkuId: undefined,
          reviewStatus: undefined,
          selectedSourceId: undefined,
          selectedSourceType: undefined,
          sku: nextSku || undefined,
          source: undefined,
        };

        return next;
      },
    });
  }

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="SKU activity"
            description="Inspect current stock, active reservations, and untrusted SKU sale evidence."
            showBackButton={showBackButton}
          />

          <form
            className="flex w-full flex-col gap-layout-sm md:w-fit md:flex-row md:items-end"
            onSubmit={handleSubmit}
          >
            <div className="min-w-0 space-y-layout-xs md:w-56 md:flex-none">
              <Label htmlFor="sku-activity-search">SKU</Label>
              <Input
                id="sku-activity-search"
                onChange={(event) => setSkuInput(event.target.value)}
                placeholder="Enter SKU"
                value={skuInput}
              />
            </div>
            <Button
              className="gap-layout-xs md:w-auto"
              type="submit"
              variant="workflow"
            >
              <Search className="h-4 w-4" />
              Inspect
            </Button>
          </form>

          {hasSelection ? (
            <SkuActivityTimeline
              isLoading={
                hasSelection &&
                ((!selectedProductSkuId && skuSearch === undefined) ||
                  skuActivity === undefined)
              }
              viewModel={viewModel}
            />
          ) : (
            <SkuActivityUntrustedSalesQuery
              orgUrlSlug={orgUrlSlug}
              reviewStatus={reviewStatus}
              selectedSourceId={selectedSourceId}
              selectedSourceType={selectedSourceType}
              sourceFilter={sourceFilter}
              storeId={storeId}
              storeUrlSlug={storeUrlSlug}
            />
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export function SkuActivityRouteShell({
  orgUrlSlug,
  productSkuId,
  reviewStatus,
  selectedSourceId,
  selectedSourceType,
  showBackButton = false,
  sku,
  source,
  storeUrlSlug,
}: {
  orgUrlSlug: string;
  productSkuId?: string;
  reviewStatus?: SkuActivityUntrustedSalesReviewStatus;
  selectedSourceId?: string;
  selectedSourceType?: SkuActivityUntrustedSalesSourceType;
  showBackButton?: boolean;
  sku?: string;
  source?: SkuActivityUntrustedSalesSourceFilter;
  storeUrlSlug: string;
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
    />
  );
}

function SkuActivityRoute() {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const {
    o,
    productSkuId,
    reviewStatus,
    selectedSourceId,
    selectedSourceType,
    sku,
    source,
  } = Route.useSearch();

  return (
    <SkuActivityRouteShell
      orgUrlSlug={orgUrlSlug}
      productSkuId={productSkuId}
      reviewStatus={reviewStatus}
      selectedSourceId={selectedSourceId}
      selectedSourceType={selectedSourceType}
      showBackButton={typeof o === "string" && o.length > 0}
      sku={sku}
      source={source}
      storeUrlSlug={storeUrlSlug}
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
            description="Inspect current stock, active reservations, and untrusted SKU sale evidence."
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
