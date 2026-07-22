import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { FadeIn } from "../common/FadeIn";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link, useParams } from "@tanstack/react-router";
import {
  ScanBarcode,
  Users,
  Settings,
  Receipt,
  Search,
  HandCoins,
  MonitorCheck,
} from "lucide-react";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { getOrigin } from "~/src/lib/navigationUtils";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import { Badge } from "../ui/badge";
import { usePermissions } from "~/src/hooks/usePermissions";
import { PageLevelHeader, PageWorkspace } from "../common/PageLevelHeader";
import { useLocalPosEntryContext } from "@/lib/pos/infrastructure/local/localPosEntryContext";
import { usePrewarmRegisterCatalogOfflineSnapshots } from "@/lib/pos/infrastructure/convex/catalogGateway";
import type { Id } from "~/convex/_generated/dataModel";
import {
  POSStorePulseSection,
  type POSStorePulseSummary,
  type POSStorePulseWindow,
} from "./sales-pulse/POSSalesPulseView";

type StoreScheduleWindowSummary = {
  localDate: string;
  localStartLabel: string;
};

type StoreScheduleSummaryResult = {
  context?: {
    nextWindow?: StoreScheduleWindowSummary | null;
    timezone: string | null;
  } | null;
  schedule?: {
    timezone: string;
  } | null;
} | null;

type FeatureLinkProps = {
  children: ReactNode;
  className?: string;
  "data-remote-assist-control"?: string;
  "data-remote-assist-control-id"?: string;
  "data-remote-assist-control-label"?: string;
  "data-remote-assist-control-role"?: string;
  params: {
    orgUrlSlug: string;
    storeUrlSlug: string;
  };
  search: {
    o: string;
  };
  to: string;
};

const FeatureLink = Link as unknown as ComponentType<FeatureLinkProps>;

function formatStoreLocalDateTime(now: Date, timezone: string) {
  try {
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "long",
      timeZone: timezone,
      weekday: "long",
    }).format(now);
    const timeLabel = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    }).format(now);

    return `${dateLabel} ${timeLabel}`;
  } catch {
    return null;
  }
}

function formatStoreHoursTimeLabel(value: string) {
  const raw = value.trim();
  const twentyFourHourMatch = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!twentyFourHourMatch) {
    return raw;
  }

  const hour = Number(twentyFourHourMatch[1]);
  const minute = twentyFourHourMatch[2];
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${displayHour}:${minute} ${period}`;
}

function formatStoreLocalDateLabel(localDate: string) {
  const date = new Date(`${localDate}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
  }).format(date);
}

function formatNextOpeningLabel(nextWindow?: StoreScheduleWindowSummary | null) {
  if (!nextWindow?.localStartLabel) {
    return null;
  }

  const timeLabel = formatStoreHoursTimeLabel(nextWindow.localStartLabel);
  const dateLabel = formatStoreLocalDateLabel(nextWindow.localDate);

  return dateLabel ? `${dateLabel} ${timeLabel}` : timeLabel;
}

function useMinuteNow() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const scheduleNextTick = () => {
      const delay = 60_000 - (Date.now() % 60_000);

      return window.setTimeout(() => {
        setNow(new Date());
        timeoutId = scheduleNextTick();
      }, delay);
    };

    let timeoutId = scheduleNextTick();

    return () => window.clearTimeout(timeoutId);
  }, []);

  return now;
}

function StoreLocalTime({
  nowOverride,
  scheduleSummary,
}: {
  nowOverride?: Date;
  scheduleSummary: StoreScheduleSummaryResult | undefined;
}) {
  const shouldReduceMotion = useReducedMotion();
  const tickingNow = useMinuteNow();
  // Screenshot fixtures pin the clock so the captured header is deterministic;
  // the live page always uses the ticking wall clock.
  const now = nowOverride ?? tickingNow;
  const timezone =
    scheduleSummary?.context?.timezone ?? scheduleSummary?.schedule?.timezone;
  const formattedTime = useMemo(
    () => (timezone ? formatStoreLocalDateTime(now, timezone) : null),
    [now, timezone],
  );
  const nextOpeningLabel = useMemo(
    () => formatNextOpeningLabel(scheduleSummary?.context?.nextWindow ?? null),
    [scheduleSummary?.context?.nextWindow],
  );

  return (
    <span className="inline-grid min-h-6 items-center align-top">
      {timezone && formattedTime ? (
        <motion.span
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-6 text-muted-foreground"
          initial={
            shouldReduceMotion
              ? { opacity: 0, transform: "translateY(0px)" }
              : { opacity: 0, transform: "translateY(6px)" }
          }
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        >
          <span className="font-medium text-foreground/85">Store time</span>
          <span className="font-numeric tabular-nums">{formattedTime}</span>
          {nextOpeningLabel ? (
            <>
              <span className="text-border" aria-hidden="true">
                /
              </span>
              <span className="font-medium text-foreground/85">
                Next opening
              </span>
              <span className="font-numeric tabular-nums">
                {nextOpeningLabel}
              </span>
            </>
          ) : null}
        </motion.span>
      ) : null}
    </span>
  );
}

/**
 * Builds the POS hub's launcher tiles. Shared by the live wrapper and the
 * screenshot fixtures so the authored hub can't drift from the real one.
 */
export function buildPosFeatures({
  canAccessPOS,
  hasFinancialDetailsAccess,
  liveLinkParams,
  posLinkParams,
  setupRequired,
}: {
  canAccessPOS: boolean;
  hasFinancialDetailsAccess: boolean;
  liveLinkParams: { orgUrlSlug: string; storeUrlSlug: string } | null;
  posLinkParams: { orgUrlSlug: string; storeUrlSlug: string } | null;
  setupRequired: boolean;
}): PosFeatureConfig[] {
  return [
    {
      title: "POS",
      description: setupRequired
        ? "Connect this terminal before starting sales"
        : "Transact in-store sales",
      icon: ScanBarcode,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/register",
      params: posLinkParams,
      color: "bg-blue-500",
      available: true,
      enabled: Boolean(posLinkParams),
      badge: setupRequired ? "Setup required" : undefined,
    },
    {
      title: "Expense Products",
      description: "Track products expensed",
      icon: HandCoins,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense",
      params: liveLinkParams,
      color: "bg-rose-500",
      available: Boolean(liveLinkParams),
      enabled: Boolean(liveLinkParams),
    },
    {
      title: "Product Lookup",
      description: "Search and scan products for quick reference",
      icon: Search,
      href: "/$orgUrlSlug/store/$storeUrlSlug/products",
      params: liveLinkParams,
      color: "bg-green-500",
      available: hasFinancialDetailsAccess && Boolean(liveLinkParams),
    },

    {
      title: "Transactions",
      description: "View completed transaction history",
      icon: Receipt,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
      params: liveLinkParams,
      color: "bg-orange-500",
      available: Boolean(liveLinkParams),
    },
    {
      title: "Expense Reports",
      description: "View expense reports",
      icon: Receipt,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports",
      params: liveLinkParams,
      color: "bg-yellow-500",
      available: Boolean(liveLinkParams),
    },
    {
      title: "Terminal Health",
      description:
        "Review checkout station sync, staff authority, and support signals",
      icon: MonitorCheck,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/terminals",
      params: liveLinkParams,
      color: "bg-emerald-600",
      available:
        canAccessPOS && hasFinancialDetailsAccess && Boolean(liveLinkParams),
    },
    {
      title: "Customers",
      description: "Manage customer information and purchase history",
      icon: Users,
      href: null,
      params: null,
      color: "bg-pink-500",
      available: false,
    },
    {
      title: "POS Settings",
      description: "Configure terminal settings",
      icon: Settings,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/settings",
      params: liveLinkParams,
      color: "bg-gray-500",
      available:
        canAccessPOS && hasFinancialDetailsAccess && Boolean(liveLinkParams),
    },
  ];
}

function PointOfSaleViewLive() {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();
  const [storePulseWindow, setStorePulseWindow] =
    useState<POSStorePulseWindow>("today");
  const routeParams = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const localEntryContext = useLocalPosEntryContext({
    activeOrganization,
    activeStore,
    routeParams,
  });
  const snapshotStoreId =
    activeStore?._id ??
    (localEntryContext.status === "ready"
      ? (localEntryContext.storeId as Id<"store">)
      : undefined);
  usePrewarmRegisterCatalogOfflineSnapshots({
    refreshAvailabilitySnapshot: false,
    storeId: snapshotStoreId,
  });
  const { canAccessPOS, hasFinancialDetailsAccess, hasFullAdminAccess } =
    usePermissions();
  const visibleStorePulseWindow = hasFullAdminAccess
    ? storePulseWindow
    : "today";
  const todaySummary = useQuery(
    api.inventory.pos.getTodaySummary,
    snapshotStoreId
      ? { pulseWindow: visibleStorePulseWindow, storeId: snapshotStoreId }
      : "skip",
  );
  const storeScheduleSummary = useQuery(
    api.inventory.storeSchedule.getStoreScheduleSummary,
    snapshotStoreId ? { storeId: snapshotStoreId } : "skip",
  ) as StoreScheduleSummaryResult | undefined;

  // Currency formatter
  const currencyFormatter = useGetCurrencyFormatter();

  const liveLinkParams =
    activeOrganization?.slug && activeStore?.slug
      ? {
          orgUrlSlug: activeOrganization.slug,
          storeUrlSlug: activeStore.slug,
        }
      : null;
  const posLinkParams =
    localEntryContext.status === "ready"
      ? {
          orgUrlSlug: localEntryContext.orgUrlSlug,
          storeUrlSlug: localEntryContext.storeUrlSlug,
        }
      : null;
  const setupRequired =
    localEntryContext.status !== "loading" &&
    localEntryContext.status !== "ready";
  const posFeatures = buildPosFeatures({
    canAccessPOS: canAccessPOS(),
    hasFinancialDetailsAccess,
    liveLinkParams,
    posLinkParams,
    setupRequired,
  });

  return (
    <PointOfSaleViewContent
      currencyFormatter={currencyFormatter}
      hasFullAdminAccess={hasFullAdminAccess}
      onPulseWindowChange={setStorePulseWindow}
      posFeatures={posFeatures}
      pulseWindow={visibleStorePulseWindow}
      scheduleSummary={storeScheduleSummary}
      todaySummary={todaySummary}
    />
  );
}

export type PosFeatureConfig = {
  available: boolean;
  badge?: string;
  color: string;
  description: string;
  enabled?: boolean;
  href: string | null;
  icon: ComponentType<{ className?: string }>;
  params: { orgUrlSlug: string; storeUrlSlug: string } | null;
  title: string;
};

export type PointOfSaleViewContentProps = {
  currencyFormatter: Intl.NumberFormat;
  hasFullAdminAccess: boolean;
  /** Pin the header's store clock; screenshot fixtures only. */
  nowOverride?: Date;
  onPulseWindowChange: (pulseWindow: POSStorePulseWindow) => void;
  posFeatures: PosFeatureConfig[];
  pulseWindow: POSStorePulseWindow;
  scheduleSummary: StoreScheduleSummaryResult | undefined;
  todaySummary: POSStorePulseSummary | undefined;
};

/**
 * The POS hub's inner content — the feature launchers and the store-pulse
 * summary — without the {@link View} chrome. Split out so it can be embedded
 * on its own (e.g. the marketing landing renders a live, interactive pulse
 * from this) without View's mount-time `window.scrollTo`.
 */
export function PosHubBody({
  currencyFormatter,
  hasFullAdminAccess,
  nowOverride,
  onPulseWindowChange,
  posFeatures,
  pulseWindow,
  scheduleSummary,
  todaySummary,
}: PointOfSaleViewContentProps) {
  return (
    <>
        <PageWorkspace>
          <PageLevelHeader
            title="Point of Sale"
            description={
              <StoreLocalTime
                nowOverride={nowOverride}
                scheduleSummary={scheduleSummary}
              />
            }
          />

          {/* POS Features Grid */}
          <div>
            {/* <h2 className="text-2xl font-semibold mb-6">POS Features</h2> */}
            <div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              data-testid="athena-pos-hub-ready"
            >
              {posFeatures
                .filter((f) => f.available)
                .map((feature) => {
                  const Icon = feature.icon;

                  if (
                    !feature.available ||
                    !feature.href ||
                    !feature.params ||
                    feature.enabled === false
                  ) {
                    return (
                      <div
                        key={feature.title}
                        className="border rounded-lg opacity-50 cursor-not-allowed"
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-center space-x-3">
                            <div className={`p-2 rounded-lg ${feature.color}`}>
                              <Icon className="h-5 w-5 text-white" />
                            </div>
                            <CardTitle className="text-lg flex items-center gap-2">
                              {feature.title}
                              <Badge variant="outline">
                                {feature.badge ?? "Unavailable"}
                              </Badge>
                            </CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <CardDescription className="text-sm">
                            {feature.description}
                          </CardDescription>
                        </CardContent>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={feature.title}
                      className="border rounded-lg cursor-pointer"
                    >
                      <FeatureLink
                        to={feature.href}
                        params={feature.params}
                        search={{
                          o: getOrigin(),
                        }}
                        className="block h-full"
                        data-remote-assist-control="pos-workspace-feature"
                        data-remote-assist-control-id={`pos-workspace-${feature.title
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/(^-|-$)/g, "")}`}
                        data-remote-assist-control-label={feature.title}
                        data-remote-assist-control-role="link"
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-center space-x-3">
                            <div className={`p-2 rounded-lg ${feature.color}`}>
                              <Icon className="h-5 w-5 text-white" />
                            </div>
                            <CardTitle className="text-lg">
                              {feature.title}
                            </CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <CardDescription className="text-sm">
                            {feature.description}
                          </CardDescription>
                        </CardContent>
                      </FeatureLink>
                    </div>
                  );
                })}
            </div>
          </div>

          <POSStorePulseSection
            currencyFormatter={currencyFormatter}
            hasFullAdminAccess={hasFullAdminAccess}
            onPulseWindowChange={onPulseWindowChange}
            pulseWindow={pulseWindow}
            todaySummary={todaySummary}
          />
        </PageWorkspace>
    </>
  );
}

/**
 * Presentational POS hub inside the app's {@link View} chrome. Rendered live
 * from Convex by {@link PointOfSaleViewLive}, or from authored screenshot
 * fixtures via the `fixture` prop on the default export.
 */
export function PointOfSaleViewContent(props: PointOfSaleViewContentProps) {
  return (
    <View hideBorder hideHeaderBottomBorder>
      <FadeIn className="container mx-auto py-layout-xl">
        <PosHubBody {...props} />
      </FadeIn>
    </View>
  );
}

export default function PointOfSaleView({
  fixture,
}: {
  /** Authored screenshot fixture; dev-only, bypasses all live queries. */
  fixture?: PointOfSaleViewContentProps;
} = {}) {
  return fixture ? (
    <PointOfSaleViewContent {...fixture} />
  ) : (
    <PointOfSaleViewLive />
  );
}
