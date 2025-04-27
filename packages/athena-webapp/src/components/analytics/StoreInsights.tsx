import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Laptop,
  Smartphone,
  Lightbulb,
  TrendingUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Id } from "~/convex/_generated/dataModel";

interface StoreInsightsProps {
  storeId: Id<"store">;
}

export default function StoreInsights({ storeId }: StoreInsightsProps) {
  const storeInsights = useAction(
    api.llm.storeInsights.getStoreInsightsFromLlm
  );
  const [insights, setInsights] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    if (storeId) {
      setInsightsLoading(true);
      storeInsights({
        storeId,
      }).then((res) => {
        setInsights(res);
        setInsightsLoading(false);
      });
    }
  }, [storeId]);

  if (insightsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Store Insights</CardTitle>
          <CardDescription>Analyzing store activity...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 animate-pulse">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
            <div className="h-4 bg-muted rounded w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!insights) return null;

  const getTrendIcon = () => {
    switch (insights.activity_trend) {
      case "increasing":
        return <ArrowUp className="w-4 h-4 text-green-500" />;
      case "decreasing":
        return <ArrowDown className="w-4 h-4 text-red-500" />;
      default:
        return <ArrowRight className="w-4 h-4" />;
    }
  };

  return (
    <Card className="space-y-4">
      <CardHeader className="space-y-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="w-4 h-4" />
          Store Insights
        </CardTitle>
        <CardDescription className="max-w-3xl leading-relaxed">
          {insights.summary}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Activity Trend and Peak Times */}
        <div className="space-y-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {getTrendIcon()}
              Activity Trend
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="w-4 h-4" />
              Peak Activity
            </div>
            <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
              {insights.peak_activity_times}
            </p>
          </div>
        </div>

        <div className="space-y-8">
          {/* Device Distribution */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Device Distribution</h3>
            <div className="flex gap-8">
              <div className="flex items-center gap-2">
                <Laptop className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  {insights.device_distribution.desktop}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  {insights.device_distribution.mobile}
                </span>
              </div>
            </div>
          </div>

          {/* Popular Actions */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Popular Actions</h3>
            <ul className="space-y-2">
              {insights.popular_actions.map((action: string, index: number) => (
                <li key={index} className="text-sm text-muted-foreground">
                  {action}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Recommendations */}
        <div className="space-y-8">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Recommendations
          </h3>
          <ul className="grid grid-cols-1 gap-4">
            {insights.recommendations.map((rec: string, index: number) => (
              <li
                key={index}
                className="text-sm text-muted-foreground max-w-md leading-relaxed"
              >
                {rec}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
