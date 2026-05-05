import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ReceivingView } from "./ReceivingView";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { runCommand } from "@/lib/errors/runCommand";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

type ContinuityState =
  | "cancelled_cover"
  | "exposed"
  | "inbound"
  | "late_inbound"
  | "partially_covered"
  | "planned"
  | "resolved"
  | "short_receipt"
  | "stale_planned_action"
  | "vendor_missing";

type PurchaseOrderStatus =
  | "approved"
  | "cancelled"
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "submitted";

type PurchaseOrderReference = {
  expectedAt?: number;
  pendingQuantity: number;
  poNumber: string;
  purchaseOrderId: Id<"purchaseOrder">;
  status: PurchaseOrderStatus;
};

type ReplenishmentRecommendation = {
  _id: Id<"productSku">;
  actionGap?: number;
  guidance: string;
  inboundCoverageGap?: number;
  inboundPurchaseOrderCount?: number;
  inboundPurchaseOrderQuantity?: number;
  inboundPurchaseOrders?: PurchaseOrderReference[];
  inventoryCount: number;
  isException?: boolean;
  needsAction?: boolean;
  nextExpectedAt?: number;
  pendingPurchaseOrderCount: number;
  pendingPurchaseOrderQuantity: number;
  pendingPurchaseOrders: PurchaseOrderReference[];
  plannedPurchaseOrderCount?: number;
  plannedPurchaseOrderQuantity?: number;
  plannedPurchaseOrders?: PurchaseOrderReference[];
  productName: string;
  quantityAvailable: number;
  sku?: string | null;
  status: ContinuityState;
  suggestedOrderQuantity: number;
};

type ProcurementOrderSummary = {
  _id: Id<"purchaseOrder">;
  expectedAt?: number;
  lineItemCount: number;
  poNumber: string;
  status: PurchaseOrderStatus;
  totalUnits: number;
};

type VendorSummary = {
  _id: Id<"vendor">;
  name: string;
};

type PurchaseOrderDetail = ProcurementOrderSummary & {
  lineItems: Array<{
    _id: Id<"purchaseOrderLineItem">;
    description?: string;
    orderedQuantity: number;
    productSkuId: Id<"productSku">;
    receivedQuantity: number;
  }>;
  vendor?: VendorSummary | null;
};

type ReorderDraftLine = {
  productName: string;
  productSkuId: Id<"productSku">;
  quantity: number;
  sku?: string | null;
  vendorId?: Id<"vendor">;
};

type ProcurementViewContentProps = {
  hasActiveStore: boolean;
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isLoadingProcurement: boolean;
  purchaseOrders: ProcurementOrderSummary[];
  recommendations: ReplenishmentRecommendation[];
  storeId?: Id<"store">;
  vendors: VendorSummary[];
};

const MODE_OPTIONS = [
  { label: "Needs action", value: "needs_action" as const },
  { label: "Planned", value: "planned" as const },
  { label: "Inbound", value: "inbound" as const },
  { label: "Exceptions", value: "exceptions" as const },
  { label: "Resolved", value: "resolved" as const },
  { label: "All", value: "all" as const },
] as const;

type ProcurementMode = (typeof MODE_OPTIONS)[number]["value"];

const ACTIVE_PROCUREMENT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "ordered",
  "partially_received",
] as const;

const PLANNED_STATES: ContinuityState[] = [
  "planned",
  "stale_planned_action",
];

const INBOUND_STATES: ContinuityState[] = [
  "inbound",
  "late_inbound",
  "partially_covered",
  "short_receipt",
];

function formatOptionalDate(timestamp?: number) {
  if (!timestamp) {
    return "No ETA";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(timestamp));
}

function formatStatus(status: PurchaseOrderStatus | ContinuityState) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getContinuityStateCopy(status: ContinuityState) {
  switch (status) {
    case "cancelled_cover":
      return {
        badgeClassName: "border-danger/30 bg-danger/10 text-danger",
        label: "Cancelled cover",
      };
    case "exposed":
      return {
        badgeClassName: "border-danger/30 bg-danger/10 text-danger",
        label: "Exposed",
      };
    case "inbound":
      return {
        badgeClassName:
          "border-success/30 bg-success/10 text-success-foreground",
        label: "Inbound",
      };
    case "late_inbound":
      return {
        badgeClassName:
          "border-warning/30 bg-warning/10 text-warning-foreground",
        label: "Late inbound",
      };
    case "partially_covered":
      return {
        badgeClassName:
          "border-warning/30 bg-warning/10 text-warning-foreground",
        label: "Partially covered",
      };
    case "planned":
      return {
        badgeClassName:
          "border-action-workflow-border bg-action-workflow-soft text-action-workflow",
        label: "Planned",
      };
    case "resolved":
      return {
        badgeClassName: "border-border bg-muted/50 text-foreground",
        label: "Resolved",
      };
    case "short_receipt":
      return {
        badgeClassName:
          "border-warning/30 bg-warning/10 text-warning-foreground",
        label: "Short receipt",
      };
    case "stale_planned_action":
      return {
        badgeClassName:
          "border-warning/30 bg-warning/10 text-warning-foreground",
        label: "Stale planned action",
      };
    case "vendor_missing":
      return {
        badgeClassName: "border-danger/30 bg-danger/10 text-danger",
        label: "Vendor missing",
      };
  }
}

function isRecommendationVisible(
  recommendation: ReplenishmentRecommendation,
  mode: ProcurementMode,
) {
  if (mode === "all") {
    return true;
  }

  if (mode === "exceptions") {
    return Boolean(recommendation.isException);
  }

  if (mode === "planned") {
    return PLANNED_STATES.includes(recommendation.status);
  }

  if (mode === "inbound") {
    return INBOUND_STATES.includes(recommendation.status);
  }

  if (mode === "resolved") {
    return recommendation.status === "resolved";
  }

  return (
    recommendation.needsAction ||
    recommendation.status === "exposed" ||
    recommendation.status === "vendor_missing" ||
    recommendation.status === "cancelled_cover" ||
    recommendation.status === "late_inbound" ||
    recommendation.status === "partially_covered" ||
    recommendation.status === "short_receipt" ||
    recommendation.status === "stale_planned_action"
  );
}

function getModeEmptyStateCopy(mode: ProcurementMode) {
  switch (mode) {
    case "exceptions":
      return {
        description:
          "Late inbound, short receipt, cancelled cover, and stale planned action are clear right now",
        title: "No procurement exceptions",
      };
    case "inbound":
      return {
        description:
          "No ordered or partially received purchase orders are covering pressure right now",
        title: "No inbound cover",
      };
    case "planned":
      return {
        description:
          "No draft, submitted, or approved purchase orders are currently planned against pressure",
        title: "No planned procurement work",
      };
    case "resolved":
      return {
        description:
          "No rows have cleared their pressure into a resolved continuity state yet",
        title: "No resolved rows",
      };
    default:
      return {
        description:
          "Current stock and receiving context are not flagging procurement work for this mode",
        title: "Procurement looks clear",
      };
  }
}

function getNextLifecycleActions(status: PurchaseOrderStatus) {
  switch (status) {
    case "draft":
      return [
        { label: "Submit", nextStatus: "submitted" as const },
        { label: "Cancel", nextStatus: "cancelled" as const },
      ];
    case "submitted":
      return [
        { label: "Approve", nextStatus: "approved" as const },
        { label: "Cancel", nextStatus: "cancelled" as const },
      ];
    case "approved":
      return [
        { label: "Mark ordered", nextStatus: "ordered" as const },
        { label: "Cancel", nextStatus: "cancelled" as const },
      ];
    case "ordered":
    case "partially_received":
      return [{ label: "Cancel", nextStatus: "cancelled" as const }];
    default:
      return [];
  }
}

function canReceivePurchaseOrder(status: PurchaseOrderStatus) {
  return status === "ordered" || status === "partially_received";
}

function buildVendorOptions(vendors: VendorSummary[], createdVendors: VendorSummary[]) {
  const vendorsById = new Map<Id<"vendor">, VendorSummary>();

  [...vendors, ...createdVendors].forEach((vendor) => {
    vendorsById.set(vendor._id, vendor);
  });

  return [...vendorsById.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function ProcurementViewContent({
  hasActiveStore,
  hasFullAdminAccess,
  isLoadingPermissions,
  isLoadingProcurement,
  purchaseOrders,
  recommendations,
  storeId,
  vendors,
}: ProcurementViewContentProps) {
  const [mode, setMode] = useState<ProcurementMode>("needs_action");
  const [draftLines, setDraftLines] = useState<ReorderDraftLine[]>([]);
  const [quickAddVendorName, setQuickAddVendorName] = useState("");
  const [createdVendors, setCreatedVendors] = useState<VendorSummary[]>([]);
  const [isCreatingVendor, setIsCreatingVendor] = useState(false);
  const [isCreatingPurchaseOrders, setIsCreatingPurchaseOrders] =
    useState(false);
  const [updatingPurchaseOrderId, setUpdatingPurchaseOrderId] =
    useState<Id<"purchaseOrder"> | null>(null);
  const [selectedReceivingOrderId, setSelectedReceivingOrderId] =
    useState<Id<"purchaseOrder"> | null>(null);

  const createVendor = useMutation(api.stockOps.vendors.createVendorCommand);
  const createPurchaseOrder = useMutation(
    api.stockOps.purchaseOrders.createPurchaseOrderCommand,
  );
  const updatePurchaseOrderStatus = useMutation(
    api.stockOps.purchaseOrders.updatePurchaseOrderStatusCommand,
  );
  const receivingPurchaseOrder = useQuery(
    api.stockOps.purchaseOrders.getPurchaseOrder,
    selectedReceivingOrderId
      ? { purchaseOrderId: selectedReceivingOrderId }
      : "skip",
  ) as PurchaseOrderDetail | null | undefined;

  const vendorOptions = useMemo(
    () => buildVendorOptions(vendors, createdVendors),
    [createdVendors, vendors],
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
            description="Select a store before opening procurement planning"
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

  const visibleRecommendations = recommendations.filter((recommendation) =>
    isRecommendationVisible(recommendation, mode),
  );
  const activePurchaseOrders = purchaseOrders
    .filter((order) =>
      ACTIVE_PROCUREMENT_STATUSES.includes(
        order.status as (typeof ACTIVE_PROCUREMENT_STATUSES)[number],
      ),
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
    0,
  );
  const draftHasMissingVendor = draftLines.some((line) => !line.vendorId);
  const draftHasInvalidQuantity = draftLines.some((line) => line.quantity <= 0);
  const summary = {
    activePurchaseOrders: activePurchaseOrders.length,
    exceptions: recommendations.filter((item) => item.isException).length,
    inbound: recommendations.filter((item) => INBOUND_STATES.includes(item.status))
      .length,
    needsAction: recommendations.filter((item) =>
      isRecommendationVisible(item, "needs_action"),
    ).length,
    planned: recommendations.filter((item) => PLANNED_STATES.includes(item.status))
      .length,
    resolved: recommendations.filter((item) => item.status === "resolved").length,
  };

  function addRecommendationToDraft(
    recommendation: ReplenishmentRecommendation,
  ) {
    setDraftLines((currentDraftLines) => {
      if (
        currentDraftLines.some(
          (line) => line.productSkuId === recommendation._id,
        )
      ) {
        return currentDraftLines;
      }

      return [
        ...currentDraftLines,
        {
          productName: recommendation.productName,
          productSkuId: recommendation._id,
          quantity: Math.max(1, recommendation.suggestedOrderQuantity),
          sku: recommendation.sku,
        },
      ];
    });
  }

  function updateDraftLine(
    productSkuId: Id<"productSku">,
    updates: Partial<Pick<ReorderDraftLine, "quantity" | "vendorId">>,
  ) {
    setDraftLines((currentDraftLines) =>
      currentDraftLines.map((line) =>
        line.productSkuId === productSkuId ? { ...line, ...updates } : line,
      ),
    );
  }

  function removeDraftLine(productSkuId: Id<"productSku">) {
    setDraftLines((currentDraftLines) =>
      currentDraftLines.filter((line) => line.productSkuId !== productSkuId),
    );
  }

  async function handleQuickAddVendor() {
    const vendorName = quickAddVendorName.trim();

    if (!storeId) {
      toast.error("Select a store before adding a vendor");
      return;
    }

    if (!vendorName) {
      toast.error("Add a vendor name first");
      return;
    }

    setIsCreatingVendor(true);

    try {
      const result = await runCommand(() =>
        createVendor({
          name: vendorName,
          storeId,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      const vendor = result.data as VendorSummary;
      setCreatedVendors((currentVendors) => [...currentVendors, vendor]);
      setQuickAddVendorName("");
      setDraftLines((currentDraftLines) => {
        const firstMissingVendorLine = currentDraftLines.find(
          (line) => !line.vendorId,
        );

        if (!firstMissingVendorLine) {
          return currentDraftLines;
        }

        return currentDraftLines.map((line) =>
          line.productSkuId === firstMissingVendorLine.productSkuId
            ? { ...line, vendorId: vendor._id }
            : line,
        );
      });
      toast.success("Vendor added");
    } finally {
      setIsCreatingVendor(false);
    }
  }

  async function handleCreateDraftPurchaseOrders() {
    if (!storeId) {
      toast.error("Select a store before creating purchase orders");
      return;
    }

    if (draftLines.length === 0) {
      toast.error("Add at least one SKU to the reorder draft");
      return;
    }

    if (draftHasMissingVendor) {
      toast.error("Choose a vendor for every reorder line");
      return;
    }

    if (draftHasInvalidQuantity) {
      toast.error("Use quantities greater than zero before creating POs");
      return;
    }

    const linesByVendor = new Map<Id<"vendor">, ReorderDraftLine[]>();

    draftLines.forEach((line) => {
      if (!line.vendorId) {
        return;
      }

      linesByVendor.set(line.vendorId, [
        ...(linesByVendor.get(line.vendorId) ?? []),
        line,
      ]);
    });

    setIsCreatingPurchaseOrders(true);

    try {
      const createdProductSkuIds = new Set<Id<"productSku">>();

      for (const [vendorId, lines] of linesByVendor) {
        const result = await runCommand(() =>
          createPurchaseOrder({
            lineItems: lines.map((line) => ({
              description: line.sku
                ? `${line.productName} (${line.sku})`
                : line.productName,
              orderedQuantity: line.quantity,
              productSkuId: line.productSkuId,
              unitCost: 0,
            })),
            storeId,
            vendorId,
          }),
        );

        if (result.kind !== "ok") {
          if (createdProductSkuIds.size > 0) {
            setDraftLines((currentDraftLines) =>
              currentDraftLines.filter(
                (line) => !createdProductSkuIds.has(line.productSkuId),
              ),
            );
          }

          presentCommandToast(result);
          return;
        }

        lines.forEach((line) => createdProductSkuIds.add(line.productSkuId));
      }

      setDraftLines((currentDraftLines) =>
        currentDraftLines.filter(
          (line) => !createdProductSkuIds.has(line.productSkuId),
        ),
      );
      toast.success(
        `${linesByVendor.size} draft purchase order${
          linesByVendor.size === 1 ? "" : "s"
        } created`,
      );
    } finally {
      setIsCreatingPurchaseOrders(false);
    }
  }

  async function handleUpdatePurchaseOrderStatus(
    purchaseOrder: ProcurementOrderSummary,
    nextStatus: PurchaseOrderStatus,
  ) {
    setUpdatingPurchaseOrderId(purchaseOrder._id);

    try {
      const result = await runCommand(() =>
        updatePurchaseOrderStatus({
          nextStatus,
          purchaseOrderId: purchaseOrder._id,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast.success(`${purchaseOrder.poNumber} moved to ${formatStatus(nextStatus)}`);
    } finally {
      setUpdatingPurchaseOrderId(null);
    }
  }

  return (
    <View hideBorder hideHeaderBottomBorder>
      <FadeIn className="container mx-auto h-full min-h-0 overflow-hidden py-layout-xl">
        <div className="grid h-full min-h-0 gap-layout-xl xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-h-0 min-w-0 space-y-layout-2xl overflow-y-auto overscroll-contain pr-1 scrollbar-hide">
            <div className="flex flex-wrap items-start justify-between gap-layout-md">
              <div className="max-w-2xl space-y-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Stock Ops
                </p>
                <div className="space-y-1">
                  <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                    Procurement workspace
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Work SKU pressure into vendor-backed POs, inbound cover, and
                    receiving without losing the stock continuity context.
                  </p>
                </div>
                <div className="grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Needs action
                    </p>
                    <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                      {summary.needsAction}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Planned
                    </p>
                    <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                      {summary.planned}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Inbound
                    </p>
                    <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                      {summary.inbound}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Exceptions
                    </p>
                    <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                      {summary.exceptions}
                    </p>
                  </div>
                </div>
              </div>

              <Tabs
                onValueChange={(value) => setMode(value as ProcurementMode)}
                value={mode}
              >
                <TabsList>
                  {MODE_OPTIONS.map((option) => (
                    <TabsTrigger key={option.value} value={option.value}>
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <section className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
              <div className="border-b border-border/70 px-layout-md py-layout-md">
                <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h3 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                      SKU pressure
                    </h3>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                      Recommendations combine current stock, sellable stock,
                      planned action, and inbound cover.
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Showing{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {visibleRecommendations.length}
                    </span>{" "}
                    of{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {recommendations.length}
                    </span>{" "}
                    rows
                  </p>
                </div>
              </div>

              <div className="divide-y divide-border/70">
                {visibleRecommendations.length === 0 ? (
                  <div className="px-layout-md py-layout-xl">
                    <EmptyState
                      description={getModeEmptyStateCopy(mode).description}
                      title={getModeEmptyStateCopy(mode).title}
                    />
                  </div>
                ) : (
                  visibleRecommendations.map((recommendation) => {
                    const statusCopy = getContinuityStateCopy(
                      recommendation.status,
                    );
                    const isInDraft = draftLines.some(
                      (line) => line.productSkuId === recommendation._id,
                    );
                    const plannedPurchaseOrders =
                      recommendation.plannedPurchaseOrders ?? [];
                    const inboundPurchaseOrders =
                      recommendation.inboundPurchaseOrders ??
                      recommendation.pendingPurchaseOrders;

                    return (
                      <article
                        className="bg-background px-layout-md py-layout-md transition-colors hover:bg-muted/30"
                        key={recommendation._id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-layout-md">
                          <div className="min-w-0 flex-1 space-y-layout-md">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-base font-semibold capitalize text-foreground">
                                  {recommendation.productName}
                                </h4>
                                {recommendation.sku ? (
                                  <span className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    {recommendation.sku}
                                  </span>
                                ) : null}
                                <span
                                  className={`rounded-md border px-2 py-1 text-[11px] font-medium ${statusCopy.badgeClassName}`}
                                >
                                  {statusCopy.label}
                                </span>
                              </div>
                              <p className="max-w-2xl text-sm text-muted-foreground">
                                {recommendation.guidance}
                              </p>
                            </div>

                            <dl className="grid gap-3 sm:grid-cols-3">
                              <div className="rounded-md border border-border/70 bg-surface px-3 py-2">
                                <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                  Available now
                                </dt>
                                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                                  {recommendation.quantityAvailable}
                                </dd>
                              </div>
                              <div className="rounded-md border border-border/70 bg-surface px-3 py-2">
                                <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                  On hand
                                </dt>
                                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                                  {recommendation.inventoryCount}
                                </dd>
                              </div>
                              <div className="rounded-md border border-border/70 bg-surface px-3 py-2">
                                <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                  Suggested order
                                </dt>
                                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                                  {recommendation.suggestedOrderQuantity}
                                </dd>
                              </div>
                            </dl>

                            <div className="flex flex-wrap gap-layout-sm text-sm text-muted-foreground">
                              <span>
                                Planned units:{" "}
                                <span className="font-medium tabular-nums text-foreground">
                                  {recommendation.plannedPurchaseOrderQuantity ??
                                    0}
                                </span>
                              </span>
                              <span>
                                Inbound units:{" "}
                                <span className="font-medium tabular-nums text-foreground">
                                  {recommendation.inboundPurchaseOrderQuantity ??
                                    recommendation.pendingPurchaseOrderQuantity}
                                </span>
                              </span>
                              <span>
                                Next ETA:{" "}
                                <span className="font-medium text-foreground">
                                  {formatOptionalDate(
                                    recommendation.nextExpectedAt,
                                  )}
                                </span>
                              </span>
                            </div>

                            {plannedPurchaseOrders.length > 0 ||
                            inboundPurchaseOrders.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {plannedPurchaseOrders.map((purchaseOrder) => (
                                  <div
                                    className="rounded-md border border-action-workflow-border bg-action-workflow-soft px-2.5 py-1.5 text-xs text-action-workflow"
                                    key={`planned-${purchaseOrder.purchaseOrderId}`}
                                  >
                                    <span>{purchaseOrder.poNumber} · </span>
                                    planned · {purchaseOrder.pendingQuantity}u
                                  </div>
                                ))}
                                {inboundPurchaseOrders.map((purchaseOrder) => (
                                  <div
                                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground"
                                    key={`inbound-${purchaseOrder.purchaseOrderId}`}
                                  >
                                    <span className="text-foreground">
                                      {purchaseOrder.poNumber} ·{" "}
                                    </span>
                                    inbound · {purchaseOrder.pendingQuantity}u ·{" "}
                                    {formatOptionalDate(
                                      purchaseOrder.expectedAt,
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          <Button
                            disabled={
                              isInDraft ||
                              recommendation.suggestedOrderQuantity <= 0
                            }
                            onClick={() => addRecommendationToDraft(recommendation)}
                            size="sm"
                            variant="workflow-soft"
                          >
                            {isInDraft ? "In draft" : "Add to draft"}
                          </Button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </section>

          <aside className="min-h-0 space-y-layout-md overflow-y-auto overscroll-contain pr-1 scrollbar-hide">
            <section className="space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Reorder Draft
                </p>
                <h3 className="mt-1 text-base font-medium text-foreground">
                  Vendor-backed PO draft
                </h3>
                <p className="text-sm text-muted-foreground">
                  Select SKU pressure, confirm quantities, and assign a vendor
                  before creating draft purchase orders.
                </p>
              </div>

              {draftLines.length === 0 ? (
                <EmptyState
                  description="Add a pressure row to start a vendor-backed reorder draft"
                  title="No reorder lines"
                />
              ) : (
                <div className="space-y-3">
                  {draftLines.map((line) => (
                    <article
                      className="space-y-3 rounded-lg border border-border bg-background p-layout-sm"
                      key={line.productSkuId}
                    >
                      <div className="flex items-start justify-between gap-layout-md">
                        <div className="min-w-0">
                          <p className="truncate font-medium capitalize text-foreground">
                            {line.productName}
                          </p>
                          {line.sku ? (
                            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                              {line.sku}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          onClick={() => removeDraftLine(line.productSkuId)}
                          size="sm"
                          variant="ghost"
                        >
                          Remove
                        </Button>
                      </div>
                      <label className="block space-y-1 text-xs font-medium text-muted-foreground">
                        <span>Quantity</span>
                        <Input
                          min={1}
                          onChange={(event) =>
                            updateDraftLine(line.productSkuId, {
                              quantity: Number(event.target.value),
                            })
                          }
                          type="number"
                          value={line.quantity}
                        />
                      </label>
                      <label className="block space-y-1 text-xs font-medium text-muted-foreground">
                        <span>Vendor</span>
                        <select
                          aria-label={`Vendor for ${line.productName}`}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          onChange={(event) =>
                            updateDraftLine(line.productSkuId, {
                              vendorId: event.target.value
                                ? (event.target.value as Id<"vendor">)
                                : undefined,
                            })
                          }
                          value={line.vendorId ?? ""}
                        >
                          <option value="">Choose vendor</option>
                          {vendorOptions.map((vendor) => (
                            <option key={vendor._id} value={vendor._id}>
                              {vendor.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </article>
                  ))}
                </div>
              )}

              <div className="space-y-2 rounded-lg border border-dashed border-border bg-background/70 p-layout-sm">
                <p className="text-sm font-medium text-foreground">
                  Quick add vendor
                </p>
                <div className="flex gap-2">
                  <Input
                    aria-label="Vendor name"
                    onChange={(event) => setQuickAddVendorName(event.target.value)}
                    placeholder="Vendor name"
                    value={quickAddVendorName}
                  />
                  <Button
                    disabled={isCreatingVendor}
                    onClick={handleQuickAddVendor}
                    variant="utility"
                  >
                    Add
                  </Button>
                </div>
              </div>

              <Button
                className="w-full"
                disabled={
                  isCreatingPurchaseOrders ||
                  draftLines.length === 0 ||
                  draftHasMissingVendor ||
                  draftHasInvalidQuantity
                }
                onClick={handleCreateDraftPurchaseOrders}
                variant="workflow"
              >
                Create draft POs
              </Button>
            </section>

            <section className="space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Snapshot
                </p>
                <h3 className="mt-1 text-base font-medium text-foreground">
                  Planning signal
                </h3>
                <p className="text-sm text-muted-foreground">
                  Use the current stock-continuity mix to decide whether to
                  order, advance planned work, receive, or resolve an exception.
                </p>
              </div>

              <div className="divide-y divide-border/70 rounded-lg border border-border bg-background">
                {[
                  ["Needs action", summary.needsAction],
                  ["Planned", summary.planned],
                  ["Inbound", summary.inbound],
                  ["Exceptions", summary.exceptions],
                  ["Resolved", summary.resolved],
                  ["Active vendors", vendorOptions.length],
                  ["Active purchase orders", summary.activePurchaseOrders],
                ].map(([label, value]) => (
                  <div
                    className="flex items-center justify-between gap-layout-md px-4 py-3 text-sm"
                    key={label}
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Purchase Orders
                </p>
                <h3 className="mt-1 text-base font-medium text-foreground">
                  Open procurement flow
                </h3>
                <p className="text-sm text-muted-foreground">
                  Draft, planned, ordered, and partially received purchase
                  orders stay actionable beside SKU pressure.
                </p>
              </div>

              {activePurchaseOrders.length === 0 ? (
                <EmptyState
                  description="Create or advance purchase orders to keep planned and inbound coverage visible beside SKU pressure"
                  title="No active purchase orders"
                />
              ) : (
                <>
                  {visiblePurchaseOrders.map((purchaseOrder) => {
                    const lifecycleActions = getNextLifecycleActions(
                      purchaseOrder.status,
                    );
                    const isUpdating =
                      updatingPurchaseOrderId === purchaseOrder._id;

                    return (
                      <article
                        className="space-y-3 rounded-lg border border-border bg-background p-layout-sm"
                        key={purchaseOrder._id}
                      >
                        <div className="flex items-center justify-between gap-layout-md">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">
                              {purchaseOrder.poNumber}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {purchaseOrder.lineItemCount} lines ·{" "}
                              {purchaseOrder.totalUnits} units
                            </p>
                          </div>
                          <div className="shrink-0 text-right text-xs text-muted-foreground">
                            <p>{formatStatus(purchaseOrder.status)}</p>
                            <p>{formatOptionalDate(purchaseOrder.expectedAt)}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {lifecycleActions.map((action) => (
                            <Button
                              disabled={isUpdating}
                              key={action.nextStatus}
                              onClick={() =>
                                handleUpdatePurchaseOrderStatus(
                                  purchaseOrder,
                                  action.nextStatus,
                                )
                              }
                              size="sm"
                              variant={
                                action.nextStatus === "cancelled"
                                  ? "utility"
                                  : "workflow-soft"
                              }
                            >
                              {action.label}
                            </Button>
                          ))}
                          {canReceivePurchaseOrder(purchaseOrder.status) ? (
                            <Button
                              onClick={() =>
                                setSelectedReceivingOrderId(purchaseOrder._id)
                              }
                              size="sm"
                              variant="workflow-soft"
                            >
                              Receive
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                  {hiddenPurchaseOrderCount > 0 ? (
                    <div className="rounded-lg border border-dashed border-border bg-background/70 px-layout-sm py-layout-sm text-sm text-muted-foreground">
                      Showing 6 of {activePurchaseOrders.length} active purchase
                      orders. Review the purchase-order workspace to inspect the
                      remaining {hiddenPurchaseOrderCount}.
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {selectedReceivingOrderId ? (
              <section className="space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
                <div className="flex items-start justify-between gap-layout-md">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Receiving
                    </p>
                    <h3 className="mt-1 text-base font-medium text-foreground">
                      {receivingPurchaseOrder?.poNumber ?? "Loading PO"}
                    </h3>
                  </div>
                  <Button
                    onClick={() => setSelectedReceivingOrderId(null)}
                    size="sm"
                    variant="ghost"
                  >
                    Close
                  </Button>
                </div>

                {storeId && receivingPurchaseOrder ? (
                  <ReceivingView
                    lineItems={receivingPurchaseOrder.lineItems}
                    purchaseOrderId={receivingPurchaseOrder._id}
                    storeId={storeId}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Loading receiving details...
                  </p>
                )}
              </section>
            ) : null}
          </aside>
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
  const procurementQueryArgs = canQueryProtectedData
    ? { storeId: activeStore!._id }
    : "skip";
  const recommendations = useQuery(
    api.stockOps.replenishment.listReplenishmentRecommendations,
    procurementQueryArgs,
  ) as ReplenishmentRecommendation[] | undefined;
  const purchaseOrders = useQuery(
    api.stockOps.purchaseOrders.listPurchaseOrders,
    procurementQueryArgs,
  ) as ProcurementOrderSummary[] | undefined;
  const vendors = useQuery(
    api.stockOps.vendors.listVendors,
    canQueryProtectedData
      ? { status: "active", storeId: activeStore!._id }
      : "skip",
  ) as VendorSummary[] | undefined;

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
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before procurement planning can load protected stock operations data" />
    );
  }

  return (
    <ProcurementViewContent
      hasActiveStore={Boolean(activeStore)}
      hasFullAdminAccess={hasFullAdminAccess}
      isLoadingPermissions={false}
      isLoadingProcurement={Boolean(
        canQueryProtectedData &&
          (recommendations === undefined ||
            purchaseOrders === undefined ||
            vendors === undefined),
      )}
      purchaseOrders={purchaseOrders ?? []}
      recommendations={recommendations ?? []}
      storeId={activeStore?._id}
      vendors={vendors ?? []}
    />
  );
}
