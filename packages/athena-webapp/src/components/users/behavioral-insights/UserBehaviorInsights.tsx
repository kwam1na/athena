import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Skeleton } from "../../ui/skeleton";
import { CustomerJourneyStageCard } from "./CustomerJourneyStage";
import { RiskIndicators } from "./RiskIndicators";
import { EngagementMetricsGrid } from "./EngagementMetrics";
import {
  getCustomerJourneyStage,
  calculateRiskIndicators,
  calculateEngagementMetrics,
} from "~/src/lib/behaviorUtils";

interface UserBehaviorInsightsProps {
  userId: Id<"storeFrontUser"> | Id<"guest">;
  className?: string;
}

export function UserBehaviorInsights({
  userId,
  className,
}: UserBehaviorInsightsProps) {
  // Fetch user activities - this is the primary data source
  const activities = useQuery(api.storeFront.user.getAllUserActivity, {
    id: userId,
  });

  const bag = useQuery(api.storeFront.bag.getByUserId, {
    storeFrontUserId: userId,
  });

  // Memoize calculations to avoid recalculating on every render
  const behaviorData = useMemo(() => {
    if (!activities) return null;

    const bagItemsCount = bag?.items?.length || 0;

    return {
      journeyStage: getCustomerJourneyStage(activities),
      risks: calculateRiskIndicators(activities, bagItemsCount),
      metrics: calculateEngagementMetrics(activities),
    };
  }, [activities, bag?.items?.length]);

  // Loading state
  if (!activities || !behaviorData) {
    return (
      <div className={`space-y-4 ${className}`}>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // No activity state
  if (activities.length === 0) {
    return (
      <div className={`py-8 ${className}`}>
        <p className="text-sm text-muted-foreground">
          No behavioral data available.
        </p>
      </div>
    );
  }

  const { journeyStage, risks, metrics } = behaviorData;

  return (
    <div className={`space-y-16 ${className}`}>
      {/* Customer Journey Stage */}
      <CustomerJourneyStageCard stage={journeyStage} />

      {/* Risk Indicators - only show if there are risks */}
      <RiskIndicators risks={risks} />

      {/* Engagement Metrics Grid */}
      <EngagementMetricsGrid metrics={metrics} />
    </div>
  );
}
