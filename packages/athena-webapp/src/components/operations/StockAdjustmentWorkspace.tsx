import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  Camera,
  ExternalLink,
  Info,
  Package,
  PackagePlus,
  RotateCcw,
  ScanBarcode,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  CYCLE_COUNT_REASON_CODE,
  MANUAL_STOCK_ADJUSTMENT_REASON_CODES,
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
  hasHighStockAdjustmentVariance,
  requiresStockAdjustmentApproval,
  summarizeStockAdjustmentLineItems,
} from "~/shared/stockAdjustment";
import type { Id } from "~/convex/_generated/dataModel";
import { useAuth } from "~/src/hooks/useAuth";
import { usePOSQuickAddProductSku } from "~/src/hooks/usePOSProducts";
import { getProductName } from "~/src/lib/productUtils";
import { getOrigin } from "~/src/lib/navigationUtils";
import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";
import {
  normalizeSkuSearchQuery,
  scoreSkuSearchTerms,
} from "@/lib/stockOps/skuSearch";
import type { NormalizedCommandResult } from "../../lib/errors/runCommand";
import { presentCommandToast } from "../../lib/errors/presentCommandToast";
import { DataTableColumnHeader } from "../base/table/data-table-column-header";
import { GenericDataTable } from "../base/table/data-table";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import {
  QuickAddProductDialog,
  type QuickAddAttachBarcodePayload,
  type QuickAddProductSubmitPayload,
} from "../product/QuickAddProductDialog";
import { normalizeQuickAddInitialLookupCode } from "../product/quickAddProductDialogUtils";
import { SkuSearchFilterBar } from "../stock-ops/SkuSearchFilterBar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

export type InventorySnapshotItem = {
  _id: Id<"productSku">;
  barcode?: string | null;
  colorName?: string | null;
  checkoutReservedQuantity?: number;
  durableQuantityAvailable?: number;
  imageUrl?: string | null;
  inventoryCount: number;
  length?: number | null;
  netPrice?: number | null;
  posReservedQuantity?: number;
  price?: number | null;
  productCategory?: string | null;
  productCategoryId?: Id<"category"> | null;
  productCategorySlug?: string | null;
  productId?: Id<"product"> | null;
  productName: string;
  productSubcategory?: string | null;
  productSubcategoryId?: Id<"subcategory"> | null;
  productSubcategorySlug?: string | null;
  quantityAvailable: number;
  reservedQuantity?: number;
  size?: string | null;
  sku?: string | null;
  stockAdjustmentBlockedMessage?: string | null;
  stockAdjustmentBlockedReason?:
    | "pos_pending_checkout"
    | "provisional_import"
    | null;
};

export type SubmitStockAdjustmentArgs = {
  adjustmentType: "manual" | "cycle_count";
  lineItems: Array<
    | {
        productSkuId: Id<"productSku">;
        quantityDelta: number;
      }
    | {
        countedQuantity: number;
        productSkuId: Id<"productSku">;
      }
  >;
  notes?: string;
  reasonCode: string;
  storeId: Id<"store">;
  submissionKey: string;
};

export type StockAdjustmentType = "manual" | "cycle_count";
export type StockAdjustmentAvailabilityFilter =
  | "all"
  | "all_available"
  | "changed"
  | "unavailable";

export type StockAdjustmentSearchState = {
  availability?: StockAdjustmentAvailabilityFilter;
  category?: string;
  mode?: StockAdjustmentType;
  o?: string;
  page?: number;
  query?: string;
  sku?: string;
};

export type StockAdjustmentSearchPatch = Partial<StockAdjustmentSearchState>;

export type CycleCountDraftLine = {
  productSkuId: Id<"productSku">;
  baselineInventoryCount: number;
  baselineAvailableCount: number;
  countedQuantity: number;
  isDirty: boolean;
  staleStatus?: "current" | "stale";
  currentInventoryCount?: number;
  currentAvailableCount?: number;
};

export type CycleCountDraftState = {
  _id: Id<"cycleCountDraft">;
  status: "open" | "submitted" | "discarded";
  scopeKey: string;
  changedLineCount: number;
  staleLineCount: number;
  lastSavedAt?: number;
  lines: CycleCountDraftLine[];
};

export type CycleCountDraftSummary = {
  changedLineCount: number;
  draftCount: number;
  largestAbsoluteDelta: number;
  lastSavedAt?: number;
  netQuantityDelta: number;
  scopeKeys: string[];
  scopeCount: number;
  staleLineCount: number;
};

type SaveCycleCountDraftLineArgs = {
  countedQuantity: number;
  productSkuId: Id<"productSku">;
};

type StockAdjustmentWorkspaceContentProps = {
  cycleCountDraft?: CycleCountDraftState | null;
  cycleCountDraftSummary?: CycleCountDraftSummary | null;
  inventoryItems: InventorySnapshotItem[];
  isCycleCountDraftSaving?: boolean;
  isSubmitting: boolean;
  onDiscardCycleCountDraft?: () => Promise<NormalizedCommandResult<unknown>>;
  onSearchStateChange?: (patch: StockAdjustmentSearchPatch) => void;
  onSaveCycleCountDraftLine?: (
    args: SaveCycleCountDraftLineArgs,
  ) => Promise<NormalizedCommandResult<unknown>>;
  onRefreshCycleCountDraftLineBaseline?: (args: {
    productSkuId: Id<"productSku">;
  }) => Promise<NormalizedCommandResult<unknown>>;
  onSubmitBatch: (
    args: SubmitStockAdjustmentArgs,
  ) => Promise<NormalizedCommandResult<unknown>>;
  onSubmitCycleCountDraft?: (args: {
    notes?: string;
  }) => Promise<NormalizedCommandResult<unknown>>;
  searchState?: StockAdjustmentSearchState;
  showBackButton?: boolean;
  storeId?: Id<"store">;
};

type StockAdjustmentRow = {
  inputValue: string;
  inventoryItem: InventorySnapshotItem;
  isBlocked: boolean;
  isEdited: boolean;
  quantityDelta: number;
  submittedLineItem: SubmitStockAdjustmentArgs["lineItems"][number] | null;
};

type CycleCountSubmissionOutcome = "applied" | "review_required" | null;
type StockAdjustmentFilterState = {
  availability: StockAdjustmentAvailabilityFilter;
  category: string;
  query: string;
};

type StockAdjustmentCategoryFilterOption = {
  itemCount: number;
  key: string;
  label: string;
};

const MANUAL_REASON_LABELS: Record<
  (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number],
  string
> = {
  correction: "Correction",
  damage: "Damage",
  shrinkage: "Shrinkage",
  vendor_return: "Vendor return",
};

const ALL_CATEGORY_FILTER_KEY = "__all_categories";
const UNCATEGORIZED_SCOPE_KEY = "__uncategorized";
const INVENTORY_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const STOCK_ADJUSTMENT_AVAILABILITY_FILTER_LABELS: Record<
  StockAdjustmentAvailabilityFilter,
  string
> = {
  all: "All SKUs",
  all_available: "All available",
  changed: "Changed SKUs",
  unavailable: "Reserved",
};

function getCountScopeLabel(key: string) {
  return key === UNCATEGORIZED_SCOPE_KEY ? "Uncategorized" : key;
}

function getStockAdjustmentCategoryKey(item: InventorySnapshotItem) {
  return item.productCategory?.trim() || UNCATEGORIZED_SCOPE_KEY;
}

function getStockAdjustmentCategoryLabel(key: string) {
  return getCountScopeLabel(key);
}

function isStockAdjustmentBlocked(item: InventorySnapshotItem) {
  return Boolean(item.stockAdjustmentBlockedReason);
}

function buildManualDrafts(inventoryItems: InventorySnapshotItem[]) {
  return Object.fromEntries(inventoryItems.map((item) => [item._id, ""]));
}

function buildCycleCountDrafts(
  inventoryItems: InventorySnapshotItem[],
  draftLines: CycleCountDraftLine[] = [],
) {
  const draftLineMap = new Map(
    draftLines.map((line) => [line.productSkuId, line]),
  );

  return Object.fromEntries(
    inventoryItems.map((item) => [
      item._id,
      String(
        draftLineMap.get(item._id)?.countedQuantity ?? item.inventoryCount,
      ),
    ]),
  );
}

function buildStockAdjustmentSubmissionKey(
  adjustmentType: StockAdjustmentType,
) {
  return `stock-adjustment-${adjustmentType}-${Date.now().toString(36)}`;
}

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function cleanInventoryMetadataValue(value?: string | null) {
  const nextValue = value?.trim();
  if (!nextValue || nextValue.toLowerCase() === "null") return undefined;
  return nextValue;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatInventoryNumber(value: number) {
  return INVENTORY_NUMBER_FORMATTER.format(value).toLowerCase();
}

function formatCategoryList(labels: string[]) {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return labels.join(" and ");

  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function getInventoryItemDisplayName(item: InventorySnapshotItem) {
  return getProductName(item) || item.sku || String(item._id);
}

function getReservationLabels(item: InventorySnapshotItem) {
  const checkoutReservedQuantity = item.checkoutReservedQuantity ?? 0;
  const posReservedQuantity = item.posReservedQuantity ?? 0;
  const knownReservedQuantity = checkoutReservedQuantity + posReservedQuantity;
  const fallbackReservedQuantity = Math.max(
    0,
    (item.reservedQuantity ?? 0) - knownReservedQuantity,
  );

  return [
    checkoutReservedQuantity > 0
      ? {
          title: `${formatInventoryNumber(checkoutReservedQuantity)} reserved in active checkout sessions`,
          value: `${formatInventoryNumber(checkoutReservedQuantity)} checkout`,
        }
      : null,
    posReservedQuantity > 0
      ? {
          title: `${formatInventoryNumber(posReservedQuantity)} reserved in POS sessions`,
          value: `${formatInventoryNumber(posReservedQuantity)} POS`,
        }
      : null,
    fallbackReservedQuantity > 0
      ? {
          title: `${formatInventoryNumber(fallbackReservedQuantity)} reserved`,
          value: `${formatInventoryNumber(fallbackReservedQuantity)} reserved`,
        }
      : null,
  ].filter(
    (label): label is { title: string; value: string } => label !== null,
  );
}

function formatReservationSourceSummary(args: {
  checkoutReservedUnits: number;
  fallbackReservedUnits: number;
  posReservedUnits: number;
}) {
  return [
    args.checkoutReservedUnits > 0
      ? `${formatInventoryNumber(
          args.checkoutReservedUnits,
        )} reserved in active checkout sessions.`
      : null,
    args.posReservedUnits > 0
      ? `${formatInventoryNumber(args.posReservedUnits)} reserved in POS sessions.`
      : null,
    args.fallbackReservedUnits > 0
      ? `${formatInventoryNumber(args.fallbackReservedUnits)} reserved.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function getSkuDetailEntries(item: InventorySnapshotItem) {
  const reservationLabels = getReservationLabels(item);
  const operationalPrice = getInventoryItemOperationalPrice(item);
  const sku = cleanInventoryMetadataValue(item.sku);
  const barcode = cleanInventoryMetadataValue(item.barcode);
  const productCategory = cleanInventoryMetadataValue(item.productCategory);
  const size = cleanInventoryMetadataValue(item.size);
  const colorName = cleanInventoryMetadataValue(item.colorName);

  return [
    sku ? { label: "SKU", value: sku } : null,
    barcode ? { label: "Barcode", value: barcode } : null,
    typeof operationalPrice === "number"
      ? {
          label: "Price",
          value: formatStoredCurrencyAmount("GHS", operationalPrice, {
            revealMinorUnits: true,
          }),
        }
      : null,
    productCategory ? { label: "Category", value: productCategory } : null,
    size ? { label: "Size", value: size } : null,
    item.length !== null && item.length !== undefined
      ? { label: "Length", value: `${item.length}"` }
      : null,
    colorName ? { label: "Color", value: colorName } : null,
    reservationLabels.length > 0
      ? {
          label: "Reserved",
          value: reservationLabels.map((entry) => entry.title).join(", "),
        }
      : null,
  ].filter(
    (entry): entry is { label: string; value: string } =>
      entry !== null && entry.value.trim().length > 0,
  );
}

function getInventoryItemOperationalPrice(item: InventorySnapshotItem) {
  return typeof item.netPrice === "number" ? item.netPrice : item.price;
}

function formatInventoryItemPriceLabel(item: InventorySnapshotItem) {
  const operationalPrice = getInventoryItemOperationalPrice(item);

  return typeof operationalPrice === "number"
    ? `Price ${formatStoredCurrencyAmount("GHS", operationalPrice, {
        revealMinorUnits: true,
      })}`
    : "Price pending";
}

function scoreStockAdjustmentSearchRow(row: StockAdjustmentRow, query: string) {
  if (!query) return 1;

  return scoreSkuSearchTerms(getStockAdjustmentSearchTerms(row), query);
}

function getStockAdjustmentSearchTerms(row: StockAdjustmentRow) {
  const item = row.inventoryItem;
  return [
    String(item._id),
    getInventoryItemDisplayName(item),
    cleanInventoryMetadataValue(item.sku),
    cleanInventoryMetadataValue(item.barcode),
    cleanInventoryMetadataValue(item.colorName),
    cleanInventoryMetadataValue(item.productCategory),
    cleanInventoryMetadataValue(item.productSubcategory),
    cleanInventoryMetadataValue(item.size),
    item.length === null || item.length === undefined
      ? undefined
      : String(item.length),
  ];
}

function rowMatchesCategoryFilter(row: StockAdjustmentRow, category: string) {
  return (
    category === ALL_CATEGORY_FILTER_KEY ||
    getStockAdjustmentCategoryKey(row.inventoryItem) === category
  );
}

function getStockAdjustmentAvailabilityFilterOptions() {
  return (
    Object.keys(
      STOCK_ADJUSTMENT_AVAILABILITY_FILTER_LABELS,
    ) as StockAdjustmentAvailabilityFilter[]
  ).map((value) => ({
    label: STOCK_ADJUSTMENT_AVAILABILITY_FILTER_LABELS[value],
    value,
  }));
}

const STOCK_ADJUSTMENT_AVAILABILITY_FILTER_OPTIONS =
  getStockAdjustmentAvailabilityFilterOptions();

function rowMatchesAvailabilityFilter(
  row: StockAdjustmentRow,
  availability: StockAdjustmentAvailabilityFilter,
) {
  if (availability === "all") return true;
  if (availability === "changed") return row.isEdited;

  const item = row.inventoryItem;
  const isAllAvailable = item.inventoryCount === item.quantityAvailable;

  return availability === "all_available" ? isAllAvailable : !isAllAvailable;
}

export function SkuDetailPanel({
  activeInventoryItem,
}: {
  activeInventoryItem: InventorySnapshotItem | null;
}) {
  const activeInventoryItemDetails = activeInventoryItem
    ? getSkuDetailEntries(activeInventoryItem)
    : [];

  return (
    <div className="space-y-layout-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        SKU detail
      </p>
      <div className="overflow-hidden rounded-md bg-muted/30">
        {activeInventoryItem?.imageUrl ? (
          <img
            alt={getInventoryItemDisplayName(activeInventoryItem)}
            className="aspect-square w-full object-cover"
            src={activeInventoryItem.imageUrl}
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-muted">
            <Package
              aria-label="SKU image unavailable"
              className="h-8 w-8 text-muted-foreground"
            />
          </div>
        )}
      </div>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          {activeInventoryItem ? (
            <p className="line-clamp-2 text-sm font-medium text-foreground">
              {getInventoryItemDisplayName(activeInventoryItem)}
            </p>
          ) : null}
          {activeInventoryItem?.productId ? (
            <Link
              aria-label={`View product detail for ${getInventoryItemDisplayName(
                activeInventoryItem,
              )}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              params={(prev) => ({
                ...prev,
                orgUrlSlug: prev.orgUrlSlug!,
                productSlug: activeInventoryItem.productId!,
                storeUrlSlug: prev.storeUrlSlug!,
              })}
              search={{
                o: getOrigin(),
                variant: activeInventoryItem?.sku || undefined,
              }}
              to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
            >
              View
              <ExternalLink className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
        {activeInventoryItemDetails.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-layout-md gap-y-layout-md pt-layout-xs text-xs">
            {activeInventoryItemDetails.map((entry) => (
              <div className="min-w-0" key={entry.label}>
                <dt className="font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {entry.label}
                </dt>
                <dd className="mt-0.5 truncate text-foreground capitalize">
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}

type StockScannerDebugSnapshot = {
  currentTime: string;
  error: string;
  event: string;
  events: string[];
  mediaDevices: string;
  readyState: string;
  secureContext: string;
  srcObject: string;
  time: string;
  tracks: string;
  userAgent: string;
  video: string;
};

type FrameCapture = {
  grabFrame: () => Promise<ImageBitmap>;
};

type FrameCaptureConstructor = new (track: MediaStreamTrack) => FrameCapture;

const buildEmptyScannerDebugSnapshot = (): StockScannerDebugSnapshot => ({
  currentTime: "n/a",
  error: "none",
  event: "idle",
  events: [],
  mediaDevices: "unknown",
  readyState: "n/a",
  secureContext: "unknown",
  srcObject: "none",
  time: "",
  tracks: "none",
  userAgent: "unknown",
  video: "none",
});

function formatScannerError(error: unknown) {
  if (error instanceof DOMException) {
    return `${error.name}: ${error.message || "DOMException"}`;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error ?? "none");
}

function isAppleTouchSafari() {
  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor;
  const isSafari =
    /Safari/i.test(userAgent) &&
    !/Chrome|CriOS|FxiOS|EdgiOS|Android/i.test(userAgent);
  const isTouchAppleDevice =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  return isSafari && /Apple/i.test(vendor) && isTouchAppleDevice;
}

function resetScannerVideoSource(node: HTMLVideoElement) {
  node.pause();
  node.srcObject = null;
  node.removeAttribute("src");

  if (!/jsdom/i.test(navigator.userAgent)) {
    node.load();
  }
}

function getFrameCaptureConstructor() {
  return (window as unknown as { ImageCapture?: FrameCaptureConstructor })
    .ImageCapture;
}

function StockAdjustmentBarcodeScannerDialog({
  onBarcodeDetected,
  onOpenChange,
  open,
}: {
  onBarcodeDetected: (barcode: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const barcodePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
    null,
  );
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerRunIdRef = useRef(0);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const hasDetectedBarcodeRef = useRef(false);
  const hasAutoStartedScannerRef = useRef(false);
  const [, setScannerDebug] = useState<StockScannerDebugSnapshot>(() =>
    buildEmptyScannerDebugSnapshot(),
  );
  const [scannerState, setScannerState] = useState<
    | "idle"
    | "requesting"
    | "starting"
    | "scanning"
    | "decoding_photo"
    | "unsupported"
    | "blocked"
    | "error"
  >("idle");

  const captureScannerDebug = useCallback((event: string, error?: unknown) => {
    const video = videoRef.current;
    const videoStream =
      typeof MediaStream !== "undefined" &&
      video?.srcObject instanceof MediaStream
        ? video.srcObject
        : null;
    const stream = activeStreamRef.current ?? videoStream;
    const tracks =
      stream
        ?.getTracks()
        .map((track) => {
          const settings =
            typeof track.getSettings === "function" ? track.getSettings() : {};
          const size =
            settings.width && settings.height
              ? ` ${settings.width}x${settings.height}`
              : "";

          return `${track.kind}:${track.readyState}:${
            track.enabled ? "enabled" : "disabled"
          }${size}`;
        })
        .join(", ") || "none";

    setScannerDebug((current) => {
      const time = new Date().toLocaleTimeString();
      const isHeartbeat = event === "diagnostic heartbeat";
      const formattedError = error ? formatScannerError(error) : undefined;

      return {
        currentTime: video ? video.currentTime.toFixed(2) : "n/a",
        error: formattedError ?? current.error,
        event: isHeartbeat ? current.event : event,
        events: isHeartbeat
          ? current.events
          : [`${time} ${event}`, ...current.events].slice(0, 14),
        mediaDevices: navigator.mediaDevices ? "available" : "missing",
        readyState: video ? String(video.readyState) : "n/a",
        secureContext: String(window.isSecureContext),
        srcObject: video?.srcObject ? "attached" : "none",
        time,
        tracks,
        userAgent: navigator.userAgent,
        video: video ? `${video.videoWidth}x${video.videoHeight}` : "none",
      };
    });
  }, []);

  const ensureVideoPreviewElement = useCallback(() => {
    if (videoRef.current) {
      return videoRef.current;
    }

    const host = videoHostRef.current;

    if (!host) {
      return null;
    }

    canvasRef.current = null;

    const node = document.createElement("video");

    node.setAttribute("aria-label", "Barcode camera preview");
    node.className = "h-full w-full object-cover";
    node.autoplay = true;
    node.defaultMuted = true;
    node.muted = true;
    node.playsInline = true;
    node.controls = false;
    node.setAttribute("autoplay", "");
    node.setAttribute("disablepictureinpicture", "");
    node.setAttribute("muted", "");
    node.setAttribute("playsinline", "");
    node.setAttribute("webkit-playsinline", "");

    host.replaceChildren(node);
    videoRef.current = node;
    setVideoElement(node);
    setScannerDebug((current) => ({
      ...current,
      event: "video ref attached",
      events: [
        `${new Date().toLocaleTimeString()} video ref attached`,
        ...current.events,
      ].slice(0, 14),
    }));

    return node;
  }, []);

  const ensureCanvasPreviewElement = useCallback(() => {
    if (canvasRef.current) {
      return canvasRef.current;
    }

    const host = videoHostRef.current;

    if (!host) {
      return null;
    }

    if (videoRef.current) {
      resetScannerVideoSource(videoRef.current);
      videoRef.current = null;
      setVideoElement(null);
    }

    const node = document.createElement("canvas");

    node.setAttribute("aria-label", "Barcode camera frame preview");
    node.className = "h-full w-full object-cover";

    host.replaceChildren(node);
    canvasRef.current = node;
    setScannerDebug((current) => ({
      ...current,
      event: "canvas ref attached",
      events: [
        `${new Date().toLocaleTimeString()} canvas ref attached`,
        ...current.events,
      ].slice(0, 14),
    }));

    return node;
  }, []);

  const removeVideoPreviewElement = useCallback(() => {
    const node = videoRef.current;

    if (node) {
      resetScannerVideoSource(node);
      node.remove();
    }

    videoRef.current = null;
    canvasRef.current?.remove();
    canvasRef.current = null;
    setVideoElement(null);
    setScannerDebug((current) => ({
      ...current,
      event: "video ref cleared",
      events: [
        `${new Date().toLocaleTimeString()} video ref cleared`,
        ...current.events,
      ].slice(0, 14),
    }));
  }, []);

  const stopScanner = useCallback(() => {
    scannerRunIdRef.current += 1;
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    activeStreamRef.current?.getTracks().forEach((track) => track.stop());
    activeStreamRef.current = null;
    hasDetectedBarcodeRef.current = false;

    const video = videoRef.current;

    if (video) {
      resetScannerVideoSource(video);
    }
    canvasRef.current = null;
    captureScannerDebug("scanner stopped");
  }, [captureScannerDebug]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      ensureVideoPreviewElement();
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [ensureVideoPreviewElement, open]);

  useEffect(() => {
    if (!open) {
      setScannerDebug(buildEmptyScannerDebugSnapshot());
      return;
    }

    if (!videoElement) {
      captureScannerDebug("waiting for video element");
      return;
    }

    const videoEvents = [
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "playing",
      "pause",
      "stalled",
      "suspend",
      "error",
    ] as const;
    const handleVideoEvent = (event: Event) => {
      captureScannerDebug(
        `video:${event.type}`,
        videoElement.error
          ? `media error ${videoElement.error.code}`
          : undefined,
      );
    };
    const intervalId = window.setInterval(
      () => captureScannerDebug("diagnostic heartbeat"),
      1500,
    );

    videoEvents.forEach((eventName) =>
      videoElement.addEventListener(eventName, handleVideoEvent),
    );
    captureScannerDebug("diagnostics attached");

    return () => {
      window.clearInterval(intervalId);
      videoEvents.forEach((eventName) =>
        videoElement.removeEventListener(eventName, handleVideoEvent),
      );
    };
  }, [captureScannerDebug, open, videoElement]);

  const startScanner = useCallback(async () => {
    if (!open) {
      return;
    }

    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
      navigator.mediaDevices,
    );

    if (!getUserMedia) {
      setScannerState("unsupported");
      captureScannerDebug("getUserMedia unavailable");
      return;
    }

    stopScanner();
    const videoElement = ensureVideoPreviewElement();

    if (!videoElement) {
      setScannerState("idle");
      captureScannerDebug("no video element");
      return;
    }

    const runId = scannerRunIdRef.current + 1;
    scannerRunIdRef.current = runId;
    const isCancelled = () => scannerRunIdRef.current !== runId;

    type CameraAttempt = {
      constraints: MediaStreamConstraints;
      label: string;
    };

    const baseCameraAttempts: CameraAttempt[] = [
      {
        constraints: {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
          },
        },
        label: "environment camera",
      },
      {
        constraints: {
          audio: false,
          video: true,
        },
        label: "default camera",
      },
    ];
    const touchSafariCameraAttempts: CameraAttempt[] = [
      {
        constraints: {
          audio: false,
          video: {
            facingMode: { exact: "environment" },
          },
        },
        label: "touch safari rear camera",
      },
      {
        constraints: {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
          },
        },
        label: "touch safari environment camera",
      },
      {
        constraints: {
          audio: false,
          video: true,
        },
        label: "touch safari default camera",
      },
    ];

    const buildCameraAttempts = async () => {
      const enumerateDevices = navigator.mediaDevices?.enumerateDevices?.bind(
        navigator.mediaDevices,
      );

      if (!enumerateDevices) {
        return baseCameraAttempts;
      }

      try {
        const devices = await enumerateDevices();
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput" && device.deviceId,
        );

        captureScannerDebug(`video devices: ${videoDevices.length}`);

        const sortedVideoDevices = [...videoDevices].sort((left, right) => {
          const leftLabel = left.label.toLowerCase();
          const rightLabel = right.label.toLowerCase();
          const leftLooksRear =
            leftLabel.includes("back") ||
            leftLabel.includes("rear") ||
            leftLabel.includes("environment");
          const rightLooksRear =
            rightLabel.includes("back") ||
            rightLabel.includes("rear") ||
            rightLabel.includes("environment");

          if (leftLooksRear === rightLooksRear) {
            return 0;
          }

          return leftLooksRear ? -1 : 1;
        });

        const deviceAttempts = sortedVideoDevices.map((device, index) => ({
          constraints: {
            audio: false,
            video: {
              deviceId: { exact: device.deviceId },
            },
          },
          label: `device ${index + 1}${device.label ? ` ${device.label}` : ""}`,
        }));

        return [...deviceAttempts, ...baseCameraAttempts];
      } catch (error) {
        captureScannerDebug("video device enumeration failed", error);
        return baseCameraAttempts;
      }
    };

    const getVideoElementStream = () =>
      typeof MediaStream !== "undefined" &&
      videoElement.srcObject instanceof MediaStream
        ? videoElement.srcObject
        : null;

    const getVideoTracks = (stream: MediaStream) =>
      typeof stream.getVideoTracks === "function"
        ? stream.getVideoTracks()
        : stream.getTracks().filter((track) => track.kind === "video");

    const stopVideoElementStream = () => {
      const stream = getVideoElementStream();

      stream?.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;

      if (stream && videoElement.srcObject === stream) {
        videoElement.srcObject = null;
      }
    };

    const waitForVideoSurfacePaint = () =>
      new Promise<void>((resolve) => {
        const animationFrame =
          window.requestAnimationFrame ??
          ((callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 16));

        animationFrame(() => {
          animationFrame(() => resolve());
        });
      });

    const prepareVideoElement = (targetVideoElement: HTMLVideoElement) => {
      targetVideoElement.autoplay = true;
      targetVideoElement.defaultMuted = true;
      targetVideoElement.muted = true;
      targetVideoElement.playsInline = true;
      targetVideoElement.controls = false;
      targetVideoElement.setAttribute("autoplay", "");
      targetVideoElement.setAttribute("disablepictureinpicture", "");
      targetVideoElement.setAttribute("muted", "");
      targetVideoElement.setAttribute("playsinline", "");
      targetVideoElement.setAttribute("webkit-playsinline", "");
    };

    const waitForVideoPreview = (
      stream: MediaStream,
      label: string,
      options: { deferInitialPlay?: boolean } = {},
    ) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const removers: Array<() => void> = [];

        const cleanup = () => {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
          }
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          }
          removers.splice(0).forEach((remove) => remove());
        };

        const settle = (callback: () => void) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          callback();
        };

        const fail = (error: Error) => {
          settle(() => {
            stopVideoElementStream();
            reject(error);
          });
        };

        const isPreviewReady = () =>
          videoElement.videoWidth > 0 &&
          videoElement.videoHeight > 0 &&
          videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          !videoElement.paused;

        const completeIfReady = () => {
          if (isPreviewReady()) {
            settle(resolve);
          }
        };

        const requestPlay = async (source: string) => {
          try {
            captureScannerDebug(`video play requested: ${label} ${source}`);
            await videoElement.play();
            captureScannerDebug(`video play resolved: ${label} ${source}`);
          } catch (error) {
            captureScannerDebug(`video play rejected: ${label}`, error);
          } finally {
            completeIfReady();
          }
        };

        getVideoTracks(stream).forEach((track) => {
          const handleTrackEnded = () => {
            captureScannerDebug(
              `${label} track:${track.kind}:${track.readyState}`,
            );
            window.setTimeout(() => {
              if (settled) {
                return;
              }

              completeIfReady();

              if (!settled) {
                const hasLiveVideoTrack = getVideoTracks(stream).some(
                  (streamTrack) => streamTrack.readyState !== "ended",
                );

                if (!hasLiveVideoTrack) {
                  fail(
                    new Error(
                      `${label} video track ended before preview started`,
                    ),
                  );
                }
              }
            }, 1000);
          };

          track.addEventListener("ended", handleTrackEnded);
          removers.push(() =>
            track.removeEventListener("ended", handleTrackEnded),
          );
        });

        const previewEvents = [
          "loadedmetadata",
          "loadeddata",
          "canplay",
          "playing",
          "resize",
        ] as const;
        const handlePreviewEvent = (event: Event) => {
          captureScannerDebug(`${label} preview:${event.type}`);
          completeIfReady();

          if (!settled && event.type !== "playing") {
            void requestPlay(event.type);
          }
        };

        previewEvents.forEach((eventName) => {
          videoElement.addEventListener(eventName, handlePreviewEvent);
          removers.push(() =>
            videoElement.removeEventListener(eventName, handlePreviewEvent),
          );
        });

        const intervalId = window.setInterval(completeIfReady, 100);
        const timeoutId = window.setTimeout(() => {
          fail(new Error(`${label} camera preview did not start`));
        }, 15000);

        prepareVideoElement(videoElement);
        activeStreamRef.current = stream;
        videoElement.srcObject = stream;
        captureScannerDebug(`media stream attached: ${label}`);

        if (options.deferInitialPlay) {
          captureScannerDebug(`video play deferred: ${label}`);
          void waitForVideoSurfacePaint().then(() => {
            if (!settled) {
              void requestPlay("after paint");
            }
          });
        } else {
          void requestPlay("initial");
        }
      });

    const startFrameCaptureScanner = async (
      stream: MediaStream,
      label: string,
      reader: BrowserMultiFormatReader,
    ) => {
      const FrameCaptureApi = getFrameCaptureConstructor();
      const canvasElement = ensureCanvasPreviewElement();
      const videoTrack = getVideoTracks(stream)[0];
      const context = canvasElement?.getContext("2d");

      if (!FrameCaptureApi || !canvasElement || !videoTrack || !context) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Camera frame capture is not available");
      }

      activeStreamRef.current = stream;
      const capture = new FrameCaptureApi(videoTrack);
      let isStopped = false;
      let scanTimeoutId: number | undefined;
      let hasStarted = false;
      let isFramePending = false;

      const controls: IScannerControls = {
        stop: () => {
          isStopped = true;
          if (scanTimeoutId !== undefined) {
            window.clearTimeout(scanTimeoutId);
          }
          stream.getTracks().forEach((track) => track.stop());
          activeStreamRef.current = null;
        },
      };

      const drawFrame = (frame: ImageBitmap) => {
        if (
          canvasElement.width !== frame.width ||
          canvasElement.height !== frame.height
        ) {
          canvasElement.width = frame.width;
          canvasElement.height = frame.height;
        }

        context.drawImage(frame, 0, 0, frame.width, frame.height);
        frame.close();
      };

      const scanNextFrame = async () => {
        if (isStopped || isCancelled()) {
          controls.stop();
          return;
        }

        if (isFramePending) {
          return;
        }

        isFramePending = true;

        try {
          const frame = await capture.grabFrame();

          drawFrame(frame);

          if (!hasStarted) {
            hasStarted = true;
            setScannerState("scanning");
            captureScannerDebug(`frame scanner scanning: ${label}`);
          }

          try {
            const result = reader.decodeFromCanvas(canvasElement);
            const decodedValue = result.getText().trim();

            if (decodedValue && !hasDetectedBarcodeRef.current) {
              hasDetectedBarcodeRef.current = true;
              captureScannerDebug("barcode decoded");
              controls.stop();
              onBarcodeDetected(decodedValue);
              onOpenChange(false);
              return;
            }
          } catch {
            // Most frames do not contain a readable barcode. Keep scanning.
          }
        } catch (error) {
          controls.stop();
          if (!hasStarted) {
            throw error instanceof Error
              ? error
              : new Error("Camera frame capture failed");
          }

          captureScannerDebug("frame scanner error", error);
          setScannerState("error");
          return;
        } finally {
          isFramePending = false;
        }

        scanTimeoutId = window.setTimeout(scanNextFrame, 180);
      };

      scannerControlsRef.current = controls;
      captureScannerDebug(`frame scanner opening: ${label}`);
      await scanNextFrame();
    };

    setScannerState("requesting");

    let lastStartupError: unknown;
    const isTouchSafariScanner = isAppleTouchSafari();
    if (isTouchSafariScanner) {
      captureScannerDebug("using touch safari camera startup");
    }
    const cameraAttempts = isTouchSafariScanner
      ? touchSafariCameraAttempts
      : await buildCameraAttempts();

    for (const [attemptIndex, cameraAttempt] of cameraAttempts.entries()) {
      captureScannerDebug(`requesting media: ${cameraAttempt.label}`);

      try {
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 180,
          tryPlayVideoTimeout: 15000,
        });
        setScannerState("starting");

        if (isTouchSafariScanner) {
          const frameCaptureApi = getFrameCaptureConstructor();

          if (frameCaptureApi) {
            captureScannerDebug(
              `requesting frame camera stream: ${cameraAttempt.label}`,
            );
            const stream = await getUserMedia(cameraAttempt.constraints);

            captureScannerDebug(
              `frame camera stream granted: ${cameraAttempt.label}`,
            );
            await startFrameCaptureScanner(stream, cameraAttempt.label, reader);
            return;
          }

          captureScannerDebug("frame capture unavailable");
          captureScannerDebug(`decoder opening: ${cameraAttempt.label}`);

          const controls = await reader.decodeFromConstraints(
            cameraAttempt.constraints,
            videoElement,
            (result, _error, controls) => {
              const decodedValue = result?.getText().trim();

              if (decodedValue && !hasDetectedBarcodeRef.current) {
                hasDetectedBarcodeRef.current = true;
                captureScannerDebug("barcode decoded");
                controls.stop();
                onBarcodeDetected(decodedValue);
                onOpenChange(false);
              }
            },
          );

          if (isCancelled()) {
            controls.stop();
            return;
          }

          scannerControlsRef.current = controls;
          setScannerState("scanning");
          captureScannerDebug(`decoder scanning: ${cameraAttempt.label}`);
          return;
        }

        captureScannerDebug(`requesting camera stream: ${cameraAttempt.label}`);

        const stream = await getUserMedia(cameraAttempt.constraints);
        captureScannerDebug(`media stream granted: ${cameraAttempt.label}`);

        await waitForVideoPreview(stream, cameraAttempt.label, {
          deferInitialPlay: isTouchSafariScanner,
        });

        if (isCancelled()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        let isScanningStopped = false;
        let scanTimeoutId: number | undefined;
        const controls: IScannerControls = {
          stop: () => {
            isScanningStopped = true;
            if (scanTimeoutId !== undefined) {
              window.clearTimeout(scanTimeoutId);
            }
            stream.getTracks().forEach((track) => track.stop());
            if (videoElement.srcObject === stream) {
              videoElement.pause();
              videoElement.srcObject = null;
            }
          },
        };
        const scanNextFrame = () => {
          if (isScanningStopped || isCancelled()) {
            controls.stop();
            return;
          }

          if (
            videoElement.videoWidth > 0 &&
            videoElement.videoHeight > 0 &&
            videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ) {
            try {
              const result = reader.decode(videoElement);
              const decodedValue = result.getText().trim();

              if (decodedValue && !hasDetectedBarcodeRef.current) {
                hasDetectedBarcodeRef.current = true;
                captureScannerDebug("barcode decoded");
                controls.stop();
                onBarcodeDetected(decodedValue);
                onOpenChange(false);
                return;
              }
            } catch {
              // Most frames do not contain a readable barcode. Keep scanning.
            }
          }

          scanTimeoutId = window.setTimeout(scanNextFrame, 180);
        };

        scannerControlsRef.current = controls;
        setScannerState("scanning");
        captureScannerDebug(`decoder scanning: ${cameraAttempt.label}`);
        scanNextFrame();
        return;
      } catch (error) {
        lastStartupError = error;

        if (isCancelled()) {
          return;
        }

        captureScannerDebug(
          `scanner startup error: ${cameraAttempt.label}`,
          error,
        );

        if (
          error instanceof DOMException &&
          (error.name === "NotAllowedError" ||
            error.name === "PermissionDeniedError")
        ) {
          setScannerState("blocked");
          return;
        }

        if (attemptIndex < cameraAttempts.length - 1) {
          captureScannerDebug(`retrying camera after ${cameraAttempt.label}`);
          continue;
        }
      }
    }

    if (!isCancelled()) {
      captureScannerDebug("scanner startup exhausted", lastStartupError);
      setScannerState("error");
    }
  }, [
    captureScannerDebug,
    ensureCanvasPreviewElement,
    ensureVideoPreviewElement,
    onBarcodeDetected,
    onOpenChange,
    open,
    stopScanner,
  ]);

  useEffect(() => {
    if (!open || hasAutoStartedScannerRef.current) {
      return;
    }

    hasAutoStartedScannerRef.current = true;
    void startScanner();
  }, [open, startScanner]);

  const handleBarcodePhotoSelected = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setScannerState("decoding_photo");
    captureScannerDebug("barcode photo selected");

    const imageUrl = URL.createObjectURL(file);

    try {
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(imageUrl);
      const decodedValue = result.getText().trim();

      if (!decodedValue) {
        throw new Error("Barcode photo did not contain a readable barcode");
      }

      captureScannerDebug("barcode photo decoded");
      onBarcodeDetected(decodedValue);
      onOpenChange(false);
    } catch (error) {
      captureScannerDebug("barcode photo decode failed", error);
      setScannerState("error");
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };

  useEffect(() => {
    if (open) {
      return;
    }

    stopScanner();
    removeVideoPreviewElement();
    hasAutoStartedScannerRef.current = false;
    setScannerState("idle");
    setScannerDebug(buildEmptyScannerDebugSnapshot());
  }, [open, removeVideoPreviewElement, stopScanner]);

  const scannerMessage =
    scannerState === "requesting"
      ? "Requesting camera access..."
      : scannerState === "idle"
        ? "Starting camera..."
        : scannerState === "starting"
          ? "Starting camera..."
          : scannerState === "decoding_photo"
            ? "Reading barcode photo..."
            : scannerState === "scanning"
              ? "Scanning barcode..."
              : scannerState === "unsupported"
                ? "Camera barcode scanning is not available in this browser."
                : scannerState === "blocked"
                  ? "Camera access is blocked for this site."
                  : scannerState === "error"
                    ? "Could not read from the camera."
                    : "Camera scanner ready.";
  const canStartScanner =
    scannerState === "error" || scannerState === "blocked";
  const canUsePhotoScanner =
    scannerState === "idle" ||
    scannerState === "error" ||
    scannerState === "blocked" ||
    scannerState === "unsupported";
  const shouldShowControlOverlay =
    scannerState !== "scanning" && scannerState !== "starting";

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-layout-md sm:flex sm:items-center sm:justify-center"
      role="dialog"
    >
      <section className="relative mx-auto grid w-full max-w-md gap-4 rounded-lg border border-border bg-background p-6 shadow-lg">
        <button
          aria-label="Close"
          className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          onClick={() => onOpenChange(false)}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
        <header className="space-y-1.5 pr-8">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Scan barcode
          </h2>
          <p className="text-sm text-muted-foreground">
            Use the device camera to fill the stock search field.
          </p>
        </header>
        <div className="space-y-layout-md">
          <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
            <div
              aria-label="Barcode camera preview"
              className="absolute inset-0"
              ref={videoHostRef}
            />
            <input
              accept="image/*"
              aria-label="Capture barcode photo"
              capture="environment"
              className="sr-only"
              onChange={handleBarcodePhotoSelected}
              ref={barcodePhotoInputRef}
              type="file"
            />
            {shouldShowControlOverlay ? (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/95 px-layout-md text-center text-sm text-muted-foreground">
                <div className="space-y-3">
                  <p>{scannerMessage}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {canStartScanner ? (
                      <Button
                        onClick={() => void startScanner()}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        <ScanBarcode className="h-4 w-4" />
                        Try again
                      </Button>
                    ) : null}
                    {canUsePhotoScanner ? (
                      <Button
                        onClick={() => barcodePhotoInputRef.current?.click()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Camera className="h-4 w-4" />
                        Take photo
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : scannerState === "starting" ? (
              <div className="pointer-events-none absolute inset-x-layout-md bottom-layout-md rounded-md border border-border bg-background/85 px-3 py-2 text-center text-sm text-muted-foreground shadow-sm">
                {scannerMessage}
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-x-layout-xl top-1/2 h-px -translate-y-1/2 bg-primary/80 shadow-[0_0_18px_hsl(var(--primary))]" />
            )}
          </div>
          {scannerState === "scanning" ? (
            <p className="text-sm text-muted-foreground">{scannerMessage}</p>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function StockAdjustmentWorkspaceContent({
  cycleCountDraft,
  cycleCountDraftSummary,
  inventoryItems,
  isCycleCountDraftSaving = false,
  isSubmitting,
  onDiscardCycleCountDraft,
  onRefreshCycleCountDraftLineBaseline,
  onSearchStateChange,
  onSaveCycleCountDraftLine,
  onSubmitBatch,
  onSubmitCycleCountDraft,
  searchState,
  showBackButton = false,
  storeId,
}: StockAdjustmentWorkspaceContentProps) {
  const { user } = useAuth();
  const quickAddProductSku = usePOSQuickAddProductSku();
  const [adjustmentType, setAdjustmentType] = useState<StockAdjustmentType>(
    searchState?.mode ?? "cycle_count",
  );
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildStockAdjustmentSubmissionKey(searchState?.mode ?? "cycle_count"),
  );
  const [reasonCode, setReasonCode] = useState<
    (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number]
  >(MANUAL_STOCK_ADJUSTMENT_REASON_CODES[0]);
  const [notes, setNotes] = useState("");
  const [manualDeltas, setManualDeltas] = useState<Record<string, string>>(() =>
    buildManualDrafts(inventoryItems),
  );
  const [cycleCounts, setCycleCounts] = useState<Record<string, string>>(() =>
    buildCycleCountDrafts(inventoryItems, cycleCountDraft?.lines),
  );
  const [activeInventoryItemId, setActiveInventoryItemId] =
    useState<Id<"productSku"> | null>(
      (searchState?.sku as Id<"productSku"> | undefined) ??
        inventoryItems[0]?._id ??
        null,
    );
  const [filters, setFilters] = useState<StockAdjustmentFilterState>({
    availability: searchState?.availability ?? "all",
    category: searchState?.category?.trim() || ALL_CATEGORY_FILTER_KEY,
    query: searchState?.query ?? "",
  });
  const [cycleCountSubmissionOutcome, setCycleCountSubmissionOutcome] =
    useState<CycleCountSubmissionOutcome>(null);
  const [pendingCycleCountSaveCount, setPendingCycleCountSaveCount] =
    useState(0);
  const pendingCycleCountSavePromisesRef = useRef<Promise<void>[]>([]);
  const locallyEditedCycleCountItemIdsRef = useRef(new Set<Id<"productSku">>());
  const [staleDraftLines, setStaleDraftLines] = useState<
    Array<{
      productSkuId: Id<"productSku">;
      productName?: string | null;
      sku?: string | null;
      currentInventoryCount: number;
      baselineInventoryCount: number;
    }>
  >([]);

  useEffect(() => {
    if (!searchState?.mode || searchState.mode === adjustmentType) return;

    setAdjustmentType(searchState.mode);
    setSubmissionKey(buildStockAdjustmentSubmissionKey(searchState.mode));
    if (searchState.mode === "manual") {
      setCycleCountSubmissionOutcome(null);
    }
  }, [adjustmentType, searchState?.mode]);

  useEffect(() => {
    if (searchState?.sku === undefined) return;

    setActiveInventoryItemId(
      searchState.sku
        ? (searchState.sku as Id<"productSku">)
        : (inventoryItems[0]?._id ?? null),
    );
  }, [inventoryItems, searchState?.sku]);

  useEffect(() => {
    setFilters((current) => ({
      availability: searchState?.availability ?? current.availability,
      category:
        searchState?.category === undefined
          ? current.category
          : searchState.category.trim() || ALL_CATEGORY_FILTER_KEY,
      query:
        searchState?.query === undefined ? current.query : searchState.query,
    }));
  }, [searchState?.availability, searchState?.category, searchState?.query]);

  const handleSelectInventoryItem = useCallback(
    (itemId: Id<"productSku"> | null) => {
      setActiveInventoryItemId(itemId);

      const selectedItem = inventoryItems.find((item) => item._id === itemId);
      const selectedCategory = selectedItem
        ? getStockAdjustmentCategoryKey(selectedItem)
        : ALL_CATEGORY_FILTER_KEY;
      const shouldMoveCategoryFilter =
        selectedItem &&
        filters.category !== ALL_CATEGORY_FILTER_KEY &&
        selectedCategory !== filters.category;

      if (shouldMoveCategoryFilter) {
        setFilters((current) => ({
          ...current,
          category: selectedCategory,
        }));
        onSearchStateChange?.({
          category: selectedCategory,
          page: 1,
          sku: itemId ?? undefined,
        });
        return;
      }

      onSearchStateChange?.({ sku: itemId ?? undefined });
    },
    [filters.category, inventoryItems, onSearchStateChange],
  );

  useEffect(() => {
    setManualDeltas(buildManualDrafts(inventoryItems));
    setCycleCounts((current) => {
      const serverCounts = buildCycleCountDrafts(
        inventoryItems,
        cycleCountDraft?.lines,
      );

      return Object.fromEntries(
        inventoryItems.map((item) => [
          item._id,
          locallyEditedCycleCountItemIdsRef.current.has(item._id)
            ? (current[item._id] ?? serverCounts[item._id])
            : serverCounts[item._id],
        ]),
      );
    });
  }, [cycleCountDraft?.lines, inventoryItems]);

  useEffect(() => {
    if (
      activeInventoryItemId &&
      inventoryItems.some((item) => item._id === activeInventoryItemId)
    ) {
      return;
    }

    setActiveInventoryItemId(inventoryItems[0]?._id ?? null);
  }, [activeInventoryItemId, inventoryItems]);

  const cycleCountDraftLineMap = useMemo(
    () =>
      new Map(
        (cycleCountDraft?.lines ?? []).map((line) => [line.productSkuId, line]),
      ),
    [cycleCountDraft?.lines],
  );
  const saveCycleCountDraftValue = useCallback(
    async (productSkuId: Id<"productSku">, value: string) => {
      if (adjustmentType !== "cycle_count" || !onSaveCycleCountDraftLine) {
        return;
      }

      const parsedCount = value.trim() === "" ? Number.NaN : Number(value);
      if (!Number.isInteger(parsedCount) || parsedCount < 0) {
        return;
      }

      const savePromise = onSaveCycleCountDraftLine({
        countedQuantity: parsedCount,
        productSkuId,
      })
        .then((result) => {
          if (result.kind !== "ok") {
            presentCommandToast(result);
            return;
          }

          locallyEditedCycleCountItemIdsRef.current.delete(productSkuId);
        })
        .finally(() => {
          pendingCycleCountSavePromisesRef.current =
            pendingCycleCountSavePromisesRef.current.filter(
              (pendingSave) => pendingSave !== savePromise,
            );
          setPendingCycleCountSaveCount(
            pendingCycleCountSavePromisesRef.current.length,
          );
        });

      pendingCycleCountSavePromisesRef.current = [
        ...pendingCycleCountSavePromisesRef.current,
        savePromise,
      ];
      setPendingCycleCountSaveCount(
        pendingCycleCountSavePromisesRef.current.length,
      );

      await savePromise;
    },
    [adjustmentType, onSaveCycleCountDraftLine],
  );

  const rows: StockAdjustmentRow[] = useMemo(
    () =>
      inventoryItems.map((item) => {
        const isBlocked = isStockAdjustmentBlocked(item);

        if (adjustmentType === "manual") {
          const rawDelta = manualDeltas[item._id] ?? "";
          const parsedDelta = rawDelta.trim() === "" ? 0 : Number(rawDelta);
          const isEdited =
            !isBlocked && Number.isInteger(parsedDelta) && parsedDelta !== 0;

          return {
            inputValue: rawDelta,
            inventoryItem: item,
            isBlocked,
            isEdited,
            quantityDelta: isEdited ? parsedDelta : 0,
            submittedLineItem: isEdited
              ? ({
                  productSkuId: item._id,
                  quantityDelta: parsedDelta,
                } as const)
              : null,
          };
        }

        const draftLine = cycleCountDraftLineMap.get(item._id);
        const baselineInventoryCount =
          draftLine?.baselineInventoryCount ?? item.inventoryCount;
        const rawCount =
          cycleCounts[item._id] ??
          String(draftLine?.countedQuantity ?? item.inventoryCount);
        const parsedCount =
          rawCount.trim() === "" ? Number.NaN : Number(rawCount);
        const quantityDelta = Number.isInteger(parsedCount)
          ? parsedCount - baselineInventoryCount
          : 0;
        const isEdited =
          !isBlocked &&
          Number.isInteger(parsedCount) &&
          parsedCount >= 0 &&
          parsedCount !== baselineInventoryCount;

        return {
          countedQuantity: parsedCount,
          inputValue: rawCount,
          inventoryItem: item,
          isBlocked,
          isEdited,
          quantityDelta: isEdited ? quantityDelta : 0,
          submittedLineItem: isEdited
            ? ({
                countedQuantity: parsedCount,
                productSkuId: item._id,
              } as const)
            : null,
        };
      }),
    [
      adjustmentType,
      cycleCountDraftLineMap,
      cycleCounts,
      inventoryItems,
      manualDeltas,
    ],
  );

  const changedRows = rows.filter((row) => row.submittedLineItem);
  const categoryFilterOptions: StockAdjustmentCategoryFilterOption[] =
    useMemo(() => {
      const categories = new Map<string, StockAdjustmentCategoryFilterOption>();

      for (const row of rows) {
        const key = getStockAdjustmentCategoryKey(row.inventoryItem);
        const existing = categories.get(key) ?? {
          itemCount: 0,
          key,
          label: getStockAdjustmentCategoryLabel(key),
        };

        existing.itemCount += 1;
        categories.set(key, existing);
      }

      return Array.from(categories.values()).sort((a, b) =>
        a.label.localeCompare(b.label),
      );
    }, [rows]);
  const routeSkuFilterQuery =
    adjustmentType === "manual" && !filters.query.trim() && searchState?.sku
      ? searchState.sku
      : "";
  const normalizedFilterQuery = normalizeSkuSearchQuery(
    filters.query || routeSkuFilterQuery,
  );
  const quickAddInitialLookupCode = normalizeQuickAddInitialLookupCode(
    filters.query,
  );
  const quickAddInitialName = quickAddInitialLookupCode
    ? ""
    : filters.query.trim();
  const existingSkuOptions = useMemo(
    () =>
      inventoryItems
        .filter((item) => !item.barcode)
        .map((item) => ({
          productSkuId: String(item._id),
          name: getInventoryItemDisplayName(item),
          sku: item.sku ?? "",
          priceLabel: formatInventoryItemPriceLabel(item),
          category: item.productCategory ?? undefined,
          barcode: item.barcode ?? undefined,
          variantAttributes: [
            item.colorName,
            item.size,
            item.length === null || item.length === undefined
              ? undefined
              : `${item.length}"`,
          ].filter((value): value is string => Boolean(value?.trim())),
        })),
    [inventoryItems],
  );
  const queryAvailabilityFilteredRows = useMemo(() => {
    const scoredRows = rows
      .map((row, position) => ({
        position,
        row,
        score: scoreStockAdjustmentSearchRow(row, normalizedFilterQuery),
      }))
      .filter(
        ({ row, score }) =>
          score > 0 && rowMatchesAvailabilityFilter(row, filters.availability),
      );

    if (!normalizedFilterQuery) {
      return scoredRows.map(({ row }) => row);
    }

    return scoredRows
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.position - right.position;
      })
      .map(({ row }) => row);
  }, [filters.availability, normalizedFilterQuery, rows]);
  const filteredRows = useMemo(
    () =>
      queryAvailabilityFilteredRows.filter((row) =>
        rowMatchesCategoryFilter(row, filters.category),
      ),
    [filters.category, queryAvailabilityFilteredRows],
  );
  const categoryMismatchRows = useMemo(() => {
    if (!normalizedFilterQuery) return [];
    if (filters.category === ALL_CATEGORY_FILTER_KEY) return [];
    if (filteredRows.length > 0) return [];

    return queryAvailabilityFilteredRows.filter(
      (row) => !rowMatchesCategoryFilter(row, filters.category),
    );
  }, [
    filteredRows.length,
    filters.category,
    normalizedFilterQuery,
    queryAvailabilityFilteredRows,
  ]);
  const isShowingCategoryMismatchRows = categoryMismatchRows.length > 0;
  const tableRows = isShowingCategoryMismatchRows
    ? categoryMismatchRows
    : filteredRows;
  const categoryMismatchCategoryKeys = useMemo(
    () =>
      Array.from(
        new Set(
          categoryMismatchRows.map((row) =>
            getStockAdjustmentCategoryKey(row.inventoryItem),
          ),
        ),
      ).sort((a, b) =>
        getStockAdjustmentCategoryLabel(a).localeCompare(
          getStockAdjustmentCategoryLabel(b),
        ),
      ),
    [categoryMismatchRows],
  );
  const categoryMismatchCategoryLabels = categoryMismatchCategoryKeys.map(
    getStockAdjustmentCategoryLabel,
  );
  const isUnavailableScopeSelectionActive =
    filters.availability === "unavailable";
  const summary = summarizeStockAdjustmentLineItems(
    changedRows.map((row) => ({
      quantityDelta: row.quantityDelta,
    })),
  );
  const overallSummary =
    adjustmentType === "cycle_count" && cycleCountDraftSummary
      ? {
          largestAbsoluteDelta: cycleCountDraftSummary.largestAbsoluteDelta,
          lineItemCount: cycleCountDraftSummary.changedLineCount,
          netQuantityDelta: cycleCountDraftSummary.netQuantityDelta,
        }
      : summary;
  const highVarianceFlag =
    overallSummary.lineItemCount > 0 &&
    hasHighStockAdjustmentVariance(overallSummary);
  const approvalRequired =
    adjustmentType === "manual" &&
    changedRows.length > 0 &&
    requiresStockAdjustmentApproval({
      adjustmentType,
      largestAbsoluteDelta: summary.largestAbsoluteDelta,
    });
  const displayedReasonCode =
    adjustmentType === "manual" ? reasonCode : CYCLE_COUNT_REASON_CODE;
  const activeInventoryItem =
    inventoryItems.find((item) => item._id === activeInventoryItemId) ??
    inventoryItems[0] ??
    null;
  const inventoryState = useMemo(() => {
    const totals = inventoryItems.reduce(
      (current, item) => {
        const unavailableUnits = Math.max(
          0,
          item.inventoryCount - item.quantityAvailable,
        );
        const reservedUnits = Math.max(0, item.reservedQuantity ?? 0);
        const checkoutReservedUnits = Math.max(
          0,
          item.checkoutReservedQuantity ?? 0,
        );
        const posReservedUnits = Math.max(0, item.posReservedQuantity ?? 0);
        const fallbackReservedUnits = Math.max(
          0,
          reservedUnits - checkoutReservedUnits - posReservedUnits,
        );

        return {
          availableUnits: current.availableUnits + item.quantityAvailable,
          checkoutReservedUnits:
            current.checkoutReservedUnits + checkoutReservedUnits,
          fallbackReservedUnits:
            current.fallbackReservedUnits + fallbackReservedUnits,
          onHandUnits: current.onHandUnits + item.inventoryCount,
          posReservedUnits: current.posReservedUnits + posReservedUnits,
          reservedUnits: current.reservedUnits + reservedUnits,
          unavailableSkuCount:
            current.unavailableSkuCount + (unavailableUnits > 0 ? 1 : 0),
          unavailableUnits: current.unavailableUnits + unavailableUnits,
        };
      },
      {
        availableUnits: 0,
        checkoutReservedUnits: 0,
        fallbackReservedUnits: 0,
        onHandUnits: 0,
        posReservedUnits: 0,
        reservedUnits: 0,
        unavailableSkuCount: 0,
        unavailableUnits: 0,
      },
    );

    const itemCount = inventoryItems.length;
    const hasUnavailableUnits = totals.unavailableUnits > 0;
    const reservationSummary = formatReservationSourceSummary(totals);

    return {
      ...totals,
      itemCount,
      description:
        itemCount === 0
          ? "Inventory appears here once SKUs are available for this store."
          : `${formatInventoryNumber(
              totals.availableUnits,
            )} of ${formatInventoryNumber(totals.onHandUnits)} ${pluralize(
              totals.onHandUnits,
              "unit",
            )} are available to sell.${
              totals.reservedUnits > 0 ? ` ${reservationSummary}` : ""
            }`,
      title:
        itemCount === 0
          ? "No inventory loaded."
          : hasUnavailableUnits
            ? `${totals.unavailableSkuCount} ${pluralize(
                totals.unavailableSkuCount,
                "SKU",
              )} ${
                totals.unavailableSkuCount === 1 ? "has" : "have"
              } reserved units.`
            : "All inventory is available.",
    };
  }, [inventoryItems]);
  const totalDraftChangedLineCount =
    cycleCountDraftSummary?.changedLineCount ??
    cycleCountDraft?.changedLineCount ??
    0;
  const totalDraftScopeCount = cycleCountDraftSummary?.scopeCount ?? 0;
  const draftScopeNames = cycleCountDraftSummary?.scopeKeys ?? [];
  const scopeDraftChangedLineCount = cycleCountDraft?.changedLineCount ?? 0;
  const currentScopeLabel = cycleCountDraft?.scopeKey
    ? getCountScopeLabel(cycleCountDraft.scopeKey)
    : null;
  const cycleCountStatus = cycleCountSubmissionOutcome
    ? cycleCountSubmissionOutcome === "review_required"
      ? {
          description:
            "Operator count submitted. Review the queued request before inventory changes apply.",
          label: "Review required",
          tone: "border-warning/30 bg-warning/10 text-foreground" as const,
        }
      : {
          description:
            "Operator count submitted. Inventory movements have been written.",
          label: "Count applied",
          tone: "border-success/30 bg-success/10 text-foreground" as const,
        }
    : {
        description:
          totalDraftChangedLineCount > 0
            ? `Saved count: ${totalDraftChangedLineCount} ${pluralize(
                totalDraftChangedLineCount,
                "SKU",
              )} across ${totalDraftScopeCount || 1} ${pluralize(
                totalDraftScopeCount || 1,
                "category",
                "categories",
              )}.`
            : "No saved counts yet.",
        label: isCycleCountDraftSaving
          ? "Saving draft"
          : cycleCountDraft?.lastSavedAt
            ? "Draft saved"
            : "Count in progress",
        tone: "border-border bg-muted/40 text-foreground" as const,
      };
  const draftLastSavedAt =
    cycleCountDraftSummary?.lastSavedAt ?? cycleCountDraft?.lastSavedAt;
  const draftLastSavedLabel = draftLastSavedAt
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(draftLastSavedAt))
    : null;
  const showDraftSavedTimestamp =
    cycleCountStatus.label === "Draft saved" && Boolean(draftLastSavedLabel);
  const canDiscardCycleCountDraft =
    !cycleCountSubmissionOutcome &&
    cycleCountDraft?.status === "open" &&
    totalDraftChangedLineCount > 0 &&
    Boolean(onDiscardCycleCountDraft);

  useEffect(() => {
    if (
      activeInventoryItemId &&
      tableRows.some((row) => row.inventoryItem._id === activeInventoryItemId)
    ) {
      return;
    }

    setActiveInventoryItemId(tableRows[0]?.inventoryItem._id ?? null);
  }, [activeInventoryItemId, tableRows]);
  const columns = useMemo<ColumnDef<StockAdjustmentRow>[]>(
    () => [
      {
        accessorKey: "inventoryItem.productName",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="SKU" />
        ),
        cell: ({ row }) => {
          const item = row.original.inventoryItem;
          const primaryLabel = getInventoryItemDisplayName(item);
          const detailEntries = getSkuDetailEntries(item);
          const blockedMessage = item.stockAdjustmentBlockedMessage;

          return (
            <div className="min-w-0 space-y-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium">{primaryLabel}</p>
                {blockedMessage ? (
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          aria-label={`Provisional item. ${blockedMessage}`}
                          className="inline-flex shrink-0 items-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          tabIndex={0}
                        >
                          <Badge
                            className="gap-1 border-warning/30 bg-warning/15 px-1.5 text-[10px] font-medium text-warning"
                            size="sm"
                            variant="outline"
                          >
                            <Info className="h-3 w-3" aria-hidden="true" />
                            Provisional
                          </Badge>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64 text-xs leading-5">
                        {blockedMessage}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
              </div>
              {detailEntries.length > 0 ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {detailEntries.map((entry) => (
                    <span className="min-w-0" key={entry.label}>
                      <span className="sr-only">{entry.label}: </span>
                      {entry.value}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "inventoryItem.inventoryCount",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            className="justify-end"
            column={column}
            title={
              <span className="grid min-w-48 grid-cols-2 gap-2 text-right">
                <span>On hand</span>
                <span>Available</span>
              </span>
            }
          />
        ),
        cell: ({ row }) => {
          const item = row.original.inventoryItem;
          const reservationLabels = getReservationLabels(item);
          const availabilityMatchesOnHand =
            item.quantityAvailable === item.inventoryCount;

          if (availabilityMatchesOnHand) {
            const availabilityLabel =
              item.inventoryCount === 0 ? "None available" : "All available";

            return (
              <div className="flex min-w-48 justify-end">
                <span
                  className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-sm font-medium tabular-nums text-muted-foreground"
                  title="All units are available"
                >
                  <span className="sr-only">On hand and available match</span>
                  {item.inventoryCount > 0 ? (
                    <span className="text-foreground">
                      {formatInventoryNumber(item.inventoryCount)}
                    </span>
                  ) : null}
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em]">
                    {availabilityLabel}
                  </span>
                </span>
              </div>
            );
          }

          return (
            <div className="grid min-w-48 grid-cols-2 gap-2 text-right text-sm tabular-nums">
              <span className="font-medium text-foreground">
                {formatInventoryNumber(item.inventoryCount)}
              </span>
              <span className="space-y-0.5 text-muted-foreground">
                <span className="block">
                  {formatInventoryNumber(item.quantityAvailable)}
                </span>
                {reservationLabels.map((label) => (
                  <span
                    className="block text-[11px] font-medium uppercase tracking-[0.12em] text-warning"
                    key={label.value}
                    title={label.title}
                  >
                    {label.value}
                  </span>
                ))}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "inputValue",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            className="justify-end"
            column={column}
            title={adjustmentType === "manual" ? "Delta" : "Counted"}
          />
        ),
        cell: ({ row }) => {
          const item = row.original.inventoryItem;
          const displayName = getInventoryItemDisplayName(item);
          const isBlocked = row.original.isBlocked;
          const inputLabel =
            adjustmentType === "manual"
              ? "Adjustment delta"
              : "Counted quantity";
          const resetValue =
            adjustmentType === "manual"
              ? ""
              : String(
                  cycleCountDraftLineMap.get(item._id)
                    ?.baselineInventoryCount ?? item.inventoryCount,
                );

          const setDraftValue = (value: string) =>
            adjustmentType === "manual"
              ? setManualDeltas((current) => ({
                  ...current,
                  [item._id]: value,
                }))
              : setCycleCounts((current) => ({
                  ...current,
                  [item._id]: value,
                }));
          const handleDraftChange = (value: string) => {
            setDraftValue(value);
            if (adjustmentType === "cycle_count") {
              locallyEditedCycleCountItemIdsRef.current.add(item._id);
              setCycleCountSubmissionOutcome(null);
              setStaleDraftLines([]);
            }
          };
          return (
            <div className="ml-auto flex max-w-56 items-center justify-end gap-2">
              <Input
                aria-label={`${inputLabel} for ${displayName}`}
                className="h-10 w-36 text-right"
                disabled={isBlocked}
                inputMode="numeric"
                min={adjustmentType === "manual" ? undefined : 0}
                onFocus={() => handleSelectInventoryItem(item._id)}
                onBlur={(event) =>
                  saveCycleCountDraftValue(item._id, event.currentTarget.value)
                }
                onChange={(event) => handleDraftChange(event.target.value)}
                type="number"
                value={row.original.inputValue}
              />
              <Button
                aria-label={`Restore original value for ${displayName}`}
                className="h-10 w-10 shrink-0 text-muted-foreground"
                disabled={isBlocked || !row.original.isEdited}
                onClick={(event) => {
                  event.stopPropagation();
                  handleSelectInventoryItem(item._id);
                  setDraftValue(resetValue);
                  if (adjustmentType === "cycle_count") {
                    setCycleCountSubmissionOutcome(null);
                    setStaleDraftLines([]);
                    void saveCycleCountDraftValue(item._id, resetValue);
                  }
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
      {
        accessorKey: "quantityDelta",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            className="justify-end"
            column={column}
            title="Impact"
          />
        ),
        cell: ({ row }) => (
          <p
            className={`text-right text-sm font-medium ${
              row.original.quantityDelta > 0
                ? "text-success"
                : row.original.quantityDelta < 0
                  ? "text-warning"
                  : "text-muted-foreground"
            }`}
          >
            {row.original.quantityDelta > 0
              ? `+${row.original.quantityDelta}`
              : row.original.quantityDelta}
          </p>
        ),
      },
    ],
    [
      adjustmentType,
      cycleCountDraftLineMap,
      handleSelectInventoryItem,
      saveCycleCountDraftValue,
    ],
  );

  const getFirstFilteredItem = (nextFilters: StockAdjustmentFilterState) => {
    const nextNormalizedQuery = normalizeSkuSearchQuery(nextFilters.query);
    const nextRows = rows
      .map((row, position) => ({
        position,
        row,
        score: scoreStockAdjustmentSearchRow(row, nextNormalizedQuery),
      }))
      .filter(
        ({ row, score }) =>
          score > 0 &&
          rowMatchesAvailabilityFilter(row, nextFilters.availability),
      )
      .sort((left, right) => {
        if (!nextNormalizedQuery) return left.position - right.position;
        if (right.score !== left.score) return right.score - left.score;
        return left.position - right.position;
      })
      .map(({ row }) => row);
    const firstExactItem = nextRows.find((row) =>
      rowMatchesCategoryFilter(row, nextFilters.category),
    )?.inventoryItem;

    if (firstExactItem) return firstExactItem;
    if (!nextNormalizedQuery) return undefined;
    if (nextFilters.category === ALL_CATEGORY_FILTER_KEY) return undefined;

    return nextRows[0]?.inventoryItem;
  };

  const handleModeChange = (nextType: StockAdjustmentType) => {
    setAdjustmentType(nextType);
    setSubmissionKey(buildStockAdjustmentSubmissionKey(nextType));
    if (nextType === "manual") {
      setCycleCountSubmissionOutcome(null);
    }

    const nextActiveItem =
      getFirstFilteredItem(filters) ?? rows[0]?.inventoryItem;

    if (nextActiveItem) {
      setActiveInventoryItemId(nextActiveItem._id);
    }
    onSearchStateChange?.({
      category:
        filters.category === ALL_CATEGORY_FILTER_KEY
          ? undefined
          : filters.category,
      mode: nextType,
      page: 1,
      sku: nextActiveItem?._id,
    });
  };

  const handleFilterChange = (patch: Partial<StockAdjustmentFilterState>) => {
    const nextFilters = {
      ...filters,
      ...patch,
    };
    const nextActiveItem = getFirstFilteredItem(nextFilters);

    setFilters(nextFilters);
    setActiveInventoryItemId(nextActiveItem?._id ?? null);
    onSearchStateChange?.({
      availability:
        nextFilters.availability === "all"
          ? undefined
          : nextFilters.availability,
      category:
        nextFilters.category === ALL_CATEGORY_FILTER_KEY
          ? undefined
          : nextFilters.category,
      page: 1,
      query: trimOptional(nextFilters.query),
      sku: nextActiveItem?._id,
    });
  };

  const handleClearFilters = () => {
    const nextActiveItem = rows[0]?.inventoryItem;

    setFilters({
      availability: "all",
      category: ALL_CATEGORY_FILTER_KEY,
      query: "",
    });
    setActiveInventoryItemId(nextActiveItem?._id ?? null);
    onSearchStateChange?.({
      availability: undefined,
      category: undefined,
      page: 1,
      query: undefined,
      sku: undefined,
    });
  };

  const handleQuickAddSubmit = async ({
    name,
    variants,
    usesMultipleVariants,
  }: QuickAddProductSubmitPayload) => {
    if (!storeId || !user?._id) {
      throw new Error("Store sign-in is still loading. Try again in a moment.");
    }

    const [primaryVariant, ...extraVariants] = variants;
    const createdProduct = await quickAddProductSku({
      storeId,
      createdByUserId: user._id,
      name,
      lookupCode: primaryVariant.lookupCode,
      price: primaryVariant.price,
      quantityAvailable: primaryVariant.quantityAvailable,
    });

    if (extraVariants.length && !createdProduct.productId) {
      throw new Error("Quick add product id missing");
    }

    for (const variant of extraVariants) {
      await quickAddProductSku({
        storeId,
        createdByUserId: user._id,
        name,
        lookupCode: variant.lookupCode,
        price: variant.price,
        quantityAvailable: variant.quantityAvailable,
        productId: createdProduct.productId,
      });
    }

    toast.success(
      usesMultipleVariants ? "Product variants added" : "Product added",
    );

    if (createdProduct.skuId) {
      const createdSkuId = createdProduct.skuId as Id<"productSku">;

      setFilters((current) => ({
        ...current,
        availability: "all",
        category: ALL_CATEGORY_FILTER_KEY,
        query: name,
      }));
      setActiveInventoryItemId(createdSkuId);
      onSearchStateChange?.({
        availability: undefined,
        category: undefined,
        page: 1,
        query: name,
        sku: createdSkuId,
      });
    }
  };

  const handleAttachBarcodeSubmit = async ({
    lookupCode,
    productSkuId,
  }: QuickAddAttachBarcodePayload) => {
    if (!storeId || !user?._id) {
      throw new Error("Store sign-in is still loading. Try again in a moment.");
    }

    await quickAddProductSku({
      storeId,
      createdByUserId: user._id,
      name: "",
      lookupCode,
      price: 0,
      quantityAvailable: 0,
      productSkuId: productSkuId as Id<"productSku">,
    });

    const attachedSkuId = productSkuId as Id<"productSku">;

    setFilters((current) => ({
      ...current,
      availability: "all",
      category: ALL_CATEGORY_FILTER_KEY,
      query: lookupCode,
    }));
    setActiveInventoryItemId(attachedSkuId);
    onSearchStateChange?.({
      availability: undefined,
      category: undefined,
      page: 1,
      query: lookupCode,
      sku: attachedSkuId,
    });
    toast.success("Barcode attached to SKU");
  };

  const handleUnavailableMetricClick = () => {
    if (inventoryState.unavailableUnits === 0) return;

    if (isUnavailableScopeSelectionActive) {
      const nextFilters = {
        ...filters,
        availability: "all" as StockAdjustmentAvailabilityFilter,
      };
      const nextActiveItem = getFirstFilteredItem(nextFilters);

      setFilters((current) => ({
        ...current,
        availability: "all",
      }));
      setActiveInventoryItemId(nextActiveItem?._id ?? null);
      onSearchStateChange?.({
        availability: undefined,
        category:
          nextFilters.category === ALL_CATEGORY_FILTER_KEY
            ? undefined
            : nextFilters.category,
        page: 1,
        sku: nextActiveItem?._id,
      });
      return;
    }

    const nextFilters = {
      ...filters,
      availability: "unavailable" as StockAdjustmentAvailabilityFilter,
    };
    const nextActiveItem = getFirstFilteredItem(nextFilters);

    setFilters((current) => ({
      ...current,
      availability: "unavailable",
    }));
    setActiveInventoryItemId(nextActiveItem?._id ?? null);
    onSearchStateChange?.({
      availability: "unavailable",
      category:
        nextFilters.category === ALL_CATEGORY_FILTER_KEY
          ? undefined
          : nextFilters.category,
      page: 1,
      sku: nextActiveItem?._id,
    });
  };

  const activeCategoryFilterLabel = getStockAdjustmentCategoryLabel(
    filters.category,
  );
  const categoryMismatchActionCategory =
    categoryMismatchCategoryKeys.length === 1
      ? categoryMismatchCategoryKeys[0]
      : ALL_CATEGORY_FILTER_KEY;
  const categoryMismatchActionLabel =
    categoryMismatchCategoryKeys.length === 1
      ? `Switch to ${getStockAdjustmentCategoryLabel(
          categoryMismatchCategoryKeys[0],
        )}`
      : "Show all categories";
  const handleCategoryMismatchAction = () => {
    handleFilterChange({ category: categoryMismatchActionCategory });
  };

  const awaitPendingCycleCountSaves = async () => {
    const pendingSaves = pendingCycleCountSavePromisesRef.current;

    if (pendingSaves.length === 0) return;

    await Promise.allSettled(pendingSaves);
  };

  const flushLocallyEditedCycleCountDraftLines = async () => {
    await awaitPendingCycleCountSaves();

    const editedItemIds = Array.from(locallyEditedCycleCountItemIdsRef.current);
    if (editedItemIds.length === 0) return;

    await Promise.allSettled(
      editedItemIds.map((itemId) =>
        saveCycleCountDraftValue(itemId, cycleCounts[itemId] ?? ""),
      ),
    );
    await awaitPendingCycleCountSaves();
  };

  const handleSubmit = async () => {
    if (!storeId) {
      toast.error("Select a store before submitting a stock adjustment");
      return;
    }

    if (adjustmentType === "cycle_count") {
      await flushLocallyEditedCycleCountDraftLines();
    }

    const firstBlockedRow = tableRows.find((row) => row.isBlocked);
    const allRowsBlocked =
      tableRows.length > 0 && tableRows.every((row) => row.isBlocked);

    if (
      adjustmentType === "manual"
        ? changedRows.length === 0
        : overallSummary.lineItemCount === 0 && changedRows.length === 0
    ) {
      if (
        allRowsBlocked &&
        firstBlockedRow?.inventoryItem.stockAdjustmentBlockedMessage
      ) {
        toast.error(
          firstBlockedRow.inventoryItem.stockAdjustmentBlockedMessage,
        );
        return;
      }

      toast.error(
        adjustmentType === "manual"
          ? "Add at least one non-zero stock delta"
          : "Enter at least one counted SKU that differs from the system stock",
      );
      return;
    }

    const result =
      adjustmentType === "cycle_count" && onSubmitCycleCountDraft
        ? await onSubmitCycleCountDraft({ notes: trimOptional(notes) })
        : await onSubmitBatch({
            adjustmentType,
            lineItems: changedRows.map((row) => row.submittedLineItem!),
            notes: trimOptional(notes),
            reasonCode:
              adjustmentType === "manual"
                ? reasonCode
                : CYCLE_COUNT_REASON_CODE,
            storeId,
            submissionKey,
          });

    if (result.kind !== "ok") {
      if (result.kind === "user_error") {
        const staleLines = result.error.metadata?.staleLines;
        if (Array.isArray(staleLines)) {
          setStaleDraftLines(
            staleLines.map((line) => ({
              baselineInventoryCount: Number(line.baselineInventoryCount ?? 0),
              currentInventoryCount: Number(line.currentInventoryCount ?? 0),
              productName:
                typeof line.productName === "string" ? line.productName : null,
              productSkuId: String(line.productSkuId) as Id<"productSku">,
              sku: typeof line.sku === "string" ? line.sku : null,
            })),
          );
        }
      }
      presentCommandToast(result);
      return;
    }

    toast.success(
      approvalRequired
        ? "Stock batch submitted for review"
        : adjustmentType === "manual"
          ? "Stock adjustment applied"
          : "Count applied",
    );
    if (adjustmentType === "cycle_count") {
      setCycleCountSubmissionOutcome(
        approvalRequired ? "review_required" : "applied",
      );
      setStaleDraftLines([]);
    }
    setNotes("");
    setManualDeltas(buildManualDrafts(inventoryItems));
    setCycleCounts(buildCycleCountDrafts(inventoryItems));
    setSubmissionKey(buildStockAdjustmentSubmissionKey(adjustmentType));
  };

  return (
    <PageWorkspace>
      <PageLevelHeader
        eyebrow="Store Ops"
        title={inventoryState.title}
        showBackButton={showBackButton}
        description={
          <>
            {inventoryState.description}{" "}
            {adjustmentType === "cycle_count"
              ? "Select a SKU, then record physical counts for its category."
              : "Record known deltas when physical stock needs correction."}
          </>
        }
      />

      <PageWorkspaceGrid>
        <PageWorkspaceMain>
          <div className="flex flex-wrap items-start justify-between gap-layout-xl">
            <div className="grid w-full max-w-2xl grid-cols-3 gap-layout-sm">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  On hand
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {formatInventoryNumber(inventoryState.onHandUnits)}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Available
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {formatInventoryNumber(inventoryState.availableUnits)}
                </p>
              </div>
              <div
                className={`overflow-hidden rounded-md border ${
                  inventoryState.unavailableUnits === 0
                    ? "border-border bg-muted/30"
                    : isUnavailableScopeSelectionActive
                      ? "border-action-workflow-border bg-action-workflow-soft"
                      : "border-border bg-muted/30 hover:bg-muted"
                }`}
              >
                <button
                  aria-pressed={isUnavailableScopeSelectionActive}
                  className="block w-full px-3 py-2 text-left disabled:cursor-default"
                  disabled={inventoryState.unavailableUnits === 0}
                  onClick={handleUnavailableMetricClick}
                  type="button"
                >
                  <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Reserved
                  </span>
                  <span className="mt-1 block text-sm font-medium tabular-nums text-foreground">
                    {formatInventoryNumber(inventoryState.unavailableUnits)}
                  </span>
                </button>
              </div>
            </div>

            <Tabs
              onValueChange={(value) =>
                handleModeChange(value as StockAdjustmentType)
              }
              value={adjustmentType}
            >
              <TabsList>
                <TabsTrigger value="cycle_count">Cycle count</TabsTrigger>
                <TabsTrigger value="manual">Manual adjustment</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <SkuSearchFilterBar
            action={
              <Button
                disabled={!storeId || !user?._id}
                onClick={() => setIsQuickAddOpen(true)}
                type="button"
                variant="workflow"
              >
                <PackagePlus className="h-4 w-4" />
                Quick add
              </Button>
            }
            ariaLabel="SKU search and filters"
            filterId="stock-adjustment-availability-filter"
            filterLabel="Filter by availability"
            filterOptions={STOCK_ADJUSTMENT_AVAILABILITY_FILTER_OPTIONS}
            filterValue={filters.availability}
            hasActiveFilters={Boolean(
              filters.query ||
              routeSkuFilterQuery ||
              filters.availability !== "all" ||
              filters.category !== ALL_CATEGORY_FILTER_KEY,
            )}
            onClearFilters={handleClearFilters}
            onFilterChange={(availability) =>
              handleFilterChange({ availability })
            }
            onQueryChange={(query) => handleFilterChange({ query })}
            query={filters.query}
            scanAction={
              <Button
                aria-label="Scan barcode with camera"
                className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setIsBarcodeScannerOpen(true)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ScanBarcode className="h-4 w-4" />
              </Button>
            }
            searchId="stock-adjustment-sku-search"
            searchLabel="Search products, SKUs, or barcodes"
            searchPlaceholder="Search product, SKU, or barcode"
            secondaryFilters={
              <div
                aria-label="Filter by category"
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
                role="group"
              >
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Categories
                </span>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {[
                    {
                      itemCount: rows.length,
                      key: ALL_CATEGORY_FILTER_KEY,
                      label: "All categories",
                    },
                    ...categoryFilterOptions,
                  ].map((category) => {
                    const isSelected = filters.category === category.key;

                    return (
                      <button
                        aria-label={`${category.label}, ${category.itemCount} ${pluralize(
                          category.itemCount,
                          "SKU",
                        )}`}
                        aria-pressed={isSelected}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          isSelected
                            ? "border-action-workflow-border bg-action-workflow-soft text-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                        key={category.key}
                        onClick={() =>
                          handleFilterChange({
                            category: isSelected
                              ? ALL_CATEGORY_FILTER_KEY
                              : category.key,
                          })
                        }
                        type="button"
                      >
                        {category.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            }
            summary={
              isShowingCategoryMismatchRows ? (
                <>
                  No {activeCategoryFilterLabel} matches. Showing{" "}
                  {formatInventoryNumber(tableRows.length)}{" "}
                  {pluralize(tableRows.length, "match", "matches")} in{" "}
                  {formatCategoryList(categoryMismatchCategoryLabels)}.
                </>
              ) : (
                <>
                  Showing {formatInventoryNumber(filteredRows.length)} of{" "}
                  {formatInventoryNumber(rows.length)}{" "}
                  {pluralize(rows.length, "SKU")}.
                </>
              )
            }
          />

          <div className="flex min-h-0 flex-col">
            {isShowingCategoryMismatchRows ? (
              <section
                aria-label="Search matches in other categories"
                className="mb-layout-md flex flex-col gap-layout-sm rounded-md border border-action-workflow-border bg-action-workflow-soft px-layout-md py-layout-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Matches are in{" "}
                    {formatCategoryList(categoryMismatchCategoryLabels)}.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {activeCategoryFilterLabel} has no matching SKUs for this
                    search.
                  </p>
                </div>
                <Button
                  className="shrink-0"
                  onClick={handleCategoryMismatchAction}
                  type="button"
                  variant="outline"
                >
                  {categoryMismatchActionLabel}
                </Button>
              </section>
            ) : null}
            <GenericDataTable
              autoResetPageIndex={false}
              columns={columns}
              data={tableRows}
              getRowClassName={(row) =>
                row.original.inventoryItem._id === activeInventoryItemId
                  ? "bg-muted/60 hover:bg-muted/70"
                  : undefined
              }
              onPageIndexChange={(nextPageIndex) =>
                onSearchStateChange?.({ page: nextPageIndex + 1 })
              }
              onRowClick={(row) =>
                handleSelectInventoryItem(row.original.inventoryItem._id)
              }
              pageIndex={
                searchState?.page === undefined
                  ? undefined
                  : Math.max(searchState.page - 1, 0)
              }
              paginationRangeItemLabel="SKU"
              paginationRangeItemPluralLabel="SKUs"
              tableId={`stock-adjustments-${adjustmentType}-${filters.category}-${filters.availability}-${isShowingCategoryMismatchRows ? "category-mismatch" : "exact"}-${normalizedFilterQuery || "all"}`}
            />
          </div>
        </PageWorkspaceMain>

        <PageWorkspaceRail>
          <section className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-lg shadow-surface">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Batch summary
            </p>
            <div className="mt-layout-lg space-y-layout-lg">
              {adjustmentType === "cycle_count" ? (
                <div className="space-y-3">
                  <div
                    className={`space-y-layout-md rounded-md border px-layout-md py-layout-md ${cycleCountStatus.tone}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Count status
                      </p>
                      <Badge
                        className="inline-flex items-center gap-1.5 rounded-md border-border bg-background text-foreground"
                        variant="outline"
                      >
                        <span>{cycleCountStatus.label}</span>
                        {showDraftSavedTimestamp ? (
                          <>
                            <span
                              aria-hidden="true"
                              className="h-3 w-px bg-border"
                            />
                            <span>{draftLastSavedLabel}</span>
                          </>
                        ) : null}
                      </Badge>
                    </div>
                    <p className="text-sm leading-6">
                      {cycleCountStatus.description}
                    </p>
                    <div className="space-y-1.5">
                      {cycleCountDraft && totalDraftChangedLineCount > 0 ? (
                        <p className="text-xs leading-5 text-muted-foreground">
                          Current:{" "}
                          {currentScopeLabel ? `${currentScopeLabel}, ` : ""}
                          {scopeDraftChangedLineCount}{" "}
                          {pluralize(scopeDraftChangedLineCount, "SKU")}.
                        </p>
                      ) : null}
                      {draftScopeNames.length > 0 ? (
                        <p className="text-xs leading-5 text-muted-foreground">
                          Categories: {draftScopeNames.join(", ")}.
                        </p>
                      ) : null}
                    </div>
                    {canDiscardCycleCountDraft && onDiscardCycleCountDraft ? (
                      <Button
                        className="mt-layout-xs h-8 px-2 text-xs"
                        disabled={isCycleCountDraftSaving || isSubmitting}
                        onClick={async () => {
                          await awaitPendingCycleCountSaves();
                          const result = await onDiscardCycleCountDraft();

                          if (result.kind !== "ok") {
                            presentCommandToast(result);
                            return;
                          }

                          setCycleCounts(buildCycleCountDrafts(inventoryItems));
                          setCycleCountSubmissionOutcome(null);
                          setStaleDraftLines([]);
                          toast.success("Draft discarded");
                        }}
                        type="button"
                        variant="outline"
                      >
                        Discard draft
                      </Button>
                    ) : null}
                  </div>
                  {staleDraftLines.length > 0 ? (
                    <div className="rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm">
                      <p className="text-sm font-medium text-foreground">
                        Inventory changed since this count started.
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {staleDraftLines.map((line) => (
                          <li
                            className="flex items-center justify-between gap-2"
                            key={line.productSkuId}
                          >
                            <span>
                              {line.productName ??
                                line.sku ??
                                line.productSkuId}
                              : {line.baselineInventoryCount} to{" "}
                              {line.currentInventoryCount} on hand.
                            </span>
                            {onRefreshCycleCountDraftLineBaseline ? (
                              <Button
                                className="h-7 shrink-0 px-2 text-[11px]"
                                disabled={
                                  isCycleCountDraftSaving || isSubmitting
                                }
                                onClick={async () => {
                                  await awaitPendingCycleCountSaves();
                                  const result =
                                    await onRefreshCycleCountDraftLineBaseline({
                                      productSkuId: line.productSkuId,
                                    });

                                  if (result.kind !== "ok") {
                                    presentCommandToast(result);
                                    return;
                                  }

                                  setStaleDraftLines((currentLines) =>
                                    currentLines.filter(
                                      (currentLine) =>
                                        currentLine.productSkuId !==
                                        line.productSkuId,
                                    ),
                                  );
                                  setCycleCounts((currentCounts) => ({
                                    ...currentCounts,
                                    [line.productSkuId]: String(
                                      line.currentInventoryCount,
                                    ),
                                  }));
                                  toast.success("Baseline refreshed");
                                }}
                                type="button"
                                variant="outline"
                              >
                                Use latest stock
                              </Button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {adjustmentType === "cycle_count" ? (
                <div className="space-y-3 border-t border-border pt-layout-md">
                  <p className="text-xs font-medium text-muted-foreground">
                    Count metrics
                  </p>
                  <div className="grid gap-2">
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        All saved counts
                      </p>
                      <dl className="mt-2 space-y-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[11px] text-muted-foreground">
                            SKUs
                          </dt>
                          <dd className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {overallSummary.lineItemCount}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[11px] text-muted-foreground">
                            Net
                          </dt>
                          <dd className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {overallSummary.netQuantityDelta > 0
                              ? `+${overallSummary.netQuantityDelta}`
                              : overallSummary.netQuantityDelta}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[11px] text-muted-foreground">
                            Variance
                          </dt>
                          <dd className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {overallSummary.largestAbsoluteDelta}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="rounded-md border border-border px-3 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Active category
                      </p>
                      <dl className="mt-2 space-y-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[11px] text-muted-foreground">
                            SKUs
                          </dt>
                          <dd className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {summary.lineItemCount}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[11px] text-muted-foreground">
                            Net
                          </dt>
                          <dd className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {summary.netQuantityDelta > 0
                              ? `+${summary.netQuantityDelta}`
                              : summary.netQuantityDelta}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[11px] text-muted-foreground">
                            Variance
                          </dt>
                          <dd className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {summary.largestAbsoluteDelta}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Adjustment metrics
                  </p>
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Manual batch
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                          {summary.lineItemCount}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          SKUs
                        </p>
                      </div>
                      <div>
                        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                          {summary.netQuantityDelta > 0
                            ? `+${summary.netQuantityDelta}`
                            : summary.netQuantityDelta}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Net
                        </p>
                      </div>
                      <div>
                        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                          {summary.largestAbsoluteDelta}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Variance
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div
                className={`rounded-md border px-layout-md py-layout-sm text-sm leading-6 ${
                  approvalRequired
                    ? "border-warning/30 bg-warning/10 text-foreground"
                    : adjustmentType === "cycle_count" && highVarianceFlag
                      ? "border-warning/30 bg-warning/10 text-foreground"
                      : "border-success/30 bg-success/10 text-foreground"
                }`}
              >
                {approvalRequired
                  ? "This batch will open an approval request before inventory changes are applied"
                  : adjustmentType === "cycle_count" && highVarianceFlag
                    ? "Submitting this count will apply inventory movements immediately and flag the high variance"
                    : adjustmentType === "cycle_count"
                      ? "Submitting this count will apply inventory movements immediately"
                      : "This batch can apply immediately and will still write inventory movements"}
              </div>
            </div>
          </section>

          <section className="space-y-layout-xl rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
            <SkuDetailPanel activeInventoryItem={activeInventoryItem} />

            <div className="space-y-2">
              <Label htmlFor="reason-code">Reason code</Label>
              <Select
                disabled={adjustmentType === "cycle_count"}
                onValueChange={(value) =>
                  setReasonCode(
                    value as (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number],
                  )
                }
                value={displayedReasonCode}
              >
                <SelectTrigger id="reason-code">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {adjustmentType === "cycle_count" ? (
                    <SelectItem value={CYCLE_COUNT_REASON_CODE}>
                      Cycle count reconciliation
                    </SelectItem>
                  ) : (
                    MANUAL_STOCK_ADJUSTMENT_REASON_CODES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {MANUAL_REASON_LABELS[option]}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock-adjustment-notes">Notes</Label>
              <Textarea
                id="stock-adjustment-notes"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add notes, count context, or exception details."
                value={notes}
              />
            </div>

            <div className="space-y-layout-sm text-sm text-muted-foreground">
              <p>
                Variances of {STOCK_ADJUSTMENT_APPROVAL_THRESHOLD}+ units{" "}
                {adjustmentType === "cycle_count"
                  ? "are flagged after submission."
                  : "go to review."}
              </p>
            </div>

            <LoadingButton
              variant={"workflow"}
              className="w-full"
              disabled={
                adjustmentType === "cycle_count" &&
                (isCycleCountDraftSaving || pendingCycleCountSaveCount > 0)
              }
              isLoading={
                isSubmitting ||
                (adjustmentType === "cycle_count" &&
                  (isCycleCountDraftSaving || pendingCycleCountSaveCount > 0))
              }
              onClick={handleSubmit}
              onMouseDown={(event) => {
                if (adjustmentType === "cycle_count") {
                  event.preventDefault();
                }
              }}
            >
              {adjustmentType === "manual"
                ? "Submit adjustment"
                : "Submit count"}
            </LoadingButton>
          </section>
        </PageWorkspaceRail>
      </PageWorkspaceGrid>

      <StockAdjustmentBarcodeScannerDialog
        onBarcodeDetected={(barcode) => handleFilterChange({ query: barcode })}
        onOpenChange={setIsBarcodeScannerOpen}
        open={isBarcodeScannerOpen}
      />

      <QuickAddProductDialog
        description="Add sellable stock without leaving stock adjustments."
        existingSkuOptions={existingSkuOptions}
        initialLookupCode={quickAddInitialLookupCode}
        initialName={quickAddInitialName}
        onAttachBarcode={handleAttachBarcodeSubmit}
        onOpenChange={setIsQuickAddOpen}
        onSubmit={handleQuickAddSubmit}
        open={isQuickAddOpen}
        submitErrorMessage="Could not quick add this product. Try again."
      />
    </PageWorkspace>
  );
}
