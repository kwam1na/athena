import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { TrendingDown, ArrowRight } from "lucide-react";

interface ConversionFunnelChartProps {
  conversions: {
    viewToCartRate: number;
    cartToCheckoutRate: number;
    checkoutToPurchaseRate: number;
    overallConversionRate: number;
  };
  overview: {
    uniqueVisitors: number;
    productViews: number;
    cartActions: number;
    checkoutActions: number;
    purchaseActions: number;
  };
}

export function ConversionFunnelChart({
  conversions,
  overview,
}: ConversionFunnelChartProps) {
  const funnelSteps = [
    {
      label: "Product Views",
      value: overview.productViews,
      percentage: 100,
      color: "from-slate-600 to-slate-700",
      bgColor: "bg-slate-50",
      textColor: "text-slate-600",
    },
    {
      label: "Added to Cart",
      value: overview.cartActions,
      percentage:
        overview.productViews > 0
          ? (overview.cartActions / overview.productViews) * 100
          : 0,
      color: "from-blue-500 to-blue-600",
      bgColor: "bg-blue-50",
      textColor: "text-blue-600",
    },
    {
      label: "Started Checkout",
      value: overview.checkoutActions,
      percentage:
        overview.productViews > 0
          ? (overview.checkoutActions / overview.productViews) * 100
          : 0,
      color: "from-emerald-500 to-emerald-600",
      bgColor: "bg-emerald-50",
      textColor: "text-emerald-600",
    },
    {
      label: "Completed Purchase",
      value: overview.purchaseActions,
      percentage:
        overview.productViews > 0
          ? (overview.purchaseActions / overview.productViews) * 100
          : 0,
      color: "from-violet-500 to-violet-600",
      bgColor: "bg-violet-50",
      textColor: "text-violet-600",
    },
  ];

  const maxWidth = 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5" />
          Conversion Funnel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {funnelSteps.map((step, index) => (
          <div key={step.label} className="relative">
            {/* Step Content */}
            <div
              className={`relative ${step.bgColor} rounded-lg p-4 border border-gray-100 shadow-sm`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full bg-gradient-to-r ${step.color} flex items-center justify-center text-white text-xs font-semibold`}
                  >
                    {index + 1}
                  </div>
                  <h3 className="font-medium text-gray-900 text-sm">
                    {step.label}
                  </h3>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${step.textColor}`}>
                    {step.value}
                  </div>
                  <div className="text-xs text-gray-500">
                    {step.percentage.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Progress visualization */}
              <div className="relative h-2 bg-white rounded-full overflow-hidden shadow-inner">
                <div
                  className={`h-full bg-gradient-to-r ${step.color} transition-all duration-700 ease-out rounded-full`}
                  style={{ width: `${Math.max(step.percentage, 2)}%` }}
                />
              </div>

              {/* Drop-off indicator */}
              {index > 0 && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full shadow-lg">
                  -
                  {(
                    funnelSteps[index - 1].percentage - step.percentage
                  ).toFixed(1)}
                  %
                </div>
              )}
            </div>

            {/* Compact Connector */}
            {index < funnelSteps.length - 1 && (
              <div className="flex justify-center my-1">
                <ArrowRight className="h-3 w-3 text-gray-300" />
              </div>
            )}
          </div>
        ))}

        {/* Summary stats */}
        <div className="mt-4 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg p-4 border border-gray-200">
          <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2 text-sm">
            <TrendingDown className="h-3 w-3" />
            Conversion Insights
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-0.5">
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                View → Cart
              </p>
              <p className="text-sm font-bold text-blue-600">
                {isNaN(conversions.viewToCartRate)
                  ? 0
                  : conversions.viewToCartRate.toFixed(1)}
                %
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                Cart → Checkout
              </p>
              <p className="text-sm font-bold text-emerald-600">
                {isNaN(conversions.cartToCheckoutRate)
                  ? 0
                  : conversions.cartToCheckoutRate.toFixed(1)}
                %
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                Checkout → Purchase
              </p>
              <p className="text-sm font-bold text-violet-600">
                {isNaN(conversions.checkoutToPurchaseRate)
                  ? 0
                  : conversions.checkoutToPurchaseRate.toFixed(1)}
                %
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                Overall Conversion
              </p>
              <p className="text-sm font-bold text-slate-700">
                {isNaN(conversions.overallConversionRate)
                  ? 0
                  : conversions.overallConversionRate.toFixed(1)}
                %
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
