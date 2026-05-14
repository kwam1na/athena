import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import { useAuth } from "@/hooks/useAuth";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { PageLevelHeader, PageWorkspace } from "~/src/components/common/PageLevelHeader";
import { SkuActivityTimeline } from "~/src/components/operations/SkuActivityTimeline";
import {
  buildSkuActivityTimelineViewModel,
  type SkuActivityQueryResult,
} from "~/src/components/operations/skuActivityTimelineAdapter";
import { NoPermissionView } from "~/src/components/states/no-permission/NoPermissionView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";
import { Button } from "~/src/components/ui/button";
import { Input } from "~/src/components/ui/input";
import { Label } from "~/src/components/ui/label";
import View from "~/src/components/View";

const skuActivitySearchSchema = z.object({
  productSkuId: z.string().optional(),
  sku: z.string().optional(),
});

function SkuActivityRouteContent({
  productSkuId,
  sku,
  storeId,
}: {
  productSkuId?: string;
  sku?: string;
  storeId: Id<"store">;
}) {
  const navigate = Route.useNavigate();
  const [skuInput, setSkuInput] = useState(sku ?? "");
  const trimmedSku = sku?.trim();
  const selectedProductSkuId = productSkuId?.trim();
  const hasSelection = Boolean(trimmedSku || selectedProductSkuId);

  const skuActivity = useQuery(
    api.operations.skuActivity.getSkuActivityForProductSku,
    hasSelection
      ? {
          productSkuId: selectedProductSkuId
            ? (selectedProductSkuId as Id<"productSku">)
            : undefined,
          sku: selectedProductSkuId ? undefined : trimmedSku,
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
          sku: nextSku || undefined,
        };

        return next;
      },
    });
  }

  return (
    <View>
      <PageWorkspace>
        <PageLevelHeader
          eyebrow="Operations"
          title="SKU activity"
          description="Inspect current stock, active reservations, and source-linked activity for a SKU."
        />

        <form
          className="flex flex-col gap-layout-sm rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface md:flex-row md:items-end"
          onSubmit={handleSubmit}
        >
          <div className="min-w-0 flex-1 space-y-layout-xs">
            <Label htmlFor="sku-activity-search">SKU</Label>
            <Input
              id="sku-activity-search"
              onChange={(event) => setSkuInput(event.target.value)}
              placeholder="Enter SKU"
              value={skuInput}
            />
          </div>
          <Button className="gap-layout-xs md:w-auto" type="submit">
            <Search className="h-4 w-4" />
            Inspect
          </Button>
        </form>

        <SkuActivityTimeline
          isLoading={hasSelection && skuActivity === undefined}
          viewModel={viewModel}
        />
      </PageWorkspace>
    </View>
  );
}

export function SkuActivityRouteShell({
  orgUrlSlug,
  productSkuId,
  sku,
  storeUrlSlug,
}: {
  orgUrlSlug: string;
  productSkuId?: string;
  sku?: string;
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
      productSkuId={productSkuId}
      sku={sku}
      storeId={store._id}
    />
  );
}

function SkuActivityRoute() {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const { productSkuId, sku } = Route.useSearch();

  return (
    <SkuActivityRouteShell
      orgUrlSlug={orgUrlSlug}
      productSkuId={productSkuId}
      sku={sku}
      storeUrlSlug={storeUrlSlug}
    />
  );
}

function SkuActivityRouteErrorView() {
  return (
    <View>
      <PageWorkspace>
        <PageLevelHeader
          eyebrow="Operations"
          title="SKU activity"
          description="Inspect current stock, active reservations, and source-linked activity for a SKU."
        />
        <SkuActivityTimeline error={true} viewModel={null} />
      </PageWorkspace>
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
