import { useState } from "react";
import { useQuery } from "convex/react";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

type RecommendationStatus =
  | "reorder_now"
  | "awaiting_receipt"
  | "availability_constrained";

type ReplenishmentRecommendation = {
  _id: Id<"productSku">;
  guidance: string;
  inventoryCount: number;
  nextExpectedAt?: number;
  pendingPurchaseOrderCount: number;
  pendingPurchaseOrderQuantity: number;
  pendingPurchaseOrders: Array<{
    expectedAt?: number;
    pendingQuantity: number;
    poNumber: string;
    purchaseOrderId: Id<"purchaseOrder">;
    status: "ordered" | "partially_received";
  }>;
  productName: string;
  quantityAvailable: number;
  sku?: string | null;
  status: RecommendationStatus;
  suggestedOrderQuantity: number;
};

type ProcurementOrderSummary = {
  _id: Id<"purchaseOrder">;
  expectedAt?: number;
  lineItemCount: number;
  poNumber: string;
  status:
    | "draft"
    | "submitted"
    | "approved"
    | "ordered"
    | "partially_received"
    | "received"
    | "cancelled";
  totalUnits: number;
};

type ProcurementViewContentProps = {
  activeVendorCount: number;
  hasActiveStore: boolean;
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isLoadingProcurement: boolean;
  purchaseOrders: ProcurementOrderSummary[];
  recommendations: ReplenishmentRecommendation[];
};

const FILTER_OPTIONS = [
  { label: "All pressure", value: "all" as const },
  { label: "Reorder now", value: "reorder_now" as const },
  { label: "Inbound cover", value: "awaiting_receipt" as const },
  { label: "Reserved stock", value: "availability_constrained" as const },
] as const;

const ACTIVE_PROCUREMENT_STATUSES = [
  "submitted",
  "approved",
  "ordered",
  "partially_received",
] as const;

function formatOptionalDate(timestamp?: number) {
  if (!timestamp) {
    return "No ETA";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(timestamp));
}

function getRecommendationStatusCopy(status: RecommendationStatus) {
  switch (status) {
    case "reorder_now":
      return {
        badgeClassName:
          "border border-red-200/80 bg-red-50 text-red-700",
        label: "Reorder now",
        rowClassName:
          "border-l-4 border-l-red-400 bg-red-50/30",
      };
    case "awaiting_receipt":
      return {
        badgeClassName:
          "border border-amber-200/80 bg-amber-50 text-amber-800",
        label: "Inbound cover",
        rowClassName:
          "border-l-4 border-l-amber-400 bg-amber-50/30",
      };
    case "availability_constrained":
      return {
        badgeClassName:
          "border border-slate-200/80 bg-slate-50 text-slate-700",
        label: "Reserved stock",
        rowClassName:
          "border-l-4 border-l-slate-300 bg-slate-50/40",
      };
  }
}

function getFilterEmptyStateCopy(
  filter: (typeof FILTER_OPTIONS)[number]["value"]
) {
  switch (filter) {
    case "reorder_now":
      return {
        description:
          "Nothing is below the current reorder target once active inbound is considered.",
        title: "No immediate reorders",
      };
    case "awaiting_receipt":
      return {
        description:
          "There are no low-stock SKUs currently covered by open receiving work.",
        title: "No inbound-covered SKUs",
      };
    case "availability_constrained":
      return {
        description:
          "Sellable stock is not currently compressed by holds or commitments.",
        title: "No reserved-stock pressure",
      };
    default:
      return {
        description:
          "Current stock and receiving context are not flagging any procurement pressure.",
        title: "Procurement looks clear",
      };
  }
}

export function ProcurementViewContent({
  activeVendorCount,
  hasActiveStore,
  hasFullAdminAccess,
  isLoadingPermissions,
  isLoadingProcurement,
  purchaseOrders,
  recommendations,
}: ProcurementViewContentProps) {
  const [filter, setFilter] = useState<(typeof FILTER_OPTIONS)[number]["value"]>(
    "all"
  );

  if (isLoadingPermissions) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading procurement workspace...
        </div>
      </View>
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!hasActiveStore) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening procurement planning."
            title="No active store"
          />
        </div>
      </View>
    );
  }

  if (isLoadingProcurement) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading procurement workspace...
        </div>
      </View>
    );
  }

  const visibleRecommendations =
    filter === "all"
      ? recommendations
      : recommendations.filter((item) => item.status === filter);
  const activePurchaseOrders = purchaseOrders
    .filter((order) =>
      ACTIVE_PROCUREMENT_STATUSES.includes(
        order.status as (typeof ACTIVE_PROCUREMENT_STATUSES)[number]
      )
    )
    .sort((left, right) => {
      const leftExpectedAt = left.expectedAt ?? Number.MAX_SAFE_INTEGER;
      const rightExpectedAt = right.expectedAt ?? Number.MAX_SAFE_INTEGER;

      if (leftExpectedAt !== rightExpectedAt) {
        return leftExpectedAt - rightExpectedAt;
      }

      return left.poNumber.localeCompare(right.poNumber);
    });
  const visiblePurchaseOrders = activePurchaseOrders.slice(0, 6);
  const hiddenPurchaseOrderCount = Math.max(
    activePurchaseOrders.length - visiblePurchaseOrders.length,
    0
  );
  const summary = {
    activePurchaseOrders: activePurchaseOrders.length,
    awaitingReceipt: recommendations.filter(
      (item) => item.status === "awaiting_receipt"
    ).length,
    reorderNow: recommendations.filter((item) => item.status === "reorder_now")
      .length,
    reservedStock: recommendations.filter(
      (item) => item.status === "availability_constrained"
    ).length,
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        <div className="container mx-auto py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-1">
              <p className="text-xs uppercase tracking-[0.24em] text-amber-700/80">
                Stock Ops
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">
                Procurement workspace
              </h2>
              <p className="text-sm text-muted-foreground">
                Read low-stock pressure against open receiving work before raising
                the next replenishment move.
              </p>
            </div>
            <div className="rounded-full border border-amber-200/80 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
              Inventory, inbound, and vendor context in one pass
            </div>
          </div>
        </div>
      }
    >
      <FadeIn className="container mx-auto grid gap-6 py-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <section className="overflow-hidden rounded-2xl border border-border/80 bg-background">
          <div className="border-b border-border/80 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_38%),linear-gradient(180deg,rgba(250,250,249,0.96),rgba(255,255,255,0.9))] px-5 py-5">
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold tracking-tight">
                  Replenishment signals
                </h3>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Recommendations are driven by current stock, sellable stock, and
                  open receiving quantities. Use the filters to separate urgent
                  reorder work from inbound-covered SKUs.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => {
                  const isActive = option.value === filter;

                  return (
                    <button
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                        isActive
                          ? "border-amber-300 bg-amber-500 text-amber-950 shadow-sm"
                          : "border-border/80 bg-background text-muted-foreground hover:border-amber-200 hover:text-foreground"
                      }`}
                      key={option.value}
                      onClick={() => setFilter(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="divide-y divide-border/70">
            {visibleRecommendations.length === 0 ? (
              <div className="px-5 py-8">
                <EmptyState
                  description={getFilterEmptyStateCopy(filter).description}
                  title={getFilterEmptyStateCopy(filter).title}
                />
              </div>
            ) : (
              visibleRecommendations.map((recommendation) => {
                const statusCopy = getRecommendationStatusCopy(
                  recommendation.status
                );

                return (
                  <article
                    className={`px-5 py-5 transition hover:bg-stone-50/60 ${statusCopy.rowClassName}`}
                    key={recommendation._id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-semibold">
                              {recommendation.productName}
                            </h4>
                            {recommendation.sku ? (
                              <span className="rounded-full border border-border/80 px-2.5 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                {recommendation.sku}
                              </span>
                            ) : null}
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusCopy.badgeClassName}`}
                            >
                              {statusCopy.label}
                            </span>
                          </div>
                          <p className="max-w-2xl text-sm text-muted-foreground">
                            {recommendation.guidance}
                          </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Available now
                            </p>
                            <p className="mt-1 text-2xl font-semibold">
                              {recommendation.quantityAvailable}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              On hand
                            </p>
                            <p className="mt-1 text-2xl font-semibold">
                              {recommendation.inventoryCount}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Suggested order
                            </p>
                            <p className="mt-1 text-2xl font-semibold">
                              {recommendation.suggestedOrderQuantity}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                          <span>
                            Inbound units:{" "}
                            <span className="font-medium text-foreground">
                              {recommendation.pendingPurchaseOrderQuantity}
                            </span>
                          </span>
                          <span>
                            Active POs:{" "}
                            <span className="font-medium text-foreground">
                              {recommendation.pendingPurchaseOrderCount}
                            </span>
                          </span>
                          <span>
                            Next ETA:{" "}
                            <span className="font-medium text-foreground">
                              {formatOptionalDate(recommendation.nextExpectedAt)}
                            </span>
                          </span>
                        </div>

                        {recommendation.pendingPurchaseOrders.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {recommendation.pendingPurchaseOrders.map((purchaseOrder) => (
                              <div
                                className="rounded-full border border-amber-200/80 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-900"
                                key={purchaseOrder.purchaseOrderId}
                              >
                                {purchaseOrder.poNumber} · {purchaseOrder.pendingQuantity}u ·{" "}
                                {formatOptionalDate(purchaseOrder.expectedAt)}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border border-border/80 bg-background p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Snapshot
              </p>
              <h3 className="mt-1 text-base font-medium">Planning signal</h3>
              <p className="text-sm text-muted-foreground">
                Use the current mix of stock pressure and open POs to decide
                whether to order, wait, or clear held inventory first.
              </p>
            </div>

            <div className="divide-y divide-border/70 rounded-xl border border-border/80">
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">Reorder now</span>
                <span className="font-semibold">{summary.reorderNow}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">Inbound cover</span>
                <span className="font-semibold">{summary.awaitingReceipt}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">Reserved stock</span>
                <span className="font-semibold">{summary.reservedStock}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">Active vendors</span>
                <span className="font-semibold">{activeVendorCount}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">Active purchase orders</span>
                <span className="font-semibold">
                  {summary.activePurchaseOrders}
                </span>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border/80 bg-background p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Purchase Orders
              </p>
              <h3 className="mt-1 text-base font-medium">Open procurement flow</h3>
              <p className="text-sm text-muted-foreground">
                Submitted, approved, ordered, and partially received purchase orders
                stay visible here while you review replenishment pressure.
              </p>
            </div>

            {activePurchaseOrders.length === 0 ? (
              <EmptyState
                description="Create or advance purchase orders to keep inbound coverage visible beside low-stock recommendations."
                title="No active purchase orders"
              />
            ) : (
              <>
                {visiblePurchaseOrders.map((purchaseOrder) => (
                  <article
                    className="rounded-xl border border-border/80 px-3 py-3"
                    key={purchaseOrder._id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{purchaseOrder.poNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {purchaseOrder.lineItemCount} lines · {purchaseOrder.totalUnits} units
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{purchaseOrder.status.replaceAll("_", " ")}</p>
                        <p>{formatOptionalDate(purchaseOrder.expectedAt)}</p>
                      </div>
                    </div>
                  </article>
                ))}
                {hiddenPurchaseOrderCount > 0 ? (
                  <div className="rounded-xl border border-dashed border-amber-300/80 bg-amber-50/60 px-3 py-3 text-sm text-amber-950">
                    Showing 6 of {activePurchaseOrders.length} active purchase orders.
                    Review the purchase-order workspace to inspect the remaining{" "}
                    {hiddenPurchaseOrderCount}.
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </FadeIn>
    </View>
  );
}

export function ProcurementView() {
  const {
    activeStore,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState();
  const procurementQueryArgs =
    canQueryProtectedData ? { storeId: activeStore!._id } : "skip";
  const recommendations = useQuery(
    api.stockOps.replenishment.listReplenishmentRecommendations,
    procurementQueryArgs
  ) as ReplenishmentRecommendation[] | undefined;
  const purchaseOrders = useQuery(
    api.stockOps.purchaseOrders.listPurchaseOrders,
    procurementQueryArgs
  ) as ProcurementOrderSummary[] | undefined;
  const vendors = useQuery(
    api.stockOps.vendors.listVendors,
    canQueryProtectedData ? { status: "active", storeId: activeStore!._id } : "skip"
  ) as Array<{ _id: Id<"vendor"> }> | undefined;

  if (isLoadingAccess) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading procurement workspace...
        </div>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before procurement planning can load protected stock operations data." />
    );
  }

  return (
    <ProcurementViewContent
      activeVendorCount={vendors?.length ?? 0}
      hasActiveStore={Boolean(activeStore)}
      hasFullAdminAccess={hasFullAdminAccess}
      isLoadingPermissions={false}
      isLoadingProcurement={Boolean(
        canQueryProtectedData &&
          (recommendations === undefined ||
            purchaseOrders === undefined ||
            vendors === undefined)
      )}
      purchaseOrders={purchaseOrders ?? []}
      recommendations={recommendations ?? []}
    />
  );
}
