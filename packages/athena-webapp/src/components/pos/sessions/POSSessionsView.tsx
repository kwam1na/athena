import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { AlertTriangle, ClipboardList } from "lucide-react";

import { GenericDataTable } from "@/components/base/table/data-table";
import View from "@/components/View";
import { FadeIn } from "@/components/common/FadeIn";
import { NavigateBackButton } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/states/empty/empty-state";
import { NoPermissionView } from "@/components/states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "@/components/states/signed-out/ProtectedAdminSignInView";
import { Badge } from "@/components/ui/badge";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { currencyFormatter } from "@/lib/utils";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  posSessionColumns,
  type POSSessionOperationsRow,
} from "./posSessionColumns";

type POSSessionStatus = "active" | "held" | string;

export type POSSessionOperationsDto = {
  _id?: Id<"posSession"> | string;
  sessionId?: Id<"posSession"> | string;
  activeHoldCount?: number | null;
  activeHoldQuantity?: number | null;
  activeHolds?:
    | Array<{
        productName?: string | null;
        sku?: string | null;
        quantity?: number | null;
      }>
    | {
        holdCount?: number | null;
        totalQuantity?: number | null;
        details?: Array<{
          productName?: string | null;
          sku?: string | null;
          quantity?: number | null;
        }>;
      }
    | null;
  cart?: {
    lineItemCount?: number | null;
    totalQuantity?: number | null;
    total?: number | null;
  } | null;
  cartCount?: number | null;
  cartItemCount?: number | null;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  customerName?: string | null;
  expiresAt?: number | null;
  itemCount?: number | null;
  operator?: {
    name?: string | null;
    status?: string | null;
    username?: string | null;
  } | null;
  operatorName?: string | null;
  registerName?: string | null;
  registerNumber?: string | null;
  register?: {
    registerNumber?: string | null;
    status?: string | null;
  } | null;
  registerSessionNumber?: string | null;
  sessionNumber?: string | null;
  status: POSSessionStatus;
  terminalName?: string | null;
  terminalNumber?: string | null;
  terminal?: {
    displayName?: string | null;
    registerNumber?: string | null;
  } | null;
  total?: number | null;
  updatedAt?: number | null;
  workflowTraceId?: string | null;
  workflowTrace?: {
    traceId?: string | null;
  } | null;
};

type POSSessionOperationsResult =
  | POSSessionOperationsDto[]
  | {
      rows?: POSSessionOperationsDto[];
      sessions?: POSSessionOperationsDto[];
    };

type POSSessionsViewContentProps = {
  currency: string;
  isLoading: boolean;
  sessions: POSSessionOperationsDto[];
};

const posSessionsApi = api.inventory.posSessions as unknown as {
  getStoreActiveSessionOperations: FunctionReference<
    "query",
    "public",
    { storeId: Id<"store"> },
    POSSessionOperationsResult
  >;
};

function getSessions(result: POSSessionOperationsResult | undefined) {
  if (!result) {
    return [];
  }

  return Array.isArray(result) ? result : (result.rows ?? result.sessions ?? []);
}

function formatStatusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getSessionCode(session: POSSessionOperationsDto) {
  return (
    session.sessionNumber ||
    String(session.sessionId ?? session._id).slice(-6).toUpperCase()
  );
}

function getOperatorLabel(session: POSSessionOperationsDto) {
  return (
    session.operatorName ||
    session.operator?.name ||
    session.operator?.username ||
    "Operator not recorded"
  );
}

function formatRegisterLabel(registerNumber?: string | null) {
  if (!registerNumber) {
    return null;
  }

  return registerNumber.toLowerCase().startsWith("register")
    ? registerNumber
    : `Register ${registerNumber}`;
}

function getRegisterLabel(session: POSSessionOperationsDto) {
  const terminal =
    session.terminalName ||
    session.terminal?.displayName ||
    (session.terminalNumber ? `Terminal ${session.terminalNumber}` : null);
  const register =
    session.registerName ||
    session.registerSessionNumber ||
    formatRegisterLabel(session.register?.registerNumber) ||
    formatRegisterLabel(session.terminal?.registerNumber) ||
    formatRegisterLabel(session.registerNumber);

  if (terminal && register) {
    return `${terminal} / ${register}`;
  }

  return terminal || register || "Terminal not recorded";
}

function getCustomerLabel(session: POSSessionOperationsDto) {
  return session.customerName || session.customer?.name || "Walk-in customer";
}

function getCartCount(session: POSSessionOperationsDto) {
  return (
    session.cart?.totalQuantity ??
    session.cartItemCount ??
    session.cartCount ??
    session.itemCount ??
    0
  );
}

function formatExpiry(expiresAt?: number | null) {
  if (!expiresAt) {
    return {
      label: "No expiry recorded",
      tone: "text-muted-foreground",
    };
  }

  const formatted = new Date(expiresAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  if (expiresAt < Date.now()) {
    return {
      label: `Expired ${formatted}`,
      tone: "text-destructive",
    };
  }

  return {
    label: formatted,
    tone: "text-foreground",
  };
}

function formatHoldDetails(session: POSSessionOperationsDto) {
  const activeHolds = Array.isArray(session.activeHolds)
    ? session.activeHolds
    : (session.activeHolds?.details ?? []);
  const holdCount =
    session.activeHoldCount ??
    (Array.isArray(session.activeHolds)
      ? session.activeHolds.length
      : session.activeHolds?.holdCount) ??
    0;
  const quantity =
    session.activeHoldQuantity ??
    (Array.isArray(session.activeHolds)
      ? undefined
      : session.activeHolds?.totalQuantity) ??
    activeHolds.reduce((total, hold) => total + Math.max(0, hold.quantity ?? 0), 0) ??
    0;
  const products =
    activeHolds
      ?.map((hold) => hold.productName || hold.sku)
      .filter(Boolean)
      .slice(0, 2)
      .join(", ") || null;

  return {
    label: `${holdCount} hold${holdCount === 1 ? "" : "s"}`,
    detail:
      products && quantity > 0
        ? `${quantity} reserved: ${products}`
        : `${quantity} reserved`,
    quantity,
  };
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "border-transparent bg-success/10 text-success";
    case "held":
      return "border-transparent bg-warning/15 text-warning";
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

function POSSessionsHeader() {
  return (
    <div className="container mx-auto flex h-10 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <NavigateBackButton />
        <p className="truncate text-xl font-medium">POS sessions</p>
      </div>
      <Badge
        className="border-border bg-surface-raised text-muted-foreground"
        variant="outline"
      >
        Operations
      </Badge>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  caption,
}: {
  caption?: string;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-sm shadow-surface">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-numeric text-2xl font-semibold tabular-nums">
        {value}
      </p>
      {caption ? (
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  );
}

export function POSSessionsViewContent({
  currency,
  isLoading,
  sessions,
}: POSSessionsViewContentProps) {
  const formatter = useMemo(() => currencyFormatter(currency), [currency]);
  const rows = useMemo<POSSessionOperationsRow[]>(
    () =>
      sessions.map((session) => {
        const expiry = formatExpiry(session.expiresAt);
        const holds = formatHoldDetails(session);
        const total = session.cart?.total ?? session.total ?? 0;

        return {
          _id: String(session.sessionId ?? session._id),
          cartCount: getCartCount(session),
          cartCountLabel: `${getCartCount(session)} item${
            getCartCount(session) === 1 ? "" : "s"
          }`,
          customerLabel: getCustomerLabel(session),
          expiresAt: session.expiresAt ?? 0,
          expiryLabel: expiry.label,
          expiryTone: expiry.tone,
          holdDetailLabel: holds.detail,
          holdLabel: holds.label,
          holdQuantity: holds.quantity,
          operatorLabel: getOperatorLabel(session),
          registerLabel: getRegisterLabel(session),
          sessionCode: getSessionCode(session),
          status: session.status,
          statusBadgeClass: getStatusBadgeClass(session.status),
          statusLabel: formatStatusLabel(session.status),
          total,
          totalLabel: formatStoredAmount(formatter, total),
          workflowTraceId:
            session.workflowTrace?.traceId ?? session.workflowTraceId ?? null,
        };
      }),
    [formatter, sessions],
  );
  const activeCount = rows.filter((row) => row.status === "active").length;
  const heldCount = rows.filter((row) => row.status === "held").length;
  const totalHolds = rows.reduce((sum, row) => sum + row.holdQuantity, 0);
  const totalValue = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={<POSSessionsHeader />}
      scrollMode="page"
    >
      <FadeIn className="container mx-auto space-y-layout-md py-layout-xl">
        <section className="space-y-layout-sm">
          <div className="flex flex-wrap items-end justify-between gap-layout-sm">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                Active session operations
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Review active and held checkout sessions that are reserving
                inventory.
              </p>
            </div>
            <Badge
              className="border-border bg-surface-raised text-muted-foreground"
              variant="outline"
            >
              {rows.length} session{rows.length === 1 ? "" : "s"}
            </Badge>
          </div>

          <div className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetric label="Active" value={activeCount} />
            <SummaryMetric label="Held" value={heldCount} />
            <SummaryMetric
              caption="Reserved across listed sessions"
              label="Active holds"
              value={totalHolds}
            />
            <SummaryMetric
              caption="Cart value in active work"
              label="Open value"
              value={formatStoredAmount(formatter, totalValue)}
            />
          </div>
        </section>

        {isLoading ? null : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-raised px-layout-lg py-layout-xl">
            <EmptyState
              description="Active and held POS sessions will appear here when carts reserve inventory."
              icon={<ClipboardList className="h-16 w-16 text-muted-foreground" />}
              title="No active POS sessions"
            />
          </div>
        ) : (
          <GenericDataTable
            columns={posSessionColumns}
            data={rows}
            paginationRangeItemLabel="session"
            paginationRangeItemPluralLabel="sessions"
            tableId="pos-active-sessions"
          />
        )}
      </FadeIn>
    </View>
  );
}

export function POSSessionsView() {
  const {
    activeStore,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState();
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;

  const sessionResult = useQuery(
    posSessionsApi.getStoreActiveSessionOperations,
    canQueryProtectedData ? { storeId: activeStore!._id } : "skip",
  ) as POSSessionOperationsResult | undefined;

  if (isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before POS sessions can load protected operations data" />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!activeStore || !params?.orgUrlSlug || !params.storeUrlSlug) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening POS session operations"
            icon={<AlertTriangle className="h-16 w-16 text-muted-foreground" />}
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <POSSessionsViewContent
      currency={activeStore.currency || "USD"}
      isLoading={sessionResult === undefined}
      sessions={getSessions(sessionResult)}
    />
  );
}

export default POSSessionsView;
