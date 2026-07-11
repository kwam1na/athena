import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Store,
} from "lucide-react";
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
import { clearDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";
import { refreshAndStoreTerminalStaffAuthority } from "@/lib/pos/infrastructure/local/terminalStaffAuthorityRefresh";
import { logger } from "@/lib/logger";
import { reloadWindow } from "@/lib/navigationUtils";

type DailyOpeningSnapshot = {
  operatingDate?: string;
  status?: "blocked" | "needs_attention" | "ready" | "started";
};

type DailyCloseSnapshot = {
  existingClose?: {
    lifecycleStatus?: "active" | "reopened" | "superseded";
  } | null;
  status?: "blocked" | "needs_review" | "carry_forward" | "ready" | "completed";
};

type ReadinessChecklistItem = {
  label: string;
  state: "checking" | "ready" | "attention";
  value: string;
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

export function POSRegisterOpeningGuard({ children }: { children: ReactNode }) {
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
    (entryContext.status === "ready" ? entryContext.storeId : undefined)) as
    Id<"store"> | undefined;
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
  const localStore = useMemo(() => getDefaultPosLocalStore(), []);
  const [isClearingLocalPosState, setIsClearingLocalPosState] = useState(false);
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
  const refreshTerminalStaffAuthority = useMutation(
    api.operations.staffCredentials.refreshTerminalStaffAuthority,
  );
  const terminalId =
    entryContext.status === "ready"
      ? (entryContext.terminalSeed?.cloudTerminalId as
          Id<"posTerminal"> | undefined)
      : undefined;
  useEffect(() => {
    if (!storeId || !terminalId || isBrowserOffline()) {
      return;
    }

    void (async () => {
      const result = await refreshAndStoreTerminalStaffAuthority({
        localStore,
        refreshTerminalStaffAuthority:
          refreshTerminalStaffAuthority as Parameters<
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
        logger.warn(
          "[POS] Staff authority background refresh could not be stored",
          {
            message: result.message,
            storeId,
            terminalId,
          },
        );
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
  operatingDate?: string;
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
  const checklist = getReadinessChecklistItems({
    closeSnapshot,
    entryContext,
    isLoadingStores,
    localReadiness,
    openingSnapshot,
    operatingDate: openingSnapshot?.operatingDate ?? operatingDate,
    storeId,
  });
  const hasBlockers = blockers.length > 0;

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
        <div className="flex w-full max-w-2xl flex-col items-center rounded-lg border border-border/80 bg-surface px-8 py-10 text-center shadow-sm">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <h2 className="text-xl font-medium text-foreground/80">
            Checking this register
          </h2>
          <p className="mt-3 max-w-lg text-base leading-7 text-muted-foreground">
            Athena is confirming the store day and local register state before
            checkout opens.
          </p>
          <div className="mt-8 w-full rounded-lg border border-border/80 bg-muted/20 p-4 text-left">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Register checks
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  This usually takes a moment.
                </p>
              </div>
              {hasBlockers ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {blockers.map((blocker) => (
                    <span
                      className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground"
                      key={blocker}
                    >
                      {blocker}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-5 grid gap-2">
              {checklist.map((item) => (
                <div
                  className="flex items-start gap-3 rounded-md border border-border/70 bg-surface px-3 py-2.5"
                  key={item.label}
                >
                  <span
                    className={[
                      "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      item.state === "ready"
                        ? "bg-emerald-50 text-emerald-700"
                        : item.state === "attention"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-muted text-muted-foreground",
                    ].join(" ")}
                    title={getReadinessChecklistStateLabel(item.state)}
                  >
                    {item.state === "ready" ? (
                      <CheckCircle2
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    ) : item.state === "attention" ? (
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    <span className="sr-only">
                      {getReadinessChecklistStateLabel(item.state)}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {item.label}
                    </p>
                    <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                      {item.value}
                    </p>
                  </div>
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

  return blockers;
}

function getReadinessChecklistItems({
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
  operatingDate?: string;
  storeId?: Id<"store">;
}): ReadinessChecklistItem[] {
  const localLoadingDiagnostics =
    localReadiness.status === "loading" ? localReadiness.diagnostics : null;
  const operatingDateLabel = formatOperatingDateLabel(operatingDate);

  const items: ReadinessChecklistItem[] = [
    {
      label: "Store",
      state: isLoadingStores ? "checking" : storeId ? "ready" : "attention",
      value: isLoadingStores
        ? "Looking up the active store."
        : storeId
          ? "Active store found."
          : "Active store is missing.",
    },
    {
      label: "Register setup",
      state:
        entryContext.status === "loading"
          ? "checking"
          : entryContext.status === "ready" && entryContext.terminalSeed
            ? "ready"
            : "attention",
      value:
        entryContext.status === "loading"
          ? "Checking this device."
          : entryContext.status === "ready" && entryContext.terminalSeed
            ? "This device is connected to a register."
            : "This device needs register setup.",
    },
    {
      label: "Opening handoff",
      state:
        !storeId || !openingSnapshot
          ? "checking"
          : openingSnapshot.status === "started"
            ? "ready"
            : "attention",
      value:
        !storeId || !openingSnapshot
          ? "Checking today's opening state."
          : openingSnapshot.status === "started"
            ? getStartedStoreDayMessage(operatingDateLabel)
            : "Opening handoff still needs attention.",
    },
    {
      label: "Day close",
      state:
        !storeId || (openingSnapshot?.status === "started" && !closeSnapshot)
          ? "checking"
          : closeSnapshot?.status === "completed" &&
              closeSnapshot.existingClose?.lifecycleStatus !== "reopened"
            ? "attention"
            : "ready",
      value: !storeId
        ? "Waiting for store details."
        : openingSnapshot?.status === "started" && !closeSnapshot
          ? "Checking whether the day is already closed."
          : closeSnapshot?.status === "completed" &&
              closeSnapshot.existingClose?.lifecycleStatus !== "reopened"
            ? "Store day is closed."
            : "No closed day is blocking this register.",
    },
    {
      label: "Local register state",
      state:
        localReadiness.status === "loading"
          ? "checking"
          : localReadiness.status === "ready"
            ? "ready"
            : "attention",
      value:
        localReadiness.status === "loading"
          ? "Reading saved register state on this device."
          : localReadiness.status === "ready"
            ? "Local register state is available."
            : localReadiness.message,
    },
  ];

  if (localLoadingDiagnostics) {
    if (localLoadingDiagnostics.startedAt) {
      items.push({
        label: "Started checking",
        state: "checking",
        value: new Date(localLoadingDiagnostics.startedAt).toLocaleTimeString(),
      });
    }
  }

  return items;
}

function getReadinessChecklistStateLabel(
  state: ReadinessChecklistItem["state"],
) {
  if (state === "ready") return "Ready";
  if (state === "attention") return "Review";
  return "Checking";
}

function getStartedStoreDayMessage(operatingDateLabel: string | null) {
  return operatingDateLabel
    ? `Store day for ${operatingDateLabel} has started.`
    : "Store day has started.";
}

function formatOperatingDateLabel(operatingDate?: string) {
  if (!operatingDate) {
    return null;
  }

  const date = new Date(`${operatingDate}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
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
  localStore: PosLocalStorePort;
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
          Id<"posTerminal"> | undefined)
      : undefined;
  const canStartFromGate = Boolean(
    storeId && (snapshot?.status === "ready" || localReadiness.canStartLocally),
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

      const result = await runCommand(
        () =>
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

    return runCommand(
      () =>
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
  const canLinkToDailyClose = Boolean(
    params?.orgUrlSlug && params.storeUrlSlug,
  );

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
            The end of day review has already closed this operating day. Reopen
            the day from the end of day review before entering POS.
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
