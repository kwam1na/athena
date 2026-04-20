import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { FadeIn } from "../common/FadeIn";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link, useParams } from "@tanstack/react-router";
import {
  ScanBarcode,
  BarChart3,
  Clock,
  Users,
  ShoppingCart,
  Settings,
  Receipt,
  Search,
  HandCoins,
} from "lucide-react";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { getOrigin } from "~/src/lib/navigationUtils";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import { useGetTerminal } from "~/src/hooks/useGetTerminal";
import { Badge } from "../ui/badge";
import { cn } from "~/src/lib/utils";
import { usePermissions } from "~/src/hooks/usePermissions";
import { toDisplayAmount } from "~/convex/lib/currency";

const Navigation = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px]">
      <div className="flex items-center">
        <p className="text-xl font-medium">Point of Sale</p>
      </div>
    </div>
  );
};

export default function PointOfSaleView() {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();

  const analytics = useQuery(
    api.storeFront.analytics.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  // Get today's POS transaction summary
  const todaySummary = useQuery(
    api.inventory.pos.getTodaySummary,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  // Currency formatter
  const currencyFormatter = useGetCurrencyFormatter();

  const { hasFullAdminAccess } = usePermissions();

  if (!activeStore || !analytics || !activeOrganization) return null;

  const posFeatures = [
    {
      title: "POS",
      description: "Transact in-store sales",
      icon: ScanBarcode,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/register" as const,
      color: "bg-blue-500",
      available: true,
      enabled: true,
    },
    {
      title: "Expense Products",
      description: "Track products expensed",
      icon: HandCoins,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense" as const,
      color: "bg-rose-500",
      available: true,
      enabled: true,
    },
    {
      title: "Product Lookup",
      description: "Search and scan products for quick reference",
      icon: Search,
      href: "/$orgUrlSlug/store/$storeUrlSlug/products" as const,
      color: "bg-green-500",
      available: true,
    },

    {
      title: "Sales Reports",
      description: "View daily sales and transaction reports",
      icon: BarChart3,
      href: "/$orgUrlSlug/store/$storeUrlSlug/analytics" as const,
      color: "bg-purple-500",
      available: false,
    },
    {
      title: "Transactions",
      description: "View completed transaction history",
      icon: Receipt,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions" as const,
      color: "bg-orange-500",
      available: true,
    },
    {
      title: "Expense Reports",
      description: "View expense reports",
      icon: Receipt,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports" as const,
      color: "bg-yellow-500",
      available: true,
    },
    {
      title: "Customers",
      description: "Manage customer information and purchase history",
      icon: Users,
      href: null,
      color: "bg-pink-500",
      available: false,
    },
    {
      title: "POS Settings",
      description: "Configure terminal settings",
      icon: Settings,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/settings" as const,
      color: "bg-gray-500",
      available: hasFullAdminAccess,
    },
  ];

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <FadeIn className="space-y-8 py-8">
        {/* POS Features Grid */}
        <div>
          {/* <h2 className="text-2xl font-semibold mb-6">POS Features</h2> */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posFeatures
              .filter((f) => f.available)
              .map((feature) => {
                const Icon = feature.icon;

                if (!feature.available || !feature.href) {
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
                            <span className="text-xs bg-muted px-2 py-1 rounded">
                              Coming Soon
                            </span>
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
                    className={cn(
                      "border rounded-lg cursor-pointer",
                      feature.enabled === false && "cursor-not-allowed",
                    )}
                  >
                    <Link
                      to={feature.href}
                      params={{
                        orgUrlSlug: activeOrganization.slug,
                        storeUrlSlug: activeStore.slug,
                      }}
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
                          {feature.enabled === false && (
                            <Badge variant="outline">Disabled</Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <CardDescription className="text-sm">
                          {feature.description}
                        </CardDescription>
                      </CardContent>
                    </Link>
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
      </FadeIn>
    </View>
  );
}
