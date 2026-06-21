import { useQuery } from "convex/react";
import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
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
  ClipboardList,
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
  type POSStorePulseWindow,
} from "./sales-pulse/POSSalesPulseView";

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

export default function PointOfSaleView() {
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
  usePrewarmRegisterCatalogOfflineSnapshots({ storeId: snapshotStoreId });
  const { canAccessPOS, hasFullAdminAccess } = usePermissions();
  const visibleStorePulseWindow = hasFullAdminAccess
    ? storePulseWindow
    : "today";
  const todaySummary = useQuery(
    api.inventory.pos.getTodaySummary,
    snapshotStoreId
      ? { pulseWindow: visibleStorePulseWindow, storeId: snapshotStoreId }
      : "skip",
  );

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
  const posFeatures = [
    {
      title: "POS",
      description: setupRequired
        ? "Connect this terminal before starting sales"
        : "Transact in-store sales",
      icon: ScanBarcode,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/register" as const,
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
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense" as const,
      params: liveLinkParams,
      color: "bg-rose-500",
      available: Boolean(liveLinkParams),
      enabled: Boolean(liveLinkParams),
    },
    {
      title: "Product Lookup",
      description: "Search and scan products for quick reference",
      icon: Search,
      href: "/$orgUrlSlug/store/$storeUrlSlug/products" as const,
      params: liveLinkParams,
      color: "bg-green-500",
      available: Boolean(liveLinkParams),
    },

    {
      title: "Transactions",
      description: "View completed transaction history",
      icon: Receipt,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions" as const,
      params: liveLinkParams,
      color: "bg-orange-500",
      available: Boolean(liveLinkParams),
    },
    {
      title: "Active Sessions",
      description: "Review active and held sales reserving inventory",
      icon: ClipboardList,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/sessions" as const,
      params: liveLinkParams,
      color: "bg-cyan-600",
      available: hasFullAdminAccess && Boolean(liveLinkParams),
    },
    {
      title: "Terminal Health",
      description: "Review checkout station sync, staff authority, and support signals",
      icon: MonitorCheck,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/terminals" as const,
      params: liveLinkParams,
      color: "bg-emerald-600",
      available: canAccessPOS() && Boolean(liveLinkParams),
    },
    {
      title: "Expense Reports",
      description: "View expense reports",
      icon: Receipt,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports" as const,
      params: liveLinkParams,
      color: "bg-yellow-500",
      available: Boolean(liveLinkParams),
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
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/settings" as const,
      params: liveLinkParams,
      color: "bg-gray-500",
      available: canAccessPOS() && Boolean(liveLinkParams),
    },
  ];

  return (
    <View hideBorder hideHeaderBottomBorder className="bg-background">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader title="Point of Sale" />

          {/* POS Features Grid */}
          <div>
            {/* <h2 className="text-2xl font-semibold mb-6">POS Features</h2> */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            onPulseWindowChange={setStorePulseWindow}
            pulseWindow={visibleStorePulseWindow}
            todaySummary={todaySummary}
          />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
