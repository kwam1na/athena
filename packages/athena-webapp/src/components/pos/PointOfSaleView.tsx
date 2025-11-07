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
} from "lucide-react";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { getOrigin } from "~/src/lib/navigationUtils";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";

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
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });

  const analytics = useQuery(
    api.storeFront.analytics.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  // Get today's POS transaction summary
  const todaySummary = useQuery(
    api.inventory.pos.getTodaySummary,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  // Currency formatter
  const currencyFormatter = useGetCurrencyFormatter();

  if (!activeStore || !analytics || !activeOrganization) return null;

  const posFeatures = [
    {
      title: "Register",
      description:
        "Complete POS interface with barcode scanning and customer management",
      icon: ScanBarcode,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/register" as const,
      color: "bg-blue-500",
      available: true,
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
      title: "Session History",
      description: "View past POS sessions and their details",
      icon: Clock,
      href: null,
      color: "bg-orange-500",
      available: false,
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
      description: "Configure hardware, tax rates, and payment methods",
      icon: Settings,
      href: "/$orgUrlSlug/store/$storeUrlSlug/pos/settings" as const,
      color: "bg-gray-500",
      available: true,
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
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card className="border-2 border-blue-200">
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-blue-500 rounded-lg">
                  <ShoppingCart className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">Start New Sale</h3>
                  <p className="text-muted-foreground text-sm">
                    Begin a new transaction
                  </p>
                </div>
                <Button asChild size="lg">
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/pos/register"
                    params={{
                      orgUrlSlug: activeOrganization.slug,
                      storeUrlSlug: activeStore.slug,
                    }}
                    search={{
                      o: getOrigin(),
                    }}
                  >
                    Start Sale
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-200">
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-green-500 rounded-lg">
                  <Receipt className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">View Receipts</h3>
                  <p className="text-muted-foreground text-sm">
                    Recent transaction receipts
                  </p>
                </div>
                <Button variant="outline" disabled>
                  View Reports
                  <span className="text-xs ml-2">(Coming Soon)</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* POS Features Grid */}
        <div>
          <h2 className="text-2xl font-semibold mb-6">POS Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posFeatures.map((feature) => {
              const Icon = feature.icon;

              if (!feature.available || !feature.href) {
                return (
                  <Card
                    key={feature.title}
                    className="opacity-50 cursor-not-allowed"
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
                  </Card>
                );
              }

              return (
                <Card
                  key={feature.title}
                  className="hover:shadow-sm transition-shadow cursor-pointer"
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
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="text-sm">
                        {feature.description}
                      </CardDescription>
                    </CardContent>
                  </Link>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Today's Summary */}
        <div>
          <h2 className="text-2xl font-semibold mb-6">Today's Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Transactions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {todaySummary ? (
                    todaySummary.totalTransactions
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Today</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Total Sales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {todaySummary ? (
                    currencyFormatter.format(todaySummary.totalSales)
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Today</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Items Sold
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {todaySummary ? (
                    todaySummary.totalItemsSold
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Today</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Avg. Transaction
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {todaySummary ? (
                    currencyFormatter.format(todaySummary.averageTransaction)
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Today</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </FadeIn>
    </View>
  );
}
