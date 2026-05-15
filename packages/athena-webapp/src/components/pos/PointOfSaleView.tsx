import { useQuery } from "convex/react";
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
  BarChart3,
  Users,
  Settings,
  Receipt,
  Search,
  HandCoins,
  ClipboardList,
} from "lucide-react";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { getOrigin } from "~/src/lib/navigationUtils";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import { Badge } from "../ui/badge";
import { usePermissions } from "~/src/hooks/usePermissions";
import { toDisplayAmount } from "~/convex/lib/currency";
import { PageLevelHeader, PageWorkspace } from "../common/PageLevelHeader";
import { useLocalPosEntryContext } from "@/lib/pos/infrastructure/local/localPosEntryContext";
import { usePrewarmRegisterCatalogOfflineSnapshots } from "@/lib/pos/infrastructure/convex/catalogGateway";
import type { Id } from "~/convex/_generated/dataModel";

type FeatureLinkProps = {
  children: ReactNode;
  className?: string;
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

  // Get today's POS transaction summary
  const todaySummary = useQuery(
    api.inventory.pos.getTodaySummary,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  // Currency formatter
  const currencyFormatter = useGetCurrencyFormatter();

  const { hasFullAdminAccess } = usePermissions();

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
      title: "Sales Reports",
      description: "View daily sales and transaction reports",
      icon: BarChart3,
      href: "/$orgUrlSlug/store/$storeUrlSlug/analytics" as const,
      params: liveLinkParams,
      color: "bg-purple-500",
      available: false,
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
      available: hasFullAdminAccess && Boolean(liveLinkParams),
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

          {/* Today's Summary */}
          <div>
            <h2 className="text-xl font-medium mb-6">Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {hasFullAdminAccess && (
                <>
                  <div className="border rounded-lg">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">
                        Total Sales
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="text-2xl font-bold">
                        {todaySummary ? (
                          currencyFormatter.format(
                            toDisplayAmount(todaySummary.totalSales),
                          )
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Today</p>
                    </CardContent>
                  </div>
                </>
              )}

              <div className="border rounded-lg">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Transactions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-2xl font-bold">
                    {todaySummary ? (
                      todaySummary.totalTransactions
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Today</p>
                </CardContent>
              </div>

              <div className="border rounded-lg">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Items Sold
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-2xl font-bold">
                    {todaySummary ? (
                      todaySummary.totalItemsSold
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Today</p>
                </CardContent>
              </div>

              {/* {hasFullAdminAccess && (
              <div className="border rounded-lg">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Avg. Transaction
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {todaySummary ? (
                      currencyFormatter.format(
                        toDisplayAmount(todaySummary.averageTransaction),
                      )
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Today</p>
                </CardContent>
              </div>
            )} */}
            </div>
          </div>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
