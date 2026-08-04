import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useReducedMotion } from "framer-motion";
import { ArrowUpRight, ChartNoAxesColumn, LoaderCircle } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { createSharedDemoReportMovementPage } from "@/components/shared-demo/sharedDemoReportsFixture";
import { ListPagination } from "@/components/common/ListPagination";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { capitalizeWords } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import { getOrigin } from "~/src/lib/navigationUtils";
import {
  REPORT_MOVEMENT_PAGE_SIZE,
  type ReportMovementLifecycle,
  type ReportSkuMovementRow,
} from "~/shared/reportsContract";
import {
  formatReportDateRange,
  formatReportMoney,
  formatUnits,
} from "./reportFormat";
import { useReportsSharedDemoMode } from "./useReportsSharedDemoMode";
import { useStableReportQuery } from "./useStableReportQuery";

const unitsChartConfig = {
  units: {
    label: "Net units",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

export type ReportUnitsMovedTab = "top" | "granular";
export type ReportUnitsMovedFocusSurface = "chart" | "table";

/**
 * In-mount preservation of the underlying report's scroll position while the
 * sheet opens/closes over it. Cross-navigation restore is the routes' job.
 */
const reportUnitsScrollPositions = new Map<string, number>();

function findReportScrollContainer(
  trigger: HTMLElement | null | undefined,
): HTMLElement | null {
  let candidate = trigger?.parentElement ?? null;
  while (
    candidate &&
    !(
      candidate.scrollHeight > candidate.clientHeight &&
      ["auto", "scroll"].includes(getComputedStyle(candidate).overflowY)
    )
  ) {
    candidate = candidate.parentElement;
  }
  return candidate;
}

/**
 * Direction-word rendering of a net unit movement. In retail copy a "+" reads
 * as stock RECEIVED, so user-facing values never carry a sign: positive net
 * is "289 out", negative net is "24 returned", and a fully cancelled SKU with
 * activity is "0 net". The signed number itself stays untouched in the data,
 * ranking, and contract — this is presentation only.
 */
export function formatNetUnitsMoved(netUnits: number): string {
  if (netUnits > 0) return `${formatUnits(netUnits)} out`;
  if (netUnits < 0) return `${formatUnits(-netUnits)} returned`;
  return "0 net";
}

/** The same direction words for spoken/sr-only copy: "289 units out". */
function netUnitsMovedAccessiblePhrase(netUnits: number): string {
  if (netUnits > 0) return `${formatUnits(netUnits)} units out`;
  if (netUnits < 0) return `${formatUnits(-netUnits)} units returned`;
  return "0 net units";
}

/**
 * Direction-aware outer corners for a zero-centered horizontal bar: positive
 * bars grow rightward (round the right corners), negative bars grow leftward.
 */
export function movementBarRadius(
  netUnits: number,
): [number, number, number, number] {
  return netUnits < 0 ? [6, 0, 0, 6] : [0, 6, 6, 0];
}

/** Symmetric zero-centered domain so equal magnitudes read as equal bars. */
export function movementChartDomain(
  rows: readonly { units: number }[],
): [number, number] {
  const maxAbs = rows.reduce(
    (max, row) => Math.max(max, Math.abs(row.units)),
    1,
  );
  return [-maxAbs, maxAbs];
}

type UnitMovementChartRow = {
  key: string;
  netPrice?: string;
  productSkuId: string;
  productName: string;
  rank: number;
  size?: string;
  sku?: string;
  units: number;
  unitsReturned: number;
  unitsSold: number;
};

function unitMovementMetadata(row: UnitMovementChartRow): string[] {
  return [row.sku, row.size, row.netPrice].filter(
    (value): value is string => Boolean(value),
  );
}

function UnitMovementAxisTick({
  endDate,
  onLinkClick,
  orgUrlSlug,
  payload,
  rows,
  startDate,
  storeUrlSlug,
  x = 0,
  y = 0,
}: {
  endDate: string;
  onLinkClick: (
    productSkuId: string,
    event: React.MouseEvent<HTMLAnchorElement>,
  ) => void;
  orgUrlSlug: string;
  payload?: { value?: string };
  rows: UnitMovementChartRow[];
  startDate: string;
  storeUrlSlug: string;
  x?: number;
  y?: number;
}) {
  const row = rows.find((candidate) => candidate.key === payload?.value);
  if (!row) return <g />;

  return (
    <g transform={`translate(${x},${y})`}>
      <foreignObject
        height={row.sku ? 54 : 40}
        width={174}
        x={-184}
        y={row.sku ? -27 : -20}
      >
        <div className="flex h-full items-center justify-end text-right">
          <Link
            aria-label={`View ${row.productName} SKU details from chart`}
            className="group flex max-w-full flex-col items-end rounded-sm px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-chart-sku-link={row.productSkuId}
            onClick={(event: React.MouseEvent<HTMLAnchorElement>) =>
              onLinkClick(row.productSkuId, event)
            }
            params={{
              orgUrlSlug,
              productSkuId: row.productSkuId,
              storeUrlSlug,
            }}
            search={{
              endDate,
              o: getOrigin(),
              startDate,
            }}
            to="/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId"
          >
            <span className="line-clamp-2 max-w-full text-xs font-medium leading-4 text-foreground underline-offset-2 group-hover:underline group-focus-visible:underline">
              {row.productName}
            </span>
            {row.sku ? (
              <span className="max-w-full truncate text-[10px] text-muted-foreground">
                {row.sku}
              </span>
            ) : null}
          </Link>
        </div>
      </foreignObject>
    </g>
  );
}

type EnsureOutcome = {
  requestKey: string | null;
  lifecycle: ReportMovementLifecycle;
};

/** One settled page of movement data plus the lifecycle it belongs to. */
type MovementPageView = {
  lifecycle: Extract<ReportMovementLifecycle, { state: "completed" }>;
  page: number;
  pageCount: number;
  requestKey: string | null;
  rows: (ReportSkuMovementRow & { rank?: number })[];
};

export function ReportUnitsMovedChartSheet({
  activeTab: controlledActiveTab,
  currency,
  granularPage: controlledGranularPage,
  isOpen: controlledIsOpen,
  onActiveTabChange,
  onGranularPageChange,
  onOpenChange,
  onRestoreComplete,
  onSkuLinkNavigate,
  orgUrlSlug,
  periodEndDate,
  periodStartDate,
  restoreFocusSkuId,
  restoreFocusSurface,
  restoreScrollOffset,
  scrollContextKey,
  storeUrlSlug,
}: {
  /** Controlled active tab (U6 lifts this into the URL); internal otherwise. */
  activeTab?: ReportUnitsMovedTab;
  currency: string;
  /** Controlled Granular page, 1-based (U6 lifts this); internal otherwise. */
  granularPage?: number;
  isOpen?: boolean;
  onActiveTabChange?: (tab: ReportUnitsMovedTab) => void;
  onGranularPageChange?: (page: number) => void;
  onOpenChange?: (open: boolean) => void;
  /** Fires once the pending cross-navigation restoration has been applied. */
  onRestoreComplete?: () => void;
  /**
   * Cross-navigation drill-down seam (U6): when provided, activating a SKU
   * link delegates navigation to the route, which persists the originating
   * focus and captured report scroll offset before pushing SKU detail.
   */
  onSkuLinkNavigate?: (context: {
    endDate: string;
    focusSurface: ReportUnitsMovedFocusSurface;
    productSkuId: string;
    scrollOffset?: number;
    startDate: string;
  }) => void | Promise<void>;
  orgUrlSlug: string;
  periodEndDate: string;
  periodStartDate: string;
  /** Originating SKU link to re-focus after returning from SKU detail. */
  restoreFocusSkuId?: string;
  /** Surface that owned the originating link; defaults to the item table. */
  restoreFocusSurface?: ReportUnitsMovedFocusSurface;
  /** Underlying report scroll offset to restore after returning. */
  restoreScrollOffset?: number;
  scrollContextKey: string;
  storeUrlSlug: string;
}) {
  const [localIsOpen, setLocalIsOpen] = useState(false);
  const [localActiveTab, setLocalActiveTab] =
    useState<ReportUnitsMovedTab>("top");
  const [localGranularPage, setLocalGranularPage] = useState(1);
  /**
   * The latest ensure/retry outcome. Durable states hand over to the
   * `getMovementRange` subscription below; waiting/backpressure own the
   * close-cancelled polling timer.
   */
  const [admission, setAdmission] = useState<EnsureOutcome | undefined>(
    undefined,
  );
  const [ensureFailed, setEnsureFailed] = useState(false);
  const [isSkuNavigationPending, setIsSkuNavigationPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const errorHeadingRef = useRef<HTMLHeadingElement>(null);
  const granularTabRef = useRef<HTMLButtonElement>(null);
  const skuNavigationPendingRef = useRef(false);
  /**
   * One-shot bookkeeping for the cross-navigation restoration (U6). Each leg
   * runs at most once per open; `completed` fires `onRestoreComplete` exactly
   * once so the route can clear the focus/scroll keys.
   */
  const restoreRef = useRef({
    completed: false,
    focusDone: false,
    scrollDone: false,
  });
  const [restoreAnnouncement, setRestoreAnnouncement] = useState<
    string | null
  >(null);
  const shouldReduceMotion = useReducedMotion();

  const isOpen = controlledIsOpen ?? localIsOpen;
  const activeTab = controlledActiveTab ?? localActiveTab;
  const granularPage = controlledGranularPage ?? localGranularPage;

  const setIsOpen = (open: boolean) => {
    if (!open) {
      skuNavigationPendingRef.current = false;
      setIsSkuNavigationPending(false);
      reportUnitsScrollPositions.delete(scrollContextKey);
      setAdmission(undefined);
      setEnsureFailed(false);
      setLocalActiveTab("top");
      setLocalGranularPage(1);
      restoreRef.current = {
        completed: false,
        focusDone: false,
        scrollDone: false,
      };
      setRestoreAnnouncement(null);
    }
    setLocalIsOpen(open);
    onOpenChange?.(open);
  };
  const setActiveTab = (tab: ReportUnitsMovedTab) => {
    setLocalActiveTab(tab);
    onActiveTabChange?.(tab);
  };
  const setGranularPage = (page: number) => {
    setLocalGranularPage(page);
    onGranularPageChange?.(page);
  };
  const captureScrollPosition = () => {
    const scrollContainer = findReportScrollContainer(triggerRef.current);
    if (!scrollContainer) return;
    reportUnitsScrollPositions.set(scrollContextKey, scrollContainer.scrollTop);
  };

  const { activeStore } = useGetActiveStore();
  const { isSharedDemo, useLiveQuery } = useReportsSharedDemoMode();
  const storeId = activeStore?._id;
  const liveEnabled = Boolean(isOpen && storeId && useLiveQuery);

  const ensureMovementRange = useMutation(
    api.reports.skuMovementRange.ensureMovementRange,
  );
  const retryMovementRange = useMutation(
    api.reports.skuMovementRange.retryMovementRange,
  );

  /**
   * Admission on open. The mutation is idempotent server-side, so StrictMode's
   * duplicate effect run may call it twice and both calls land on the same
   * request; the polling loop lives in the effect below and owns exactly one
   * timer.
   */
  useEffect(() => {
    if (!liveEnabled || !storeId) return;
    let cancelled = false;
    setAdmission(undefined);
    setEnsureFailed(false);
    ensureMovementRange({
      storeId,
      startDate: periodStartDate,
      endDate: periodEndDate,
    }).then(
      (result) => {
        if (!cancelled) setAdmission(result);
      },
      () => {
        if (!cancelled) setEnsureFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    ensureMovementRange,
    liveEnabled,
    periodEndDate,
    periodStartDate,
    storeId,
  ]);

  /**
   * Poll-then-subscribe: while the outcome is waiting/backpressure (no durable
   * row was written), re-call ensure after the server-supplied interval. The
   * timer belongs to this effect instance — closing the sheet or unmounting
   * clears it, and a StrictMode double effect cleans up its first timer before
   * arming the second, so timers never stack.
   */
  const admissionLifecycle = admission?.lifecycle;
  useEffect(() => {
    if (!liveEnabled || !storeId) return;
    if (
      admissionLifecycle?.state !== "waiting" &&
      admissionLifecycle?.state !== "backpressure"
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      ensureMovementRange({
        storeId,
        startDate: periodStartDate,
        endDate: periodEndDate,
      }).then(
        (result) => {
          if (!cancelled) setAdmission(result);
        },
        () => {
          if (!cancelled) setEnsureFailed(true);
        },
      );
    }, admissionLifecycle.retryAfterMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    admissionLifecycle,
    ensureMovementRange,
    liveEnabled,
    periodEndDate,
    periodStartDate,
    storeId,
  ]);

  const requestKey = admission?.requestKey ?? null;

  /** Header-only lifecycle subscription once a durable request exists. */
  const headerStatus = useQuery(
    api.reports.skuMovementRange.getMovementRange,
    liveEnabled && storeId && requestKey ? { storeId, requestKey } : "skip",
  );

  const effectiveLifecycle: ReportMovementLifecycle | undefined = isSharedDemo
    ? undefined // the demo branch below is always completed
    : (headerStatus?.lifecycle ?? admissionLifecycle);

  const requestedPage = activeTab === "granular" ? granularPage : 1;
  const isCompleted = effectiveLifecycle?.state === "completed";

  /** The single 20-row interval for the active tab, once completed. */
  const livePageData = useQuery(
    api.reports.skuMovementRange.getMovementRangePage,
    liveEnabled && storeId && requestKey && isCompleted
      ? { storeId, requestKey, page: requestedPage }
      : "skip",
  );

  const demoView = useMemo<MovementPageView | undefined>(() => {
    if (!isOpen || !isSharedDemo) return undefined;
    const demoPage = createSharedDemoReportMovementPage({
      startDate: periodStartDate,
      endDate: periodEndDate,
      page: requestedPage,
    });
    return {
      lifecycle: demoPage.lifecycle,
      page: demoPage.page,
      pageCount: demoPage.lifecycle.pageCount,
      requestKey: null,
      rows: demoPage.rows,
    };
  }, [isOpen, isSharedDemo, periodEndDate, periodStartDate, requestedPage]);

  const liveView = useMemo<MovementPageView | undefined>(() => {
    if (!livePageData || livePageData.lifecycle.state !== "completed") {
      return undefined;
    }
    return {
      lifecycle: livePageData.lifecycle,
      page: livePageData.page,
      pageCount: livePageData.pageCount,
      requestKey: livePageData.requestKey,
      rows: livePageData.rows,
    };
  }, [livePageData]);

  /**
   * Settled `{request, page}` context: rows, page label, and pagination all
   * render from the same settled snapshot, so a transition can never label
   * retained page-N rows as page N+1.
   */
  const settled = useStableReportQuery(
    isSharedDemo ? demoView : liveView,
    `${requestKey ?? "demo"}:${requestedPage}:${activeTab}`,
  );
  const settledView = settled.data;

  const lifecycle = isSharedDemo ? demoView?.lifecycle : effectiveLifecycle;
  const isPageTransition =
    lifecycle?.state === "completed" && settled.isRefreshing;

  useLayoutEffect(() => {
    if (!isOpen) return;
    const savedScrollTop = reportUnitsScrollPositions.get(scrollContextKey);
    const scrollContainer = findReportScrollContainer(triggerRef.current);
    if (savedScrollTop === undefined || !scrollContainer) return;
    scrollContainer.scrollTop = savedScrollTop;
  }, [isOpen, scrollContextKey]);

  /**
   * Canonicalize an out-of-range Granular page only once a completed request
   * supplies the authoritative count: the page payload reports the canonical
   * page it actually served, and the URL follows it.
   */
  const servedView = isSharedDemo ? demoView : liveView;
  useEffect(() => {
    if (!isOpen || !servedView) return;
    if (activeTab === "granular" && servedView.page !== granularPage) {
      setLocalGranularPage(servedView.page);
      onGranularPageChange?.(servedView.page);
    }
    // setLocalGranularPage is stable; onGranularPageChange may be an inline
    // route callback, and the guard above makes re-runs idempotent.
  }, [activeTab, granularPage, isOpen, onGranularPageChange, servedView]);

  const completeRestoreIfReady = () => {
    const restore = restoreRef.current;
    if (restore.completed) return;
    if (restoreScrollOffset !== undefined && !restore.scrollDone) return;
    if (restoreFocusSkuId !== undefined && !restore.focusDone) return;
    if (restoreScrollOffset === undefined && restoreFocusSkuId === undefined) {
      return;
    }
    restore.completed = true;
    onRestoreComplete?.();
  };

  /**
   * Cross-navigation scroll restore (R11): the captured offset is applied
   * once the underlying report content has laid out. jsdom-free of repo
   * precedent — the container may not exist or be tall enough on the first
   * frame after a route mount, so retry on animation frames, bounded, and
   * degrade silently to top when the offset never becomes applicable.
   */
  useEffect(() => {
    if (!isOpen || restoreScrollOffset === undefined) return;
    if (isSkuNavigationPending) return;
    const restore = restoreRef.current;
    if (restore.scrollDone || restore.completed) return;
    if (!Number.isFinite(restoreScrollOffset) || restoreScrollOffset <= 0) {
      restore.scrollDone = true;
      completeRestoreIfReady();
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const attemptRestore = () => {
      if (cancelled) return;
      const scrollContainer = findReportScrollContainer(triggerRef.current);
      if (
        scrollContainer &&
        scrollContainer.scrollHeight > scrollContainer.clientHeight
      ) {
        scrollContainer.scrollTop = restoreScrollOffset;
        // Keep the in-mount map coherent so closing the sheet afterwards
        // does not jump the report back to the top.
        reportUnitsScrollPositions.set(scrollContextKey, restoreScrollOffset);
        restore.scrollDone = true;
        completeRestoreIfReady();
        return;
      }
      attempts += 1;
      if (attempts >= 30) {
        restore.scrollDone = true;
        completeRestoreIfReady();
        return;
      }
      requestAnimationFrame(attemptRestore);
    };
    attemptRestore();
    return () => {
      cancelled = true;
    };
    // completeRestoreIfReady closes over the same props this effect lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isSkuNavigationPending, restoreScrollOffset, scrollContextKey]);

  const handleRetry = async () => {
    if (!storeId || !requestKey) return;
    try {
      const result = await retryMovementRange({ storeId, requestKey });
      setAdmission(result);
      if (result.lifecycle.state === "terminal_error") {
        errorHeadingRef.current?.focus();
      }
    } catch {
      setEnsureFailed(true);
      errorHeadingRef.current?.focus();
    }
  };

  const chartRows: UnitMovementChartRow[] = useMemo(() => {
    if (!settledView) return [];
    return settledView.rows.map((row, index) => {
      const productName = row.identity
        ? capitalizeWords(row.identity.displayName)
        : row.label;
      return {
        key: row.key,
        netPrice:
          row.identity?.netPriceMinor === undefined
            ? undefined
            : formatReportMoney(row.identity.netPriceMinor, currency),
        productSkuId: row.productSkuId,
        productName,
        rank:
          row.rank ??
          (settledView.page - 1) * REPORT_MOVEMENT_PAGE_SIZE + index + 1,
        size: row.identity?.size,
        sku: row.identity?.sku ?? (row.identity ? row.label : undefined),
        units: row.netUnits,
        unitsReturned: row.unitsReturned,
        unitsSold: row.unitsSold,
      };
    });
  }, [currency, settledView]);

  const totals = settledView?.lifecycle.totals;
  const skuCount = totals?.skuCount ?? 0;
  const isCompletedEmpty =
    lifecycle?.state === "completed" && lifecycle.totals.skuCount === 0;
  const showTopSubset = skuCount > REPORT_MOVEMENT_PAGE_SIZE;
  const dateRangeLabel = formatReportDateRange(periodStartDate, periodEndDate);
  const chartDomain = movementChartDomain(chartRows);

  const settledVisibleStart = settledView
    ? (settledView.page - 1) * REPORT_MOVEMENT_PAGE_SIZE + 1
    : 0;
  const settledVisibleEnd = settledView
    ? settledVisibleStart + settledView.rows.length - 1
    : 0;

  const isPending =
    !ensureFailed &&
    (lifecycle === undefined ||
      lifecycle.state === "waiting" ||
      lifecycle.state === "backpressure" ||
      lifecycle.state === "queued_pending");
  const isNotAvailable = !ensureFailed && lifecycle?.state === "not_available";
  const isTerminalError =
    ensureFailed || lifecycle?.state === "terminal_error";
  const terminalCorrelationId =
    lifecycle?.state === "terminal_error" ? lifecycle.correlationId : undefined;

  /**
   * Originating-focus restore (R10/AE4): once the returned page settles, move
   * focus back to the SKU link the operator drilled through. If changed data
   * removed the SKU (or its page canonicalized away), focus the Granular tab
   * heading instead and announce the settled result via the status region —
   * never a different item.
   */
  const isRestoreSettled =
    lifecycle?.state === "completed" && settledView !== undefined
      ? !settled.isRefreshing
      : false;
  useEffect(() => {
    if (!isOpen || restoreFocusSkuId === undefined) return;
    if (isSkuNavigationPending) return;
    const restore = restoreRef.current;
    if (restore.focusDone || restore.completed) return;
    if (isTerminalError || isNotAvailable) {
      // No rows will ever settle; give the keys back without moving focus.
      restore.focusDone = true;
      completeRestoreIfReady();
      return;
    }
    if (!isRestoreSettled || !settledView) return;
    const focusSurface = restoreFocusSurface ?? "table";
    const focusAttribute =
      focusSurface === "chart" ? "data-chart-sku-link" : "data-sku-link";
    const selector = `[${focusAttribute}="${CSS.escape(restoreFocusSkuId)}"]`;
    const skuStillExists = settledView.rows.some(
      (row) => row.productSkuId === restoreFocusSkuId,
    );
    const attemptFocus = (): boolean => {
      if (restore.focusDone || restore.completed) return true;
      const link = document.querySelector<HTMLElement>(selector);
      if (!link && skuStillExists) return false;
      restore.focusDone = true;
      if (link) {
        link.focus();
      } else {
        granularTabRef.current?.focus();
        setRestoreAnnouncement(
          `Your previous item is no longer in this view. Showing page ${settledView.page} of ${settledView.pageCount}.`,
        );
      }
      completeRestoreIfReady();
      return true;
    };

    let observer: MutationObserver | undefined;
    const frame = requestAnimationFrame(() => {
      if (attemptFocus()) return;
      // Recharts mounts SVG ticks asynchronously. The settled row proves this
      // SKU still belongs in the surface, so observe for the actual axis link
      // instead of treating an elapsed frame budget as item removal.
      observer = new MutationObserver(() => {
        if (attemptFocus()) observer?.disconnect();
      });
      const sheet = document.querySelector("[role='dialog']");
      observer.observe(sheet ?? document.body, {
        childList: true,
        subtree: true,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
    // completeRestoreIfReady closes over the same props this effect lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isNotAvailable,
    isOpen,
    isRestoreSettled,
    isTerminalError,
    isSkuNavigationPending,
    restoreFocusSkuId,
    restoreFocusSurface,
    settledView,
  ]);

  const handleSkuLinkClick = (
    productSkuId: string,
    event: React.MouseEvent<HTMLAnchorElement>,
  ) => {
    // U6 seam: the route persists focus/scroll continuity into its search
    // state, then owns the push to SKU detail.
    if (!onSkuLinkNavigate || event.defaultPrevented) return;
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if (skuNavigationPendingRef.current) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    // Persisting the return token rerenders this still-mounted sheet before
    // the detail push completes. Do not mistake that outbound write for a
    // browser return and consume/focus the token on the page being left.
    skuNavigationPendingRef.current = true;
    setIsSkuNavigationPending(true);
    const scrollContainer = findReportScrollContainer(triggerRef.current);
    const navigation = onSkuLinkNavigate({
      endDate: periodEndDate,
      focusSurface: event.currentTarget.dataset.chartSkuLink
        ? "chart"
        : "table",
      productSkuId,
      scrollOffset:
        scrollContainer?.scrollTop ??
        reportUnitsScrollPositions.get(scrollContextKey),
      startDate: periodStartDate,
    });
    if (navigation && typeof navigation.then === "function") {
      void navigation.catch(() => {
        skuNavigationPendingRef.current = false;
        setIsSkuNavigationPending(false);
      });
    }
  };

  const itemRowsTable = (
    <table className="w-full border-collapse border-t border-border text-sm">
      <caption className="sr-only">SKU movement details</caption>
      <thead>
        <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
          <th className="py-layout-sm font-medium" scope="col">
            Item
          </th>
          <th className="py-layout-sm text-right font-medium" scope="col">
            Net units
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {chartRows.map((item) => (
          <tr key={item.key}>
            <td className="min-w-0 py-layout-sm pr-layout-md align-top">
              <Link
                className="group block min-h-11 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-sku-link={item.productSkuId}
                onClick={(event: React.MouseEvent<HTMLAnchorElement>) =>
                  handleSkuLinkClick(item.productSkuId, event)
                }
                params={{
                  orgUrlSlug,
                  productSkuId: item.productSkuId,
                  storeUrlSlug,
                }}
                search={{
                  endDate: periodEndDate,
                  o: getOrigin(),
                  startDate: periodStartDate,
                }}
                to="/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId"
              >
                <span className="flex items-center gap-1 font-medium text-foreground underline-offset-4 group-hover:underline">
                  {item.productName}
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </span>
                {unitMovementMetadata(item).length > 0 ? (
                  <span
                    className="mt-0.5 block break-words text-xs text-muted-foreground"
                    data-testid={`unit-metadata-${item.key}`}
                  >
                    {unitMovementMetadata(item).join(" · ")}
                  </span>
                ) : null}
              </Link>
            </td>
            <td className="whitespace-nowrap py-layout-sm text-right align-top font-numeric font-semibold text-foreground">
              {formatNetUnitsMoved(item.units)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Sheet onOpenChange={setIsOpen} open={isOpen}>
      <SheetTrigger asChild>
        <Button
          data-testid="weekly-units-chart-trigger"
          onClick={captureScrollPosition}
          ref={triggerRef}
          size="sm"
          variant="outline"
        >
          <ChartNoAxesColumn aria-hidden="true" />
          View item movement
        </Button>
      </SheetTrigger>
      <SheetContent
        className="flex w-[min(100vw,42rem)] flex-col gap-0 overflow-y-auto p-0 sm:max-w-[42rem]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus({ preventScroll: true });
        }}
        side="right"
      >
        {/* Persistent shell: title/date, then tabs, then lifecycle/count
            message, then the active tab's content — in every request state. */}
        <SheetHeader className="border-b border-border px-layout-xl py-layout-lg pr-12">
          <SheetTitle>Item movement</SheetTitle>
          <SheetDescription>
            Net units by item for {dateRangeLabel}.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-layout-lg px-layout-md py-layout-xl sm:px-layout-xl">
          <Tabs
            onValueChange={(value) =>
              setActiveTab(value as ReportUnitsMovedTab)
            }
            value={activeTab}
          >
            <TabsList
              aria-label="Item movement view"
              className="h-auto flex-wrap justify-start gap-1 border border-border bg-surface-raised p-1 text-muted-foreground shadow-surface"
              size="sm"
            >
              <TabsTrigger
                className="h-11 min-h-8 px-3 data-[state=active]:bg-primary-soft data-[state=active]:text-primary data-[state=active]:shadow-none sm:h-8"
                size="sm"
                value="top"
              >
                Top movers
              </TabsTrigger>
              <TabsTrigger
                className="h-11 min-h-8 px-3 data-[state=active]:bg-primary-soft data-[state=active]:text-primary data-[state=active]:shadow-none sm:h-8"
                ref={granularTabRef}
                size="sm"
                value="granular"
              >
                All items
              </TabsTrigger>
            </TabsList>

            {/* Lifecycle / count message slot. */}
            {isPending ? (
              <div
                className="mt-layout-md flex min-h-[20rem] items-center justify-center px-layout-lg"
                data-testid="units-moved-status"
                role="status"
              >
                <div className="flex max-w-xs flex-col items-center text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-4 animate-spin motion-reduce:animate-none"
                    />
                  </div>
                  <p className="mt-layout-md text-sm font-medium text-foreground">
                    Preparing item movement
                  </p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    Organizing item movement for this period.
                  </p>
                </div>
              </div>
            ) : null}
            {isNotAvailable ? (
              <p
                className="mt-layout-md text-sm text-muted-foreground"
                data-testid="units-moved-status"
                role="status"
              >
                Item movement is not available for this store.
              </p>
            ) : null}
            {isTerminalError ? (
              <div
                className="mt-layout-md space-y-layout-sm"
                data-testid="units-moved-error"
                role="alert"
              >
                <h3
                  className="text-sm font-medium text-foreground outline-none"
                  ref={errorHeadingRef}
                  tabIndex={-1}
                >
                  Item movement could not be prepared
                </h3>
                <p className="text-sm text-muted-foreground">
                  Something went wrong while preparing this report. Try again,
                  or contact support if the problem continues.
                </p>
                {terminalCorrelationId ? (
                  <p className="text-xs text-muted-foreground">
                    Reference: {terminalCorrelationId}
                  </p>
                ) : null}
                {requestKey ? (
                  <Button
                    className="min-h-11"
                    onClick={handleRetry}
                    variant="outline"
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : null}
            {isCompletedEmpty ? (
              <p
                className="mt-layout-md text-sm text-muted-foreground"
                data-testid="units-moved-status"
                role="status"
              >
                No SKU movement was recorded in this period.
              </p>
            ) : null}
            {restoreAnnouncement ? (
              <p
                className="sr-only"
                data-testid="units-moved-restore-status"
                role="status"
              >
                {restoreAnnouncement}
              </p>
            ) : null}
            {lifecycle?.state === "completed" && !isCompletedEmpty && totals ? (
              <p
                className="mt-layout-md text-sm text-muted-foreground"
                data-testid="units-moved-count"
                role="status"
              >
                {formatUnits(skuCount)} SKU{skuCount === 1 ? "" : "s"} moved ·{" "}
                {formatUnits(totals.unitsSold)} sold ·{" "}
                {formatUnits(totals.unitsReturned)} returned · net{" "}
                {totals.netUnits === 0
                  ? "0"
                  : formatNetUnitsMoved(totals.netUnits)}
              </p>
            ) : null}

            {lifecycle?.state === "completed" &&
            !isCompletedEmpty &&
            settledView ? (
              <>
                <TabsContent className="mt-layout-md" value="top">
                  <div
                    aria-busy={isPageTransition}
                    className={
                      isPageTransition
                        ? "space-y-layout-lg opacity-60 transition-opacity"
                        : "space-y-layout-lg"
                    }
                  >
                    {showTopSubset ? (
                      <p
                        className="text-sm text-muted-foreground"
                        data-testid="top-movers-subset"
                      >
                        Showing the top {REPORT_MOVEMENT_PAGE_SIZE} of{" "}
                        {formatUnits(skuCount)} SKUs by absolute net movement.
                      </p>
                    ) : null}
                    <p className="sr-only" data-testid="top-movers-summary">
                      Top movers for {dateRangeLabel}:{" "}
                      {showTopSubset
                        ? `the ${REPORT_MOVEMENT_PAGE_SIZE} largest of ${skuCount} moving SKUs`
                        : `${skuCount} moving SKU${skuCount === 1 ? "" : "s"}`}
                      {", by net units. "}
                      {chartRows
                        .map(
                          (row) =>
                            `${row.productName}, ${netUnitsMovedAccessiblePhrase(row.units)}`,
                        )
                        .join(". ")}
                      .
                    </p>
                    <div className="relative overflow-hidden rounded-lg">
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 text-border/[0.55]"
                        data-testid="weekly-units-dot-grid"
                        style={{
                          backgroundImage:
                            "radial-gradient(currentColor 1px, transparent 1.5px)",
                          backgroundSize: "16px 16px",
                          maskImage:
                            "radial-gradient(ellipse at center, black 50%, transparent 100%)",
                          WebkitMaskImage:
                            "radial-gradient(ellipse at center, black 50%, transparent 100%)",
                        }}
                      />
                      <ChartContainer
                        className="relative w-full"
                        config={unitsChartConfig}
                        style={{
                          height: Math.max(240, chartRows.length * 56),
                        }}
                      >
                        <BarChart
                          accessibilityLayer
                          data={chartRows}
                          layout="vertical"
                          margin={{ bottom: 0, left: 0, right: 12, top: 0 }}
                        >
                          <CartesianGrid horizontal={false} />
                          <XAxis
                            allowDecimals={false}
                            axisLine={false}
                            domain={chartDomain}
                            tickFormatter={(value: number) =>
                              formatUnits(Math.abs(value))
                            }
                            tickLine={false}
                            type="number"
                          />
                          <YAxis
                            axisLine={false}
                            dataKey="key"
                            tick={
                              <UnitMovementAxisTick
                                endDate={periodEndDate}
                                onLinkClick={handleSkuLinkClick}
                                orgUrlSlug={orgUrlSlug}
                                rows={chartRows}
                                startDate={periodStartDate}
                                storeUrlSlug={storeUrlSlug}
                              />
                            }
                            tickLine={false}
                            type="category"
                            width={184}
                          />
                          <ReferenceLine
                            stroke="hsl(var(--border))"
                            x={0}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                formatter={(_value, _name, item) => {
                                  const movement =
                                    item.payload as UnitMovementChartRow;
                                  return (
                                    <div className="grid gap-0.5">
                                      <span className="font-medium text-foreground">
                                        {movement.productName}
                                      </span>
                                      {unitMovementMetadata(movement).length >
                                      0 ? (
                                        <span className="text-muted-foreground">
                                          {unitMovementMetadata(movement).join(
                                            " · ",
                                          )}
                                        </span>
                                      ) : null}
                                      <span className="font-numeric text-muted-foreground">
                                        {netUnitsMovedAccessiblePhrase(
                                          movement.units,
                                        )}
                                      </span>
                                    </div>
                                  );
                                }}
                                hideLabel
                              />
                            }
                            cursor={{ fill: "hsl(var(--primary-soft))" }}
                          />
                          <Bar
                            dataKey="units"
                            fill="var(--color-units)"
                            isAnimationActive={!shouldReduceMotion}
                            maxBarSize={32}
                          >
                            {chartRows.map((row) => (
                              <Cell
                                fill="var(--color-units)"
                                key={row.key}
                                radius={
                                  movementBarRadius(
                                    row.units,
                                  ) as unknown as number
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ChartContainer>
                      {/* The axis shows unsigned magnitudes; these side
                          labels carry the direction the ticks no longer do. */}
                      <div
                        aria-hidden="true"
                        className="relative flex min-w-0 justify-between px-layout-sm pb-layout-sm text-[10px] text-muted-foreground"
                        data-testid="units-axis-direction"
                      >
                        <span>returned</span>
                        <span>out</span>
                      </div>
                    </div>
                    {itemRowsTable}
                  </div>
                </TabsContent>

                <TabsContent className="mt-layout-md" value="granular">
                  <div
                    aria-busy={isPageTransition}
                    className={
                      isPageTransition
                        ? "opacity-60 transition-opacity"
                        : undefined
                    }
                  >
                    {itemRowsTable}
                    <ListPagination
                      onPageChange={(page) => {
                        if (isPageTransition) return;
                        setGranularPage(page);
                      }}
                      page={settledView.page}
                      pageCount={settledView.pageCount}
                      pageSize={REPORT_MOVEMENT_PAGE_SIZE}
                      totalItems={skuCount}
                    />
                    {/* Announce the settled interval only once it settles. */}
                    <p className="sr-only" role="status">
                      {isPageTransition
                        ? ""
                        : `Showing ${settledVisibleStart}-${settledVisibleEnd} of ${skuCount}`}
                    </p>
                  </div>
                </TabsContent>
              </>
            ) : null}
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
