import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  ArrowUpRight,
  Columns3,
  FileJson,
  ListChecks,
  Pencil,
  Save,
  UploadCloud,
} from "lucide-react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { useOptionalManagerElevation } from "@/contexts/ManagerElevationContext";
import { runCommand } from "@/lib/errors/runCommand";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { useUpdateApplyBlocker } from "@/lib/app-update";
import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";
import { getOrigin } from "@/lib/navigationUtils";
import {
  createFuzzySearchEntry,
  normalizeFuzzySearchText,
  scoreFuzzySearchEntry,
  tokenizeFuzzySearchText,
  type FuzzySearchEntry,
} from "@/lib/search/fuzzySearch";
import { capitalizeWords, cn } from "@/lib/utils";
import {
  parseInventoryImportContent,
  type InventoryImportRow,
  type InventoryImportParseResult,
} from "@/lib/inventory-import/inventoryImportParser";
import {
  matchesSkuSearchTerms,
  normalizeSkuSearchQuery,
} from "@/lib/stockOps/skuSearch";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { ListPagination } from "../common/ListPagination";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { EmptyState } from "../states/empty/empty-state";
import View from "../View";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { Textarea } from "../ui/textarea";
import { SkuSearchFilterBar } from "../stock-ops/SkuSearchFilterBar";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";

const IMPORT_TABLE_PAGE_SIZE = 10;
const DRAFT_AUTOSAVE_DELAY_MS = 1200;

const PREVIEW_COLUMNS = [
  {
    align: "left",
    id: "product",
    label: "Product",
    render: (row: InventoryImportRow) => row.productName,
  },
  {
    align: "left",
    id: "sku",
    label: "SKU",
    render: (row: InventoryImportRow) => row.sku ?? "-",
  },
  {
    align: "left",
    id: "barcode",
    label: "Barcode",
    render: (row: InventoryImportRow) => row.barcode ?? "-",
  },
  {
    align: "left",
    id: "category",
    label: "Category",
    render: (row: InventoryImportRow) =>
      [row.category, row.subcategory].filter(Boolean).join(" / ") || "-",
  },
  {
    align: "right",
    id: "price",
    label: "Price",
    render: (row: InventoryImportRow) =>
      formatStoredCurrencyAmount("GHS", row.price, {
        revealMinorUnits: true,
      }),
  },
  {
    align: "right",
    id: "quantity",
    label: "Qty",
    render: (row: InventoryImportRow) => row.quantity,
  },
] as const;

type PreviewColumnId = (typeof PREVIEW_COLUMNS)[number]["id"];
type PreviewColumnVisibility = Record<PreviewColumnId, boolean>;

const DEFAULT_PREVIEW_COLUMN_VISIBILITY: PreviewColumnVisibility = {
  barcode: false,
  category: false,
  price: true,
  product: true,
  quantity: true,
  sku: false,
};

type InventoryOverlayFilter =
  | "all"
  | "review"
  | "new"
  | "matched"
  | "needs_decision"
  | "decided";
type ImportDraftSource = "import" | "athena";
type ImportNewRowAction = "create_item" | "skip_row";
type BulkImportReviewDecisionAction =
  | "create_new_items"
  | "skip_rows"
  | "use_import_values"
  | "use_athena_values"
  | "clear_choices";
type ImportRowDraftDecision = {
  action?: ImportNewRowAction;
  nameSource?: ImportDraftSource;
  priceSource?: ImportDraftSource;
  quantitySource?: ImportDraftSource;
};
type SavedImportRowDraftDecision = ImportRowDraftDecision & {
  productName: string;
  rowKey: string;
  rowNumber: number;
};

type AthenaSkuContext = {
  barcode?: string;
  inventoryCount: number;
  price: number;
  productAvailability?: string;
  productId: Id<"product">;
  productName: string;
  productSkuId: Id<"productSku">;
  quantityAvailable: number;
  sku?: string;
};

type InventoryOverlayRow = {
  athenaMatch?: AthenaSkuContext;
  athenaPrice?: number;
  athenaQuantity?: number;
  delta: number;
  matchLabel: string;
  matchType: "barcode" | "sku" | "name" | "closeName" | "none";
  row: InventoryImportRow;
  status: "matched" | "new" | "review";
  statusLabel: string;
};

const OVERLAY_FILTERS: Array<{
  label: string;
  value: InventoryOverlayFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Matched", value: "matched" },
  { label: "Needs review", value: "review" },
  { label: "New items", value: "new" },
  { label: "Needs decision", value: "needs_decision" },
  { label: "Decided", value: "decided" },
];

const OVERLAY_FILTER_SELECT_OPTIONS = OVERLAY_FILTERS.map((filter) => ({
  ...filter,
  label: `Status: ${filter.label}`,
}));

function parseInventoryOverlayFilter(value: unknown): InventoryOverlayFilter | null {
  if (typeof value !== "string") return null;
  return OVERLAY_FILTERS.some((filter) => filter.value === value)
    ? (value as InventoryOverlayFilter)
    : null;
}

function parseInventoryOverlayQuery(value: unknown) {
  return typeof value === "string" ? normalizeSkuSearchQuery(value) : "";
}

function parseInventoryOverlayPage(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

const INVENTORY_IMPORT_ROUTE_DRAFT_STORAGE_KEY =
  "athena:operations:inventory-import-route-draft";

type InventoryImportRouteDraft = {
  fileName: string;
  notes: string;
  rawContent: string;
  storeId?: string;
};

function saveInventoryImportRouteDraft(draft: InventoryImportRouteDraft) {
  if (typeof window === "undefined") return;

  window.sessionStorage.setItem(
    INVENTORY_IMPORT_ROUTE_DRAFT_STORAGE_KEY,
    JSON.stringify(draft),
  );
}

function readInventoryImportRouteDraft(storeId?: string): InventoryImportRouteDraft | null {
  if (typeof window === "undefined") return null;

  const rawDraft = window.sessionStorage.getItem(
    INVENTORY_IMPORT_ROUTE_DRAFT_STORAGE_KEY,
  );
  if (!rawDraft) return null;

  try {
    const draft = JSON.parse(rawDraft) as Partial<InventoryImportRouteDraft>;
    if (!draft.rawContent || (draft.storeId && draft.storeId !== storeId)) return null;

    return {
      fileName: draft.fileName ?? "",
      notes: draft.notes ?? "",
      rawContent: draft.rawContent,
      storeId: draft.storeId,
    };
  } catch {
    return null;
  }
}

export function InventoryImportView({
  mode = "import",
}: {
  mode?: "import" | "review";
}) {
  const { activeStore } = useGetActiveStore();
  const terminal = useGetTerminal();
  const managerElevation = useOptionalManagerElevation();
  const adminState = useProtectedAdminPageState({ surface: "store_day" });
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    filter?: unknown;
    page?: unknown;
    q?: unknown;
    review?: unknown;
  };
  const overlayFilterFromSearch = parseInventoryOverlayFilter(search.filter);
  const overlayQueryFromSearch = parseInventoryOverlayQuery(search.q);
  const overlayPageFromSearch = parseInventoryOverlayPage(search.page);
  const isReviewRoute = mode === "review";
  const saveReviewVersion = useMutation(
    api.inventory.catalogImport.saveInventoryImportReviewVersion,
  );
  const stageReviewRowsForPos = useMutation(
    api.inventory.catalogImport.stageInventoryImportReviewRowsForPos,
  );
  const activeManagerElevation = managerElevation?.activeElevation;
  const effectiveManagerElevationId = activeManagerElevation?.elevationId;
  const effectiveTerminalId = activeManagerElevation?.terminalId ?? terminal?._id;
  const hasManagerElevation = Boolean(managerElevation?.activeElevation);
  const canImportInventory =
    adminState.hasFullAdminAccess || (hasManagerElevation && Boolean(effectiveTerminalId));
  const latestReviewVersion = useQuery(
    api.inventory.catalogImport.getLatestInventoryImportReviewVersion,
    activeStore?._id && canImportInventory
      ? {
          managerElevationId: effectiveManagerElevationId,
          storeId: activeStore._id as Id<"store">,
          terminalId: effectiveTerminalId,
        }
      : "skip",
  );
  const inventorySkuContextResult = useQuery(
    api.inventory.catalogImport.listInventoryImportReviewSkuContext,
    activeStore?._id && canImportInventory
      ? {
          managerElevationId: effectiveManagerElevationId,
          storeId: activeStore._id as Id<"store">,
          terminalId: effectiveTerminalId,
        }
      : "skip",
  );
  const inventorySkuContext = useMemo(
    () => (Array.isArray(inventorySkuContextResult) ? inventorySkuContextResult : []),
    [inventorySkuContextResult],
  );
  const isInventorySkuContextLoading =
    inventorySkuContextResult === undefined && Boolean(activeStore?._id && canImportInventory);
  const [fileName, setFileName] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [notes, setNotes] = useState("");
  const [isSavingReviewVersion, setIsSavingReviewVersion] = useState(false);
  const [isStagingReviewForPos, setIsStagingReviewForPos] = useState(false);
  const [draftAutosaveStatus, setDraftAutosaveStatus] = useState<
    "idle" | "pending" | "saving" | "saved" | "error"
  >("idle");
  const [isSourceExpanded, setIsSourceExpanded] = useState(true);
  const [lastSavedReviewVersion, setLastSavedReviewVersion] = useState<{
    _id: Id<"inventoryImportReviewVersion">;
    createdAt: number;
    versionNumber: number;
  } | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [overlayPage, setOverlayPage] = useState(() => overlayPageFromSearch);
  const [overlayFilter, setOverlayFilterState] = useState<InventoryOverlayFilter>(
    () => overlayFilterFromSearch ?? "all",
  );
  const [overlayQuery, setOverlayQuery] = useState(() => overlayQueryFromSearch);
  const [rowDraftDecisions, setRowDraftDecisions] = useState<
    Record<string, ImportRowDraftDecision>
  >({});
  const [isReviewModeState, setIsReviewModeState] = useState(false);
  const [previewColumnVisibility, setPreviewColumnVisibility] =
    useState<PreviewColumnVisibility>(DEFAULT_PREVIEW_COLUMN_VISIBILITY);
  const autoLoadedReviewVersionIdRef = useRef<string | null>(null);
  const lastSavedDraftSignatureRef = useRef("");
  const draftAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHydratingReviewVersionRef = useRef(false);
  const didRunSourceResetRef = useRef(false);

  const updateReviewSearch = useCallback(
    ({
      filter,
      page,
      query,
      review,
    }: {
      filter?: InventoryOverlayFilter | null;
      page?: number | null;
      query?: string | null;
      review?: boolean;
    }) => {
      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) => {
          const nextSearch = { ...current };

          if (review !== undefined) {
            if (review) {
              nextSearch.review = "1";
            } else {
              delete nextSearch.review;
              delete nextSearch.filter;
              delete nextSearch.page;
              delete nextSearch.q;
            }
          }

          if (filter !== undefined) {
            if (filter) {
              nextSearch.filter = filter;
            } else {
              delete nextSearch.filter;
            }
          }

          if (page !== undefined) {
            if (page && page > 1) {
              nextSearch.page = page;
            } else {
              delete nextSearch.page;
            }
          }

          if (query !== undefined) {
            const nextQuery = normalizeSkuSearchQuery(query);
            if (nextQuery) {
              nextSearch.q = nextQuery;
            } else {
              delete nextSearch.q;
            }
          }

          return nextSearch;
        }) as never,
      });
    },
    [navigate],
  );

  const setReviewMode = useCallback(
    (nextReviewMode: boolean, nextFilter = overlayFilter) => {
      setIsReviewModeState(nextReviewMode);
      if (!nextReviewMode) {
        void navigate({
          params: ((params: {
            orgUrlSlug?: string;
            storeUrlSlug?: string;
          }) => ({
            ...params,
            orgUrlSlug: params.orgUrlSlug!,
            storeUrlSlug: params.storeUrlSlug!,
          })) as never,
          search: ((current: Record<string, unknown>) => {
            const nextSearch = { ...current };
            delete nextSearch.filter;
            delete nextSearch.page;
            delete nextSearch.q;
            delete nextSearch.review;
            return nextSearch;
          }) as never,
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import",
        });
        return;
      }

      updateReviewSearch({ filter: nextFilter, page: overlayPage, query: overlayQuery });
    },
    [navigate, overlayFilter, overlayPage, overlayQuery, updateReviewSearch],
  );

  const setOverlayFilter = useCallback(
    (nextFilter: InventoryOverlayFilter) => {
      setOverlayFilterState(nextFilter);
      if (isReviewRoute || isReviewModeState) {
        setOverlayPage(1);
        updateReviewSearch({ filter: nextFilter, page: null });
      }
    },
    [isReviewModeState, isReviewRoute, updateReviewSearch],
  );

  const handleOverlayQueryChange = useCallback(
    (nextQuery: string) => {
      setOverlayQuery(nextQuery);
      if (isReviewRoute || isReviewModeState) {
        setOverlayPage(1);
        updateReviewSearch({ page: null, query: nextQuery });
      }
    },
    [isReviewModeState, isReviewRoute, updateReviewSearch],
  );

  const handleClearOverlayFilters = useCallback(() => {
    setOverlayFilterState("all");
    setOverlayQuery("");
    setOverlayPage(1);
    if (isReviewRoute || isReviewModeState) {
      updateReviewSearch({ filter: "all", page: null, query: null });
    }
  }, [isReviewModeState, isReviewRoute, updateReviewSearch]);

  const parseResult = useMemo<InventoryImportParseResult | null>(() => {
    if (!rawContent.trim()) return null;
    return parseInventoryImportContent({ content: rawContent, fileName });
  }, [fileName, rawContent]);

  const importKey = useMemo(() => {
    if (!parseResult || parseResult.rows.length === 0) return "";
    return `inventory-import:${activeStore?._id ?? "store"}:${hashString(rawContent)}`;
  }, [activeStore?._id, parseResult, rawContent]);
  const reviewVersionKey = useMemo(() => {
    if (!rawContent.trim()) return "";
    return `inventory-import-review:${activeStore?._id ?? "store"}:${hashString(rawContent)}`;
  }, [activeStore?._id, rawContent]);

  const previewRowCount = parseResult?.rows.length ?? 0;
  const previewPageCount = Math.max(
    1,
    Math.ceil(previewRowCount / IMPORT_TABLE_PAGE_SIZE),
  );
  const visiblePreviewPage = Math.min(previewPage, previewPageCount);
  const previewRows =
    parseResult?.rows.slice(
      (visiblePreviewPage - 1) * IMPORT_TABLE_PAGE_SIZE,
      visiblePreviewPage * IMPORT_TABLE_PAGE_SIZE,
    ) ?? [];
  const visiblePreviewColumns = PREVIEW_COLUMNS.filter(
    (column) => previewColumnVisibility[column.id],
  );
  const overlayRows = useMemo(
    () => sortInventoryOverlayRows(buildInventoryOverlayRows(parseResult?.rows ?? [], inventorySkuContext)),
    [inventorySkuContext, parseResult?.rows],
  );
  const overlaySummary = useMemo(() => summarizeOverlayRows(overlayRows), [overlayRows]);
  const normalizedOverlayQuery = normalizeSkuSearchQuery(overlayQuery);
  const needsReviewMetricProps =
    overlaySummary.review > 0
      ? {
          className: "border-action-workflow-border bg-action-workflow-soft/60",
          labelClassName: "text-action-workflow",
          valueClassName: "text-action-workflow",
        }
      : {};
  const matchesOverlayStatusFilter = useCallback(
    (row: InventoryOverlayRow) => {
      const decision = rowDraftDecisions[getOverlayDecisionKey(row)];

      if (overlayFilter === "all") return true;
      if (overlayFilter === "decided") return hasDraftDecisionValue(decision ?? {});
      if (overlayFilter === "needs_decision") {
        return !isOverlayRowDecisionComplete(row, decision);
      }

      return row.status === overlayFilter;
    },
    [overlayFilter, rowDraftDecisions],
  );
  const overlayRowsMatchingQuery = useMemo(
    () =>
      normalizedOverlayQuery
        ? overlayRows.filter((row) =>
            matchesInventoryOverlayRowSearch(row, normalizedOverlayQuery),
          )
        : overlayRows,
    [normalizedOverlayQuery, overlayRows],
  );
  const filteredOverlayRows = useMemo(
    () =>
      normalizedOverlayQuery
        ? overlayRowsMatchingQuery
        : overlayRows.filter(matchesOverlayStatusFilter),
    [
      matchesOverlayStatusFilter,
      normalizedOverlayQuery,
      overlayRows,
      overlayRowsMatchingQuery,
    ],
  );
  const selectedStatusQueryHitCount = useMemo(
    () =>
      normalizedOverlayQuery
        ? overlayRowsMatchingQuery.filter(matchesOverlayStatusFilter).length
        : filteredOverlayRows.length,
    [
      filteredOverlayRows.length,
      matchesOverlayStatusFilter,
      normalizedOverlayQuery,
      overlayRowsMatchingQuery,
    ],
  );
  const crossStatusQueryHitCount =
    normalizedOverlayQuery && overlayFilter !== "all"
      ? filteredOverlayRows.length - selectedStatusQueryHitCount
      : 0;
  const overlayPageCount = Math.max(
    1,
    Math.ceil(filteredOverlayRows.length / IMPORT_TABLE_PAGE_SIZE),
  );
  const visibleOverlayPage = Math.min(overlayPage, overlayPageCount);
  const visibleOverlayRows = filteredOverlayRows.slice(
    (visibleOverlayPage - 1) * IMPORT_TABLE_PAGE_SIZE,
    visibleOverlayPage * IMPORT_TABLE_PAGE_SIZE,
  );
  const bulkDecisionSummary = useMemo(
    () => getBulkImportReviewDecisionSummary(filteredOverlayRows),
    [filteredOverlayRows],
  );
  const pendingImportActionCount = overlayRows.filter(
    (row) => !isOverlayRowDecisionComplete(row, rowDraftDecisions[getOverlayDecisionKey(row)]),
  ).length;
  const completedImportActionCount = overlayRows.length - pendingImportActionCount;
  const hasValidRows =
    Boolean(parseResult) &&
    parseResult!.rows.length > 0 &&
    parseResult!.errors.length === 0 &&
    Boolean(activeStore?._id);
  const hasReviewableContent =
    Boolean(parseResult) && Boolean(rawContent.trim()) && Boolean(activeStore?._id);
  const canSaveImportHandoff = hasReviewableContent;
  const canStageReviewForPos = canSaveImportHandoff && pendingImportActionCount === 0;
  const shouldShowCollapsedSource =
    Boolean(rawContent.trim()) && Boolean(parseResult) && !isSourceExpanded;
  const isReviewMode = (isReviewRoute || isReviewModeState) && Boolean(parseResult);
  const savedRowDraftDecisions = useMemo(
    () =>
      buildSavedRowDraftDecisions({
        rows: overlayRows,
        rowDraftDecisions,
      }),
    [overlayRows, rowDraftDecisions],
  );
  const draftSignature = useMemo(
    () => getDraftAutosaveSignature(savedRowDraftDecisions),
    [savedRowDraftDecisions],
  );
  const hasUnsavedRowDraftDecisions =
    savedRowDraftDecisions.length > 0 &&
    draftSignature !== lastSavedDraftSignatureRef.current;
  const hasUnsavedReviewSource =
    hasReviewableContent && !lastSavedReviewVersion?._id;
  const hasActiveImportSaveWork =
    isSavingReviewVersion ||
    isStagingReviewForPos ||
    draftAutosaveStatus === "pending" ||
    draftAutosaveStatus === "saving" ||
    draftAutosaveStatus === "error";
  const shouldBlockUpdateApply =
    hasActiveImportSaveWork || hasUnsavedRowDraftDecisions || hasUnsavedReviewSource;

  useUpdateApplyBlocker({
    active: shouldBlockUpdateApply,
    guidance: "Save the current import work before refreshing.",
    label: "Inventory import",
    priority: hasActiveImportSaveWork ? "active-command" : "resume-required",
    surfaceId: "operations.inventory-import",
  });

  useEffect(() => {
    if (isHydratingReviewVersionRef.current) {
      isHydratingReviewVersionRef.current = false;
      return;
    }

    if (!didRunSourceResetRef.current) {
      didRunSourceResetRef.current = true;
      return;
    }

    setPreviewPage(1);
    setOverlayPage(1);
    setOverlayQuery("");
    setRowDraftDecisions({});
    lastSavedDraftSignatureRef.current = "";
    setDraftAutosaveStatus("idle");
  }, [fileName, rawContent]);

  useEffect(() => {
    setOverlayPage(1);
  }, [normalizedOverlayQuery, overlayFilter]);

  useEffect(() => {
    if (!isReviewRoute || !parseResult) return;

    if (overlayFilterFromSearch && overlayFilterFromSearch !== overlayFilter) {
      setOverlayFilterState(overlayFilterFromSearch);
    }
    if (overlayPageFromSearch !== overlayPage) {
      setOverlayPage(overlayPageFromSearch);
    }
    if (overlayQueryFromSearch !== overlayQuery) {
      setOverlayQuery(overlayQueryFromSearch);
    }
  }, [
    isReviewRoute,
    overlayFilter,
    overlayFilterFromSearch,
    overlayPage,
    overlayPageFromSearch,
    overlayQuery,
    overlayQueryFromSearch,
    parseResult,
  ]);

  useEffect(() => {
    if (!isReviewRoute || rawContent.trim() || !activeStore?._id) return;

    const draft = readInventoryImportRouteDraft(activeStore._id);
    if (!draft) return;

    isHydratingReviewVersionRef.current = true;
    setFileName(draft.fileName);
    setRawContent(draft.rawContent);
    setNotes(draft.notes);
    setIsSourceExpanded(false);
  }, [activeStore?._id, isReviewRoute, rawContent]);

  useEffect(() => {
    if (
      !latestReviewVersion ||
      rawContent.trim() ||
      autoLoadedReviewVersionIdRef.current === latestReviewVersion._id
    ) {
      return;
    }

    autoLoadedReviewVersionIdRef.current = latestReviewVersion._id;
    isHydratingReviewVersionRef.current = true;
    setFileName(
      latestReviewVersion.fileName ||
        `inventory-import-review-v${latestReviewVersion.versionNumber}.${latestReviewVersion.sourceFormat}`,
    );
    setRawContent(latestReviewVersion.rawContent);
    setNotes(latestReviewVersion.notes ?? "");
    const loadedDraftDecisions = mapSavedRowDraftDecisions(
      latestReviewVersion.rowDecisions ?? [],
    );
    setRowDraftDecisions(loadedDraftDecisions);
    lastSavedDraftSignatureRef.current = getDraftAutosaveSignature(
      latestReviewVersion.rowDecisions ?? [],
    );
    setDraftAutosaveStatus("saved");
    setIsSourceExpanded(false);
    setLastSavedReviewVersion({
      _id: latestReviewVersion._id,
      createdAt: latestReviewVersion.createdAt,
      versionNumber: latestReviewVersion.versionNumber,
    });
  }, [latestReviewVersion, rawContent]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setRawContent(await file.text());
    setLastSavedReviewVersion(null);
    setIsSourceExpanded(false);
    setReviewMode(false);
  };

  const saveReviewDraft = useCallback(async (mode: "auto" | "manual" = "manual") => {
    if (!activeStore?._id || !parseResult || !rawContent.trim()) return;

    const reviewNotes = buildReviewNotesWithImportActions({
      notes,
      rows: overlayRows,
      rowDraftDecisions,
    });
    const rowDecisions = buildSavedRowDraftDecisions({
      rows: overlayRows,
      rowDraftDecisions,
    });
    const draftSignature = getDraftAutosaveSignature(rowDecisions);

    setIsSavingReviewVersion(true);
    if (mode === "auto") setDraftAutosaveStatus("saving");
    try {
      const result = await runCommand(() =>
        saveReviewVersion({
          fileName: fileName || undefined,
          importKey: importKey || reviewVersionKey,
          issueCount: parseResult.errors.length,
          notes: reviewNotes || undefined,
          rawContent,
          rowDecisions,
          rowCount: parseResult.rows.length,
          sourceFormat: parseResult.format,
          storeId: activeStore._id as Id<"store">,
          managerElevationId: effectiveManagerElevationId,
          terminalId: effectiveTerminalId,
        })
      );

      if (result.kind === "ok") {
        lastSavedDraftSignatureRef.current = draftSignature;
        setLastSavedReviewVersion({
          _id: result.data._id,
          createdAt: result.data.createdAt,
          versionNumber: result.data.versionNumber,
        });
        if (mode === "auto") {
          setDraftAutosaveStatus("saved");
        } else {
          setDraftAutosaveStatus("saved");
          toast.success(`Review version ${result.data.versionNumber} saved`);
        }
        return result.data;
      }

      if (mode === "auto") setDraftAutosaveStatus("error");
      presentCommandToast(result);
      return null;
    } finally {
      setIsSavingReviewVersion(false);
    }
  }, [
    activeStore?._id,
    effectiveManagerElevationId,
    effectiveTerminalId,
    fileName,
    importKey,
    notes,
    overlayRows,
    parseResult,
    rawContent,
    reviewVersionKey,
    rowDraftDecisions,
    saveReviewVersion,
  ]);

  const handleSaveReviewVersion = () => {
    void saveReviewDraft("manual");
  };

  const handleStageReviewRowsForPos = async () => {
    if (!activeStore?._id || !parseResult || !rawContent.trim()) return;

    setIsStagingReviewForPos(true);
    try {
      const rowDecisions = buildSavedRowDraftDecisions({
        rows: overlayRows,
        rowDraftDecisions,
      });
      const draftSignature = getDraftAutosaveSignature(rowDecisions);
      const savedVersion =
        lastSavedReviewVersion?._id &&
        draftSignature === lastSavedDraftSignatureRef.current
          ? lastSavedReviewVersion
          : await saveReviewDraft("manual");
      if (!savedVersion?._id) return;

      const result = await runCommand(() =>
        stageReviewRowsForPos({
          importKey: importKey || reviewVersionKey,
          managerElevationId: effectiveManagerElevationId,
          notes: notes.trim() || undefined,
          reviewVersionId: savedVersion._id,
          rows: buildProvisionalImportStageRows({
            rows: overlayRows,
            rowDraftDecisions,
          }),
          sourceFormat: parseResult.format,
          storeId: activeStore._id as Id<"store">,
          terminalId: effectiveTerminalId,
        })
      );

      if (result.kind === "ok") {
        toast.success(
          `${formatCount(result.data.rowsStaged, "row")} available in POS pending final counts`,
        );
        return;
      }

      presentCommandToast(result);
    } finally {
      setIsStagingReviewForPos(false);
    }
  };

  useEffect(() => {
    if (draftAutosaveTimerRef.current) {
      clearTimeout(draftAutosaveTimerRef.current);
      draftAutosaveTimerRef.current = null;
    }

    const rowDecisions = buildSavedRowDraftDecisions({
      rows: overlayRows,
      rowDraftDecisions,
    });
    const draftSignature = getDraftAutosaveSignature(rowDecisions);

    if (
      !hasReviewableContent ||
      rowDecisions.length === 0 ||
      draftSignature === lastSavedDraftSignatureRef.current
    ) {
      return;
    }

    if (isSavingReviewVersion) {
      setDraftAutosaveStatus("pending");
      return;
    }

    setDraftAutosaveStatus("pending");
    draftAutosaveTimerRef.current = setTimeout(() => {
      draftAutosaveTimerRef.current = null;
      void saveReviewDraft("auto");
    }, DRAFT_AUTOSAVE_DELAY_MS);

    return () => {
      if (draftAutosaveTimerRef.current) {
        clearTimeout(draftAutosaveTimerRef.current);
        draftAutosaveTimerRef.current = null;
      }
    };
  }, [
    hasReviewableContent,
    isSavingReviewVersion,
    overlayRows,
    rowDraftDecisions,
    saveReviewDraft,
  ]);

  const handleLoadLatestReviewVersion = () => {
    if (!latestReviewVersion) return;

    isHydratingReviewVersionRef.current = true;
    setFileName(
      latestReviewVersion.fileName ||
        `inventory-import-review-v${latestReviewVersion.versionNumber}.${latestReviewVersion.sourceFormat}`,
    );
    setRawContent(latestReviewVersion.rawContent);
    setNotes(latestReviewVersion.notes ?? "");
    const loadedDraftDecisions = mapSavedRowDraftDecisions(
      latestReviewVersion.rowDecisions ?? [],
    );
    setRowDraftDecisions(loadedDraftDecisions);
    lastSavedDraftSignatureRef.current = getDraftAutosaveSignature(
      latestReviewVersion.rowDecisions ?? [],
    );
    setDraftAutosaveStatus("saved");
    setIsSourceExpanded(false);
    setLastSavedReviewVersion({
      _id: latestReviewVersion._id,
      createdAt: latestReviewVersion.createdAt,
      versionNumber: latestReviewVersion.versionNumber,
    });
    autoLoadedReviewVersionIdRef.current = latestReviewVersion._id;
    setReviewMode(false);
    toast.success(`Review version ${latestReviewVersion.versionNumber} loaded`);
  };

  const handleEnterReviewMode = () => {
    const nextFilter = overlayFilterFromSearch ?? getDefaultOverlayFilter(overlaySummary);
    saveInventoryImportRouteDraft({
      fileName,
      notes,
      rawContent,
      storeId: activeStore?._id,
    });
    setOverlayFilterState(nextFilter);
    setOverlayQuery(overlayQueryFromSearch);
    setOverlayPage(1);
    setIsReviewModeState(true);
    void navigate({
      params: ((params: {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }) => ({
        ...params,
        orgUrlSlug: params.orgUrlSlug!,
        storeUrlSlug: params.storeUrlSlug!,
      })) as never,
      search: {
        filter: nextFilter,
        ...(overlayQueryFromSearch ? { q: overlayQueryFromSearch } : {}),
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import/review",
    });
  };

  const handleOverlayPageChange = (nextPage: number) => {
    setOverlayPage(nextPage);
    if (isReviewMode) {
      updateReviewSearch({ page: nextPage });
    }
  };

  const handleApplyBulkReviewDecision = (action: BulkImportReviewDecisionAction) => {
    setRowDraftDecisions((current) =>
      applyBulkImportReviewDecision({
        action,
        current,
        rows: filteredOverlayRows,
      }),
    );
  };

  if (adminState.isLoadingAccess) {
    return (
      <View hideBorder hideHeaderBottomBorder>
        <PageWorkspace className="container mx-auto py-layout-2xl">
          <PageLevelHeader
            eyebrow="Operations"
            title="Inventory import"
            description="Loading protected store access."
            showBackButton
          />
        </PageWorkspace>
      </View>
    );
  }

  if (!adminState.isAuthenticated) {
    return <ProtectedAdminSignInView description="Sign in again before importing inventory." />;
  }

  if (!canImportInventory) {
    return (
      <View hideBorder hideHeaderBottomBorder>
        <PageWorkspace className="container mx-auto py-layout-2xl">
          <PageLevelHeader
            eyebrow="Operations"
            title="Inventory import"
            description="Start manager elevation before importing inventory."
            showBackButton
          />
          <EmptyState
            icon={<UploadCloud className="h-10 w-10" />}
            title="Manager elevation required"
            description="Use the account menu to start manager elevation, then return to this import surface."
          />
        </PageWorkspace>
      </View>
    );
  }

  if (isReviewRoute && !parseResult) {
    const isLoadingReviewImport = latestReviewVersion === undefined;

    return (
      <View hideBorder hideHeaderBottomBorder>
        <PageWorkspace className="container mx-auto py-layout-2xl">
          <PageLevelHeader
            backButtonLabel="Back to import"
            eyebrow="Operations"
            title="Inventory review"
            description="Compare the loaded import with Athena inventory before applying changes."
            onNavigateBack={() => setReviewMode(false)}
            showBackButton
          />
          <EmptyState
            icon={<FileJson className="h-10 w-10" />}
            title={isLoadingReviewImport ? "Loading inventory review" : "No import loaded"}
            description={
              isLoadingReviewImport
                ? "Loading the latest saved import for review."
                : "Return to the import screen and load a saved import before reviewing inventory."
            }
          />
        </PageWorkspace>
      </View>
    );
  }

  if (isReviewMode && parseResult) {
    return (
      <View hideBorder hideHeaderBottomBorder>
        <PageWorkspace className="container mx-auto py-layout-2xl">
          <PageLevelHeader
            backButtonLabel="Back to import"
            eyebrow="Operations"
            title="Inventory review"
            description="Compare the loaded import with Athena inventory before applying changes."
            onNavigateBack={() => setReviewMode(false)}
            showBackButton
          />

          <section className="space-y-4 rounded-md border border-border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Import review</h2>
                <p className="text-sm text-muted-foreground">
                  {overlayRows.length} import row{overlayRows.length === 1 ? "" : "s"} compared
                  with Athena inventory
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <OperationsSummaryMetric
                label="Matched"
                tone="quiet"
                value={overlaySummary.matched}
              />
              <OperationsSummaryMetric
                label="Needs review"
                tone="quiet"
                value={overlaySummary.review}
                {...needsReviewMetricProps}
              />
              <OperationsSummaryMetric
                label="New items"
                tone="quiet"
                value={overlaySummary.new}
              />
              <OperationsSummaryMetric
                label="Net delta"
                tone="quiet"
                value={formatSignedQuantity(overlaySummary.netDelta)}
              />
            </div>

            <SkuSearchFilterBar
              ariaLabel="Inventory import review filters"
              className="bg-surface/60"
              filterId="inventory-import-review-status-filter"
              filterLabel="Review status"
              filterOptions={OVERLAY_FILTER_SELECT_OPTIONS}
              filterTriggerClassName="w-[190px]"
              filterValue={overlayFilter}
              hasActiveFilters={overlayFilter !== "all" || Boolean(normalizedOverlayQuery)}
              onClearFilters={handleClearOverlayFilters}
              onFilterChange={setOverlayFilter}
              onQueryChange={handleOverlayQueryChange}
              query={overlayQuery}
              searchId="inventory-import-review-search"
              searchLabel="Search import rows by product identifiers"
              searchPlaceholder="Search name, SKU, barcode, row, category, price, or qty"
              secondaryFilters={
                <div className="flex flex-wrap gap-2">
                  {OVERLAY_FILTERS.map((filter) => {
                    const isSelected = overlayFilter === filter.value;
                    return (
                      <Button
                        aria-pressed={isSelected}
                        className={cn(
                          "h-8",
                          isSelected &&
                            "border-action-workflow-border bg-action-workflow-soft text-action-workflow hover:bg-action-workflow-soft/80",
                        )}
                        key={filter.value}
                        onClick={() => setOverlayFilter(filter.value)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {filter.label}
                      </Button>
                    );
                  })}
                </div>
              }
              summary={
                <>
                  Showing {filteredOverlayRows.length} of {overlayRows.length} import rows.
                  {normalizedOverlayQuery
                    ? crossStatusQueryHitCount > 0
                      ? ` ${formatCount(crossStatusQueryHitCount, "match")} from other statuses included.`
                      : " Identifier filters are applied."
                    : ""}
                </>
              }
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border bg-surface/60 px-3 py-3">
              {pendingImportActionCount === 0 ? (
                <>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Next action</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Rows are ready for POS availability. Stage them without applying final
                      counts.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 sm:min-w-[28rem]">
                    <LoadingButton
                      className="w-56 px-4"
                      disabled={!canSaveImportHandoff || isSavingReviewVersion}
                      isLoading={isSavingReviewVersion}
                      onClick={handleSaveReviewVersion}
                      type="button"
                      variant="workflow"
                    >
                      <Save className="h-4 w-4" />
                      Save for import handoff
                    </LoadingButton>
                    <LoadingButton
                      className="w-56 px-4"
                      disabled={
                        !canStageReviewForPos ||
                        isSavingReviewVersion ||
                        isStagingReviewForPos ||
                        draftAutosaveStatus === "pending" ||
                        draftAutosaveStatus === "saving"
                      }
                      isLoading={isStagingReviewForPos}
                      onClick={handleStageReviewRowsForPos}
                      type="button"
                      variant="workflow"
                    >
                      <UploadCloud className="h-4 w-4" />
                      Make available in POS
                    </LoadingButton>
                    <DraftAutosaveStatus status={draftAutosaveStatus} />
                  </div>
                </>
              ) : overlaySummary.review > 0 ? (
                <>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Next action</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatCount(pendingImportActionCount, "row")} still need decisions.
                      {completedImportActionCount > 0
                        ? ` ${formatCount(completedImportActionCount, "row")} ready.`
                        : ""}{" "}
                      Save a draft any time and resume it later.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 sm:min-w-[28rem]">
                    <BulkImportReviewDecisionMenu
                      onApply={handleApplyBulkReviewDecision}
                      summary={bulkDecisionSummary}
                    />
                    <Button
                      onClick={() => setOverlayFilter("needs_decision")}
                      type="button"
                      variant="outline"
                    >
                      Show needs decision
                    </Button>
                    <LoadingButton
                      className="w-56 px-4"
                      disabled={!canSaveImportHandoff || isSavingReviewVersion}
                      isLoading={isSavingReviewVersion}
                      onClick={handleSaveReviewVersion}
                      type="button"
                      variant="workflow"
                    >
                      <Save className="h-4 w-4" />
                      Save for import handoff
                    </LoadingButton>
                    <DraftAutosaveStatus status={draftAutosaveStatus} />
                  </div>
                </>
              ) : overlaySummary.new > 0 ? (
                <>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Next action</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatCount(pendingImportActionCount, "row")} still need decisions.
                      {completedImportActionCount > 0
                        ? ` ${formatCount(completedImportActionCount, "row")} ready.`
                        : ""}{" "}
                      Save a draft any time and resume it later.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 sm:min-w-[28rem]">
                    <BulkImportReviewDecisionMenu
                      onApply={handleApplyBulkReviewDecision}
                      summary={bulkDecisionSummary}
                    />
                    <Button
                      onClick={() => setOverlayFilter("needs_decision")}
                      type="button"
                      variant="outline"
                    >
                      Show needs decision
                    </Button>
                    <LoadingButton
                      className="w-56 px-4"
                      disabled={!canSaveImportHandoff || isSavingReviewVersion}
                      isLoading={isSavingReviewVersion}
                      onClick={handleSaveReviewVersion}
                      type="button"
                      variant="workflow"
                    >
                      <Save className="h-4 w-4" />
                      Save for import handoff
                    </LoadingButton>
                    <DraftAutosaveStatus status={draftAutosaveStatus} />
                  </div>
                </>
              ) : null}
            </div>

            {visibleOverlayRows.length > 0 ? (
              <div className="overflow-hidden rounded-md border border-border">
                <div className="divide-y divide-border">
                  {visibleOverlayRows.map((overlayRow) => (
                    <article
                      className="grid gap-4 p-4 lg:grid-cols-[minmax(11rem,15rem)_minmax(15rem,22rem)_minmax(18rem,1fr)_14rem] lg:items-start"
                      key={`${overlayRow.row.rowNumber}-${overlayRow.row.sku ?? overlayRow.row.barcode ?? overlayRow.row.productName}`}
                    >
                      <InventoryReviewIdentity
                        source="import"
                        eyebrow="Import"
                        name={overlayRow.row.productName}
                        detail={
                          [overlayRow.row.sku, overlayRow.row.barcode]
                            .filter(Boolean)
                            .join(" / ") || `Row ${overlayRow.row.rowNumber}`
                        }
                      />

                      {overlayRow.athenaMatch ? (
                        <InventoryReviewIdentity
                          source="athena"
                          eyebrow="Athena"
                          name={overlayRow.athenaMatch.productName}
                          detail={
                            [overlayRow.athenaMatch.sku, overlayRow.athenaMatch.barcode]
                              .filter(Boolean)
                              .join(" / ") || "SKU details pending"
                          }
                          productId={overlayRow.athenaMatch.productId}
                          sku={overlayRow.athenaMatch.sku}
                        />
                      ) : (
                        <InventoryReviewIdentity
                          source="athena"
                          eyebrow="Athena"
                          name="No Athena match"
                          detail="Create or skip this import row"
                          muted
                        />
                      )}

                      <InventoryReviewChangeSummary row={overlayRow} />

                      <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:pt-3">
                        <span
                          className={cn(
                            "text-xs font-medium",
                            overlayRow.status === "review" && "text-destructive",
                            overlayRow.status === "new" && "text-emerald-700",
                            overlayRow.status === "matched" && "text-muted-foreground",
                          )}
                        >
                          {overlayRow.statusLabel}
                        </span>
                        {overlayRow.athenaMatch ? (
                          <span className="text-xs text-muted-foreground">
                            {overlayRow.matchLabel}
                          </span>
                        ) : null}
                        <ImportRowActionControl
                          decision={rowDraftDecisions[getOverlayDecisionKey(overlayRow)]}
                          row={overlayRow}
                          onChange={(decision) =>
                            setRowDraftDecisions((current) => ({
                              ...current,
                              [getOverlayDecisionKey(overlayRow)]: {
                                ...current[getOverlayDecisionKey(overlayRow)],
                                ...decision,
                              },
                            }))
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
                <ListPagination
                  page={visibleOverlayPage}
                  pageCount={overlayPageCount}
                  pageSize={IMPORT_TABLE_PAGE_SIZE}
                  totalItems={filteredOverlayRows.length}
                  onPageChange={handleOverlayPageChange}
                />
              </div>
            ) : (
              <EmptyState
                icon={<FileJson className="h-10 w-10" />}
                title="No rows in this view"
                description={
                  normalizedOverlayQuery
                    ? "Clear search or choose another review filter."
                    : "Choose another review filter."
                }
              />
            )}
          </section>
        </PageWorkspace>
      </View>
    );
  }

  return (
    <View hideBorder hideHeaderBottomBorder>
      <PageWorkspace className="container mx-auto py-layout-2xl">
        <PageLevelHeader
          eyebrow="Operations"
          title="Inventory import"
          description="Load legacy catalog rows, review validation, and write the baseline into Athena."
          showBackButton
        />

        <PageWorkspaceGrid>
          <PageWorkspaceMain>
            <section className="space-y-4 rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Source file</h2>
                  <p className="text-sm text-muted-foreground">
                    {shouldShowCollapsedSource
                      ? "Loaded import is ready for review."
                      : "CSV and JSON exports are accepted."}
                  </p>
                </div>
                {parseResult ? (
                  <Badge variant={parseResult.errors.length > 0 ? "destructive" : "secondary"}>
                    {parseResult.format.toUpperCase()}
                  </Badge>
                ) : null}
              </div>

              {shouldShowCollapsedSource ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {fileName || "Loaded import"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {parseResult?.rows.length ?? 0} row
                      {(parseResult?.rows.length ?? 0) === 1 ? "" : "s"} -{" "}
                      {parseResult?.errors.length ?? 0} issue
                      {(parseResult?.errors.length ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setReviewMode(false);
                      setIsSourceExpanded(true);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Replace source
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="inventory-import-file">File</Label>
                    <Input
                      id="inventory-import-file"
                      accept=".csv,.json,application/json,text/csv"
                      type="file"
                      onChange={handleFileChange}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="inventory-import-content">Raw export</Label>
                    <Textarea
                      id="inventory-import-content"
                      className="min-h-52 font-mono text-xs"
                      value={rawContent}
                      onChange={(event) => {
                        setFileName(fileName || "manual.csv");
                        setRawContent(event.target.value);
                        setLastSavedReviewVersion(null);
                        setReviewMode(false);
                      }}
                    />
                  </div>
                </>
              )}
            </section>

            {parseResult ? (
              <section className="space-y-4 rounded-md border border-border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Inventory check</h2>
                    <p className="text-sm text-muted-foreground">
                      Compare the loaded file with current stock before applying changes.
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <OperationsSummaryMetric
                    label="Matched"
                    tone="quiet"
                    value={overlaySummary.matched}
                  />
                  <OperationsSummaryMetric
                    label="Needs review"
                    tone="quiet"
                    value={overlaySummary.review}
                    {...needsReviewMetricProps}
                  />
                  <OperationsSummaryMetric
                    label="New items"
                    tone="quiet"
                    value={overlaySummary.new}
                  />
                  <OperationsSummaryMetric
                    label="Net delta"
                    tone="quiet"
                    value={formatSignedQuantity(overlaySummary.netDelta)}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 rounded-md border border-border bg-surface p-3">
                  <Button
                    disabled={!hasValidRows || isInventorySkuContextLoading}
                    onClick={handleEnterReviewMode}
                    type="button"
                    variant="workflow"
                  >
                    Review inventory changes
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </section>
            ) : null}

            <section className="space-y-4 rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Source preview</h2>
                  <p className="text-sm text-muted-foreground">
                    {parseResult
                      ? `${parseResult.rows.length} row${parseResult.rows.length === 1 ? "" : "s"} ready`
                      : "No rows loaded"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="h-8" size="sm" variant="outline">
                        <Columns3 className="mr-2 h-4 w-4" />
                        Columns
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[170px]">
                      <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {PREVIEW_COLUMNS.map((column) => (
                        <DropdownMenuCheckboxItem
                          checked={previewColumnVisibility[column.id]}
                          key={column.id}
                          onCheckedChange={(checked) =>
                            setPreviewColumnVisibility((current) => ({
                              ...current,
                              [column.id]: Boolean(checked),
                            }))
                          }
                        >
                          {column.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {parseResult?.errors.length ? (
                    <Badge variant="destructive">{parseResult.errors.length} issue</Badge>
                  ) : null}
                </div>
              </div>

              {parseResult?.errors.length ? (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  {parseResult.errors.slice(0, 12).map((error) => (
                    <p className="text-sm text-destructive" key={error}>
                      {error}
                    </p>
                  ))}
                </div>
              ) : null}

              {previewRows.length > 0 ? (
                <div className="overflow-hidden rounded-md border border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="border-b bg-surface text-xs uppercase text-muted-foreground">
                        <tr>
                          {visiblePreviewColumns.map((column, index) => (
                            <th
                              className={[
                                "py-2 pr-3",
                                index === 0 ? "pl-3" : "",
                                column.align === "right" ? "text-right" : "",
                              ].filter(Boolean).join(" ")}
                              key={column.id}
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {previewRows.map((row) => (
                          <tr key={`${row.rowNumber}-${row.sku ?? row.barcode}`}>
                            {visiblePreviewColumns.map((column, index) => (
                              <td
                                className={[
                                  "py-3 pr-3",
                                  index === 0 ? "pl-3 font-medium" : "",
                                  column.align === "right" ? "text-right" : "",
                                ].filter(Boolean).join(" ")}
                                key={column.id}
                              >
                                {column.render(row)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ListPagination
                    page={visiblePreviewPage}
                    pageCount={previewPageCount}
                    pageSize={IMPORT_TABLE_PAGE_SIZE}
                    totalItems={previewRowCount}
                    onPageChange={setPreviewPage}
                  />
                </div>
              ) : rawContent.trim() ? null : (
                <EmptyState
                  icon={<FileJson className="h-10 w-10" />}
                  title="No import rows"
                  description="Choose a file or paste an export."
                />
              )}
            </section>

          </PageWorkspaceMain>

          <PageWorkspaceRail>
            <aside className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
              <div className="flex items-start justify-between gap-layout-md">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Import status
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">Review import</h2>
                </div>
                <Badge variant={parseResult?.errors.length ? "destructive" : "secondary"}>
                  {hasValidRows ? "Ready" : "Review"}
                </Badge>
              </div>
              <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
                Save the current export as a server review version before using the
                dedicated import workflow.
              </p>

              <div className="mt-layout-md space-y-layout-sm">
                {hasManagerElevation && !adminState.hasFullAdminAccess ? (
                  <Badge variant="secondary">
                    Elevated as {activeManagerElevation?.displayName}
                  </Badge>
                ) : null}
                <div className="grid grid-cols-2 gap-layout-sm">
                  <OperationsSummaryMetric
                    label="Rows"
                    tone="quiet"
                    value={parseResult?.rows.length ?? 0}
                  />
                  <OperationsSummaryMetric
                    label="Issues"
                    tone="quiet"
                    value={parseResult?.errors.length ?? 0}
                  />
                  <OperationsSummaryMetric
                    label="Review"
                    tone="quiet"
                    value={overlaySummary.review}
                  />
                  <OperationsSummaryMetric
                    label="New"
                    tone="quiet"
                    value={overlaySummary.new}
                  />
                  <OperationsSummaryMetric
                    label="Format"
                    tone="quiet"
                    value={parseResult ? parseResult.format.toUpperCase() : "-"}
                  />
                </div>
              </div>

              <div className="mt-layout-md space-y-layout-sm">
                <Label htmlFor="inventory-import-notes">Notes</Label>
                <Textarea
                  id="inventory-import-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>

              <LoadingButton
                className="mt-layout-sm w-full"
                disabled={!hasReviewableContent || isSavingReviewVersion}
                isLoading={isSavingReviewVersion}
                onClick={handleSaveReviewVersion}
                variant="outline"
              >
                <Save className="mr-2 h-4 w-4" />
                Save review version
              </LoadingButton>

              <div className="mt-layout-md border-t border-border pt-layout-md">
                <p className="text-sm font-medium">Saved review version</p>
                {latestReviewVersion ? (
                  <div className="mt-layout-sm space-y-layout-sm">
                    <p className="text-sm leading-6 text-muted-foreground">
                      Version {latestReviewVersion.versionNumber} -{" "}
                      {latestReviewVersion.rowCount} row
                      {latestReviewVersion.rowCount === 1 ? "" : "s"} -{" "}
                      {latestReviewVersion.issueCount} issue
                      {latestReviewVersion.issueCount === 1 ? "" : "s"} -{" "}
                      {formatReviewVersionTime(latestReviewVersion.createdAt)}
                    </p>
                    <Button
                      className="w-full"
                      onClick={handleLoadLatestReviewVersion}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Load saved version
                    </Button>
                  </div>
                ) : (
                  <p className="mt-layout-xs text-sm leading-6 text-muted-foreground">
                    Save the current export to keep a server copy for review.
                  </p>
                )}
                {lastSavedReviewVersion ? (
                  <p className="mt-layout-sm text-xs text-muted-foreground">
                    Last saved: version {lastSavedReviewVersion.versionNumber} -{" "}
                    {formatReviewVersionTime(lastSavedReviewVersion.createdAt)}
                  </p>
                ) : null}
              </div>
            </aside>

          </PageWorkspaceRail>
        </PageWorkspaceGrid>
      </PageWorkspace>
    </View>
  );
}

function ImportRowActionControl({
  decision,
  onChange,
  row,
}: {
  decision?: ImportRowDraftDecision;
  onChange: (decision: ImportRowDraftDecision) => void;
  row: InventoryOverlayRow;
}) {
  if (row.status === "matched") {
    return (
      <Badge className="border-border bg-transparent text-muted-foreground" variant="secondary">
        Ready
      </Badge>
    );
  }

  if (row.status === "new") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
        <DraftChoiceButton
          isSelected={decision?.action === "create_item"}
          label="Create item"
          onClick={() =>
            onChange({
              action: decision?.action === "create_item" ? undefined : "create_item",
            })
          }
        />
        <DraftChoiceButton
          isSelected={decision?.action === "skip_row"}
          label="Skip"
          onClick={() =>
            onChange({
              action: decision?.action === "skip_row" ? undefined : "skip_row",
            })
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-2 text-xs lg:min-w-52">
      {doesOverlayRowNeedNameDecision(row.row, row.athenaMatch) ? (
        <DraftSourceControl
          label="Name"
          source={decision?.nameSource}
          onChange={(nameSource) => onChange({ nameSource })}
        />
      ) : null}
      {row.delta !== 0 ? (
        <DraftSourceControl
          label="Qty"
          source={decision?.quantitySource}
          onChange={(quantitySource) => onChange({ quantitySource })}
        />
      ) : null}
      {row.athenaPrice !== undefined && row.row.price !== row.athenaPrice ? (
        <DraftSourceControl
          label="Price"
          source={decision?.priceSource}
          onChange={(priceSource) => onChange({ priceSource })}
        />
      ) : null}
      <DraftChoiceButton
        isSelected={decision?.action === "skip_row"}
        label="Skip row"
        onClick={() =>
          onChange({
            action: decision?.action === "skip_row" ? undefined : "skip_row",
          })
        }
      />
    </div>
  );
}

function BulkImportReviewDecisionMenu({
  onApply,
  summary,
}: {
  onApply: (action: BulkImportReviewDecisionAction) => void;
  summary: BulkImportReviewDecisionSummary;
}) {
  if (summary.actionableRows === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-9 px-3" type="button" variant="outline">
          <ListChecks className="h-4 w-4" />
          Apply to {summary.actionableRows.toLocaleString()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Apply decision</DropdownMenuLabel>
        <div className="px-2 pb-1 text-xs leading-5 text-muted-foreground">
          Updates all decision rows in the current results.
        </div>
        <DropdownMenuSeparator />
        {summary.newRows > 0 ? (
          <DropdownMenuItem onSelect={() => onApply("create_new_items")}>
            Create {formatCount(summary.newRows, "new item")}
          </DropdownMenuItem>
        ) : null}
        {summary.reviewRows > 0 ? (
          <>
            <DropdownMenuItem onSelect={() => onApply("use_import_values")}>
              Use import values for {formatCount(summary.reviewRows, "review row")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onApply("use_athena_values")}>
              Use Athena values for {formatCount(summary.reviewRows, "review row")}
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onApply("skip_rows")}>
          Skip {formatCount(summary.actionableRows, "row")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onApply("clear_choices")}>
          Clear choices for {formatCount(summary.actionableRows, "row")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DraftSourceControl({
  label,
  onChange,
  source,
}: {
  label: string;
  onChange: (source: ImportDraftSource | undefined) => void;
  source?: ImportDraftSource;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="min-w-10 text-muted-foreground">{label}</span>
      <DraftChoiceButton
        isSelected={source === "import"}
        label="Import"
        onClick={() => onChange(source === "import" ? undefined : "import")}
      />
      <DraftChoiceButton
        isSelected={source === "athena"}
        label="Athena"
        onClick={() => onChange(source === "athena" ? undefined : "athena")}
      />
    </div>
  );
}

function DraftChoiceButton({
  isSelected,
  label,
  onClick,
}: {
  isSelected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-pressed={isSelected}
      className={cn(
        "h-7 px-2.5 text-xs",
        isSelected &&
          "border-action-workflow-border bg-action-workflow-soft text-action-workflow hover:bg-action-workflow-soft/80",
      )}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {label}
    </Button>
  );
}

function DraftAutosaveStatus({
  status,
}: {
  status: "idle" | "pending" | "saving" | "saved" | "error";
}) {
  const label = getDraftAutosaveStatusLabel(status);

  return (
    <span
      className={cn(
        "inline-flex h-9 w-28 items-center justify-end text-right text-xs text-muted-foreground",
        status === "idle" && "invisible",
        status === "error" && "text-destructive",
      )}
      aria-hidden={status === "idle" ? "true" : undefined}
    >
      {label || "Draft status"}
    </span>
  );
}

function InventoryReviewIdentity({
  detail,
  eyebrow,
  muted = false,
  name,
  productId,
  sku,
  source,
}: {
  detail: string;
  eyebrow: string;
  muted?: boolean;
  name: string;
  productId?: Id<"product">;
  sku?: string;
  source: "import" | "athena";
}) {
  const displayName = productId ? capitalizeWords(name) : name;
  const content = (
    <div className="min-w-0">
      <p
        className={cn(
          "text-xs font-semibold uppercase",
          source === "import" && "text-comparison-primary",
          source === "athena" && "text-comparison-secondary",
        )}
      >
        {eyebrow}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-medium leading-5",
          muted && "text-muted-foreground",
        )}
      >
        {productId ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
            <span className="min-w-0 truncate">{displayName}</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </span>
        ) : (
          displayName
        )}
      </p>
      <p
        className={cn(
          "mt-1 break-words text-xs leading-5",
          "text-muted-foreground",
          muted && "text-muted-foreground",
        )}
      >
        {detail}
      </p>
    </div>
  );

  if (!productId) return content;

  return (
    <Link
      className="min-w-0 rounded-sm outline-none transition-colors hover:text-action-workflow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      params={(params) => ({
        ...params,
        orgUrlSlug: params.orgUrlSlug!,
        productSlug: productId,
        storeUrlSlug: params.storeUrlSlug!,
      })}
      search={{
        o: getOrigin(),
        variant: sku,
      }}
      to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
    >
      {content}
    </Link>
  );
}

function InventoryReviewChangeSummary({
  row,
}: {
  row: InventoryOverlayRow;
}) {
  const importPrice = formatStoredCurrencyAmount("GHS", row.row.price, {
    revealMinorUnits: true,
  });
  const athenaPrice =
    row.athenaPrice === undefined
      ? "-"
      : formatStoredCurrencyAmount("GHS", row.athenaPrice, {
          revealMinorUnits: true,
        });

  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground lg:pt-4">
      <span>
        Qty{" "}
        <span className="font-medium text-foreground">{row.row.quantity}</span>
        {" import vs "}
        <span className="font-medium text-foreground">{row.athenaQuantity ?? "-"}</span>
        {" Athena"}
        <span
          className={cn(
            "ml-2 font-medium",
            row.delta > 0 && "text-emerald-700",
            row.delta < 0 && "text-destructive",
          )}
        >
          ({formatSignedQuantity(row.delta)})
        </span>
      </span>
      <span>
        Price{" "}
        <span className="font-medium text-foreground">{importPrice}</span>
        {" import vs "}
        <span className="font-medium text-foreground">{athenaPrice}</span>
        {" Athena"}
      </span>
    </p>
  );
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildInventoryOverlayRows(
  importRows: InventoryImportRow[],
  athenaSkus: AthenaSkuContext[],
): InventoryOverlayRow[] {
  const barcodeMatches = new Map<string, AthenaSkuContext>();
  const skuMatches = new Map<string, AthenaSkuContext>();
  const productNameCandidates = new Map<string, AthenaSkuContext[]>();
  const productNameFuzzyEntries: Array<FuzzySearchEntry<AthenaSkuContext>> = [];

  athenaSkus.forEach((athenaSku) => {
    const barcodeKey = normalizeOverlayIdentifierKey(athenaSku.barcode);
    if (barcodeKey && !barcodeMatches.has(barcodeKey)) {
      barcodeMatches.set(barcodeKey, athenaSku);
    }

    const skuKey = normalizeOverlayIdentifierKey(athenaSku.sku);
    if (skuKey && !skuMatches.has(skuKey)) {
      skuMatches.set(skuKey, athenaSku);
    }

    const nameKey = normalizeOverlayNameKey(athenaSku.productName);
    if (nameKey) {
      productNameCandidates.set(nameKey, [
        ...(productNameCandidates.get(nameKey) ?? []),
        athenaSku,
      ]);
      productNameFuzzyEntries.push(
        createFuzzySearchEntry(athenaSku, {
          productName: athenaSku.productName,
        }),
      );
    }
  });

  return importRows.map((row) => {
    const barcodeKey = normalizeOverlayIdentifierKey(row.barcode);
    const skuKey = normalizeOverlayIdentifierKey(row.sku);
    const nameKey = normalizeOverlayNameKey(row.productName);
    const nameMatches = nameKey ? productNameCandidates.get(nameKey) ?? [] : [];
    const barcodeMatch = barcodeKey ? barcodeMatches.get(barcodeKey) : undefined;
    const skuMatch = skuKey ? skuMatches.get(skuKey) : undefined;
    const nameMatch = selectBestExactNameMatch(nameMatches, row);
    const closeNameMatch =
      barcodeMatch || skuMatch || nameMatch
        ? undefined
        : findBestCloseNameMatch(row.productName, productNameFuzzyEntries);
    const match = barcodeMatch ?? skuMatch ?? nameMatch ?? closeNameMatch;
    const matchType = barcodeMatch
      ? "barcode"
      : skuMatch
        ? "sku"
        : nameMatch
          ? "name"
          : closeNameMatch
            ? "closeName"
            : "none";
    const athenaQuantity = match?.quantityAvailable;
    const delta = row.quantity - (athenaQuantity ?? 0);

    if (!match) {
      return {
        delta,
        matchLabel: "No Athena match",
        matchType,
        row,
        status: "new",
        statusLabel: "New item",
      };
    }

    const priceChanged = row.price !== match.price;
    const quantityChanged = delta !== 0;
    const nameChanged = doesOverlayRowNeedNameDecision(row, match);
    const archivedMatch = match.productAvailability === "archived";
    const status =
      priceChanged || quantityChanged || nameChanged || archivedMatch ? "review" : "matched";

    return {
      athenaMatch: match,
      athenaPrice: match.price,
      athenaQuantity,
      delta,
      matchLabel: getOverlayMatchLabel(matchType),
      matchType,
      row,
      status,
      statusLabel: getOverlayStatusLabel({
        archivedMatch,
        nameChanged,
        priceChanged,
        quantityChanged,
      }),
    };
  });
}

function sortInventoryOverlayRows(rows: InventoryOverlayRow[]) {
  return [...rows].sort((left, right) => {
    const nameOrder = left.row.productName.localeCompare(right.row.productName, undefined, {
      numeric: true,
      sensitivity: "base",
    });

    if (nameOrder !== 0) return nameOrder;

    return left.row.rowNumber - right.row.rowNumber;
  });
}

function matchesInventoryOverlayRowSearch(row: InventoryOverlayRow, query: string) {
  return matchesSkuSearchTerms(
    [
      row.row.productName,
      row.row.sku,
      row.row.barcode,
      row.row.category,
      row.row.subcategory,
      row.row.size,
      row.row.color,
      row.row.length,
      row.row.weight,
      row.row.status,
      row.row.rowNumber,
      row.row.price,
      row.row.unitCost,
      row.row.quantity,
      row.athenaMatch?.productName,
      row.athenaMatch?.sku,
      row.athenaMatch?.barcode,
      row.athenaMatch?.productAvailability,
      row.athenaMatch?.inventoryCount,
      row.athenaMatch?.price,
      row.athenaMatch?.quantityAvailable,
      row.matchLabel,
      row.statusLabel,
    ],
    query,
  );
}

function summarizeOverlayRows(rows: InventoryOverlayRow[]) {
  return rows.reduce(
    (summary, row) => ({
      matched: summary.matched + (row.status === "matched" ? 1 : 0),
      netDelta: summary.netDelta + row.delta,
      new: summary.new + (row.status === "new" ? 1 : 0),
      review: summary.review + (row.status === "review" ? 1 : 0),
    }),
    {
      matched: 0,
      netDelta: 0,
      new: 0,
      review: 0,
    },
  );
}

function getDefaultOverlayFilter(summary: ReturnType<typeof summarizeOverlayRows>): InventoryOverlayFilter {
  if (summary.review > 0) return "review";
  if (summary.new > 0) return "new";
  return "all";
}

function normalizeOverlayIdentifierKey(value?: string | null) {
  return value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function normalizeOverlayNameKey(value?: string | null) {
  return normalizeFuzzySearchText(value);
}

function doesOverlayRowNeedNameDecision(
  row: InventoryImportRow,
  match?: AthenaSkuContext,
) {
  if (!match) return false;

  return normalizeOverlayNameKey(row.productName) !== normalizeOverlayNameKey(match.productName);
}

function selectBestExactNameMatch(
  matches: AthenaSkuContext[],
  row: InventoryImportRow,
) {
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];

  return [...matches].sort((left, right) => {
    const leftScore = scoreExactNameMatch(left, row);
    const rightScore = scoreExactNameMatch(right, row);

    if (rightScore !== leftScore) return rightScore - leftScore;

    return getAthenaSkuStableSortKey(left).localeCompare(getAthenaSkuStableSortKey(right));
  })[0];
}

function scoreExactNameMatch(match: AthenaSkuContext, row: InventoryImportRow) {
  let score = 0;

  if (match.productAvailability !== "archived") score += 100;
  if (match.price === row.price) score += 40;
  if (match.quantityAvailable === row.quantity) score += 30;

  const priceDelta = Math.abs(match.price - row.price);
  const quantityDelta = Math.abs(match.quantityAvailable - row.quantity);

  score -= Math.min(priceDelta / 100, 20);
  score -= Math.min(quantityDelta, 20);

  return score;
}

function getAthenaSkuStableSortKey(match: AthenaSkuContext) {
  return [match.productName, match.sku ?? "", match.productSkuId].join("|");
}

function findBestCloseNameMatch(
  productName: string,
  entries: Array<FuzzySearchEntry<AthenaSkuContext>>,
) {
  const queryTokens = [...tokenizeFuzzySearchText([productName])];

  if (queryTokens.length === 0) return undefined;

  const scored = entries
    .map((entry, position) => ({
      item: entry.item,
      position,
      score: scoreFuzzySearchEntry(entry, queryTokens, {
        productName: 4,
      }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.position - right.position;
    });

  const best = scored[0];
  const next = scored[1];
  const minimumScore = Math.max(4 * queryTokens.length, queryTokens.length === 1 ? 5 : 0);

  if (!best || best.score < minimumScore) return undefined;
  if (next && best.score - next.score < 3) return undefined;

  return best.item;
}

function getOverlayMatchLabel(matchType: InventoryOverlayRow["matchType"]) {
  switch (matchType) {
    case "barcode":
      return "Barcode";
    case "sku":
      return "SKU";
    case "name":
      return "Name";
    case "closeName":
      return "Close name";
    case "none":
      return "No Athena match";
  }
}

function getOverlayStatusLabel(args: {
  archivedMatch: boolean;
  nameChanged: boolean;
  priceChanged: boolean;
  quantityChanged: boolean;
}) {
  if (args.archivedMatch) return "Archived match";
  if (args.priceChanged && args.quantityChanged) return "Qty and price";
  if (args.nameChanged && args.quantityChanged) return "Name and count";
  if (args.nameChanged && args.priceChanged) return "Name and price";
  if (args.quantityChanged) return "Count differs";
  if (args.priceChanged) return "Price differs";
  if (args.nameChanged) return "Name differs";
  return "Matched";
}

function getOverlayRowKey(row: InventoryOverlayRow) {
  return [
    row.row.rowNumber,
    row.row.sku ?? "",
    row.row.barcode ?? "",
    row.row.productName,
  ].join(":");
}

function getOverlayDecisionKey(row: InventoryOverlayRow) {
  return String(row.row.rowNumber);
}

function getImportRowActionLabel(action: ImportNewRowAction) {
  switch (action) {
    case "create_item":
      return "Create item";
    case "skip_row":
      return "Skip row";
  }
}

function buildReviewNotesWithImportActions({
  notes,
  rows,
  rowDraftDecisions,
}: {
  notes: string;
  rows: InventoryOverlayRow[];
  rowDraftDecisions: Record<string, ImportRowDraftDecision>;
}) {
  const trimmedNotes = notes.trim();
  const decisions = rows
    .map((row) => {
      const decision = rowDraftDecisions[getOverlayDecisionKey(row)];
      if (!decision || !hasDraftDecisionValue(decision)) return null;

      return `Row ${row.row.rowNumber} ${row.row.productName}: ${formatDraftDecision(decision)}`;
    })
    .filter((decision): decision is string => Boolean(decision));

  if (decisions.length === 0) return trimmedNotes;

  return [trimmedNotes, "Import decisions:", ...decisions].filter(Boolean).join("\n");
}

function buildSavedRowDraftDecisions({
  rows,
  rowDraftDecisions,
}: {
  rows: InventoryOverlayRow[];
  rowDraftDecisions: Record<string, ImportRowDraftDecision>;
}): SavedImportRowDraftDecision[] {
  return rows
    .map((row) => {
      const rowKey = getOverlayRowKey(row);
      const decision = rowDraftDecisions[getOverlayDecisionKey(row)];
      if (!decision || !hasDraftDecisionValue(decision)) return null;

      return {
        ...decision,
        productName: row.row.productName,
        rowKey,
        rowNumber: row.row.rowNumber,
      };
    })
    .filter((decision): decision is SavedImportRowDraftDecision => Boolean(decision));
}

type BulkImportReviewDecisionSummary = {
  actionableRows: number;
  newRows: number;
  reviewRows: number;
};

function getBulkImportReviewDecisionSummary(
  rows: InventoryOverlayRow[],
): BulkImportReviewDecisionSummary {
  return rows.reduce<BulkImportReviewDecisionSummary>(
    (summary, row) => {
      if (row.status === "new") {
        summary.actionableRows += 1;
        summary.newRows += 1;
      } else if (row.status === "review") {
        summary.actionableRows += 1;
        summary.reviewRows += 1;
      }

      return summary;
    },
    {
      actionableRows: 0,
      newRows: 0,
      reviewRows: 0,
    },
  );
}

function applyBulkImportReviewDecision({
  action,
  current,
  rows,
}: {
  action: BulkImportReviewDecisionAction;
  current: Record<string, ImportRowDraftDecision>;
  rows: InventoryOverlayRow[];
}) {
  const next = { ...current };

  for (const row of rows) {
    const key = getOverlayDecisionKey(row);
    const patch = getBulkImportReviewDecisionPatch(row, action);

    if (action === "clear_choices") {
      if (patch) delete next[key];
      continue;
    }

    if (!patch) continue;

    next[key] = {
      ...next[key],
      ...patch,
    };
  }

  return next;
}

function getBulkImportReviewDecisionPatch(
  row: InventoryOverlayRow,
  action: BulkImportReviewDecisionAction,
): ImportRowDraftDecision | null {
  if (row.status === "matched") return null;

  if (action === "clear_choices") return {};

  if (action === "skip_rows") {
    return {
      action: "skip_row",
      nameSource: undefined,
      priceSource: undefined,
      quantitySource: undefined,
    };
  }

  if (row.status === "new") {
    return action === "create_new_items" ? { action: "create_item" } : null;
  }

  if (row.status !== "review") return null;

  if (action === "use_import_values" || action === "use_athena_values") {
    return buildBulkReviewSourcePatch(
      row,
      action === "use_import_values" ? "import" : "athena",
    );
  }

  return null;
}

function buildBulkReviewSourcePatch(
  row: InventoryOverlayRow,
  source: ImportDraftSource,
): ImportRowDraftDecision {
  return {
    action: undefined,
    ...(doesOverlayRowNeedNameDecision(row.row, row.athenaMatch)
      ? { nameSource: source }
      : null),
    ...(row.delta !== 0 ? { quantitySource: source } : null),
    ...(row.athenaPrice !== undefined && row.row.price !== row.athenaPrice
      ? { priceSource: source }
      : null),
  };
}

function buildProvisionalImportStageRows({
  rows,
  rowDraftDecisions,
}: {
  rows: InventoryOverlayRow[];
  rowDraftDecisions: Record<string, ImportRowDraftDecision>;
}) {
  return rows.map((row) => {
    const rowKey = getOverlayRowKey(row);
    const decision = rowDraftDecisions[getOverlayDecisionKey(row)] ?? {};

    return {
      ...row.row,
      action: decision.action,
      nameSource: decision.nameSource,
      priceSource: decision.priceSource,
      productId: row.athenaMatch?.productId,
      productSkuId: row.athenaMatch?.productSkuId,
      quantitySource: decision.quantitySource,
      rowKey,
    };
  });
}

function mapSavedRowDraftDecisions(
  decisions: SavedImportRowDraftDecision[],
): Record<string, ImportRowDraftDecision> {
  return decisions.reduce<Record<string, ImportRowDraftDecision>>((mapped, decision) => {
    mapped[String(decision.rowNumber)] = {
      action: decision.action,
      nameSource: decision.nameSource,
      priceSource: decision.priceSource,
      quantitySource: decision.quantitySource,
    };
    return mapped;
  }, {});
}

function hasDraftDecisionValue(decision: ImportRowDraftDecision) {
  return Boolean(
    decision.action ||
      decision.nameSource ||
      decision.priceSource ||
      decision.quantitySource,
  );
}

function isOverlayRowDecisionComplete(
  row: InventoryOverlayRow,
  decision?: ImportRowDraftDecision,
) {
  if (row.status === "matched") return true;
  if (!decision) return false;
  if (decision.action === "skip_row") return true;
  if (row.status === "new") return decision.action === "create_item";

  const needsQuantity = row.delta !== 0;
  const needsPrice = row.athenaPrice !== undefined && row.row.price !== row.athenaPrice;
  const needsName = doesOverlayRowNeedNameDecision(row.row, row.athenaMatch);

  return (
    (!needsName || Boolean(decision.nameSource)) &&
    (!needsQuantity || Boolean(decision.quantitySource)) &&
    (!needsPrice || Boolean(decision.priceSource))
  );
}

function formatDraftDecision(decision: ImportRowDraftDecision) {
  const parts = [];
  if (decision.action) parts.push(getImportRowActionLabel(decision.action));
  if (decision.nameSource) parts.push(`Name from ${formatDraftSource(decision.nameSource)}`);
  if (decision.quantitySource) parts.push(`Qty from ${formatDraftSource(decision.quantitySource)}`);
  if (decision.priceSource) parts.push(`Price from ${formatDraftSource(decision.priceSource)}`);
  return parts.join("; ");
}

function formatDraftSource(source: ImportDraftSource) {
  return source === "import" ? "import" : "Athena";
}

function getDraftAutosaveSignature(decisions: SavedImportRowDraftDecision[]) {
  return JSON.stringify(
    decisions
      .map((decision) => ({
        action: decision.action,
        nameSource: decision.nameSource,
        priceSource: decision.priceSource,
        quantitySource: decision.quantitySource,
        rowKey: decision.rowKey,
      }))
      .sort((left, right) => left.rowKey.localeCompare(right.rowKey)),
  );
}

function getDraftAutosaveStatusLabel(
  status: "idle" | "pending" | "saving" | "saved" | "error",
) {
  switch (status) {
    case "idle":
      return "";
    case "pending":
      return "Autosave pending";
    case "saving":
      return "Saving draft";
    case "saved":
      return "Draft saved";
    case "error":
      return "Autosave failed";
  }
}

function formatSignedQuantity(value: number) {
  const formatted = Math.abs(value).toLocaleString();
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}

function formatCount(value: number, singular: string) {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

function formatReviewVersionTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
