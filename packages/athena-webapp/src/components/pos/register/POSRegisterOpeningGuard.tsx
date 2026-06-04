import { type ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, CheckCircle2, Store } from "lucide-react";
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
import { useLocalPosReadiness } from "@/lib/pos/infrastructure/local/localPosReadiness";

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

  if (isLoadingStores && entryContext.status === "loading") {
    return null;
  }

  if (localReadiness.status === "loading") {
    return null;
  }

  if (
    localReadiness.status === "blocked" &&
    localReadiness.reason === "not_started"
  ) {
    return (
      <StoreDayNotStartedState
        operatingDateRange={operatingDateRange}
        snapshot={snapshot}
        storeId={storeId}
      />
    );
  }

  if (
    localReadiness.status === "blocked" &&
    localReadiness.reason === "closed"
  ) {
    return <StoreDayClosedState />;
  }

  if (
    localReadiness.status === "blocked" &&
    localReadiness.reason === "local_closeout"
  ) {
    return <>{children}</>;
  }

  if (localReadiness.status === "blocked") {
    return <POSSetupRequiredState message={localReadiness.message} />;
  }

  return <>{children}</>;
}

function StoreDayNotStartedState({
  operatingDateRange,
  snapshot,
  storeId,
}: {
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
  const canStartFromGate = Boolean(storeId && snapshot?.status === "ready");

  const handleStartDay = async (staff: StaffAuthenticationResult) => {
    if (!storeId || isStarting) {
      return;
    }

    setIsStaffAuthOpen(false);
    setIsStarting(true);

    try {
      const result = await runCommand(() =>
        startStoreDay({
          ...operatingDateRange,
          actorStaffProfileId: staff.staffProfileId,
          storeId,
        }) as Promise<CommandResult<unknown>>,
      );

      if (result.kind === "ok") {
        toast.success("Store day started");
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
            Start the day when Opening Handoff is ready.
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
              Opening Handoff needs review before the store day can start from
              POS.
            </p>
          ) : null}
        </div>
      </FadeIn>
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

function POSSetupRequiredState({ message }: { message: string }) {
  return (
    <View
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
        </div>
      </FadeIn>
    </View>
  );
}
