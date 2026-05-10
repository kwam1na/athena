import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Landmark } from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { capitalizeWords } from "@/lib/utils";
import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";
import { api } from "~/convex/_generated/api";
import { formatStaffDisplayName } from "~/shared/staffDisplayName";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { GenericDataTable } from "../base/table/data-table";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { CashControlsWorkspaceHeader } from "./CashControlsWorkspaceHeader";
import {
  registerSessionColumns,
  type RegisterSessionRow,
} from "./registerSessionColumns";
import type {
  CashControlsDashboardSession,
  CashControlsDashboardSnapshot,
} from "./CashControlsDashboard";

type RegisterSessionsViewContentProps = {
  currency: string;
  isLoading: boolean;
  orgUrlSlug: string;
  registerSessions: CashControlsDashboardSession[];
  storeUrlSlug: string;
};

function formatCurrency(currency: string, amount?: number | null) {
  if (amount === undefined || amount === null) {
    return "Pending";
  }

  return formatStoredCurrencyAmount(currency, amount, {
    revealMinorUnits: true,
  });
}

function formatRegisterName(registerNumber?: string | null) {
  const trimmedRegisterNumber = registerNumber?.trim();
  if (!trimmedRegisterNumber) {
    return "Unnamed register";
  }

  return trimmedRegisterNumber.toLowerCase().startsWith("register ")
    ? trimmedRegisterNumber
    : `Register ${trimmedRegisterNumber}`;
}

function formatStatusLabel(status: string) {
  return capitalizeWords(status.replaceAll("_", " "));
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTimelineLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimelineDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimelineTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(openedAt: number, closedAt?: number) {
  if (!closedAt || closedAt < openedAt) {
    return "In progress";
  }

  const totalMinutes = Math.max(1, Math.round((closedAt - openedAt) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function formatTimelineRange(openedAt: number, closedAt?: number) {
  const openedTime = formatTimelineTime(openedAt);

  if (!closedAt) {
    return `${openedTime} - now`;
  }

  return `${openedTime} - ${formatTimelineTime(closedAt)}`;
}

function getVarianceTone(variance?: number) {
  if (!variance) {
    return "text-foreground";
  }

  return variance > 0 ? "text-success" : "text-danger";
}

function getVarianceCaption(variance?: number) {
  if (!variance) {
    return "Balanced";
  }

  return variance > 0 ? "Over expected" : "Short";
}

function getStaffName(staffName?: string | null) {
  return staffName
    ? formatStaffDisplayName({ fullName: staffName }) || "Staff not recorded"
    : "Staff not recorded";
}

function formatSessionCode(sessionId: string) {
  return sessionId.slice(-6).toUpperCase();
}

export function RegisterSessionsViewContent({
  currency,
  isLoading,
  orgUrlSlug,
  registerSessions,
  storeUrlSlug,
}: RegisterSessionsViewContentProps) {
  const tableData = useMemo<RegisterSessionRow[]>(
    () =>
      registerSessions.map((session) => ({
        _id: session._id,
        accountabilityLabel: `Opened ${formatTimelineLabel(session.openedAt)}`,
        closedAtLabel: session.closedAt
          ? formatTimestamp(session.closedAt)
          : "Not closed",
        countedCashLabel: formatCurrency(currency, session.countedCash),
        depositedLabel: formatCurrency(currency, session.totalDeposited),
        expectedCashLabel: formatCurrency(currency, session.expectedCash),
        expectedCashValue: session.expectedCash,
        openedAtLabel: formatTimestamp(session.openedAt),
        openedAtSort: session.openedAt,
        openedByLabel: getStaffName(session.openedByStaffName),
        registerLabel: formatRegisterName(session.registerNumber),
        sessionCode: formatSessionCode(session._id),
        status: session.status,
        statusLabel: formatStatusLabel(session.status),
        timelineDateLabel: formatTimelineDate(session.openedAt),
        timelineDurationLabel: formatDuration(session.openedAt, session.closedAt),
        timelineRangeLabel: formatTimelineRange(
          session.openedAt,
          session.closedAt,
        ),
        varianceCaption: getVarianceCaption(session.variance),
        varianceLabel: formatCurrency(currency, session.variance ?? 0),
        varianceTone: getVarianceTone(session.variance),
        varianceValue: session.variance ?? 0,
      })),
    [currency, registerSessions],
  );

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      scrollMode="page"
      header={
        <CashControlsWorkspaceHeader
          activeView="cash-controls"
          orgUrlSlug={orgUrlSlug}
          showBackButton
          storeUrlSlug={storeUrlSlug}
          title="Register sessions"
        />
      }
    >
      <FadeIn className="container mx-auto py-layout-xl">
        <section className="space-y-layout-md">
          <div className="flex flex-wrap items-center justify-between gap-layout-sm">
            <p className="text-sm text-muted-foreground">
              Review drawer ownership, closeout timing, and cash discrepancies.
            </p>
            <Badge
              className="border-border bg-surface-raised text-muted-foreground"
              variant="outline"
            >
              {registerSessions.length} session
              {registerSessions.length === 1 ? "" : "s"}
            </Badge>
          </div>

          {isLoading ? (
            <div className="rounded-lg border border-border bg-surface-raised p-layout-lg text-sm text-muted-foreground shadow-surface">
              Loading register sessions...
            </div>
          ) : registerSessions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-raised px-layout-lg py-layout-xl">
              <EmptyState
                description="Register sessions will appear after drawers are opened from POS"
                title="No register sessions"
              />
            </div>
          ) : (
            <GenericDataTable
              columns={registerSessionColumns}
              data={tableData}
              tableId="cash-controls-register-sessions"
            />
          )}
        </section>
      </FadeIn>
    </View>
  );
}

export function RegisterSessionsView() {
  const {
    activeStore,
    canAccessProtectedSurface,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState({ surface: "store_day" });
  const canAccessSurface = canAccessProtectedSurface ?? hasFullAdminAccess;
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;

  const dashboardSnapshot = useQuery(
    api.cashControls.deposits.getDashboardSnapshot,
    canQueryProtectedData ? { storeId: activeStore!._id } : "skip",
  ) as CashControlsDashboardSnapshot | undefined;

  if (isLoadingAccess) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading register sessions...
        </div>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before cash controls can load protected register-session data" />
    );
  }

  if (!canAccessSurface) {
    return <NoPermissionView />;
  }

  if (!activeStore || !params?.orgUrlSlug || !params.storeUrlSlug) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening register sessions"
            icon={<Landmark className="h-16 w-16 text-muted-foreground" />}
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <RegisterSessionsViewContent
      currency={activeStore.currency || "USD"}
      isLoading={dashboardSnapshot === undefined}
      orgUrlSlug={params.orgUrlSlug}
      registerSessions={dashboardSnapshot?.registerSessions ?? []}
      storeUrlSlug={params.storeUrlSlug}
    />
  );
}
