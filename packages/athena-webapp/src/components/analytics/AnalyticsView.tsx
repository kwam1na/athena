import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import AnalyticsProducts from "./AnalyticsProducts";
import { FadeIn } from "../common/FadeIn";
import { formatNumber } from "../../utils/formatNumber";
import { Button } from "../ui/button";
import AnalyticsCombinedUsers from "./AnalyticsCombinedUsers";
import { Link } from "@tanstack/react-router";
import StorefrontObservabilityPanel from "./StorefrontObservabilityPanel";
import { Badge } from "../ui/badge";
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  MonitorCheck,
  ShoppingBag,
  Users,
} from "lucide-react";

function formatMetric(value: number | undefined) {
  return value === undefined ? "..." : formatNumber(value);
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
          <p className="font-display text-3xl font-semibold text-foreground">
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

const StoreVisitors = ({ compact = false }: { compact?: boolean }) => {
  const { activeStore } = useGetActiveStore();
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

  const uniqueVisitorsToday = useQuery(
    api.storeFront.guest.getUniqueVisitorsForDay,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          startTimeMs: startOfDay,
          endTimeMs: endOfDay,
        }
      : "skip",
  );

  if (compact) {
    return (
      <StorefrontSignalCard
        description="Distinct people seen since opening today."
        icon={<Users className="h-4 w-4" />}
        label="Visitors today"
        value={uniqueVisitorsToday}
      />
    );
  }

  return null;
};

const ActiveCheckoutSessions = ({ compact = false }: { compact?: boolean }) => {
  const { activeStore } = useGetActiveStore();

  const activeCheckoutSessions = useQuery(
    api.storeFront.checkoutSession.getActiveCheckoutSessionsForStore,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  if (compact) {
    return (
      <div className="rounded-lg border border-border bg-surface px-layout-md py-layout-sm shadow-surface">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Active checkouts
            </p>
            <p className="font-display text-3xl font-semibold text-foreground">
              {formatMetric(activeCheckoutSessions?.length)}
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface-raised p-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-layout-sm text-sm text-muted-foreground">
          Carts currently moving through the storefront.
        </p>
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/checkout-sessions"
          params={(p) => ({
            ...p,
            orgUrlSlug: p.orgUrlSlug!,
            storeUrlSlug: p.storeUrlSlug!,
          })}
        >
          <Button variant="link" className="mt-layout-sm h-auto p-0 text-sm">
            Review sessions <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    );
  }

  return null;
};

export default function AnalyticsView() {
  const { activeStore } = useGetActiveStore();

  const analytics = useQuery(
    api.storeFront.analytics.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  const items = analytics?.sort((a, b) => b._creationTime - a._creationTime);

  if (!activeStore || !analytics || !items) return null;

  const productViewCount = items.filter((item) =>
    item.action.includes("product"),
  ).length;
  const customerCount = new Set(items.map((item) => item.storeFrontUserId))
    .size;
  const recentEvents = items.slice(0, 5);

  const Navigation = () => {
    return (
      <div className="container mx-auto py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Storefront Ops
            </p>
            <div className="space-y-1">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                Storefront activity
              </h1>
              <p className="text-sm text-muted-foreground">
                See what customers are doing now, where checkout needs
                attention, and which products are drawing interest.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Enhanced view
  // if (viewMode === "enhanced") {
  //   return (
  //     <View
  //       hideBorder
  //       hideHeaderBottomBorder
  //       className="bg-background"
  //       header={<Navigation />}
  //     >
  //       <EnhancedAnalyticsView />
  //     </View>
  //   );
  // }

  // Classic view

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
      scrollMode="page"
    >
      <FadeIn className="space-y-layout-2xl py-layout-xl">
        <section className="grid gap-layout-xl xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-layout-lg">
            <section className="space-y-layout-lg">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl space-y-2">
                  <Badge variant="outline" className="rounded-full lowercase">
                    {activeStore.name}.store
                  </Badge>
                  <h2 className="font-display text-2xl font-semibold text-foreground">
                    Customers are browsing the storefront.
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Start here for the live pulse. Use the detail sections below
                    when you need to inspect specific customers, products, or
                    journey failures.
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
                  value={customerCount}
                />
                <StorefrontSignalCard
                  description="Product interest captured from browsing behavior."
                  icon={<Eye className="h-4 w-4" />}
                  label="Product views"
                  value={productViewCount}
                />
                <ActiveCheckoutSessions compact />
              </div>
            </section>

            <StorefrontObservabilityPanel />
          </div>

          <aside className="space-y-layout-md">
            <StoreVisitors compact />
            <section className="rounded-lg border border-border bg-surface px-layout-md py-layout-lg shadow-surface">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Latest activity
                </p>
              </div>
              <div className="mt-layout-md space-y-3">
                {recentEvents.map((item) => (
                  <div
                    className="border-b border-border/70 pb-3 last:border-0 last:pb-0"
                    key={item._id}
                  >
                    <p className="text-sm font-medium text-foreground">
                      {item.action.replace(/_/g, " ")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(item._creationTime).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>

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
            <AnalyticsCombinedUsers items={items} />
            <AnalyticsProducts items={items} />
          </div>
        </section>
      </FadeIn>
    </View>
  );
}
