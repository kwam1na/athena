import { type ReactNode, useMemo } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowUpRight, Store } from "lucide-react";

import { ComposedPageHeader } from "@/components/common/PageHeader";
import { FadeIn } from "@/components/common/FadeIn";
import { Button } from "@/components/ui/button";
import View from "@/components/View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";

type DailyOpeningSnapshot = {
  status?: "blocked" | "needs_attention" | "ready" | "started";
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
  const operatingDateRange = useMemo(() => getLocalOperatingDateRange(), []);
  const snapshot = useQuery(
    api.operations.dailyOpening.getDailyOpeningSnapshot,
    activeStore?._id
      ? {
          ...operatingDateRange,
          storeId: activeStore._id,
        }
      : "skip",
  ) as DailyOpeningSnapshot | undefined;

  if (isLoadingStores || !activeStore?._id || snapshot === undefined) {
    return null;
  }

  if (snapshot.status !== "started") {
    return <StoreDayNotStartedState />;
  }

  return <>{children}</>;
}

function StoreDayNotStartedState() {
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const canLinkToOpening = Boolean(params?.orgUrlSlug && params.storeUrlSlug);

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
            Opening Handoff needs to be completed before sales can begin. Ask a
            manager to start the store day.
          </p>
          {canLinkToOpening ? (
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
                to="/$orgUrlSlug/store/$storeUrlSlug/operations/opening"
              >
                Opening Handoff
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </FadeIn>
    </View>
  );
}
