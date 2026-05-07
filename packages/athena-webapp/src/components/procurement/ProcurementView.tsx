import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { toast } from "sonner";

import View from "../View";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PanelHeader } from "../ui/panel-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import {
  SkuDetailPanel,
  type InventorySnapshotItem,
} from "../operations/StockAdjustmentWorkspace";
import { ReceivingView } from "./ReceivingView";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { runCommand } from "@/lib/errors/runCommand";
import { cn } from "@/lib/utils";
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
  vendorName?: string;
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
  quantityInput: string;
  sku?: string | null;
  vendorId?: Id<"vendor">;
};

type ProcurementViewContentProps = {
  hasActiveStore: boolean;
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isLoadingProcurement: boolean;
  inventoryItems: InventorySnapshotItem[];
  mode?: ProcurementMode;
  onModeChange?: (mode: ProcurementMode) => void;
  onPageChange?: (page: number) => void;
  onSelectedSkuChange?: (sku: string | null, page?: number) => void;
  page?: number;
  purchaseOrders: ProcurementOrderSummary[];
  recommendations: ReplenishmentRecommendation[];
  selectedSku?: string;
  storeId?: Id<"store">;
  vendors: VendorSummary[];
};

const MODE_OPTIONS = [
  { label: "Needs action", value: "needs_action" as const },
  { label: "Planned", value: "planned" as const },
  { label: "Inbound", value: "inbound" as const },
  { label: "Exceptions", value: "exceptions" as const },
  { label: "Handled", value: "resolved" as const },
  { label: "All", value: "all" as const },
] as const;

type ProcurementMode = (typeof MODE_OPTIONS)[number]["value"];

const RECOMMENDATIONS_PER_PAGE = 10;

const UNASSIGNED_VENDOR_VALUE = "unassigned-vendor";

const ACTIVE_PROCUREMENT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "ordered",
  "partially_received",
] as const;

const PLANNED_STATES: ContinuityState[] = ["planned", "stale_planned_action"];

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
        badgeClassName: "border-success/30 bg-success/10 text-success",
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
        badgeClassName: "border-border bg-muted/50 text-muted-foreground",
        label: "Planned",
      };
    case "resolved":
      return {
        badgeClassName: "border-border bg-muted/50 text-foreground",
        label: "Handled",
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

function formatUnitCount(count: number) {
  return `${count} ${count === 1 ? "unit" : "units"}`;
}

function formatLineCount(count: number) {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

function formatPurchaseOrderCount(count: number) {
  return `${count} purchase order${count === 1 ? "" : "s"}`;
}

function getUniquePurchaseOrderReferences(
  recommendation: ReplenishmentRecommendation,
) {
  const purchaseOrderReferencesById = new Map<string, PurchaseOrderReference>();

  [
    ...(recommendation.plannedPurchaseOrders ?? []),
    ...(recommendation.inboundPurchaseOrders ?? []),
    ...recommendation.pendingPurchaseOrders,
  ].forEach((purchaseOrder) => {
    purchaseOrderReferencesById.set(
      String(purchaseOrder.purchaseOrderId),
      purchaseOrder,
    );
  });

  return [...purchaseOrderReferencesById.values()];
}

function getUniqueVendorCount(purchaseOrders: PurchaseOrderReference[]) {
  return new Set(
    purchaseOrders
      .map((purchaseOrder) => purchaseOrder.vendorName)
      .filter(Boolean),
  ).size;
}

function hasPlannedPurchaseOrderCover(
  recommendation: Pick<
    ReplenishmentRecommendation,
    "plannedPurchaseOrderCount" | "plannedPurchaseOrderQuantity"
  >,
) {
  return (
    (recommendation.plannedPurchaseOrderCount ?? 0) > 0 ||
    (recommendation.plannedPurchaseOrderQuantity ?? 0) > 0
  );
}

function hasInboundPurchaseOrderCover(
  recommendation: Pick<
    ReplenishmentRecommendation,
    "inboundPurchaseOrderCount" | "inboundPurchaseOrderQuantity"
  >,
) {
  return (
    (recommendation.inboundPurchaseOrderCount ?? 0) > 0 ||
    (recommendation.inboundPurchaseOrderQuantity ?? 0) > 0
  );
}

function hasMixedPurchaseOrderCover(
  recommendation: Pick<
    ReplenishmentRecommendation,
    | "inboundPurchaseOrderCount"
    | "inboundPurchaseOrderQuantity"
    | "plannedPurchaseOrderCount"
    | "plannedPurchaseOrderQuantity"
  >,
) {
  return (
    hasPlannedPurchaseOrderCover(recommendation) &&
    hasInboundPurchaseOrderCover(recommendation)
  );
}

function getRecommendationStateNote(
  recommendation: ReplenishmentRecommendation,
) {
  const inboundUnits =
    recommendation.inboundPurchaseOrderQuantity ??
    recommendation.pendingPurchaseOrderQuantity;

  if (hasMixedPurchaseOrderCover(recommendation)) {
    return `${formatUnitCount(inboundUnits)} already inbound.`;
  }

  if (PLANNED_STATES.includes(recommendation.status)) {
    return null;
  }

  if (INBOUND_STATES.includes(recommendation.status)) {
    return `Inbound cover: ${formatUnitCount(inboundUnits)}. Track receiving on the open purchase order.`;
  }

  if (recommendation.status === "resolved") {
    if (inboundUnits > 0) {
      return `${formatUnitCount(inboundUnits)} still inbound.`;
    }

    return null;
  }

  return null;
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
    return (
      PLANNED_STATES.includes(recommendation.status) ||
      hasPlannedPurchaseOrderCover(recommendation)
    );
  }

  if (mode === "inbound") {
    return (
      INBOUND_STATES.includes(recommendation.status) ||
      hasInboundPurchaseOrderCover(recommendation)
    );
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

function countRecommendationsForMode(
  recommendations: ReplenishmentRecommendation[],
  mode: ProcurementMode,
) {
  return recommendations.filter((recommendation) =>
    isRecommendationVisible(recommendation, mode),
  ).length;
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
          "No rows have enough stock or purchase order cover right now",
        title: "No handled rows",
      };
    default:
      return {
        description:
          "Current stock and receiving context are not flagging procurement work for this mode",
        title: "Procurement looks clear",
      };
  }
}

function getRecommendationCountCopy(mode: ProcurementMode, count: number) {
  const countCopy = count === 0 ? "No" : String(count);

  switch (mode) {
    case "all":
      return `${countCopy} total stock item${count === 1 ? "" : "s"}`;
    case "exceptions":
      return `${countCopy} exception${count === 1 ? "" : "s"}`;
    case "inbound":
      return `${countCopy} inbound stock item${count === 1 ? "" : "s"}`;
    case "needs_action":
      if (count === 0) return "No action needed";
      return `${countCopy} need${count === 1 ? "s" : ""} action`;
    case "planned":
      return `${countCopy} planned stock item${count === 1 ? "" : "s"}`;
    case "resolved":
      return `${countCopy} handled stock item${count === 1 ? "" : "s"}`;
  }
}

function getNextLifecycleActions(status: PurchaseOrderStatus) {
  switch (status) {
    case "draft":
    case "submitted":
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

function getPurchaseOrderMode(status: PurchaseOrderStatus): ProcurementMode {
  switch (status) {
    case "draft":
    case "submitted":
    case "approved":
      return "planned";
    case "ordered":
    case "partially_received":
      return "inbound";
    case "received":
      return "resolved";
    case "cancelled":
      return "exceptions";
  }
}

function buildVendorOptions(
  vendors: VendorSummary[],
  createdVendors: VendorSummary[],
) {
  const vendorsById = new Map<Id<"vendor">, VendorSummary>();

  [...vendors, ...createdVendors].forEach((vendor) => {
    vendorsById.set(vendor._id, vendor);
  });

  return [...vendorsById.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function sanitizeDraftQuantityInput(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits === "") {
    return "";
  }

  return digits.replace(/^0+(?=\d)/, "");
}

function parseDraftLineQuantity(line: ReorderDraftLine) {
  if (line.quantityInput.trim() === "") {
    return null;
  }

  const quantity = Number(line.quantityInput);

  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

function getRecommendationUrlSku(recommendation: ReplenishmentRecommendation) {
  return recommendation.sku ?? recommendation._id;
}

function matchesRecommendationSku(
  recommendation: ReplenishmentRecommendation,
  selectedSku: string | undefined,
) {
  return (
    selectedSku === recommendation.sku || selectedSku === recommendation._id
  );
}

export function ProcurementViewContent({
  hasActiveStore,
  hasFullAdminAccess,
  isLoadingPermissions,
  isLoadingProcurement,
  inventoryItems,
  mode: controlledMode,
  onModeChange,
  onPageChange,
  onSelectedSkuChange,
  page: controlledPage,
  purchaseOrders,
  recommendations,
  selectedSku,
  storeId,
  vendors,
}: ProcurementViewContentProps) {
  const [localMode, setLocalMode] = useState<ProcurementMode>("needs_action");
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
  const [selectedProductSkuId, setSelectedProductSkuId] =
    useState<Id<"productSku"> | null>(null);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] =
    useState<Id<"purchaseOrder"> | null>(null);
  const [recommendationPage, setRecommendationPage] = useState(1);
  const [scrollTargetProductSkuId, setScrollTargetProductSkuId] =
    useState<Id<"productSku"> | null>(null);
  const stockPressureSectionRef = useRef<HTMLElement | null>(null);
  const recommendationRowRefs = useRef(
    new Map<Id<"productSku">, HTMLElement>(),
  );

  const createVendor = useMutation(api.stockOps.vendors.createVendorCommand);
  const createPurchaseOrder = useMutation(
    api.stockOps.purchaseOrders.createPurchaseOrderCommand,
  );
  const updatePurchaseOrderStatus = useMutation(
    api.stockOps.purchaseOrders.updatePurchaseOrderStatusCommand,
  );
  const advancePurchaseOrderToOrdered = useMutation(
    api.stockOps.purchaseOrders.advancePurchaseOrderToOrderedCommand,
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
  const inventoryItemsById = useMemo(
    () => new Map(inventoryItems.map((item) => [item._id, item])),
    [inventoryItems],
  );
  const mode = controlledMode ?? localMode;
  const controlledSelectedProductSkuId = selectedSku
    ? (recommendations.find((recommendation) =>
        matchesRecommendationSku(recommendation, selectedSku),
      )?._id ?? null)
    : null;
  const activeSelectedProductSkuId =
    selectedSku === undefined
      ? selectedProductSkuId
      : controlledSelectedProductSkuId;
  const activeRecommendationPage = controlledPage ?? recommendationPage;
  const setActiveRecommendationPage = (nextPage: number) => {
    if (controlledPage === undefined) {
      setRecommendationPage(nextPage);
    }

    onPageChange?.(nextPage);
  };
  const selectProductSku = (recommendation: ReplenishmentRecommendation) => {
    setSelectedProductSkuId(recommendation._id);
    onSelectedSkuChange?.(
      getRecommendationUrlSku(recommendation),
      clampedRecommendationPage,
    );
  };
  const handleModeChange = (nextMode: ProcurementMode) => {
    setActiveRecommendationPage(1);

    if (!controlledMode) {
      setLocalMode(nextMode);
    }

    onModeChange?.(nextMode);
  };
  const handleRecommendationPageChange = (nextPage: number) => {
    const boundedPage = Math.min(
      Math.max(nextPage, 1),
      recommendationPageCount,
    );

    setActiveRecommendationPage(boundedPage);
    window.requestAnimationFrame(() => {
      stockPressureSectionRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  };

  const visibleRecommendations = useMemo(
    () =>
      recommendations.filter((recommendation) =>
        isRecommendationVisible(recommendation, mode),
      ),
    [mode, recommendations],
  );
  const recommendationPageCount = Math.max(
    Math.ceil(visibleRecommendations.length / RECOMMENDATIONS_PER_PAGE),
    1,
  );
  const clampedRecommendationPage = Math.min(
    activeRecommendationPage,
    recommendationPageCount,
  );
  const paginatedRecommendations = visibleRecommendations.slice(
    (clampedRecommendationPage - 1) * RECOMMENDATIONS_PER_PAGE,
    clampedRecommendationPage * RECOMMENDATIONS_PER_PAGE,
  );
  const paginationStart =
    visibleRecommendations.length === 0
      ? 0
      : (clampedRecommendationPage - 1) * RECOMMENDATIONS_PER_PAGE + 1;
  const paginationEnd = Math.min(
    clampedRecommendationPage * RECOMMENDATIONS_PER_PAGE,
    visibleRecommendations.length,
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
  const selectedReceivingPurchaseOrder = activePurchaseOrders.find(
    (purchaseOrder) => purchaseOrder._id === selectedReceivingOrderId,
  );
  const selectedInventoryItem = activeSelectedProductSkuId
    ? (inventoryItemsById.get(activeSelectedProductSkuId) ?? null)
    : null;
  const visiblePurchaseOrders = activePurchaseOrders.slice(0, 6);
  const hiddenPurchaseOrderCount = Math.max(
    activePurchaseOrders.length - visiblePurchaseOrders.length,
    0,
  );
  const draftHasMissingVendor = draftLines.some((line) => !line.vendorId);
  const draftHasInvalidQuantity = draftLines.some(
    (line) => parseDraftLineQuantity(line) === null,
  );
  const recommendationCounts: Record<ProcurementMode, number> = {
    all: countRecommendationsForMode(recommendations, "all"),
    exceptions: countRecommendationsForMode(recommendations, "exceptions"),
    inbound: countRecommendationsForMode(recommendations, "inbound"),
    needs_action: countRecommendationsForMode(recommendations, "needs_action"),
    planned: countRecommendationsForMode(recommendations, "planned"),
    resolved: countRecommendationsForMode(recommendations, "resolved"),
  };
  const summary = {
    activePurchaseOrders: activePurchaseOrders.length,
    exceptions: recommendationCounts.exceptions,
    inbound: recommendationCounts.inbound,
    needsAction: recommendationCounts.needs_action,
    planned: recommendationCounts.planned,
    resolved: recommendationCounts.resolved,
  };
  const shouldPrioritizeReorderDraft = draftLines.length > 0;
  const plannedPurchaseOrderActionCount = visibleRecommendations.reduce(
    (count, recommendation) =>
      count +
      getUniquePurchaseOrderReferences(recommendation).filter(
        (purchaseOrder) =>
          getPurchaseOrderMode(purchaseOrder.status) === "planned",
      ).length,
    0,
  );

  useEffect(() => {
    if (
      controlledPage === undefined &&
      activeRecommendationPage > recommendationPageCount
    ) {
      setRecommendationPage(recommendationPageCount);
    }
  }, [activeRecommendationPage, controlledPage, recommendationPageCount]);

  useEffect(() => {
    if (!scrollTargetProductSkuId) return;
    if (
      !visibleRecommendations.some(
        (recommendation) => recommendation._id === scrollTargetProductSkuId,
      )
    ) {
      return;
    }

    window.requestAnimationFrame(() => {
      recommendationRowRefs.current
        .get(scrollTargetProductSkuId)
        ?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      setScrollTargetProductSkuId(null);
    });
  }, [scrollTargetProductSkuId, visibleRecommendations]);

  function getRecommendationForPurchaseOrder(
    purchaseOrderId: Id<"purchaseOrder">,
  ) {
    return recommendations.find((recommendation) =>
      getUniquePurchaseOrderReferences(recommendation).some(
        (purchaseOrder) => purchaseOrder.purchaseOrderId === purchaseOrderId,
      ),
    );
  }

  function handlePurchaseOrderSummaryClick(
    purchaseOrder: ProcurementOrderSummary,
  ) {
    const recommendation = getRecommendationForPurchaseOrder(purchaseOrder._id);
    const nextMode = getPurchaseOrderMode(purchaseOrder.status);

    setSelectedPurchaseOrderId(purchaseOrder._id);
    if (recommendation) {
      selectProductSku(recommendation);
      setScrollTargetProductSkuId(recommendation._id);
    }
    handleModeChange(nextMode);
    if (recommendation) {
      const nextVisibleRecommendations = recommendations.filter(
        (nextRecommendation) =>
          isRecommendationVisible(nextRecommendation, nextMode),
      );
      const recommendationIndex = nextVisibleRecommendations.findIndex(
        (nextRecommendation) => nextRecommendation._id === recommendation._id,
      );

      if (recommendationIndex >= 0) {
        setActiveRecommendationPage(
          Math.floor(recommendationIndex / RECOMMENDATIONS_PER_PAGE) + 1,
        );
      }
    }
  }

  if (isLoadingPermissions) {
    return null;
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
    return null;
  }

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
          quantityInput: String(
            Math.max(1, recommendation.suggestedOrderQuantity),
          ),
          sku: recommendation.sku,
        },
      ];
    });
  }

  function updateDraftLine(
    productSkuId: Id<"productSku">,
    updates: Partial<Pick<ReorderDraftLine, "quantityInput" | "vendorId">>,
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
      toast.error("Add at least one stock item to the reorder draft");
      return;
    }

    if (draftHasMissingVendor) {
      toast.error("Choose a vendor for every reorder line");
      return;
    }

    if (draftHasInvalidQuantity) {
      toast.error(
        "Use quantities greater than zero before creating purchase orders",
      );
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
              orderedQuantity: parseDraftLineQuantity(line)!,
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

      if (mode === "needs_action" && summary.needsAction === 1) {
        handleModeChange("planned");
      }
    } finally {
      setIsCreatingPurchaseOrders(false);
    }
  }

  async function handleUpdatePurchaseOrderStatus(
    purchaseOrder: Pick<ProcurementOrderSummary, "_id" | "poNumber">,
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

      toast.success(
        `${purchaseOrder.poNumber} moved to ${formatStatus(nextStatus)}`,
      );
    } finally {
      setUpdatingPurchaseOrderId(null);
    }
  }

  async function handleAdvancePurchaseOrderToOrdered(
    purchaseOrder: Pick<ProcurementOrderSummary, "_id" | "poNumber">,
  ) {
    setUpdatingPurchaseOrderId(purchaseOrder._id);

    try {
      const result = await runCommand(() =>
        advancePurchaseOrderToOrdered({
          purchaseOrderId: purchaseOrder._id,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast.success(`${purchaseOrder.poNumber} marked ordered`);

      if (mode === "planned" && plannedPurchaseOrderActionCount === 1) {
        handleModeChange("inbound");
      }
    } finally {
      setUpdatingPurchaseOrderId(null);
    }
  }

  return (
    <View hideBorder hideHeaderBottomBorder>
      <FadeIn className="container mx-auto h-full min-h-0 overflow-hidden py-layout-xl">
        <PageWorkspaceGrid className="h-full min-h-0 xl:grid-cols-[minmax(0,1fr)_360px]">
          <PageWorkspaceMain className="min-h-0 overflow-y-auto overscroll-contain pr-1 scrollbar-hide">
            <PageWorkspace>
              <PageLevelHeader
                className="border-b-0 pb-0"
                eyebrow="Stock Ops"
                title="Procurement"
                description="Review stock pressure, create vendor-backed orders, and track receiving in one workspace."
              />

              <div className="flex flex-wrap items-start justify-between gap-layout-xl">
                <div className="max-w-2xl space-y-6">
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
                  onValueChange={(value) =>
                    handleModeChange(value as ProcurementMode)
                  }
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

              <section
                className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface"
                ref={stockPressureSectionRef}
              >
                <div className="border-b border-border/70 px-layout-md py-layout-md">
                  <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h3 className="text-lg font-medium text-foreground">
                        Stock pressure
                      </h3>
                      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                        Review low-stock items and decide what needs a purchase
                        order.
                      </p>
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {getRecommendationCountCopy(
                        mode,
                        visibleRecommendations.length,
                      )}
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
                    paginatedRecommendations.map((recommendation) => {
                      const statusCopy = getContinuityStateCopy(
                        recommendation.status,
                      );
                      const statusLabel = hasMixedPurchaseOrderCover(
                        recommendation,
                      )
                        ? "Planned + inbound"
                        : statusCopy.label;
                      const statusClassName = hasMixedPurchaseOrderCover(
                        recommendation,
                      )
                        ? "border-border bg-muted/50 text-foreground"
                        : statusCopy.badgeClassName;
                      const isInDraft = draftLines.some(
                        (line) => line.productSkuId === recommendation._id,
                      );
                      const stateNote =
                        getRecommendationStateNote(recommendation);
                      const rowNote =
                        stateNote ??
                        (PLANNED_STATES.includes(recommendation.status)
                          ? null
                          : recommendation.guidance);
                      const hasSuggestedOrder =
                        recommendation.suggestedOrderQuantity > 0;
                      const canAddAnotherPurchaseOrder =
                        PLANNED_STATES.includes(recommendation.status) ||
                        INBOUND_STATES.includes(recommendation.status) ||
                        hasPlannedPurchaseOrderCover(recommendation) ||
                        hasInboundPurchaseOrderCover(recommendation);
                      const showDraftAction =
                        isInDraft ||
                        hasSuggestedOrder ||
                        canAddAnotherPurchaseOrder;
                      const draftActionLabel = isInDraft
                        ? "In draft"
                        : canAddAnotherPurchaseOrder
                          ? "Add purchase order"
                          : "Add to draft";
                      const plannedUnits =
                        recommendation.plannedPurchaseOrderQuantity ?? 0;
                      const linkedPurchaseOrders =
                        getUniquePurchaseOrderReferences(recommendation);
                      const linkedVendorCount =
                        getUniqueVendorCount(linkedPurchaseOrders);
                      const inboundUnits =
                        recommendation.inboundPurchaseOrderQuantity ??
                        recommendation.pendingPurchaseOrderQuantity;
                      const nextEta = formatOptionalDate(
                        recommendation.nextExpectedAt,
                      );

                      return (
                        <article
                          aria-pressed={
                            activeSelectedProductSkuId === recommendation._id
                          }
                          className={cn(
                            "bg-background px-layout-md py-layout-lg text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            activeSelectedProductSkuId === recommendation._id ||
                              linkedPurchaseOrders.some(
                                (purchaseOrder) =>
                                  purchaseOrder.purchaseOrderId ===
                                  selectedPurchaseOrderId,
                              )
                              ? "bg-muted/30 hover:bg-muted/40"
                              : undefined,
                          )}
                          key={recommendation._id}
                          onClick={() => selectProductSku(recommendation)}
                          ref={(element) => {
                            if (element) {
                              recommendationRowRefs.current.set(
                                recommendation._id,
                                element,
                              );
                              return;
                            }

                            recommendationRowRefs.current.delete(
                              recommendation._id,
                            );
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") {
                              return;
                            }

                            event.preventDefault();
                            selectProductSku(recommendation);
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="flex flex-col gap-layout-lg lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 flex-1 space-y-layout-lg">
                              <div className="space-y-3">
                                <div className="min-w-0 space-y-3">
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
                                      className={`rounded-md border px-2 py-1 text-[11px] font-medium ${statusClassName}`}
                                    >
                                      {statusLabel}
                                    </span>
                                    {linkedPurchaseOrders.length > 0 ? (
                                      <span className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground/70">
                                        {formatPurchaseOrderCount(
                                          linkedPurchaseOrders.length,
                                        )}
                                        {linkedVendorCount > 0
                                          ? ` · ${linkedVendorCount} vendor${
                                              linkedVendorCount === 1 ? "" : "s"
                                            }`
                                          : ""}
                                      </span>
                                    ) : null}
                                  </div>
                                  {rowNote ? (
                                    <p className="max-w-3xl text-sm text-muted-foreground">
                                      {rowNote}
                                    </p>
                                  ) : null}
                                </div>
                              </div>

                              <dl className="grid gap-layout-lg text-sm sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
                                <div className="space-y-3">
                                  <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    Stock now
                                  </dt>
                                  <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                    <span className="text-lg font-semibold tabular-nums text-foreground">
                                      {recommendation.inventoryCount}
                                    </span>
                                    <span className="text-muted-foreground">
                                      on hand
                                    </span>
                                    <span
                                      className="text-border"
                                      aria-hidden="true"
                                    >
                                      /
                                    </span>
                                    <span className="font-medium tabular-nums text-foreground">
                                      {recommendation.quantityAvailable}
                                    </span>
                                    <span className="text-muted-foreground">
                                      available
                                    </span>
                                  </dd>
                                </div>
                                <div className="space-y-3 border-t border-border/70 pt-layout-md sm:border-l sm:border-t-0 sm:pl-layout-lg sm:pt-0">
                                  <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    Cover
                                  </dt>
                                  <dd className="text-foreground">
                                    <span className="font-medium tabular-nums">
                                      {plannedUnits}
                                    </span>{" "}
                                    planned,{" "}
                                    <span className="font-medium tabular-nums">
                                      {inboundUnits}
                                    </span>{" "}
                                    inbound
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · ETA{" "}
                                    </span>
                                    <span className="font-medium">
                                      {nextEta}
                                    </span>
                                  </dd>
                                </div>
                              </dl>

                              {linkedPurchaseOrders.length > 0 ? (
                                <div className="space-y-3">
                                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    Purchase orders
                                  </div>
                                  <div className="space-y-2">
                                    {linkedPurchaseOrders.map(
                                      (purchaseOrder) => {
                                        const lifecycleActions =
                                          getNextLifecycleActions(
                                            purchaseOrder.status,
                                          );
                                        const isReceivingActive =
                                          selectedReceivingOrderId ===
                                          purchaseOrder.purchaseOrderId;
                                        const isUpdatingPurchaseOrder =
                                          updatingPurchaseOrderId ===
                                          purchaseOrder.purchaseOrderId;

                                        return (
                                          <div
                                            className={cn(
                                              "flex flex-col gap-layout-sm rounded-md border bg-surface px-3 py-2 transition-colors sm:flex-row sm:items-center sm:justify-between",
                                              isReceivingActive
                                                ? "border-action-workflow-border bg-action-workflow-soft/40"
                                                : selectedPurchaseOrderId ===
                                                    purchaseOrder.purchaseOrderId
                                                  ? "border-action-workflow-border bg-action-workflow-soft/30"
                                                  : "border-border",
                                            )}
                                            key={purchaseOrder.purchaseOrderId}
                                          >
                                            <div className="min-w-0 space-y-1">
                                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                                <span className="font-medium capitalize text-foreground">
                                                  {purchaseOrder.vendorName ??
                                                    "Vendor not set"}
                                                </span>
                                                <span className="text-xs font-medium text-muted-foreground">
                                                  {purchaseOrder.poNumber}
                                                </span>
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                {formatUnitCount(
                                                  purchaseOrder.pendingQuantity,
                                                )}{" "}
                                                ·{" "}
                                                {formatStatus(
                                                  purchaseOrder.status,
                                                )}
                                              </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2 sm:justify-end">
                                              {lifecycleActions.map(
                                                (action) => (
                                                  <Button
                                                    disabled={
                                                      isUpdatingPurchaseOrder
                                                    }
                                                    key={action.nextStatus}
                                                    onClick={(event) => {
                                                      event.stopPropagation();
                                                      if (
                                                        action.nextStatus ===
                                                        "ordered"
                                                      ) {
                                                        void handleAdvancePurchaseOrderToOrdered(
                                                          {
                                                            _id: purchaseOrder.purchaseOrderId,
                                                            poNumber:
                                                              purchaseOrder.poNumber,
                                                          },
                                                        );
                                                        return;
                                                      }

                                                      void handleUpdatePurchaseOrderStatus(
                                                        {
                                                          _id: purchaseOrder.purchaseOrderId,
                                                          poNumber:
                                                            purchaseOrder.poNumber,
                                                        },
                                                        action.nextStatus,
                                                      );
                                                    }}
                                                    size="sm"
                                                    variant={
                                                      action.nextStatus ===
                                                      "cancelled"
                                                        ? "utility"
                                                        : "workflow-soft"
                                                    }
                                                  >
                                                    {action.label}
                                                  </Button>
                                                ),
                                              )}
                                              {canReceivePurchaseOrder(
                                                purchaseOrder.status,
                                              ) ? (
                                                <Button
                                                  aria-current={
                                                    isReceivingActive
                                                      ? "true"
                                                      : undefined
                                                  }
                                                  className="w-[92px]"
                                                  disabled={isReceivingActive}
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setSelectedReceivingOrderId(
                                                      purchaseOrder.purchaseOrderId,
                                                    );
                                                  }}
                                                  size="sm"
                                                  variant={
                                                    isReceivingActive
                                                      ? "utility"
                                                      : "workflow-soft"
                                                  }
                                                >
                                                  {isReceivingActive
                                                    ? "Receiving"
                                                    : "Receive"}
                                                </Button>
                                              ) : null}
                                            </div>
                                          </div>
                                        );
                                      },
                                    )}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            {showDraftAction ? (
                              <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                                <Button
                                  className="w-[160px] self-start"
                                  disabled={isInDraft}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    addRecommendationToDraft(recommendation);
                                  }}
                                  size="sm"
                                  variant={
                                    canAddAnotherPurchaseOrder
                                      ? "utility"
                                      : "workflow-soft"
                                  }
                                >
                                  {draftActionLabel}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
                {visibleRecommendations.length > RECOMMENDATIONS_PER_PAGE ? (
                  <div className="flex border-t border-border/70 px-layout-md py-layout-sm text-sm">
                    <div className="ml-auto flex flex-col gap-layout-sm sm:flex-row sm:items-center sm:gap-layout-md">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-muted-foreground">
                          Showing {paginationStart}-{paginationEnd} of{" "}
                          {visibleRecommendations.length}
                        </span>
                        <span className="text-muted-foreground">
                          Page {clampedRecommendationPage} of{" "}
                          {recommendationPageCount}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          className="hidden h-8 w-8 p-0 lg:flex"
                          disabled={clampedRecommendationPage === 1}
                          onClick={() => handleRecommendationPageChange(1)}
                          variant="outline"
                        >
                          <span className="sr-only">Go to first page</span>
                          <ChevronsLeft />
                        </Button>
                        <Button
                          className="h-8 w-8 p-0"
                          disabled={clampedRecommendationPage === 1}
                          onClick={() =>
                            handleRecommendationPageChange(
                              Math.max(1, clampedRecommendationPage - 1),
                            )
                          }
                          variant="outline"
                        >
                          <span className="sr-only">Go to previous page</span>
                          <ChevronLeft />
                        </Button>
                        <Button
                          className="h-8 w-8 p-0"
                          disabled={
                            clampedRecommendationPage ===
                            recommendationPageCount
                          }
                          onClick={() =>
                            handleRecommendationPageChange(
                              Math.min(
                                recommendationPageCount,
                                clampedRecommendationPage + 1,
                              ),
                            )
                          }
                          variant="outline"
                        >
                          <span className="sr-only">Go to next page</span>
                          <ChevronRight />
                        </Button>
                        <Button
                          className="hidden h-8 w-8 p-0 lg:flex"
                          disabled={
                            clampedRecommendationPage ===
                            recommendationPageCount
                          }
                          onClick={() =>
                            handleRecommendationPageChange(
                              recommendationPageCount,
                            )
                          }
                          variant="outline"
                        >
                          <span className="sr-only">Go to last page</span>
                          <ChevronsRight />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            </PageWorkspace>
          </PageWorkspaceMain>

          <PageWorkspaceRail className="flex min-h-0 flex-col gap-layout-lg overflow-y-auto overscroll-contain pr-1 scrollbar-hide">
            {selectedInventoryItem ? (
              <section
                className={cn(
                  "space-y-layout-xl rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface",
                  shouldPrioritizeReorderDraft ? "order-1" : undefined,
                )}
              >
                <SkuDetailPanel activeInventoryItem={selectedInventoryItem} />
              </section>
            ) : null}

            {selectedReceivingOrderId ? (
              <section
                className={cn(
                  "space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface",
                  shouldPrioritizeReorderDraft ? "order-4" : undefined,
                )}
              >
                <div className="flex items-start justify-between gap-layout-md">
                  <PanelHeader
                    description={
                      receivingPurchaseOrder?.vendor?.name
                        ? receivingPurchaseOrder.poNumber
                        : undefined
                    }
                    eyebrow="Receiving"
                    title={
                      receivingPurchaseOrder?.vendor?.name ? (
                        <span className="capitalize">
                          {receivingPurchaseOrder.vendor.name}
                        </span>
                      ) : (
                        (receivingPurchaseOrder?.poNumber ??
                        selectedReceivingPurchaseOrder?.poNumber ??
                        "Purchase order")
                      )
                    }
                  />
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
                    onReceived={() => setSelectedReceivingOrderId(null)}
                    purchaseOrderId={receivingPurchaseOrder._id}
                    storeId={storeId}
                  />
                ) : (
                  <div
                    aria-label="Loading receiving details"
                    className="space-y-layout-md"
                  >
                    <Skeleton className="h-5 w-28" />
                    <div className="space-y-3 rounded-md border border-border bg-surface px-3 py-3">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-44" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <div className="flex items-end justify-between gap-layout-md border-t border-border/70 pt-3">
                        <div className="space-y-2">
                          <Skeleton className="h-3 w-24" />
                          <Skeleton className="h-3 w-36" />
                        </div>
                        <Skeleton className="h-9 w-24" />
                      </div>
                    </div>
                    <Skeleton className="h-10 w-full" />
                  </div>
                )}
              </section>
            ) : null}

            {activePurchaseOrders.length > 0 ? (
              <section
                className={cn(
                  "space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface",
                  shouldPrioritizeReorderDraft ? "order-3" : undefined,
                )}
              >
                <PanelHeader
                  description="Purchase orders that may not be visible in the current stock list."
                  eyebrow="Purchase Orders"
                  title="Open purchase orders"
                />

                <div className="space-y-layout-sm">
                  {visiblePurchaseOrders.map((purchaseOrder) => {
                    return (
                      <article
                        aria-pressed={
                          selectedPurchaseOrderId === purchaseOrder._id
                        }
                        className={cn(
                          "rounded-lg border bg-background p-layout-md text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedPurchaseOrderId === purchaseOrder._id
                            ? "border-action-workflow-border bg-action-workflow-soft/30"
                            : "border-border",
                        )}
                        key={purchaseOrder._id}
                        onClick={() =>
                          handlePurchaseOrderSummaryClick(purchaseOrder)
                        }
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }

                          event.preventDefault();
                          handlePurchaseOrderSummaryClick(purchaseOrder);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex items-start justify-between gap-layout-md">
                          <div className="min-w-0 space-y-1.5">
                            <p className="truncate text-sm font-medium text-foreground/80">
                              {purchaseOrder.poNumber}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatLineCount(purchaseOrder.lineItemCount)} ·{" "}
                              {formatUnitCount(purchaseOrder.totalUnits)}
                            </p>
                          </div>
                          <dl className="shrink-0 space-y-2 text-right text-xs">
                            <div>
                              <dt className="sr-only">Status</dt>
                              <dd className="font-medium text-foreground">
                                {formatStatus(purchaseOrder.status)}
                              </dd>
                            </div>
                            <div>
                              <dt className="sr-only">Expected date</dt>
                              <dd className="text-muted-foreground">
                                {formatOptionalDate(purchaseOrder.expectedAt)}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {hiddenPurchaseOrderCount > 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-background/70 px-layout-sm py-layout-sm text-sm text-muted-foreground">
                    Showing 6 of {activePurchaseOrders.length} active purchase
                    orders. Use the stock list to review the remaining{" "}
                    {hiddenPurchaseOrderCount}.
                  </p>
                ) : null}
              </section>
            ) : null}

            <section
              className={cn(
                "space-y-layout-lg rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface",
                shouldPrioritizeReorderDraft ? "order-2" : undefined,
              )}
            >
              <PanelHeader
                description="Select low-stock items, confirm quantities, and assign a vendor before creating draft purchase orders."
                eyebrow="Reorder Draft"
                title="Vendor-backed purchase order draft"
              />

              {draftLines.length === 0 ? (
                <EmptyState
                  description="Add a pressure row to start a vendor-backed reorder draft"
                  title="No reorder lines"
                />
              ) : (
                <div className="space-y-4">
                  {draftLines.map((line) => (
                    <article
                      className="space-y-4 rounded-lg border border-border/80 bg-surface p-layout-sm"
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
                          inputMode="numeric"
                          min={1}
                          onChange={(event) =>
                            updateDraftLine(line.productSkuId, {
                              quantityInput: sanitizeDraftQuantityInput(
                                event.target.value,
                              ),
                            })
                          }
                          pattern="[0-9]*"
                          type="text"
                          value={line.quantityInput}
                        />
                      </label>
                      <label className="block space-y-1 text-xs font-medium text-muted-foreground">
                        <span>Vendor</span>
                        <Select
                          onValueChange={(value) =>
                            updateDraftLine(line.productSkuId, {
                              vendorId:
                                value === UNASSIGNED_VENDOR_VALUE
                                  ? undefined
                                  : (value as Id<"vendor">),
                            })
                          }
                          value={line.vendorId ?? UNASSIGNED_VENDOR_VALUE}
                        >
                          <SelectTrigger
                            aria-label={`Vendor for ${line.productName}`}
                            className="[&>span]:capitalize"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              disabled
                              value={UNASSIGNED_VENDOR_VALUE}
                            >
                              Choose vendor
                            </SelectItem>
                            {vendorOptions.map((vendor) => (
                              <SelectItem
                                className="capitalize"
                                key={vendor._id}
                                value={vendor._id}
                              >
                                {vendor.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                    </article>
                  ))}
                </div>
              )}

              <div className="space-y-2 rounded-lg border border-dashed border-border/80 bg-surface p-layout-sm">
                <p className="text-sm font-medium text-foreground">
                  Quick add vendor
                </p>
                <div className="flex gap-2">
                  <Input
                    aria-label="Vendor name"
                    onChange={(event) =>
                      setQuickAddVendorName(event.target.value)
                    }
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
                Create draft purchase orders
              </Button>
            </section>

            <section
              className={cn(
                "space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface",
                shouldPrioritizeReorderDraft ? "order-5" : undefined,
              )}
            >
              <PanelHeader
                description="Use the current stock-continuity mix to decide whether to order, advance planned work, receive, or resolve an exception."
                eyebrow="Snapshot"
                title="Planning signal"
              />

              <div className="divide-y divide-border/70 rounded-lg border border-border bg-background">
                {[
                  ["Needs action", summary.needsAction],
                  ["Planned", summary.planned],
                  ["Inbound", summary.inbound],
                  ["Exceptions", summary.exceptions],
                  ["Handled", summary.resolved],
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
          </PageWorkspaceRail>
        </PageWorkspaceGrid>
      </FadeIn>
    </View>
  );
}

export function ProcurementView({
  mode,
  onModeChange,
  onPageChange,
  onSelectedSkuChange,
  page,
  selectedSku,
}: {
  mode?: ProcurementMode;
  onModeChange?: (mode: ProcurementMode) => void;
  onPageChange?: (page: number) => void;
  onSelectedSkuChange?: (sku: string | null, page?: number) => void;
  page?: number;
  selectedSku?: string;
} = {}) {
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
  const inventoryItems = useQuery(
    api.stockOps.adjustments.listInventorySnapshot,
    procurementQueryArgs,
  ) as InventorySnapshotItem[] | undefined;
  const vendors = useQuery(
    api.stockOps.vendors.listVendors,
    canQueryProtectedData
      ? { status: "active", storeId: activeStore!._id }
      : "skip",
  ) as VendorSummary[] | undefined;

  if (isLoadingAccess) {
    return null;
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
          inventoryItems === undefined ||
          purchaseOrders === undefined ||
          vendors === undefined),
      )}
      inventoryItems={inventoryItems ?? []}
      mode={mode}
      onModeChange={onModeChange}
      onPageChange={onPageChange}
      onSelectedSkuChange={onSelectedSkuChange}
      page={page}
      purchaseOrders={purchaseOrders ?? []}
      recommendations={recommendations ?? []}
      selectedSku={selectedSku}
      storeId={activeStore?._id}
      vendors={vendors ?? []}
    />
  );
}
