import { useMemo } from "react";
import { Card, CardContent } from "../ui/card";
import { Activity, Eye, ShoppingCart, Calendar } from "lucide-react";
import { Analytic } from "~/types";

interface ActivitySummaryCardsProps {
  activities: Analytic[];
  className?: string;
}

interface SummaryCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  color: string;
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  description,
  color,
}: SummaryCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-lg font-semibold">{value}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ActivitySummaryCards({
  activities,
  className,
}: ActivitySummaryCardsProps) {
  const summaryData = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Filter activities from the last 7 days
    const last7Days = activities.filter(
      (a) => now - a._creationTime < sevenDaysMs
    );

    // Commerce actions (high-value activities)
    const commerceActionTypes = [
      "added_product_to_bag",
      "removed_product_from_bag",
      "initiated_checkout",
      "completed_checkout",
      "finalized_checkout",
      "completed_payment_on_delivery_checkout",
    ];
    const commerceActions = last7Days.filter((a) =>
      commerceActionTypes.includes(a.action)
    );

    // Product views
    const productViews = last7Days.filter((a) => a.action === "viewed_product");

    // Engagement actions (views, saves, etc.)
    const engagementActions = last7Days.filter((a) =>
      [
        "viewed_product",
        "added_product_to_saved",
        "viewed_shopping_bag",
      ].includes(a.action)
    );

    return {
      totalWeekly: last7Days.length,
      productViews: productViews.length,
      commerceActions: commerceActions.length,
      engagementActions: engagementActions.length,
      totalAllTime: activities.length,
    };
  }, [activities]);

  if (activities.length === 0) {
    return null;
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${className}`}>
      <SummaryCard
        label="This Week"
        value={summaryData.totalWeekly}
        icon={Activity}
        description={`${summaryData.totalAllTime} total activities`}
        color="bg-blue-100 text-blue-600"
      />

      <SummaryCard
        label="Products Viewed"
        value={summaryData.productViews}
        icon={Eye}
        description="Last 7 days"
        color="bg-green-100 text-green-600"
      />

      <SummaryCard
        label="Commerce Actions"
        value={summaryData.commerceActions}
        icon={ShoppingCart}
        description="Cart & checkout activities"
        color="bg-purple-100 text-purple-600"
      />
    </div>
  );
}
