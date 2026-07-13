import { ComposedPageHeader } from "@/components/common/PageHeader";
import { FadeIn } from "@/components/common/FadeIn";
import { CommandApprovalDialog } from "@/components/operations/CommandApprovalDialog";
import { CashierAuthDialog } from "@/components/pos/CashierAuthDialog";
import { CashierView } from "@/components/pos/CashierView";
import { CartItems } from "@/components/pos/CartItems";
import {
  ProductEntry,
  ProductEntryHandle,
  ProductSearchInput,
} from "@/components/pos/ProductEntry";
import type { Product } from "@/components/pos/types";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import View from "@/components/View";
import {
  calculatePosRemainingDue,
  calculatePosTotalPaid,
} from "@/lib/pos/domain";
import { cn } from "~/src/lib/utils";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Cloud,
  Loader2,
  MonitorCog,
  PackagePlus,
  RefreshCw,
  ScanBarcode,
  Scissors,
  Search,
  ShoppingBasket,
  Settings,
  Users,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type RegisterServiceSearchResult,
  type RegisterViewModel,
  type RegisterWorkflowMode,
} from "@/lib/pos/presentation/register/registerUiState";
import { usePosTerminalAppSessionRecoveryRuntimeInput } from "@/lib/pos/infrastructure/terminal/posTerminalAppSessionRecoveryContext";
import { clearDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { useRegisterViewModel } from "@/lib/pos/presentation/register/useRegisterViewModel";
import { useAppActionBlocker } from "@/lib/app-messages";
import { APP_UPDATE_APPLY_ACTION_ID } from "@/lib/app-update";
import { currencyFormatter } from "~/shared/currencyFormatter";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";

import { RegisterActionBar } from "./RegisterActionBar";
import { RegisterCheckoutPanel } from "./RegisterCheckoutPanel";
import { RegisterCustomerPanel } from "./RegisterCustomerPanel";
import { RegisterDrawerGate } from "./RegisterDrawerGate";
import { ExpenseCompletionPanel } from "./ExpenseCompletionPanel";
import { getOrigin, reloadWindow } from "~/src/lib/navigationUtils";

function useCollapseSidebarForPosFlow() {
  const { isMobile, open, setOpen } = useSidebar();
  const collapsedForPosFlowRef = useRef(false);
  const previousSidebarOpenRef = useRef<boolean | null>(null);
  const setOpenRef = useRef(setOpen);

  useEffect(() => {
    setOpenRef.current = setOpen;
  }, [setOpen]);

  useEffect(() => {
    if (isMobile || collapsedForPosFlowRef.current) {
      return;
    }

    previousSidebarOpenRef.current = open;
    setOpen(false);
    collapsedForPosFlowRef.current = true;
  }, [isMobile, open, setOpen]);

  useEffect(() => {
    return () => {
      if (
        collapsedForPosFlowRef.current &&
        previousSidebarOpenRef.current !== null
      ) {
        setOpenRef.current(previousSidebarOpenRef.current);
      }
    };
  }, []);
}

function ProductLookupEmptyState({
  canSearchProducts = true,
  canSearchServices = true,
  canQuickAddProduct = false,
  onActivate,
  onQuickAddProduct,
  workflowMode,
}: {
  canSearchProducts?: boolean;
  canSearchServices?: boolean;
  canQuickAddProduct?: boolean;
  onActivate?: () => void | Promise<void>;
  onQuickAddProduct?: () => void;
  workflowMode: RegisterWorkflowMode;
}) {
  const isExpenseWorkflow = workflowMode === "expense";
  const isServiceOnly =
    !isExpenseWorkflow && !canSearchProducts && canSearchServices;
  const isProductOnly =
    isExpenseWorkflow || (canSearchProducts && !canSearchServices);
  const title = isExpenseWorkflow
    ? "Ready for expense entry"
    : isServiceOnly
      ? "Ready for service lookup"
      : isProductOnly
        ? "Ready for product lookup"
        : "Ready for checkout lookup";
  const description = isExpenseWorkflow
    ? "Search or scan products to add expense items"
    : isServiceOnly
      ? "Search services to add service lines to this sale"
      : isProductOnly
        ? "Scan a barcode or search products to add items to this sale"
        : "Scan products or search products and services to add items to this sale";
  const isInteractive = Boolean(onActivate);
  const handleActivate = useCallback(() => {
    void onActivate?.();
  }, [onActivate]);
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!onActivate || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      void onActivate();
    },
    [onActivate],
  );
  const handleQuickAddClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onQuickAddProduct?.();
    },
    [onQuickAddProduct],
  );

  return (
    <div
      aria-label={title}
      className={cn(
        "flex h-full min-h-0 w-full flex-col items-center justify-center rounded-lg border border-border bg-surface-raised p-8 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4",
        isInteractive
          ? "cursor-pointer hover:border-ring hover:bg-muted/30"
          : "cursor-default",
      )}
      data-testid="product-lookup-empty-state"
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={isInteractive ? handleActivate : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
    >
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface text-muted-foreground shadow-surface">
          {isServiceOnly ? (
            <Scissors className="h-7 w-7" />
          ) : (
            <Search className="h-7 w-7" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
        {canSearchProducts ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1">
            <ScanBarcode className="h-3.5 w-3.5" />
            Barcode
          </span>
        ) : null}
        {canSearchProducts ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1">
            <Search className="h-3.5 w-3.5" />
            Product search
            <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
              ⌘+K
            </kbd>
          </span>
        ) : null}
        {canSearchServices && !isExpenseWorkflow ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1">
            <Scissors className="h-3.5 w-3.5" />
            Service search
            <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
              ⌘+K
            </kbd>
          </span>
        ) : null}
        {canQuickAddProduct && onQuickAddProduct ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 rounded-full bg-surface px-3 text-xs"
            onClick={handleQuickAddClick}
          >
            <PackagePlus className="h-3.5 w-3.5" />
            Quick add product
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RegisterSaleSummaryStrip({
  checkout,
  itemCount,
}: {
  checkout: RegisterViewModel["checkout"];
  itemCount: number;
}) {
  const formatter = currencyFormatter(checkout.currency ?? "GHS");
  const totalPaid = calculatePosTotalPaid(checkout.payments ?? []);
  const balanceDue = calculatePosRemainingDue(totalPaid, checkout.total ?? 0);

  return (
    <section
      aria-label="Sale summary"
      className="grid min-h-[6.5rem] overflow-hidden rounded-lg border border-border/80 bg-surface shadow-surface sm:grid-cols-3"
    >
      <div className="flex min-w-0 flex-col justify-center gap-2 border-b border-border/70 px-5 py-5 sm:border-b-0 sm:border-r">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Items
        </p>
        <p className="text-3xl font-semibold leading-none text-foreground">
          {itemCount}
        </p>
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2 border-b border-border/70 px-5 py-5 sm:border-b-0 sm:border-r">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Paid
        </p>
        <p className="text-3xl font-semibold leading-none text-foreground">
          {formatStoredAmount(formatter, totalPaid)}
        </p>
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2 bg-warning/10 px-5 py-5 ring-1 ring-inset ring-warning/20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warning">
          Balance due
        </p>
        <p className="text-3xl font-semibold leading-none text-foreground">
          {formatStoredAmount(formatter, balanceDue)}
        </p>
      </div>
    </section>
  );
}

function CashierAuthWorkspace({
  authDialog,
}: {
  authDialog: NonNullable<RegisterViewModel["authDialog"]>;
}) {
  return (
    <CashierAuthDialog
      open={authDialog.open}
      presentation="inline"
      restoredCashier={authDialog.restoredCashier}
      storeId={authDialog.storeId}
      terminalId={authDialog.terminalId}
      workflowMode={authDialog.workflowMode}
      onAuthenticated={authDialog.onAuthenticated}
      onDismiss={authDialog.onDismiss}
    />
  );
}

function CashierPresenceRestoreWorkspace({
  restore,
}: {
  restore: RegisterViewModel["cashierPresenceRestore"];
}) {
  if (!restore.message) return null;

  return (
    <section
      aria-live="polite"
      className="flex min-h-[8rem] items-center justify-center rounded-lg border border-border bg-surface-raised px-6 py-6 text-center"
    >
      <div className="max-w-xl space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Cashier sign-in
        </p>
        <h2 className="text-xl font-semibold text-foreground">
          {restore.message}
        </h2>
      </div>
    </section>
  );
}

function DrawerGateWorkspace({
  drawerGate,
}: {
  drawerGate: NonNullable<RegisterViewModel["drawerGate"]>;
}) {
  return (
    <div className="flex h-full min-h-0 items-start justify-center overflow-y-auto rounded-lg border border-border bg-surface-raised px-6 py-10 sm:px-8 sm:pt-20">
      <div className="w-[min(100%,40rem)]">
        <RegisterDrawerGate drawerGate={drawerGate} />
      </div>
    </div>
  );
}

function LocalPosStateRecoveryAction({
  isClearingLocalPosState,
  onClearLocalPosState,
}: {
  isClearingLocalPosState: boolean;
  onClearLocalPosState: () => void;
}) {
  return (
    <div className="mt-6 rounded-lg border border-warning/30 bg-warning/5 p-4 text-left">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warning">
            Local recovery
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Clear this browser's cached POS terminal state and reload setup.
            This also removes pending local POS records on this terminal.
          </p>
        </div>
        <Button
          className="shrink-0 gap-2"
          disabled={isClearingLocalPosState}
          onClick={onClearLocalPosState}
          type="button"
          variant="outline"
        >
          {isClearingLocalPosState ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isClearingLocalPosState
            ? "Clearing..."
            : "Clear and reprovision terminal"}
        </Button>
      </div>
    </div>
  );
}

function RegisterSetupResolvingWorkspace({
  debug,
  isClearingLocalPosState,
  onClearLocalPosState,
  onboarding,
}: {
  debug?: RegisterViewModel["debug"];
  isClearingLocalPosState: boolean;
  onClearLocalPosState: () => void;
  onboarding: NonNullable<RegisterViewModel["onboarding"]>;
}) {
  const rows = [
    {
      label: "Terminal ready",
      value: onboarding.terminalReady ? "yes" : "no",
    },
    {
      label: "Cashier setup",
      value: onboarding.cashierSetupReady ? "ready" : "missing",
    },
    {
      label: "Cashier signed in",
      value: onboarding.cashierSignedIn ? "yes" : "no",
    },
    {
      label: "Active store",
      value: debug?.activeStoreSource ?? "unknown",
    },
    {
      label: "Entry context",
      value: formatEntryContextStatus(debug),
    },
    {
      label: "Terminal source",
      value: debug?.terminalSource ?? "unknown",
    },
  ];

  return (
    <section
      aria-live="polite"
      className="flex h-full min-h-0 items-center justify-center rounded-lg border border-border bg-background p-8 text-center"
    >
      <div className="w-full max-w-2xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-warning/30 bg-warning/10 text-warning">
          <MonitorCog className="h-6 w-6" />
        </div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Terminal recovery
        </p>
        <h2 className="mt-2 text-xl font-semibold text-foreground">
          Register setup needs attention
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
          The register shell is ready, but setup details are not resolving.
          Review the diagnostics or clear local POS state to reprovision this
          terminal.
        </p>
        <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
          {rows.map((row) => (
            <div
              className="rounded-md border border-border/70 bg-surface px-3 py-2"
              key={row.label}
            >
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {row.label}
              </p>
              <p className="mt-1 break-words text-sm font-medium text-foreground">
                {row.value}
              </p>
            </div>
          ))}
        </div>
        <LocalPosStateRecoveryAction
          isClearingLocalPosState={isClearingLocalPosState}
          onClearLocalPosState={onClearLocalPosState}
        />
      </div>
    </section>
  );
}

export function CartCountSummary({
  itemCount,
  onExpandCart,
}: {
  itemCount: number;
  onExpandCart: () => void;
}) {
  return (
    <button
      type="button"
      className="shrink-0 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={onExpandCart}
      aria-label="Show cart items"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Items
          </p>
          <p className="text-2xl font-semibold leading-none text-foreground">
            {itemCount}
          </p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ShoppingBasket className="h-4 w-4" />
        </div>
      </div>
    </button>
  );
}

function RegisterSyncStatusChip({
  isRegisterOperable = false,
  syncStatus,
}: {
  isRegisterOperable?: boolean;
  syncStatus: RegisterViewModel["syncStatus"];
}) {
  if (!syncStatus) {
    return null;
  }

  const isOperableReview =
    syncStatus.status === "needs_review" && isRegisterOperable;
  if (syncStatus.status === "needs_review" && !isOperableReview) {
    return null;
  }

  const tone = isOperableReview ? "success" : syncStatus.tone;
  const className =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "warning"
          ? "text-warning"
          : "text-muted-foreground";
  const canRetry =
    !isOperableReview &&
    syncStatus.status !== "synced" &&
    syncStatus.onRetrySync;
  const label = getRegisterSyncStatusChipLabel(syncStatus.status, {
    isRegisterOperable,
  });
  const actionLabel =
    syncStatus.status === "needs_review"
      ? "Check POS sync review"
      : "Retry POS sync";
  const content = <span className="truncate">{label}</span>;

  if (canRetry) {
    return (
      <button
        aria-label={`${actionLabel}: ${label}`}
        className={cn(
          "inline-flex max-w-full items-baseline gap-1 font-mono text-xs leading-none transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        onClick={syncStatus.onRetrySync}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex max-w-full items-baseline gap-1 font-mono text-xs leading-none",
        className,
      )}
    >
      {content}
    </div>
  );
}

function getRegisterSyncStatusChipLabel(
  status: NonNullable<RegisterViewModel["syncStatus"]>["status"],
  options: { isRegisterOperable?: boolean } = {},
) {
  switch (status) {
    case "synced":
      return "synced";
    case "syncing":
      return "syncing";
    case "needs_review":
      if (options.isRegisterOperable) {
        return "ready";
      }
      return "needs review";
    case "locally_closed_pending_sync":
      return "locally closed";
    case "pending_sync":
    default:
      return "pending sync";
  }
}

function formatDebugTimestamp(timestamp?: number) {
  return timestamp
    ? new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z")
    : "n/a";
}

function formatDebugIdentifier(value?: string | null) {
  if (!value) return "none";
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-6)}`;
}

function formatDebugStoredAmount(value?: number | null) {
  return typeof value === "number" ? String(value) : "n/a";
}

function formatDebugStatus(value?: string | null) {
  if (!value) return "not ready";

  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatEntryContextStatus(debug?: RegisterViewModel["debug"]) {
  if (!debug?.localEntryStatus) return "unknown";

  if (debug.localEntryStatus === "ready") {
    if (debug.activeStoreSource === "live") return "live route ready";
    if (debug.activeStoreSource === "local") return "local seed ready";
    return "ready";
  }

  return debug.localEntryStatus.replace(/_/g, " ");
}

function formatDebugSource(value?: string | null) {
  switch (value) {
    case "runtime":
      return "Upload worker";
    case "local-read-model":
      return "Local register record";
    case "register-state":
      return "Register record";
    case "none":
    default:
      return "No active source";
  }
}

function formatDebugTrigger(value?: string | null) {
  switch (value) {
    case "event-appended":
      return "New register activity";
    case "route-entry":
      return "Page opened";
    case "visibility":
      return "Page visible";
    case "interval":
      return "Scheduled retry";
    case "online":
      return "Connection restored";
    case "manual-retry":
    case "manual":
      return "Manual retry";
    case "none":
    default:
      return "Not triggered";
  }
}

function formatDebugRuntimeMode(value?: string | null) {
  switch (value) {
    case "drain-enabled":
      return "Drain enabled";
    case "status-only":
      return "Status only";
    default:
      return "Unknown";
  }
}

function formatDebugAppSessionRecovery(value?: string | null) {
  switch (value) {
    case "waiting_for_network":
      return "Local sale continuation";
    case "recoverable":
    case "idle":
      return "Verified";
    case "validating":
      return "Validating";
    case "retrying":
      return "Retrying";
    case "blocked":
      return "Blocked";
    default:
      return "Not reported";
  }
}

function getDebugAppSessionReconciliationPosture(value?: string | null) {
  if (value === "waiting_for_network") {
    return "App session unverified; local sales stay on this register until cloud validation returns.";
  }

  if (value === "blocked") {
    return "App-session recovery is blocked. Keep terminal, drawer, and staff evidence separate before taking support action.";
  }

  return "No app-session reconciliation posture reported.";
}

function formatDebugCheckInPublishStatus(value?: string | null) {
  switch (value) {
    case "accepted":
      return "Accepted";
    case "failed":
      return "Failed";
    case "not_ready":
      return "Not ready";
    case "pending":
      return "Publishing";
    case "rejected":
      return "Rejected";
    default:
      return "Not observed";
  }
}

function formatDebugRegisterSession(input?: {
  cloudRegisterSessionId?: string;
  localRegisterSessionId?: string;
  registerNumber?: string;
  status?: string;
}) {
  if (!input?.localRegisterSessionId && !input?.cloudRegisterSessionId) {
    return "none";
  }

  return [
    input.status ? formatDebugStatus(input.status) : "Unknown",
    input.registerNumber ? `register ${input.registerNumber}` : null,
    input.localRegisterSessionId
      ? `local ${formatDebugIdentifier(input.localRegisterSessionId)}`
      : null,
    input.cloudRegisterSessionId
      ? `cloud ${formatDebugIdentifier(input.cloudRegisterSessionId)}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function getDebugSyncHoldUp(debug: NonNullable<RegisterViewModel["debug"]>) {
  const reviewCount = debug.syncFlow.reviewEventCount ?? 0;
  const retryableCount = debug.syncFlow.pendingUploadEventCount ?? 0;
  const localOnlyCount = debug.syncFlow.localOnlyEventCount ?? 0;

  if (debug.syncFlow.status === "needs_review") {
    if (retryableCount > 0 && localOnlyCount > 0) {
      return `${formatUploadedReviewEventCount(retryableCount)} waiting on server review; ${formatLocalOnlyReviewRecordCount(localOnlyCount)} need support inspection.`;
    }
    if (retryableCount > 0) {
      return `${formatUploadedReviewEventCount(retryableCount)} waiting on server review.`;
    }
    if (localOnlyCount > 0 || reviewCount > 0) {
      return "Local review records remain on this browser.";
    }
    return "The local sync status is waiting for review settlement.";
  }

  if (retryableCount > 0) {
    return `${retryableCount} local events are eligible to upload.`;
  }

  return "No sync hold-up detected.";
}

function getDebugSyncNextStep(debug: NonNullable<RegisterViewModel["debug"]>) {
  const retryableCount = debug.syncFlow.pendingUploadEventCount ?? 0;

  if (debug.syncFlow.status === "needs_review" && retryableCount > 0) {
    return "Open terminal health or cash controls to resolve the server review. Retry only checks whether that review has settled.";
  }

  if (debug.syncFlow.status === "needs_review") {
    return "Inspect local review records before clearing browser data or discarding local activity.";
  }

  if (retryableCount > 0) {
    return "Let the upload worker drain or trigger retry from the pending sync control.";
  }

  return "No action required.";
}

function formatUploadedReviewEventCount(count: number) {
  return `${count} uploaded review ${count === 1 ? "event is" : "events are"}`;
}

function formatLocalOnlyReviewRecordCount(count: number) {
  return `${count} local-only review ${count === 1 ? "record" : "records"}`;
}

function usePosDebugPanelToggle() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    function isDebugShortcut(event: KeyboardEvent) {
      const isDebugShortcut = event.key === "/" || event.code === "Slash";
      return (event.metaKey || event.ctrlKey) && isDebugShortcut;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isDebugShortcut(event)) {
        return;
      }

      event.preventDefault();
      if (event.repeat) {
        return;
      }

      setIsVisible((current) => !current);
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return isVisible;
}

function POSLocalDebugStrip({
  appSessionRecovery,
  debug,
  isVisible,
}: {
  appSessionRecovery?: string | null;
  debug: RegisterViewModel["debug"];
  isVisible: boolean;
}) {
  if (!debug || !isVisible) return null;

  const runtimeState = debug.runtimeState;
  const heartbeat = runtimeState?.heartbeat;
  const localEvents = runtimeState?.events ?? [];
  const localReviewEvents = heartbeat?.sync.reviewEvents ?? [];
  const localReadModel = runtimeState?.localReadModel;
  const repair = runtimeState?.repair;
  const registerRows: DebugPanelRow[] = [
    ["connection", debug.online ? "Online" : "Offline"],
    ["register activity", formatDebugStatus(debug.localEntryStatus)],
    ["staff access", formatDebugStatus(debug.localStaffAuthorityStatus)],
    ["store record", formatDebugStatus(debug.activeStoreSource)],
    ["register record", formatDebugStatus(debug.terminalSource)],
    ["staff sign-in", debug.staffSignedIn ? "Signed in" : "Not signed in"],
    ["cashier presence", formatDebugStatus(debug.cashierPresence)],
    ["app session", formatDebugAppSessionRecovery(appSessionRecovery)],
    [
      "reconciliation posture",
      getDebugAppSessionReconciliationPosture(appSessionRecovery),
    ],
    [
      "staff authorization",
      debug.syncFlow.staffProof === "present" ? "Ready" : "Needed",
    ],
    ["sign-in panel", debug.authDialogOpen ? "Open" : "Closed"],
    [
      "local drawer",
      formatDebugRegisterSession(localReadModel?.activeRegisterSession),
    ],
    [
      "local block reason",
      localReadModel?.saleBlockReason
        ? formatDebugStatus(localReadModel.saleBlockReason)
        : "none",
    ],
    [
      "local read sequence",
      localReadModel
        ? [
            `local ${localReadModel.syncStatus.lastLocalSequence}`,
            `synced ${localReadModel.syncStatus.lastSyncedSequence ?? "n/a"}`,
            `next ${localReadModel.syncStatus.nextPendingSequence ?? "n/a"}`,
          ].join(" ")
        : "none",
    ],
  ];
  const syncRows: DebugPanelRow[] = [
    ["sync status", formatDebugStatus(debug.syncFlow.status)],
    ["sync hold-up", getDebugSyncHoldUp(debug)],
    ["next sync step", getDebugSyncNextStep(debug)],
    ["status source", formatDebugSource(debug.syncFlow.source)],
    ["runtime mode", formatDebugRuntimeMode(debug.syncFlow.mode)],
    [
      "check-in publish",
      formatDebugCheckInPublishStatus(debug.syncFlow.checkInPublishStatus),
    ],
    [
      "check-in reason",
      debug.syncFlow.checkInPublishReason
        ? formatDebugStatus(debug.syncFlow.checkInPublishReason)
        : "n/a",
    ],
    ["activity signal", String(debug.syncFlow.eventAppendToken)],
    [
      "last sync attempt",
      formatDebugTrigger(debug.syncFlow.lastRuntimeTrigger),
    ],
    [
      "attempt priority",
      debug.syncFlow.lastRuntimeTriggerPriority === "high" ? "High" : "Normal",
    ],
    ["attempted at", formatDebugTimestamp(debug.syncFlow.lastRuntimeTriggerAt)],
    [
      "check-in attempted",
      formatDebugTimestamp(debug.syncFlow.checkInPublishAttemptedAt),
    ],
    [
      "check-in completed",
      formatDebugTimestamp(debug.syncFlow.checkInPublishCompletedAt),
    ],
    ["check-in note", debug.syncFlow.checkInPublishMessage ?? "none"],
    ["waiting to sync", String(debug.syncFlow.pendingEventCount ?? 0)],
    [
      "eligible uploads",
      debug.syncFlow.pendingUploadEventCount === undefined
        ? "n/a"
        : String(debug.syncFlow.pendingUploadEventCount),
    ],
    [
      "local-only events",
      debug.syncFlow.localOnlyEventCount === undefined
        ? "n/a"
        : String(debug.syncFlow.localOnlyEventCount),
    ],
    [
      "oldest pending",
      formatDebugTimestamp(debug.syncFlow.oldestPendingEventAt),
    ],
    [
      "oldest sequence",
      [
        `local ${debug.syncFlow.oldestPendingEventSequence ?? "n/a"}`,
        `upload ${debug.syncFlow.oldestPendingUploadSequence ?? "n/a"}`,
      ].join(" "),
    ],
    [
      "upload sequence",
      [
        `oldest ${debug.syncFlow.oldestPendingUploadSequence ?? "n/a"}`,
        `next ${debug.syncFlow.nextPendingUploadSequence ?? "n/a"}`,
      ].join(" "),
    ],
    [
      "last batch",
      debug.syncFlow.lastBatchEventCount === undefined
        ? "n/a"
        : String(debug.syncFlow.lastBatchEventCount),
    ],
    [
      "held events",
      debug.syncFlow.lastHeldEventCount === undefined
        ? "n/a"
        : String(debug.syncFlow.lastHeldEventCount),
    ],
    [
      "local review items",
      [
        `local ${debug.syncFlow.reviewEventCount ?? 0}`,
        `last ${debug.syncFlow.lastReviewEventCount ?? "n/a"}`,
      ].join(" "),
    ],
    ["failed events", String(debug.syncFlow.failedEventCount ?? 0)],
    [
      "scheduler",
      [
        debug.syncFlow.schedulerRunning ? "running" : "idle",
        debug.syncFlow.schedulerScheduled ? "scheduled" : null,
      ]
        .filter(Boolean)
        .join(" "),
    ],
    [
      "backoff until",
      formatDebugTimestamp(debug.syncFlow.schedulerBackoffUntil ?? undefined),
    ],
    ["failure count", String(debug.syncFlow.failureCount ?? 0)],
    ["last failure", debug.syncFlow.lastFailure ?? "none"],
    [
      "activity count",
      [
        `local ${debug.syncFlow.lastLocalSequence ?? "n/a"}`,
        `synced ${debug.syncFlow.lastSyncedSequence ?? "n/a"}`,
        `next ${debug.syncFlow.nextPendingSequence ?? "n/a"}`,
      ].join(" "),
    ],
  ];
  const heartbeatRows: DebugPanelRow[] = runtimeState
    ? [
        [
          "heartbeat source",
          heartbeat?.source ? formatDebugStatus(heartbeat.source) : "none",
        ],
        ["heartbeat reported", formatDebugTimestamp(heartbeat?.reportedAt)],
        [
          "heartbeat local store",
          heartbeat
            ? [
                heartbeat.localStore.available ? "available" : "unavailable",
                heartbeat.localStore.terminalSeedReady
                  ? "seed ready"
                  : "seed missing",
                heartbeat.localStore.schemaVersion
                  ? `schema ${heartbeat.localStore.schemaVersion}`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")
            : "none",
        ],
        [
          "heartbeat staff",
          heartbeat
            ? [
                formatDebugStatus(heartbeat.staffAuthority.status),
                heartbeat.staffAuthority.staffProfileId
                  ? `staff ${formatDebugIdentifier(
                      heartbeat.staffAuthority.staffProfileId,
                    )}`
                  : "no staff",
              ].join(" ")
            : "none",
        ],
        [
          "heartbeat sale authority",
          heartbeat?.saleAuthority
            ? [
                formatDebugStatus(heartbeat.saleAuthority.status),
                heartbeat.saleAuthority.staffProfileId
                  ? `staff ${formatDebugIdentifier(
                      heartbeat.saleAuthority.staffProfileId,
                    )}`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")
            : "not ready",
        ],
        [
          "heartbeat drawer",
          formatDebugRegisterSession(heartbeat?.activeRegisterSession),
        ],
        [
          "heartbeat drawer authority",
          heartbeat?.drawerAuthority
            ? [
                formatDebugStatus(heartbeat.drawerAuthority.status),
                heartbeat.drawerAuthority.reason
                  ? formatDebugStatus(heartbeat.drawerAuthority.reason)
                  : null,
                `local ${formatDebugIdentifier(
                  heartbeat.drawerAuthority.localRegisterSessionId,
                )}`,
                heartbeat.drawerAuthority.cloudRegisterSessionId
                  ? `cloud ${formatDebugIdentifier(
                      heartbeat.drawerAuthority.cloudRegisterSessionId,
                    )}`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")
            : "none",
        ],
        [
          "heartbeat sync",
          heartbeat
            ? [
                formatDebugStatus(heartbeat.sync.status),
                `pending ${heartbeat.sync.pendingEventCount ?? 0}`,
                `uploadable ${heartbeat.sync.uploadableEventCount ?? 0}`,
                `review ${heartbeat.sync.reviewEventCount ?? 0}`,
                `failed ${heartbeat.sync.failedEventCount ?? 0}`,
              ].join(" ")
            : "none",
        ],
        [
          "local read model",
          localReadModel
            ? [
                localReadModel.canSell ? "can sell" : "blocked",
                formatDebugStatus(localReadModel.syncStatus.state),
                `events ${localReadModel.sourceEventCount}`,
              ].join(" ")
            : "none",
        ],
        [
          "repair seed result",
          repair ? formatDebugStatus(repair.seedResult) : "not observed",
        ],
        ["repair observed", formatDebugTimestamp(repair?.observedAt)],
        [
          "repair directive drawer",
          formatDebugRegisterSession(repair?.directive),
        ],
        [
          "repair directive staff",
          repair?.directive?.staffProfileId
            ? formatDebugIdentifier(repair.directive.staffProfileId)
            : "none",
        ],
        [
          "repair directive expected",
          formatDebugStoredAmount(repair?.directive?.expectedCash),
        ],
      ]
    : [];
  const runtimeRows = [...heartbeatRows, ...syncRows];
  const flow = [
    {
      label: debug.online ? "Connected" : "Offline",
      state: debug.online ? "ready" : "blocked",
    },
    {
      label:
        debug.localEntryStatus === "ready"
          ? "Register activity ready"
          : "Register activity",
      state: debug.localEntryStatus === "ready" ? "ready" : "waiting",
    },
    {
      label:
        debug.syncFlow.staffProof === "present"
          ? "Staff authorized"
          : "Staff authorization",
      state: debug.syncFlow.staffProof === "present" ? "ready" : "waiting",
    },
    {
      label:
        debug.syncFlow.status === "syncing"
          ? "Uploading"
          : debug.syncFlow.status === "synced"
            ? "Uploaded"
            : debug.syncFlow.status === "needs_review"
              ? "Local review"
              : "Upload",
      state:
        debug.syncFlow.status === "needs_review"
          ? "blocked"
          : debug.syncFlow.status === "synced"
            ? "ready"
            : debug.syncFlow.pendingEventCount
              ? "active"
              : "waiting",
    },
    {
      label:
        debug.syncFlow.status === "synced"
          ? "Server current"
          : debug.syncFlow.status === "needs_review"
            ? "Local review item"
            : "Server update",
      state:
        debug.syncFlow.status === "synced"
          ? "ready"
          : debug.syncFlow.status === "needs_review"
            ? "blocked"
            : "waiting",
    },
  ];
  const tone =
    !debug.online || debug.syncFlow.status === "needs_review"
      ? "warning"
      : "neutral";

  return (
    <details
      className={cn(
        "rounded-lg border px-4 py-3 text-xs text-foreground",
        tone === "warning"
          ? "border-warning/30 bg-warning/10"
          : "border-border bg-muted/25",
      )}
      open
    >
      <summary
        className={cn(
          "cursor-pointer font-medium",
          tone === "warning" ? "text-warning" : "text-muted-foreground",
        )}
      >
        Support sync diagnostics
      </summary>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {flow.map((step, index) => (
            <div key={step.label} className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-medium",
                  step.state === "ready"
                    ? "border-success/25 bg-success/10 text-success"
                    : step.state === "blocked"
                      ? "border-warning/30 bg-warning/15 text-warning"
                      : step.state === "active"
                        ? "border-primary/25 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground",
                )}
              >
                <Circle className="h-2 w-2 fill-current" />
                {step.label}
              </span>
              {index < flow.length - 1 ? (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              ) : null}
            </div>
          ))}
        </div>
        {debug.terminalId ? (
          <Button
            asChild
            className="ml-auto h-8 px-2.5 text-xs"
            size="sm"
            variant="ghost"
          >
            <Link
              params={(params) => ({
                ...params,
                orgUrlSlug: params.orgUrlSlug!,
                storeUrlSlug: params.storeUrlSlug!,
                terminalId: debug.terminalId!,
              })}
              search={{ o: getOrigin() }}
              to="/$orgUrlSlug/store/$storeUrlSlug/pos/terminals/$terminalId"
            >
              Open terminal health
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </div>
      <Tabs defaultValue="runtime" className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList
            aria-label="Support sync diagnostic sections"
            className="bg-background/60"
            size="sm"
          >
            <TabsTrigger size="sm" value="runtime">
              Runtime
            </TabsTrigger>
            <TabsTrigger size="sm" value="register">
              Register
            </TabsTrigger>
            <TabsTrigger size="sm" value="events">
              Events
            </TabsTrigger>
          </TabsList>
          <p className="text-xs text-muted-foreground">
            Runtime covers heartbeat and sync worker state. Register covers the
            cashier and drawer context. Events shows the local IndexedDB log.
          </p>
        </div>
        <TabsContent className="mt-3" value="runtime">
          <DebugPanelSection
            badges={[
              {
                label: localReadModel?.canSell
                  ? "local sale ready"
                  : "local gate active",
                tone: localReadModel?.canSell ? "ready" : "warning",
              },
              {
                label: `repair ${
                  repair ? formatDebugStatus(repair.seedResult) : "not observed"
                }`,
                tone:
                  repair?.seedResult === "seeded"
                    ? "ready"
                    : repair?.seedResult === "gateway_rejected" ||
                        repair?.seedResult === "missing_staff_identity"
                      ? "warning"
                      : "neutral",
              },
            ]}
            description="Heartbeat, local read-model, repair, and upload-worker signals."
            rows={runtimeRows}
            title="Runtime state"
          />
        </TabsContent>
        <TabsContent className="mt-3" value="register">
          <DebugPanelSection
            badges={[
              {
                label: debug.staffSignedIn ? "staff signed in" : "no staff",
                tone: debug.staffSignedIn ? "ready" : "warning",
              },
              {
                label: debug.authDialogOpen ? "sign-in open" : "sign-in closed",
                tone: debug.authDialogOpen ? "warning" : "neutral",
              },
            ]}
            description="Register record, cashier presence, app session, and drawer context."
            rows={registerRows}
            title="Register state"
          />
        </TabsContent>
        <TabsContent className="mt-3" value="events">
          <DebugEventsSection
            events={localEvents}
            reviewEvents={localReviewEvents}
          />
        </TabsContent>
      </Tabs>
    </details>
  );
}

type DebugPanelRow = [label: string, value: string];

type DebugRuntimeState = NonNullable<
  NonNullable<RegisterViewModel["debug"]>["runtimeState"]
>;
type DebugEventRecord = NonNullable<DebugRuntimeState["events"]>[number];
type DebugEventFilter =
  "all" | "review" | "uploadable" | "pending" | "failed" | "synced";

const DEBUG_EVENT_FILTERS: Array<{
  label: string;
  value: DebugEventFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Review", value: "review" },
  { label: "Uploadable", value: "uploadable" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
  { label: "Synced", value: "synced" },
];

function isDebugEventReview(event: DebugEventRecord) {
  return event.status === "needs_review";
}

function isDebugEventFailed(event: DebugEventRecord) {
  return event.status === "failed";
}

function isDebugEventSynced(event: DebugEventRecord) {
  return (
    !isDebugEventReview(event) &&
    !isDebugEventFailed(event) &&
    (event.uploaded === true ||
      event.status === "synced" ||
      event.status === "locally_resolved")
  );
}

function isDebugEventUploadable(event: DebugEventRecord) {
  if (event.syncUploadable !== undefined) {
    return event.syncUploadable;
  }

  return (
    !isDebugEventReview(event) &&
    !isDebugEventFailed(event) &&
    !isDebugEventSynced(event) &&
    event.uploaded !== true &&
    typeof event.uploadSequence === "number"
  );
}

function isDebugEventPending(event: DebugEventRecord) {
  return (
    !isDebugEventReview(event) &&
    !isDebugEventFailed(event) &&
    !isDebugEventSynced(event) &&
    !isDebugEventUploadable(event)
  );
}

function debugEventMatchesFilter(
  event: DebugEventRecord,
  filter: DebugEventFilter,
) {
  switch (filter) {
    case "review":
      return isDebugEventReview(event);
    case "uploadable":
      return isDebugEventUploadable(event);
    case "pending":
      return isDebugEventPending(event);
    case "failed":
      return isDebugEventFailed(event);
    case "synced":
      return isDebugEventSynced(event);
    case "all":
    default:
      return true;
  }
}

function DebugPanelSection({
  badges,
  description,
  rows,
  title,
}: {
  badges: Array<{ label: string; tone: "neutral" | "ready" | "warning" }>;
  description: string;
  rows: DebugPanelRow[];
  title: string;
}) {
  return (
    <section className="rounded-md border border-border bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {badges.map((badge) => (
            <span
              className={cn(
                "inline-flex h-6 items-center rounded-full border px-2 font-medium",
                badge.tone === "ready"
                  ? "border-success/25 bg-success/10 text-success"
                  : badge.tone === "warning"
                    ? "border-warning/30 bg-warning/15 text-warning"
                    : "border-border bg-muted/30 text-muted-foreground",
              )}
              key={badge.label}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </div>
      <dl className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0 border-t border-border/60 pt-2">
            <dt className="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-0.5 break-words font-mono text-[0.72rem] leading-5 text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DebugEventsSection({
  events,
  reviewEvents,
}: {
  events: DebugRuntimeState["events"];
  reviewEvents?: NonNullable<
    DebugRuntimeState["heartbeat"]
  >["sync"]["reviewEvents"];
}) {
  const [eventFilter, setEventFilter] = useState<DebugEventFilter>("all");
  const mergedEventsById = new Map<string, DebugEventRecord>();
  for (const event of reviewEvents ?? []) {
    mergedEventsById.set(event.localEventId, event);
  }
  for (const event of events ?? []) {
    mergedEventsById.set(event.localEventId, event);
  }
  const orderedEvents = [...mergedEventsById.values()].sort(
    (left, right) => right.sequence - left.sequence,
  );
  const filteredEvents = orderedEvents.filter((event) =>
    debugEventMatchesFilter(event, eventFilter),
  );
  const eventFilterCounts = DEBUG_EVENT_FILTERS.reduce<
    Record<DebugEventFilter, number>
  >(
    (counts, filter) => {
      counts[filter.value] =
        filter.value === "all"
          ? orderedEvents.length
          : orderedEvents.filter((event) =>
              debugEventMatchesFilter(event, filter.value),
            ).length;
      return counts;
    },
    {} as Record<DebugEventFilter, number>,
  );

  return (
    <section className="rounded-md border border-border bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Local IndexedDB events
          </p>
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            Local event records reported by this terminal. Payload and proof
            fields are omitted.
          </p>
        </div>
        <div aria-label="Local event filters" className="flex flex-wrap gap-2">
          {DEBUG_EVENT_FILTERS.map((filter) => {
            const isActive = eventFilter === filter.value;
            return (
              <button
                aria-pressed={isActive}
                className={cn(
                  "inline-flex h-6 items-center rounded-full border px-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "border-foreground/20 bg-foreground text-background"
                    : filter.value === "synced"
                      ? "border-success/25 bg-success/10 text-success"
                      : filter.value === "review" || filter.value === "failed"
                        ? "border-warning/30 bg-warning/15 text-warning"
                        : "border-border bg-muted/30 text-muted-foreground hover:bg-muted",
                )}
                key={filter.value}
                type="button"
                onClick={() => setEventFilter(filter.value)}
              >
                {filter.label} {eventFilterCounts[filter.value]}
              </button>
            );
          })}
        </div>
      </div>
      {filteredEvents.length > 0 ? (
        <div className="mt-3 max-h-[32rem] overflow-auto rounded-md border border-border/70">
          <div className="min-w-[46rem]">
            <div className="sticky top-0 z-10 grid grid-cols-[5rem_minmax(12rem,1fr)_8rem_8rem_minmax(10rem,1fr)] gap-3 border-b border-border bg-muted px-3 py-2 text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Sequence</span>
              <span>Event</span>
              <span>Status</span>
              <span>Upload</span>
              <span>Scope</span>
            </div>
            <div className="divide-y divide-border/70">
              {filteredEvents.map((event) => (
                <div
                  className="grid grid-cols-[5rem_minmax(12rem,1fr)_8rem_8rem_minmax(10rem,1fr)] gap-3 px-3 py-2 text-xs"
                  key={event.localEventId}
                >
                  <div className="font-mono text-muted-foreground">
                    #{event.sequence}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {formatDebugStatus(event.type)}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[0.68rem] text-muted-foreground">
                      {event.localEventId}
                    </p>
                    <p className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">
                      {formatDebugTimestamp(event.createdAt)}
                    </p>
                  </div>
                  <div className="font-mono text-foreground">
                    {formatDebugStatus(event.status)}
                  </div>
                  <div className="font-mono text-muted-foreground">
                    {typeof event.uploadSequence === "number"
                      ? `#${event.uploadSequence}`
                      : "n/a"}
                    {event.uploaded === true ? " uploaded" : ""}
                  </div>
                  <div className="min-w-0 space-y-0.5 font-mono text-[0.68rem] text-muted-foreground">
                    {event.localRegisterSessionId ? (
                      <p className="truncate">
                        register{" "}
                        {formatDebugIdentifier(event.localRegisterSessionId)}
                      </p>
                    ) : null}
                    {event.localPosSessionId ? (
                      <p className="truncate">
                        sale {formatDebugIdentifier(event.localPosSessionId)}
                      </p>
                    ) : null}
                    {event.localTransactionId ? (
                      <p className="truncate">
                        transaction{" "}
                        {formatDebugIdentifier(event.localTransactionId)}
                      </p>
                    ) : null}
                    {event.staffProfileId ? (
                      <p className="truncate">
                        staff {formatDebugIdentifier(event.staffProfileId)}
                      </p>
                    ) : null}
                    {!event.localRegisterSessionId &&
                    !event.localPosSessionId &&
                    !event.localTransactionId &&
                    !event.staffProfileId ? (
                      <p>none</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
          {orderedEvents.length > 0
            ? "No local events match this filter."
            : "No local events were reported by this terminal."}
        </div>
      )}
    </section>
  );
}

function LocalRegisterClosedWorkspace({
  syncStatus,
}: {
  syncStatus: NonNullable<RegisterViewModel["syncStatus"]>;
}) {
  return (
    <section className="flex h-full min-h-0 items-start justify-center overflow-y-auto rounded-lg border border-border bg-surface-raised px-6 py-10 text-center sm:px-8 sm:pt-20">
      <div className="w-[min(100%,40rem)]">
        <div className="mx-auto flex max-w-2xl flex-col rounded-lg border border-border bg-surface-raised p-8 shadow-surface">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-warning/30 bg-warning/10 text-warning">
            <Cloud aria-hidden className="h-5 w-5" />
          </div>
          <div className="mt-6 space-y-layout-xs">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-warning">
              Pending sync
            </p>
            <h2 className="font-display text-2xl font-semibold text-foreground">
              Register closed locally
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {syncStatus.description}
            </p>
          </div>
          {syncStatus.onRetrySync ? (
            <div className="mt-6 flex justify-center">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={syncStatus.onRetrySync}
                type="button"
              >
                <RefreshCw className="h-4 w-4" />
                Retry sync
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function POSOnboardingWorkspace({
  onboarding,
}: {
  onboarding: RegisterViewModel["onboarding"];
}) {
  const steps = [
    {
      id: "terminal",
      title: "Set up this register",
      description: onboarding.terminalReady
        ? "Register details are ready for this checkout station"
        : "Name this checkout station and assign its register number",
      isComplete: onboarding.terminalReady,
      isCurrent: onboarding.nextStep === "terminal",
      icon: Settings,
      action:
        onboarding.nextStep === "terminal" ? (
          <Link
            params={(params) => ({
              ...params,
              orgUrlSlug: params.orgUrlSlug!,
              storeUrlSlug: params.storeUrlSlug!,
            })}
            to="/$orgUrlSlug/store/$storeUrlSlug/pos/settings"
            search={{ o: getOrigin() }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-action-commit px-4 text-sm font-medium text-action-commit-foreground transition-colors hover:bg-action-commit/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Open register setup
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null,
    },
    {
      id: "cashierSetup",
      title: "Add cashier access",
      description: onboarding.cashierSetupReady
        ? `${onboarding.cashierCount} cashier ${
            onboarding.cashierCount === 1 ? "profile is" : "profiles are"
          } ready for POS sign-in.`
        : "Add at least one cashier or manager with an active PIN",
      isComplete: onboarding.cashierSetupReady,
      isCurrent: onboarding.nextStep === "cashierSetup",
      icon: Users,
      action:
        onboarding.nextStep === "cashierSetup" ? (
          <Link
            params={(params) => ({
              ...params,
              orgUrlSlug: params.orgUrlSlug!,
              storeUrlSlug: params.storeUrlSlug!,
            })}
            to="/$orgUrlSlug/store/$storeUrlSlug/members"
            search={{ o: getOrigin() }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-action-commit px-4 text-sm font-medium text-action-commit-foreground transition-colors hover:bg-action-commit/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Manage staff
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null,
    },
  ];

  return (
    <div className="flex h-full min-h-0 overflow-y-auto rounded-lg border border-border bg-background">
      <div className="mx-auto flex w-full flex-col gap-layout-xl px-layout-3xl py-layout-2xl">
        <header className="max-w-3xl space-y-layout-sm">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Onboarding
          </p>
          <h2 className="font-display text-3xl font-light text-foreground">
            Finish setup before your first checkout
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Athena checks the register setup and staff access before products
            can be scanned into a sale.
          </p>
        </header>

        <div className="grid gap-layout-lg lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
          <div className="space-y-layout-md">
            {steps.map((step) => {
              const Icon = step.icon;
              const isWaiting = !step.isComplete && !step.isCurrent;
              return (
                <section
                  key={step.id}
                  className={cn(
                    "rounded-lg border p-layout-md transition-colors",
                    step.isComplete && "border-border bg-surface",
                    step.isCurrent &&
                      "border-action-commit/40 bg-background shadow-sm",
                    isWaiting &&
                      "border-transparent bg-transparent py-layout-sm opacity-55",
                  )}
                >
                  <div className="flex gap-layout-md">
                    <div
                      className={cn(
                        "mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground",
                        step.isComplete &&
                          "border-success/30 bg-success/10 text-success",
                        step.isCurrent &&
                          !step.isComplete &&
                          "border-action-commit/30 bg-action-neutral-soft text-action-commit",
                        isWaiting &&
                          "h-8 w-8 border-border/60 bg-transparent text-muted-foreground",
                      )}
                    >
                      {step.isComplete ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : step.isCurrent ? (
                        <Icon className="h-4 w-4" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-layout-xs">
                      <div className="flex flex-wrap items-center gap-layout-xs">
                        <h3
                          className={cn(
                            "text-base font-medium text-foreground",
                            isWaiting && "font-normal text-muted-foreground",
                          )}
                        >
                          {step.title}
                        </h3>
                        {!isWaiting ? (
                          <span className="rounded-full border border-border bg-background px-layout-xs py-layout-2xs text-xs text-muted-foreground">
                            {step.isComplete ? "Done" : "Next"}
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          "text-sm leading-6 text-muted-foreground",
                          isWaiting && "text-muted-foreground/80",
                        )}
                      >
                        {step.description}
                      </p>
                      {step.action ? (
                        <div className="pt-layout-xs">{step.action}</div>
                      ) : null}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface POSRegisterViewProps {
  workflowMode?: RegisterWorkflowMode;
  viewModel?: RegisterViewModel;
}

export function POSRegisterView(props: POSRegisterViewProps) {
  return (
    <SidebarProvider
      className="contents"
      defaultOpen={false}
      persistOpenState={false}
    >
      <POSRegisterViewContent {...props} />
    </SidebarProvider>
  );
}

function POSRegisterViewContent(props: POSRegisterViewProps) {
  if (props.viewModel) {
    return (
      <ResolvedPOSRegisterViewContent
        workflowMode={props.workflowMode}
        viewModel={props.viewModel}
      />
    );
  }

  return <DefaultPOSRegisterViewContent workflowMode={props.workflowMode} />;
}

function DefaultPOSRegisterViewContent({
  workflowMode,
}: Pick<POSRegisterViewProps, "workflowMode">) {
  const viewModel = useRegisterViewModel();
  return (
    <ResolvedPOSRegisterViewContent
      workflowMode={workflowMode}
      viewModel={viewModel}
    />
  );
}

function ResolvedPOSRegisterViewContent({
  workflowMode,
  viewModel,
}: {
  workflowMode?: RegisterWorkflowMode;
  viewModel: RegisterViewModel;
}) {
  const appSessionRecovery = usePosTerminalAppSessionRecoveryRuntimeInput();
  const debugAppSessionRecovery = viewModel.debug?.appSessionRecovery;
  const effectiveWorkflowMode: RegisterWorkflowMode =
    workflowMode ?? viewModel.workflowMode ?? "pos";
  const isPosWorkflow = effectiveWorkflowMode === "pos";
  const updateApplyBlocker = viewModel.updateApplyBlocker;
  useAppActionBlocker({
    actionId: APP_UPDATE_APPLY_ACTION_ID,
    active: isPosWorkflow && Boolean(updateApplyBlocker?.active),
    blockerId: "pos-register",
    priority: updateApplyBlocker?.priority ?? "critical-workflow",
    label: updateApplyBlocker?.label ?? "Register ready",
    guidance:
      updateApplyBlocker?.guidance ?? "Apply the update when you are ready.",
  });
  const [, setIsPaymentEntryActive] = useState(false);
  const [, setIsPaymentEditActive] = useState(false);
  const [isPaymentsListExpanded, setIsPaymentsListExpanded] = useState(true);
  const [isEmptyStateQuickAddActive, setIsEmptyStateQuickAddActive] =
    useState(false);
  const productEntryRef = useRef<ProductEntryHandle>(null);
  const pendingEmptyStateQuickAddRef = useRef(false);
  const pendingProductLookupFocusAfterSaleStartRef = useRef(false);
  const headerProductSearchInputRef = useRef<HTMLInputElement>(null);
  const [isClearingLocalPosState, setIsClearingLocalPosState] = useState(false);
  const isDebugPanelVisible = usePosDebugPanelToggle();
  const cashierPresenceRestore =
    viewModel.cashierPresenceRestore ?? ({ status: "missing" } as const);

  useCollapseSidebarForPosFlow();
  const isSessionActive = viewModel.header.isSessionActive;
  const registerViewWidth = "full";
  const registerContentClassName = cn(
    "box-border w-full px-6 py-5",
    "h-full min-h-0",
    "overflow-hidden",
  );
  const hasProductSearchIntent =
    (viewModel.productEntry?.productSearchQuery ?? "").trim().length > 0;
  const hasServiceSearchIntent =
    (viewModel.serviceEntry?.serviceSearchQuery ?? "").trim().length > 0;
  const hasLookupIntent = hasProductSearchIntent || hasServiceSearchIntent;
  const cartItemCount =
    (viewModel.cart?.items?.reduce((sum, item) => sum + item.quantity, 0) ??
      0) +
    (viewModel.cart?.serviceItems?.reduce(
      (sum, item) => sum + item.quantity,
      0,
    ) ?? 0);
  const isAwaitingCashierAuth = Boolean(viewModel.authDialog?.open);
  const isStaffSignedIn =
    viewModel.debug?.staffSignedIn === true || Boolean(viewModel.cashierCard);
  const isResolvingCashierPresence =
    cashierPresenceRestore.status === "pending" && !isStaffSignedIn;
  const onboardingState =
    viewModel.onboarding ??
    ({
      shouldShow: false,
      terminalReady: viewModel.registerInfo?.hasTerminal ?? false,
      cashierSetupReady: true,
      cashierSignedIn: Boolean(viewModel.cashierCard),
      cashierCount: viewModel.cashierCard ? 1 : 0,
      nextStep: "ready",
    } satisfies RegisterViewModel["onboarding"]);
  const localCloseoutSyncStatus = viewModel.syncStatus;
  const isLocallyClosedPendingSync =
    isPosWorkflow &&
    !viewModel.checkout.isTransactionCompleted &&
    localCloseoutSyncStatus?.status === "locally_closed_pending_sync";
  const isPosRegisterLocked =
    isPosWorkflow && isAwaitingCashierAuth && !isLocallyClosedPendingSync;
  const shouldShowOnboarding =
    isPosWorkflow &&
    onboardingState.shouldShow &&
    !viewModel.checkout.isTransactionCompleted &&
    !viewModel.drawerGate;
  const isResolvingRegisterSetup =
    isPosWorkflow &&
    !viewModel.checkout.isTransactionCompleted &&
    !onboardingState.shouldShow &&
    !onboardingState.terminalReady &&
    !viewModel.authDialog &&
    !viewModel.drawerGate;
  const readinessGuard = isPosWorkflow ? viewModel.readinessGuard : null;
  const isPosReadinessGuardSettling =
    readinessGuard?.status === "settling" &&
    (readinessGuard.reason === "cashierPresence" ||
      readinessGuard.reason === "registerSetup");
  const shouldShowPosReadinessGuard =
    readinessGuard?.reason === "registerSetup" &&
    readinessGuard.status === "visible";
  const terminalCanSearchProducts =
    viewModel.productEntry?.canSearchProducts !== false;
  const terminalCanSearchServices =
    viewModel.productEntry?.canSearchServices !== false;
  const terminalCanSearchAnyCatalog =
    terminalCanSearchProducts || terminalCanSearchServices;
  const canSearchProducts =
    !viewModel.checkout.isTransactionCompleted &&
    !isLocallyClosedPendingSync &&
    !viewModel.drawerGate &&
    !isResolvingCashierPresence &&
    !isAwaitingCashierAuth &&
    !shouldShowOnboarding &&
    !isResolvingRegisterSetup;
  const isHeaderProductSearchSupported =
    isSessionActive &&
    canSearchProducts &&
    terminalCanSearchAnyCatalog &&
    !viewModel.productEntry.disabled;
  const canStartSaleFromProductLookup =
    isPosWorkflow &&
    canSearchProducts &&
    terminalCanSearchAnyCatalog &&
    !isSessionActive &&
    Boolean(viewModel.sessionPanel) &&
    !viewModel.sessionPanel?.disableNewSession;
  const canActivateProductLookup =
    isHeaderProductSearchSupported || canStartSaleFromProductLookup;
  const canTouchHeaderProductSearch = canActivateProductLookup;
  const isRegisterOperable =
    isPosWorkflow && isHeaderProductSearchSupported && !viewModel.drawerGate;
  const shouldRenderSaleSurface = isPosWorkflow
    ? !viewModel.checkout.isTransactionCompleted
    : true;
  const shouldRenderExpenseCompletionWorkspace =
    !isPosWorkflow &&
    viewModel.checkout.isTransactionCompleted &&
    !isAwaitingCashierAuth;
  const shouldRenderExpenseCompletionPanel =
    !isPosWorkflow && !shouldRenderExpenseCompletionWorkspace;
  const shouldRenderCheckoutPanel =
    isPosWorkflow || shouldRenderExpenseCompletionPanel;
  const handleClearLocalPosState = useCallback(async () => {
    if (isClearingLocalPosState) {
      return;
    }

    setIsClearingLocalPosState(true);
    try {
      const result = await clearDefaultPosLocalStore();

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success("Local POS state cleared. Reopening terminal setup.");
      reloadWindow();
    } finally {
      setIsClearingLocalPosState(false);
    }
  }, [isClearingLocalPosState]);
  const shouldShowDrawerRecoveryActionBar =
    isPosWorkflow &&
    viewModel.drawerGate?.mode === "recovery" &&
    !viewModel.checkout.isTransactionCompleted &&
    !isLocallyClosedPendingSync &&
    !isAwaitingCashierAuth &&
    !shouldShowOnboarding &&
    !isResolvingRegisterSetup;
  const shouldShowLookupCartSplit =
    isPosWorkflow &&
    shouldRenderSaleSurface &&
    cartItemCount > 0 &&
    !hasLookupIntent &&
    !shouldShowOnboarding &&
    !isResolvingRegisterSetup &&
    !isResolvingCashierPresence &&
    !isAwaitingCashierAuth &&
    !viewModel.drawerGate;
  const shouldRenderCartSidebar =
    shouldRenderSaleSurface &&
    !shouldShowLookupCartSplit &&
    !hasLookupIntent &&
    !shouldShowOnboarding &&
    !isResolvingCashierPresence &&
    !isResolvingRegisterSetup;
  const shouldRenderWorkspaceSidebar =
    !shouldShowOnboarding &&
    !isResolvingCashierPresence &&
    !isResolvingRegisterSetup &&
    (shouldRenderCartSidebar ||
      shouldRenderCheckoutPanel ||
      isAwaitingCashierAuth);
  const shouldPreviewCompletedExpenseItems =
    !isPosWorkflow && viewModel.checkout.isTransactionCompleted;
  const completedExpenseCartItems = shouldPreviewCompletedExpenseItems
    ? (viewModel.checkout.completedTransactionData?.cartItems ??
      viewModel.checkout.cartItems)
    : null;
  const workspaceSidebarCartItems = isPosRegisterLocked
    ? []
    : (completedExpenseCartItems ?? viewModel.cart?.items ?? []);
  const workspaceSidebarServiceItems = isPosRegisterLocked
    ? []
    : (viewModel.cart?.serviceItems ?? []);
  const workspaceSidebarCheckout = isPosRegisterLocked
    ? {
        ...viewModel.checkout,
        cartItems: [],
        payments: [],
        serviceLines: [],
        subtotal: 0,
        tax: 0,
        total: 0,
      }
    : viewModel.checkout;

  useEffect(() => {
    const handleCmdK = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "k"
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (isTypingTarget) {
        return;
      }

      event.preventDefault();

      if (!isHeaderProductSearchSupported) {
        return;
      }

      const didFocusProductEntryInput =
        productEntryRef.current?.focusProductSearchInput() ?? false;
      if (didFocusProductEntryInput) {
        return;
      }

      if (isHeaderProductSearchSupported) {
        headerProductSearchInputRef.current?.focus();
        headerProductSearchInputRef.current?.select();
      }
    };

    document.addEventListener("keydown", handleCmdK);
    return () => document.removeEventListener("keydown", handleCmdK);
  }, [isHeaderProductSearchSupported]);

  const handlePaymentFlowChange = useCallback((isActive: boolean) => {
    setIsPaymentEntryActive(isActive);
  }, []);

  const handlePaymentsExpandedChange = useCallback((isExpanded: boolean) => {
    setIsPaymentsListExpanded(isExpanded);
  }, []);

  const handleEditingPaymentChange = useCallback((isEditing: boolean) => {
    setIsPaymentEditActive(isEditing);
  }, []);

  const handlePaymentEntryStart = useCallback(() => {
    if (hasProductSearchIntent) {
      viewModel.productEntry?.setProductSearchQuery?.("");
    }
    if (hasServiceSearchIntent) {
      viewModel.serviceEntry?.setServiceSearchQuery?.("");
    }

    setIsPaymentEntryActive(true);
  }, [
    hasProductSearchIntent,
    hasServiceSearchIntent,
    viewModel.productEntry,
    viewModel.serviceEntry,
  ]);

  const focusProductLookupSearch = useCallback(() => {
    viewModel.productEntry?.setShowProductLookup?.(true);

    window.setTimeout(() => {
      const didFocusProductEntryInput =
        productEntryRef.current?.focusProductSearchInput() ?? false;
      if (didFocusProductEntryInput) {
        return;
      }

      headerProductSearchInputRef.current?.focus();
      headerProductSearchInputRef.current?.select();
    }, 0);
  }, [viewModel.productEntry]);

  const handleProductLookupEmptyStateActivate = useCallback(() => {
    if (isHeaderProductSearchSupported) {
      focusProductLookupSearch();
      return;
    }

    if (
      pendingProductLookupFocusAfterSaleStartRef.current ||
      !canStartSaleFromProductLookup ||
      !viewModel.sessionPanel
    ) {
      return;
    }

    pendingProductLookupFocusAfterSaleStartRef.current = true;
    void viewModel.sessionPanel.onStartNewSession();
  }, [
    canStartSaleFromProductLookup,
    focusProductLookupSearch,
    isHeaderProductSearchSupported,
    viewModel.sessionPanel,
  ]);

  const handleProductLookupEmptyStateQuickAdd = useCallback(() => {
    if (
      !isHeaderProductSearchSupported ||
      !terminalCanSearchProducts ||
      !viewModel.productEntry.canQuickAddProduct
    ) {
      return;
    }

    pendingEmptyStateQuickAddRef.current = true;
    if (
      isEmptyStateQuickAddActive &&
      productEntryRef.current?.openQuickAddProduct()
    ) {
      pendingEmptyStateQuickAddRef.current = false;
      return;
    }

    setIsEmptyStateQuickAddActive(true);
    viewModel.productEntry?.setShowProductLookup?.(true);
  }, [
    isEmptyStateQuickAddActive,
    isHeaderProductSearchSupported,
    terminalCanSearchProducts,
    viewModel.productEntry,
  ]);

  const handleCompletionBlockAction = useCallback(() => {
    viewModel.customerPanel.onOpenChange(true);
  }, [viewModel.customerPanel]);

  useEffect(() => {
    if (!pendingEmptyStateQuickAddRef.current || !isEmptyStateQuickAddActive) {
      return;
    }

    if (productEntryRef.current?.openQuickAddProduct()) {
      pendingEmptyStateQuickAddRef.current = false;
    }
  }, [isEmptyStateQuickAddActive]);

  useEffect(() => {
    if (
      !pendingProductLookupFocusAfterSaleStartRef.current ||
      !isHeaderProductSearchSupported
    ) {
      return;
    }

    pendingProductLookupFocusAfterSaleStartRef.current = false;
    focusProductLookupSearch();
  }, [focusProductLookupSearch, isHeaderProductSearchSupported]);

  const focusHeaderProductSearch = useCallback(() => {
    if (!isHeaderProductSearchSupported) {
      return;
    }

    window.setTimeout(() => {
      headerProductSearchInputRef.current?.focus();
      headerProductSearchInputRef.current?.select();
    }, 0);
  }, [isHeaderProductSearchSupported]);

  const handleAddProduct = useCallback(
    async (product: Product, quantity?: number) => {
      const added = await viewModel.productEntry.onAddProduct(
        product,
        quantity,
      );
      if (added !== false) {
        focusHeaderProductSearch();
      }

      return added;
    },
    [focusHeaderProductSearch, viewModel.productEntry],
  );

  const handleAddService = useCallback(
    async (service: RegisterServiceSearchResult, amount?: number) => {
      if (!viewModel.serviceEntry) {
        return false;
      }

      const added = await viewModel.serviceEntry.onAddService(service, amount);
      if (added !== false) {
        focusHeaderProductSearch();
      }

      return added;
    },
    [focusHeaderProductSearch, viewModel.serviceEntry],
  );

  const productEntryServiceEntry = useMemo(
    () =>
      viewModel.serviceEntry
        ? {
            ...viewModel.serviceEntry,
            onAddService: handleAddService,
          }
        : undefined,
    [handleAddService, viewModel.serviceEntry],
  );

  const renderProductEntry = ({
    containerClassName = "h-full min-h-0",
    forceQuickAddHost = false,
    lookupPanelClassName = "flex h-full min-h-0 flex-col overflow-hidden",
    resultsClassName = "max-h-none min-h-0 flex-1 pr-1",
  }: {
    containerClassName?: string;
    forceQuickAddHost?: boolean;
    lookupPanelClassName?: string;
    resultsClassName?: string;
  } = {}) => (
    <ProductEntry
      ref={productEntryRef}
      catalogRows={viewModel.productEntry.catalogRows}
      disabled={viewModel.productEntry.disabled}
      showProductLookup={viewModel.productEntry.showProductLookup}
      setShowProductLookup={viewModel.productEntry.setShowProductLookup}
      productSearchQuery={viewModel.productEntry.productSearchQuery}
      setProductSearchQuery={viewModel.productEntry.setProductSearchQuery}
      onBarcodeSubmit={viewModel.productEntry.onBarcodeSubmit}
      onAddProduct={handleAddProduct}
      searchResults={viewModel.productEntry.searchResults}
      isSearchLoading={viewModel.productEntry.isSearchLoading}
      isSearchReady={viewModel.productEntry.isSearchReady}
      canSearchProducts={terminalCanSearchProducts}
      canSearchServices={terminalCanSearchServices}
      canQuickAddProduct={viewModel.productEntry.canQuickAddProduct}
      canAddPendingCheckoutItem={
        viewModel.productEntry.canAddPendingCheckoutItem
      }
      pendingCheckoutContext={viewModel.productEntry.pendingCheckoutContext}
      onQuickAddOpenChange={setIsEmptyStateQuickAddActive}
      forceQuickAddHost={forceQuickAddHost}
      serviceEntry={productEntryServiceEntry}
      showSearchInput={false}
      containerClassName={containerClassName}
      lookupPanelClassName={lookupPanelClassName}
      resultsClassName={resultsClassName}
    />
  );

  if (!viewModel.hasActiveStore) {
    return (
      <View
        className="bg-transparent"
        fullHeight
        header={
          <ComposedPageHeader
            leadingContent={
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {viewModel.header.title}
                  </p>
                </div>
              </div>
            }
          />
        }
      >
        <FadeIn className="flex h-full min-h-0 items-center justify-center p-6">
          <POSRegisterUnresolvedState
            debug={viewModel.debug}
            isClearingLocalPosState={isClearingLocalPosState}
            onClearLocalPosState={handleClearLocalPosState}
          />
        </FadeIn>
      </View>
    );
  }

  return (
    <View
      className="bg-transparent"
      fullHeight
      lockDocumentScroll
      width={registerViewWidth}
      contentClassName={cn(
        "flex h-full max-h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface",
      )}
      headerClassName="shrink-0"
      mainClassName={cn("min-h-0 flex-1")}
      header={
        <ComposedPageHeader
          width={registerViewWidth}
          className="h-auto flex-wrap gap-x-4 gap-y-3 py-4"
          onNavigateBack={viewModel.onNavigateBack}
          leadingContent={
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-8">
              <div className="flex shrink-0 items-baseline gap-3">
                <FadeIn className="flex items-center gap-2 self-center">
                  <div
                    aria-label={
                      isStaffSignedIn ? "Staff signed in" : "No staff signed in"
                    }
                    className={cn(
                      "h-2 w-2 rounded-full",
                      isStaffSignedIn
                        ? "animate-pulse bg-success"
                        : "bg-background",
                    )}
                  />
                </FadeIn>

                <p className="text-lg font-semibold leading-none text-foreground">
                  {viewModel.header.title}
                </p>
                {isPosWorkflow ? (
                  <RegisterSyncStatusChip
                    isRegisterOperable={isRegisterOperable}
                    syncStatus={localCloseoutSyncStatus}
                  />
                ) : null}
              </div>

              {!shouldShowOnboarding &&
              !isResolvingCashierPresence &&
              !isResolvingRegisterSetup ? (
                <ProductSearchInput
                  ref={headerProductSearchInputRef}
                  disabled={!canTouchHeaderProductSearch}
                  productSearchQuery={viewModel.productEntry.productSearchQuery}
                  setProductSearchQuery={
                    viewModel.productEntry.setProductSearchQuery
                  }
                  onBarcodeSubmit={viewModel.productEntry.onBarcodeSubmit}
                  onActivate={
                    canTouchHeaderProductSearch
                      ? handleProductLookupEmptyStateActivate
                      : undefined
                  }
                  readOnly={!canTouchHeaderProductSearch}
                  lookupKind={
                    terminalCanSearchProducts && terminalCanSearchServices
                      ? "products_services"
                      : terminalCanSearchServices
                        ? "services"
                        : "products"
                  }
                  submitOnEnter={
                    isHeaderProductSearchSupported && terminalCanSearchProducts
                  }
                  className="max-w-[800px] flex-1"
                  inputClassName="h-14"
                />
              ) : null}
            </div>
          }
          trailingContent={
            (canSearchProducts &&
              isPosWorkflow &&
              !isLocallyClosedPendingSync) ||
            shouldShowDrawerRecoveryActionBar ? (
              <RegisterActionBar
                cashierCard={viewModel.cashierCard}
                closeoutControl={viewModel.closeoutControl}
                drawerGate={viewModel.drawerGate}
                registerInfo={viewModel.registerInfo}
                sessionPanel={viewModel.sessionPanel}
              />
            ) : undefined
          }
        />
      }
    >
      <FadeIn className={registerContentClassName}>
        <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
          {viewModel.debug ? (
            <POSLocalDebugStrip
              appSessionRecovery={
                debugAppSessionRecovery ?? appSessionRecovery?.status ?? null
              }
              debug={viewModel.debug}
              isVisible={isDebugPanelVisible}
            />
          ) : null}

          {isPosWorkflow &&
          shouldRenderSaleSurface &&
          !shouldShowOnboarding &&
          !isPosRegisterLocked &&
          !isResolvingCashierPresence &&
          !isResolvingRegisterSetup ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.86fr)_minmax(28rem,0.68fr)]">
              <RegisterCustomerPanel
                customerPanel={viewModel.customerPanel}
                disabled={!isSessionActive}
              />
              <RegisterSaleSummaryStrip
                checkout={viewModel.checkout}
                itemCount={cartItemCount}
              />
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
            {shouldRenderSaleSurface ? (
              <div
                data-testid="register-main-workspace"
                className={cn(
                  "flex min-h-0 flex-col overflow-hidden pr-1",
                  !shouldRenderWorkspaceSidebar && "lg:col-span-2",
                )}
              >
                {isLocallyClosedPendingSync && localCloseoutSyncStatus ? (
                  <LocalRegisterClosedWorkspace
                    syncStatus={localCloseoutSyncStatus}
                  />
                ) : shouldShowOnboarding ? (
                  <POSOnboardingWorkspace onboarding={onboardingState} />
                ) : isPosReadinessGuardSettling ? (
                  <div className="h-full min-h-0 rounded-lg border border-border bg-background" />
                ) : shouldShowPosReadinessGuard && isResolvingRegisterSetup ? (
                  <RegisterSetupResolvingWorkspace
                    debug={viewModel.debug}
                    isClearingLocalPosState={isClearingLocalPosState}
                    onClearLocalPosState={handleClearLocalPosState}
                    onboarding={onboardingState}
                  />
                ) : isPosWorkflow && viewModel.drawerGate ? (
                  <DrawerGateWorkspace drawerGate={viewModel.drawerGate} />
                ) : isAwaitingCashierAuth && viewModel.authDialog ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-4">
                    {cashierPresenceRestore.status ===
                    "validation_pending" ? null : (
                      <CashierPresenceRestoreWorkspace
                        restore={cashierPresenceRestore}
                      />
                    )}
                    <CashierAuthWorkspace authDialog={viewModel.authDialog} />
                  </div>
                ) : cashierPresenceRestore.status === "validation_pending" &&
                  cashierPresenceRestore.message ? (
                  <CashierPresenceRestoreWorkspace
                    restore={cashierPresenceRestore}
                  />
                ) : shouldRenderExpenseCompletionWorkspace ? (
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-surface p-4">
                    <ExpenseCompletionPanel checkout={viewModel.checkout} />
                  </div>
                ) : hasLookupIntent ? (
                  <div className="min-h-0 flex-1">{renderProductEntry()}</div>
                ) : shouldShowLookupCartSplit ? (
                  <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]">
                    <ProductLookupEmptyState
                      canQuickAddProduct={
                        terminalCanSearchProducts &&
                        viewModel.productEntry.canQuickAddProduct
                      }
                      canSearchProducts={terminalCanSearchProducts}
                      canSearchServices={terminalCanSearchServices}
                      onActivate={
                        canActivateProductLookup
                          ? handleProductLookupEmptyStateActivate
                          : undefined
                      }
                      onQuickAddProduct={
                        isHeaderProductSearchSupported &&
                        terminalCanSearchProducts &&
                        viewModel.productEntry.canQuickAddProduct
                          ? handleProductLookupEmptyStateQuickAdd
                          : undefined
                      }
                      workflowMode={effectiveWorkflowMode}
                    />
                    <CartItems
                      cartItems={viewModel.cart.items}
                      serviceItems={viewModel.cart.serviceItems}
                      onUpdateQuantity={viewModel.cart.onUpdateQuantity}
                      onRemoveItem={viewModel.cart.onRemoveItem}
                      onUpdateServiceAmount={
                        viewModel.cart.onUpdateServiceAmount
                      }
                      onRemoveService={viewModel.cart.onRemoveService}
                      clearCart={viewModel.cart.onClearCart}
                      readOnly={viewModel.cart.readOnly}
                      density="compact"
                    />
                    {isEmptyStateQuickAddActive
                      ? renderProductEntry({
                          containerClassName: "hidden",
                          forceQuickAddHost: true,
                          lookupPanelClassName: "hidden",
                          resultsClassName: "hidden",
                        })
                      : null}
                  </div>
                ) : (
                  <>
                    <ProductLookupEmptyState
                      canQuickAddProduct={
                        terminalCanSearchProducts &&
                        viewModel.productEntry.canQuickAddProduct
                      }
                      canSearchProducts={terminalCanSearchProducts}
                      canSearchServices={terminalCanSearchServices}
                      onActivate={
                        canActivateProductLookup
                          ? handleProductLookupEmptyStateActivate
                          : undefined
                      }
                      onQuickAddProduct={
                        isHeaderProductSearchSupported &&
                        terminalCanSearchProducts &&
                        viewModel.productEntry.canQuickAddProduct
                          ? handleProductLookupEmptyStateQuickAdd
                          : undefined
                      }
                      workflowMode={effectiveWorkflowMode}
                    />
                    {isEmptyStateQuickAddActive
                      ? renderProductEntry({
                          containerClassName: "hidden",
                          forceQuickAddHost: true,
                          lookupPanelClassName: "hidden",
                          resultsClassName: "hidden",
                        })
                      : null}
                  </>
                )}
              </div>
            ) : null}

            {shouldRenderWorkspaceSidebar ? (
              <div
                data-testid="register-workspace-sidebar"
                className={cn(
                  "flex h-full min-h-0 overflow-hidden",
                  shouldRenderSaleSurface ? "lg:col-span-1" : "lg:col-span-2",
                )}
              >
                <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1">
                  {shouldRenderCartSidebar ? (
                    <CartItems
                      cartItems={workspaceSidebarCartItems}
                      serviceItems={workspaceSidebarServiceItems}
                      onUpdateQuantity={viewModel.cart.onUpdateQuantity}
                      onRemoveItem={viewModel.cart.onRemoveItem}
                      onUpdateServiceAmount={
                        viewModel.cart.onUpdateServiceAmount
                      }
                      onRemoveService={viewModel.cart.onRemoveService}
                      clearCart={viewModel.cart.onClearCart}
                      readOnly={
                        shouldPreviewCompletedExpenseItems ||
                        viewModel.cart.readOnly
                      }
                      density={
                        shouldPreviewCompletedExpenseItems
                          ? "comfortable"
                          : "compact"
                      }
                    />
                  ) : null}

                  {shouldRenderCheckoutPanel ? (
                    <div
                      className={cn(
                        "rounded-lg bg-surface p-4",
                        shouldShowLookupCartSplit ||
                          hasLookupIntent ||
                          viewModel.checkout.isTransactionCompleted
                          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                          : "shrink-0",
                      )}
                    >
                      {isPosWorkflow ? (
                        <RegisterCheckoutPanel
                          checkout={workspaceSidebarCheckout}
                          readOnly={viewModel.cart.readOnly}
                          onPaymentFlowChange={handlePaymentFlowChange}
                          onPaymentEntryStart={handlePaymentEntryStart}
                          onCompletionBlockAction={handleCompletionBlockAction}
                          onEditingPaymentChange={handleEditingPaymentChange}
                          hideActiveSummaryCards
                          paymentsExpanded={isPaymentsListExpanded}
                          onPaymentsExpandedChange={
                            handlePaymentsExpandedChange
                          }
                        />
                      ) : (
                        <ExpenseCompletionPanel checkout={viewModel.checkout} />
                      )}
                    </div>
                  ) : null}

                  {!isPosWorkflow ? (
                    <div className="shrink-0">
                      <CashierView
                        cashierName={
                          viewModel.cashierCard?.cashierName ?? "Unassigned"
                        }
                        isSignInRequired={
                          isAwaitingCashierAuth || !viewModel.cashierCard
                        }
                        onSignOut={viewModel.cashierCard?.onSignOut}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </FadeIn>

      {viewModel.commandApprovalDialog ? (
        <CommandApprovalDialog
          approval={viewModel.commandApprovalDialog.approval}
          onApproved={viewModel.commandApprovalDialog.onApproved}
          onAuthenticateForApproval={
            viewModel.commandApprovalDialog.onAuthenticateForApproval
          }
          onDismiss={viewModel.commandApprovalDialog.onDismiss}
          open={viewModel.commandApprovalDialog.open}
          requestedByStaffProfileId={
            viewModel.commandApprovalDialog.requestedByStaffProfileId
          }
          storeId={viewModel.commandApprovalDialog.storeId}
        />
      ) : null}
    </View>
  );
}

function POSRegisterUnresolvedState({
  debug,
  isClearingLocalPosState,
  onClearLocalPosState,
}: {
  debug?: RegisterViewModel["debug"];
  isClearingLocalPosState: boolean;
  onClearLocalPosState: () => void;
}) {
  const rows = [
    {
      label: "Active store",
      value: debug?.activeStoreSource ?? "missing",
    },
    {
      label: "Live store",
      value: debug?.hasLiveActiveStore ? "ready" : "missing",
    },
    {
      label: "Store id",
      value: debug?.storeId ?? "missing",
    },
    {
      label: "Entry context",
      value: formatEntryContextStatus(debug),
    },
    {
      label: "Terminal",
      value: debug?.terminalSource ?? "unknown",
    },
    {
      label: "Cashier",
      value: debug?.staffSignedIn ? "signed in" : "missing",
    },
  ];

  return (
    <div className="flex w-full max-w-3xl flex-col items-center rounded-lg border border-border bg-surface px-10 py-12 text-center shadow-sm">
      <div className="mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
      <h2 className="text-xl font-medium text-foreground/80">Preparing POS</h2>
      <p className="mt-3 max-w-lg text-base leading-7 text-muted-foreground">
        Waiting for the active store context before loading the register.
      </p>
      <div className="mt-8 w-full rounded-lg border border-border bg-muted/30 p-4 text-left">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Register context
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div
              className="rounded-md border border-border/70 bg-surface px-3 py-2"
              key={row.label}
            >
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {row.label}
              </p>
              <p className="mt-1 break-words text-sm font-medium text-foreground">
                {row.value}
              </p>
            </div>
          ))}
        </div>
      </div>
      <LocalPosStateRecoveryAction
        isClearingLocalPosState={isClearingLocalPosState}
        onClearLocalPosState={onClearLocalPosState}
      />
    </div>
  );
}
