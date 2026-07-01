import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, CheckCircle2, Loader2, RefreshCw, Store } from "lucide-react";
import { toast } from "sonner";

import { ComposedPageHeader } from "@/components/common/PageHeader";
import { FadeIn } from "@/components/common/FadeIn";
import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import View from "@/components/View";
import { CashierAuthDialog } from "@/components/pos/CashierAuthDialog";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import {
  type NormalizedCommandResult,
  runCommand,
} from "@/lib/errors/runCommand";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { CommandResult } from "~/shared/commandResult";
import { useLocalPosEntryContext } from "@/lib/pos/infrastructure/local/localPosEntryContext";
import {
  type LocalPosReadiness,
  useLocalPosReadiness,
} from "@/lib/pos/infrastructure/local/localPosReadiness";
import {
  clearIndexedDbPosLocalStore,
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
} from "@/lib/pos/infrastructure/local/posLocalStore";
import { refreshAndStoreTerminalStaffAuthority } from "@/lib/pos/infrastructure/local/terminalStaffAuthorityRefresh";
import { logger } from "@/lib/logger";
import { reloadWindow } from "@/lib/navigationUtils";

type DailyOpeningSnapshot = {
  status?: "blocked" | "needs_attention" | "ready" | "started";
};

type DailyCloseSnapshot = {
  existingClose?: {
    lifecycleStatus?: "active" | "reopened" | "superseded";
  } | null;
  status?: "blocked" | "needs_review" | "carry_forward" | "ready" | "completed";
};

function getLocalOperatingDate(date = new Date()) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function getLocalOperatingDateRange(date = new Date()) {
  const localStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const localEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  );

  return {
    endAt: localEnd.getTime(),
    operatingDate: getLocalOperatingDate(date),
    startAt: localStart.getTime(),
  };
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function POSRegisterOpeningGuard({
  children,
}: {
  children: ReactNode;
}) {
  const { activeStore, isLoadingStores } = useGetActiveStore();
  const routeParams = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const entryContext = useLocalPosEntryContext({
    activeStore,
    routeParams,
  });
  const operatingDateRange = useMemo(() => getLocalOperatingDateRange(), []);
  const storeId = (activeStore?._id ??
    (entryContext.status === "ready"
      ? entryContext.storeId
      : undefined)) as Id<"store"> | undefined;
  const snapshot = useQuery(
    api.operations.dailyOpening.getDailyOpeningSnapshot,
    storeId
      ? {
          ...operatingDateRange,
          storeId,
        }
      : "skip",
  ) as DailyOpeningSnapshot | undefined;
  const dailyCloseSnapshot = useQuery(
    api.operations.dailyClose.getDailyCloseSnapshot,
    storeId
      ? {
          ...operatingDateRange,
          storeId,
        }
      : "skip",
  ) as DailyCloseSnapshot | undefined;
  const localReadiness = useLocalPosReadiness({
    closeSnapshot: dailyCloseSnapshot,
    entryContext,
    openingSnapshot: snapshot,
    operatingDate: operatingDateRange.operatingDate,
  });
  const [locallyStartedDayKey, setLocallyStartedDayKey] = useState<
    string | null
  >(null);
  const localStore = useMemo(
    () =>
      createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }),
    [],
  );
  const [isClearingLocalPosState, setIsClearingLocalPosState] =
    useState(false);
  const handleClearLocalPosState = useCallback(async () => {
    if (isClearingLocalPosState) {
      return;
    }

    setIsClearingLocalPosState(true);
    try {
      const result = await clearIndexedDbPosLocalStore();

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
  const refreshTerminalStaffAuthority = useMutation(
    api.operations.staffCredentials.refreshTerminalStaffAuthority,
  );
  const terminalId =
    entryContext.status === "ready"
      ? (entryContext.terminalSeed?.cloudTerminalId as
          | Id<"posTerminal">
          | undefined)
      : undefined;
  useEffect(() => {
    if (!storeId || !terminalId || isBrowserOffline()) {
      return;
    }

    void (async () => {
      const result = await refreshAndStoreTerminalStaffAuthority({
        localStore,
        refreshTerminalStaffAuthority: refreshTerminalStaffAuthority as Parameters<
          typeof refreshAndStoreTerminalStaffAuthority
        >[0]["refreshTerminalStaffAuthority"],
        storeId,
        terminalId,
      });

      if (result.status === "preserved") {
        logger.warn("[POS] Staff authority background refresh skipped", {
          code: result.code,
          message: result.message,
          storeId,
          terminalId,
        });
        return;
      }

      if (result.status === "write_failed") {
        logger.warn("[POS] Staff authority background refresh could not be stored", {
          message: result.message,
          storeId,
          terminalId,
        });
      }
    })();
  }, [localStore, refreshTerminalStaffAuthority, storeId, terminalId]);
  const activeDayKey = storeId
    ? `${storeId}:${operatingDateRange.operatingDate}`
    : null;
  const effectiveReadiness =
    activeDayKey && locallyStartedDayKey === activeDayKey
      ? ({
          status: "ready",
          source: "local_readiness",
          storeDayStatus: "started",
        } satisfies LocalPosReadiness)
      : localReadiness;

  if (isLoadingStores && entryContext.status === "loading") {
    return null;
  }

  if (effectiveReadiness.status === "loading") {
    return (
      <POSReadinessLoadingState
        closeSnapshot={dailyCloseSnapshot}
        entryContext={entryContext}
        isLoadingStores={isLoadingStores}
        localReadiness={localReadiness}
        openingSnapshot={snapshot}
        operatingDate={operatingDateRange.operatingDate}
        storeId={storeId}
      />
    );
  }

  if (
    effectiveReadiness.status === "blocked" &&
    effectiveReadiness.reason === "not_started"
  ) {
    return (
      <StoreDayNotStartedState
        entryContext={entryContext}
        localReadiness={effectiveReadiness}
        localStore={localStore}
        onStarted={() => setLocallyStartedDayKey(activeDayKey)}
        operatingDateRange={operatingDateRange}
        snapshot={snapshot}
        storeId={storeId}
      />
    );
  }

  if (
    effectiveReadiness.status === "blocked" &&
    effectiveReadiness.reason === "closed"
  ) {
    return <StoreDayClosedState />;
  }

  if (
    effectiveReadiness.status === "blocked" &&
    effectiveReadiness.reason === "local_closeout"
  ) {
    return <>{children}</>;
  }

  if (effectiveReadiness.status === "blocked") {
    return (
      <POSSetupRequiredState
        isClearingLocalPosState={isClearingLocalPosState}
        message={effectiveReadiness.message}
        onClearLocalPosState={handleClearLocalPosState}
      />
    );
  }

  return <>{children}</>;
}

function POSReadinessLoadingState({
  closeSnapshot,
  entryContext,
  isLoadingStores,
  localReadiness,
  openingSnapshot,
  operatingDate,
  storeId,
}: {
  closeSnapshot?: DailyCloseSnapshot;
  entryContext: ReturnType<typeof useLocalPosEntryContext>;
  isLoadingStores: boolean;
  localReadiness: LocalPosReadiness;
  openingSnapshot?: DailyOpeningSnapshot;
  operatingDate: string;
  storeId?: Id<"store">;
}) {
  const blockers = getReadinessLoadingBlockers({
    closeSnapshot,
    entryContext,
    isLoadingStores,
    localReadiness,
    openingSnapshot,
    storeId,
  });
  const rows = getReadinessDiagnosticRows({
    closeSnapshot,
    entryContext,
    isLoadingStores,
    localReadiness,
    openingSnapshot,
    operatingDate,
    storeId,
  });

  return (
    <View
      className="bg-transparent"
      fullHeight
      width="full"
      contentClassName="flex h-full max-h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface"
      headerClassName="shrink-0"
      mainClassName="min-h-0 flex-1"
      header={
        <ComposedPageHeader
          width="full"
          className="h-auto flex-wrap gap-x-4 gap-y-3 py-4"
          leadingContent={
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="w-2 h-2 bg-background rounded-full" />
              <p className="text-lg font-semibold text-gray-900">POS</p>
            </div>
          }
        />
      }
    >
      <FadeIn className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="flex w-full max-w-3xl flex-col items-center rounded-lg border border-border bg-surface px-10 py-12 text-center shadow-sm">
          <div className="mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <h2 className="text-xl font-medium text-foreground/80">
            Preparing POS
          </h2>
          <p className="mt-3 max-w-lg text-base leading-7 text-muted-foreground">
            Checking register readiness.
          </p>
          <div className="mt-8 w-full rounded-lg border border-border bg-muted/30 p-4 text-left">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Waiting on
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {blockers.map((blocker) => (
                  <span
                    className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground"
                    key={blocker}
                  >
                    {blocker}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
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
        </div>
      </FadeIn>
    </View>
  );
}

function getReadinessLoadingBlockers({
  closeSnapshot,
  entryContext,
  isLoadingStores,
  localReadiness,
  openingSnapshot,
  storeId,
}: {
  closeSnapshot?: DailyCloseSnapshot;
  entryContext: ReturnType<typeof useLocalPosEntryContext>;
  isLoadingStores: boolean;
  localReadiness: LocalPosReadiness;
  openingSnapshot?: DailyOpeningSnapshot;
  storeId?: Id<"store">;
}) {
  const blockers: string[] = [];

  if (isLoadingStores) {
    blockers.push("active store lookup");
  }

  if (entryContext.status === "loading") {
    blockers.push("local terminal setup");
  }

  if (!storeId) {
    blockers.push("store id");
  }

  if (storeId && !openingSnapshot) {
    blockers.push("opening snapshot");
  }

  if (openingSnapshot?.status === "started" && !closeSnapshot) {
    blockers.push("close snapshot");
  }

  if (entryContext.status === "ready" && localReadiness.status === "loading") {
    blockers.push("local register readiness");
  }

  return blockers.length > 0 ? blockers : ["readiness evaluation"];
}

function getReadinessDiagnosticRows({
  closeSnapshot,
  entryContext,
  isLoadingStores,
  localReadiness,
  openingSnapshot,
  operatingDate,
  storeId,
}: {
  closeSnapshot?: DailyCloseSnapshot;
  entryContext: ReturnType<typeof useLocalPosEntryContext>;
  isLoadingStores: boolean;
  localReadiness: LocalPosReadiness;
  openingSnapshot?: DailyOpeningSnapshot;
  operatingDate: string;
  storeId?: Id<"store">;
}) {
  const terminalStatus =
    entryContext.status === "ready"
      ? `${entryContext.source}; seed ${entryContext.terminalSeed ? "present" : "missing"}`
      : entryContext.status;
  const localLoadingDiagnostics =
    localReadiness.status === "loading" ? localReadiness.diagnostics : null;

  const rows = [
    {
      label: "Store",
      value: isLoadingStores
        ? "loading"
        : storeId
          ? `ready: ${storeId}`
          : "missing",
    },
    {
      label: "Terminal",
      value: terminalStatus,
    },
    {
      label: "Operating date",
      value: operatingDate,
    },
    {
      label: "Opening snapshot",
      value: storeId ? (openingSnapshot?.status ?? "loading") : "skipped",
    },
    {
      label: "Close snapshot",
      value: storeId
        ? (closeSnapshot?.status ??
          (openingSnapshot?.status === "started" ? "loading" : "pending"))
        : "skipped",
    },
    {
      label: "Local readiness",
      value: localReadiness.status,
    },
  ];

  if (localLoadingDiagnostics) {
    rows.push({
      label: "Local read stage",
      value: localLoadingDiagnostics.stage,
    });

    if (localLoadingDiagnostics.stateKey) {
      rows.push({
        label: "Local read key",
        value: localLoadingDiagnostics.stateKey,
      });
    }

    if (localLoadingDiagnostics.activeStateKey) {
      rows.push({
        label: "Active read key",
        value: localLoadingDiagnostics.activeStateKey,
      });
    }

    if (localLoadingDiagnostics.startedAt) {
      rows.push({
        label: "Local read started",
        value: new Date(localLoadingDiagnostics.startedAt).toLocaleTimeString(),
      });
    }
  }

  return rows;
}

function StoreDayNotStartedState({
  entryContext,
  localReadiness,
  localStore,
  onStarted,
  operatingDateRange,
  snapshot,
  storeId,
}: {
  entryContext: ReturnType<typeof useLocalPosEntryContext>;
  localReadiness: Extract<LocalPosReadiness, { status: "blocked" }>;
  localStore: ReturnType<typeof createPosLocalStore>;
  onStarted: () => void;
  operatingDateRange: ReturnType<typeof getLocalOperatingDateRange>;
  snapshot?: DailyOpeningSnapshot;
  storeId?: Id<"store">;
}) {
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const canLinkToOpening = Boolean(params?.orgUrlSlug && params.storeUrlSlug);
  const startStoreDay = useMutation(api.operations.dailyOpening.startStoreDay);
  const authenticateStaffCredential = useMutation(
    api.operations.staffCredentials.authenticateStaffCredential,
  );
  const [isStarting, setIsStarting] = useState(false);
  const [isStaffAuthOpen, setIsStaffAuthOpen] = useState(false);
  const terminalId =
    entryContext.status === "ready"
      ? (entryContext.terminalSeed?.cloudTerminalId as
          | Id<"posTerminal">
          | undefined)
      : undefined;
  const canStartFromGate = Boolean(
    storeId &&
      (snapshot?.status === "ready" || localReadiness.canStartLocally),
  );
  const shouldStartLocally =
    Boolean(localReadiness.canStartLocally) && snapshot?.status !== "ready";

  const handleStartDay = async (staff: StaffAuthenticationResult) => {
    if (!storeId || isStarting) {
      return;
    }

    setIsStaffAuthOpen(false);
    setIsStarting(true);

    try {
      if (shouldStartLocally) {
        const result = await localStore.writeStoreDayReadiness({
          storeId,
          operatingDate: operatingDateRange.operatingDate,
          status: "started",
          source: "local",
          updatedAt: Date.now(),
        });

        if (result.ok) {
          toast.success("Store day started");
          onStarted();
          return;
        }

        toast.error(result.error.message);
        return;
      }

      const result = await runCommand(() =>
        startStoreDay({
          ...operatingDateRange,
          actorStaffProfileId: staff.staffProfileId,
          storeId,
        }) as Promise<CommandResult<unknown>>,
      );

      if (result.kind === "ok") {
        toast.success("Store day started");
        onStarted();
        return;
      }

      presentCommandToast(result);
    } finally {
      setIsStarting(false);
    }
  };

  const handleAuthenticateStaff = async (args: {
    pinHash: string;
    username: string;
  }): Promise<NormalizedCommandResult<StaffAuthenticationResult>> => {
    if (!storeId) {
      return {
        kind: "user_error",
        error: {
          code: "validation_failed",
          message: "Select a store before confirming staff credentials.",
        },
      };
    }

    return runCommand(() =>
      authenticateStaffCredential({
        allowedRoles: ["cashier", "manager"],
        pinHash: args.pinHash,
        storeId,
        username: args.username,
      }) as Promise<CommandResult<StaffAuthenticationResult>>,
    );
  };

  return (
    <View
      className="bg-transparent"
      fullHeight
      width="full"
      contentClassName="flex h-full max-h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-white"
      headerClassName="shrink-0"
      mainClassName="min-h-0 flex-1"
      header={
        <ComposedPageHeader
          width="full"
          className="h-auto flex-wrap gap-x-4 gap-y-3 py-4"
          leadingContent={
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="w-2 h-2 bg-background rounded-full" />
              <p className="text-lg font-semibold text-gray-900">POS</p>
            </div>
          }
        />
      }
    >
      <FadeIn className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="flex w-full max-w-2xl flex-col items-center rounded-lg border border-border bg-surface px-12 py-16 text-center shadow-sm">
          <div className="mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-warning/10 text-warning">
            <Store className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-medium text-foreground/80">
            Store day not started
          </h2>
          <p className="mt-3 max-w-lg text-base leading-7 text-muted-foreground">
            Start the store day to begin POS sales.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-layout-sm">
            <LoadingButton
              className="min-w-40"
              disabled={!canStartFromGate || isStarting}
              isLoading={isStarting}
              onClick={() => setIsStaffAuthOpen(true)}
              type="button"
              variant="workflow"
            >
              Start day
              <CheckCircle2 className="h-4 w-4" />
            </LoadingButton>
            {canLinkToOpening ? (
              <Button
                asChild
                className="bg-background/80 text-muted-foreground hover:text-foreground"
                size="lg"
                variant="outline"
              >
                <Link
                  params={{
                    orgUrlSlug: params!.orgUrlSlug!,
                    storeUrlSlug: params!.storeUrlSlug!,
                  }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/operations/opening"
                >
                  Opening Handoff
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
          </div>
          {!canStartFromGate ? (
            <p className="mt-layout-md max-w-md text-sm leading-6 text-muted-foreground">
              Terminal setup is required before POS can start the day.
            </p>
          ) : null}
        </div>
      </FadeIn>
      {terminalId && storeId ? (
        <CashierAuthDialog
          onAuthenticated={(result) => {
            void handleStartDay(result);
          }}
          onDismiss={() => setIsStaffAuthOpen(false)}
          open={isStaffAuthOpen}
          storeId={storeId}
          terminalId={terminalId}
        />
      ) : (
        <StaffAuthenticationDialog
          copy={{
            title: "Confirm staff credentials",
            description: "Start the store day with your staff sign-in.",
            submitLabel: "Start day",
          }}
          getSuccessMessage={() => null}
          onAuthenticate={(args) => handleAuthenticateStaff(args)}
          onAuthenticated={(result) => {
            void handleStartDay(result);
          }}
          onDismiss={() => setIsStaffAuthOpen(false)}
          open={isStaffAuthOpen}
        />
      )}
    </View>
  );
}

function StoreDayClosedState() {
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const canLinkToDailyClose = Boolean(params?.orgUrlSlug && params.storeUrlSlug);

  return (
    <View
      className="bg-transparent"
      fullHeight
      width="full"
      contentClassName="flex h-full max-h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-white"
      headerClassName="shrink-0"
      mainClassName="min-h-0 flex-1"
      header={
        <ComposedPageHeader
          width="full"
          className="h-auto flex-wrap gap-x-4 gap-y-3 py-4"
          leadingContent={
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="w-2 h-2 bg-background rounded-full" />
              <p className="text-lg font-semibold text-gray-900">POS</p>
            </div>
          }
        />
      }
    >
      <FadeIn className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="flex w-full max-w-2xl flex-col items-center rounded-lg border border-border bg-surface px-12 py-16 text-center shadow-sm">
          <div className="mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-warning/10 text-warning">
            <Store className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-medium text-foreground/80">
            Store day closed
          </h2>
          <p className="mt-3 max-w-lg text-base leading-7 text-muted-foreground">
            The end of day review has already closed this operating day. Reopen the
            day from the end of day review before entering POS.
          </p>
          {canLinkToDailyClose ? (
            <Button
              asChild
              className="mt-8 bg-background/80 text-muted-foreground hover:text-foreground"
              size="lg"
              variant="outline"
            >
              <Link
                params={{
                  orgUrlSlug: params!.orgUrlSlug!,
                  storeUrlSlug: params!.storeUrlSlug!,
                }}
                to="/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close"
              >
                EOD Review
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </FadeIn>
    </View>
  );
}

function POSSetupRequiredState({
  isClearingLocalPosState,
  message,
  onClearLocalPosState,
}: {
  isClearingLocalPosState: boolean;
  message: string;
  onClearLocalPosState: () => void;
}) {
  return (
    <View
      className="bg-transparent"
      fullHeight
      width="full"
      contentClassName="flex h-full max-h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-white"
      headerClassName="shrink-0"
      mainClassName="min-h-0 flex-1"
      header={
        <ComposedPageHeader
          width="full"
          className="h-auto flex-wrap gap-x-4 gap-y-3 py-4"
          leadingContent={
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="w-2 h-2 bg-background rounded-full" />
              <p className="text-lg font-semibold text-gray-900">POS</p>
            </div>
          }
        />
      }
    >
      <FadeIn className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="flex w-full max-w-2xl flex-col items-center rounded-lg border border-border bg-surface px-12 py-16 text-center shadow-sm">
          <div className="mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-warning/10 text-warning">
            <Store className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-medium text-foreground/80">
            POS setup required
          </h2>
          <p className="mt-3 max-w-lg text-base leading-7 text-muted-foreground">
            {message}
          </p>
          <div className="mt-8 w-full rounded-lg border border-warning/30 bg-warning/5 p-4 text-left">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warning">
                  Local recovery
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Clear this browser's cached POS terminal state and reload
                  setup. This also removes pending local POS records on this
                  terminal.
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
        </div>
      </FadeIn>
    </View>
  );
}
