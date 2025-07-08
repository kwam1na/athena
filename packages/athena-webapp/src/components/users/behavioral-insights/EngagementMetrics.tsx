import { Card, CardContent } from "../../ui/card";
import {
  Activity,
  Eye,
  Monitor,
  Smartphone,
  ShoppingCart,
  Calendar,
  ClockFading,
} from "lucide-react";
import { EngagementMetrics } from "~/src/lib/behaviorUtils";
import { getRelativeTime } from "~/src/lib/utils";

interface EngagementMetricsProps {
  metrics: EngagementMetrics;
  className?: string;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  className?: string;
}

// function MetricCard({
//   label,
//   value,
//   icon: Icon,
//   description,
//   className,
// }: MetricCardProps) {
//   return (
//     <Card className={className}>
//       <CardContent className="p-3 space-y-2">
//         <div className="flex items-center gap-1 mb-1">
//           <Icon className="w-3.5 h-3.5 text-muted-foreground" />
//           <p className="text-xs text-muted-foreground">{label}</p>
//         </div>
//         <p className="font-semibold">{value}</p>
//         {description && (
//           <p className="text-xs text-muted-foreground mt-1">{description}</p>
//         )}
//       </CardContent>
//     </Card>
//   );
// }

function MetricCard({
  label,
  value,
  icon: Icon,
  description,
  className,
}: MetricCardProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="font-semibold">{value}</p>
      {description && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}

export function EngagementMetricsGrid({
  metrics,
  className,
}: EngagementMetricsProps) {
  const formatLastActivity = (days: number): string => {
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days === Infinity) return "Never";
    return `${days} days ago`;
  };

  const getDeviceIcon = (device: EngagementMetrics["preferredDevice"]) => {
    switch (device) {
      case "desktop":
        return Monitor;
      case "mobile":
        return Smartphone;
      default:
        return Activity;
    }
  };

  const getDeviceLabel = (device: EngagementMetrics["preferredDevice"]) => {
    switch (device) {
      case "desktop":
        return "Desktop";
      case "mobile":
        return "Mobile";
      default:
        return "Mixed";
    }
  };

  return (
    <div className={`grid grid-cols-4 ${className}`}>
      <MetricCard
        label="Products Viewed"
        value={metrics.uniqueProductsViewed}
        icon={Eye}
        description={`${metrics.totalActivities} total activities`}
      />

      <MetricCard
        label="Last Activity"
        value={formatLastActivity(metrics.daysSinceLastActivity)}
        icon={ClockFading}
        description={`${metrics.daysSinceLastActivity === 0 ? getRelativeTime(metrics.lastActivityTimestamp) : `${metrics.weeklyActivities} this week`}`}
      />

      <MetricCard
        label="Commerce Actions"
        value={metrics.commerceActions}
        icon={ShoppingCart}
        description="Cart & checkout activities"
      />

      <MetricCard
        label="Device Preference"
        value={getDeviceLabel(metrics.preferredDevice)}
        icon={getDeviceIcon(metrics.preferredDevice)}
        description="Primary shopping device"
      />
    </div>
  );
}
