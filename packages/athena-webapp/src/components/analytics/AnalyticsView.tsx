import { useQuery } from "convex/react";
import { useMemo } from "react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import AnalyticsProducts from "./AnalyticsProducts";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { formatNumber } from "../../utils/formatNumber";
import AnalyticsCombinedUsers from "./AnalyticsCombinedUsers";
import StorefrontObservabilityPanel from "./StorefrontObservabilityPanel";
import { Badge } from "../ui/badge";
import {
  Activity,
  Eye,
  MonitorCheck,
  ShoppingBag,
  Users,
} from "lucide-react";

function formatMetric(value: number | undefined) {
  return value === undefined ? "..." : formatNumber(value);
}

function AnalyticsWorkspaceSkeleton() {
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      scrollMode="page"
    >
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            className="border-b-0 pb-0"
            eyebrow="Storefront Ops"
            title="Storefront activity"
            description="Loading the latest storefront signal."
          />
          <PageWorkspaceGrid>
            <PageWorkspaceMain>
              <div className="grid gap-3 md:grid-cols-3">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="h-36 animate-pulse rounded-lg border border-border bg-surface"
                  />
                ))}
              </div>
              <div className="h-80 animate-pulse rounded-lg border border-border bg-surface" />
            </PageWorkspaceMain>
            <PageWorkspaceRail>
              {[0, 1].map((index) => (
                <div
                  key={index}
                  className="h-36 animate-pulse rounded-lg border border-border bg-surface"
                />
              ))}
            </PageWorkspaceRail>
          </PageWorkspaceGrid>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

function StorefrontSignalCard({
  description,
  icon,
  label,
  value,
}: {
  description: string;
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-layout-md py-layout-sm shadow-surface">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </p>
          <p className="font-numeric text-3xl font-semibold tabular-nums text-foreground">
            {formatMetric(value)}
          </p>
        </div>
        <div className="rounded-md border border-border bg-surface-raised p-2 text-muted-foreground">
          {icon}
        </div>
      </div>
      <p className="mt-layout-sm text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export default function AnalyticsView() {
  const { activeStore } = useGetActiveStore();
  const currentTimeMs = useMemo(() => Date.now(), []);

  const summary = useQuery(
    api.storeFront.analytics.getWorkspaceSummary,
    activeStore?._id
      ? { storeId: activeStore._id, currentTimeMs }
      : "skip",
  );

  if (!activeStore || !summary) return <AnalyticsWorkspaceSkeleton />;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      scrollMode="page"
    >
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            className="border-b-0 pb-0"
            eyebrow="Storefront Ops"
            title="Storefront activity"
            description="See what customers are doing now, where checkout needs attention, and which products are drawing interest."
          />

          <PageWorkspaceGrid>
            <PageWorkspaceMain>
              <section className="space-y-layout-lg">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-2xl space-y-2">
                    <Badge variant="outline" className="rounded-full lowercase">
                      {activeStore.name}.store
                    </Badge>
                    <h2 className="font-display text-2xl font-semibold text-foreground">
                      Live storefront pulse
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Start with current movement, then inspect shoppers,
                      products, and journey health when the signal changes.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                    <MonitorCheck className="h-4 w-4" />
                    Live storefront signal
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <StorefrontSignalCard
                    description="People with storefront activity in the current data set."
                    icon={<Users className="h-4 w-4" />}
                    label="Known shoppers"
                    value={summary.overview.knownShoppers}
                  />
                  <StorefrontSignalCard
                    description="Product interest captured from browsing behavior."
                    icon={<Eye className="h-4 w-4" />}
                    label="Product views"
                    value={summary.overview.productViews}
                  />
                  <StorefrontSignalCard
                    description="Carts currently moving through the storefront."
                    icon={<ShoppingBag className="h-4 w-4" />}
                    label="Active checkouts"
                    value={summary.overview.activeCheckoutSessions}
                  />
                </div>
              </section>

              <StorefrontObservabilityPanel />
            </PageWorkspaceMain>

            <PageWorkspaceRail>
              <StorefrontSignalCard
                description="Distinct shoppers seen since opening today."
                icon={<Users className="h-4 w-4" />}
                label="Visitors today"
                value={summary.overview.visitorsToday}
              />
              <section className="rounded-lg border border-border bg-surface px-layout-md py-layout-lg shadow-surface">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Latest activity
                  </p>
                </div>
                <div className="mt-layout-md space-y-3">
                  {summary.recentEvents.length > 0 ? (
                    summary.recentEvents.map((item) => (
                      <div
                        className="border-b border-border/70 pb-3 last:border-0 last:pb-0"
                        key={item._id}
                      >
                        <p className="text-sm font-medium capitalize text-foreground">
                          {item.action.replace(/_/g, " ")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(item._creationTime).toLocaleTimeString(
                            [],
                            {
                              hour: "numeric",
                              minute: "2-digit",
                            },
                          )}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No storefront activity has been recorded yet.
                    </p>
                  )}
                </div>
              </section>
            </PageWorkspaceRail>
          </PageWorkspaceGrid>

          <section className="space-y-layout-lg">
            <div className="max-w-2xl space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Detail
              </p>
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Customer and product detail
              </h2>
              <p className="text-sm text-muted-foreground">
                Use these tables after the pulse tells you where to look.
              </p>
            </div>
            <div className="grid gap-layout-xl xl:grid-cols-2">
              <AnalyticsCombinedUsers items={summary.topUsers} />
              <AnalyticsProducts items={summary.topProducts} />
            </div>
          </section>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
