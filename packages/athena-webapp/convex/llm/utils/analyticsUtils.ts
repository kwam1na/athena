import { Analytic } from "../../../types";

export interface DeviceDistribution {
  desktop: string;
  mobile: string;
  unknown: string;
}

export type ActivityTrend = "increasing" | "steady" | "decreasing" | "unknown";

export function calculateDeviceDistribution(
  analytics: Analytic[]
): DeviceDistribution {
  const deviceCounts = analytics.reduce(
    (acc, item) => {
      const device = item.device?.toLowerCase() || "unknown";
      acc[device] = (acc[device] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Calculate total with explicit number array
  const counts = Object.values(deviceCounts) as number[];
  const total = counts.length > 0 ? counts.reduce((a, b) => a + b) : 0;

  // Avoid division by zero
  if (total === 0) {
    return {
      desktop: "0%",
      mobile: "0%",
      unknown: "100%",
    };
  }

  return {
    desktop: `${Math.round(((deviceCounts.desktop || 0) / total) * 100)}%`,
    mobile: `${Math.round(((deviceCounts.mobile || 0) / total) * 100)}%`,
    unknown: `${Math.round(((deviceCounts.unknown || 0) / total) * 100)}%`,
  };
}

export function calculateActivityTrend(analytics: Analytic[]): ActivityTrend {
  if (!analytics.length) return "unknown";

  // Sort analytics by creation time
  const sortedAnalytics = [...analytics].sort(
    (a, b) => a._creationTime - b._creationTime
  );

  // Split the data into two periods
  const midPoint = Math.floor(sortedAnalytics.length / 2);
  const firstPeriod = sortedAnalytics.slice(0, midPoint);
  const secondPeriod = sortedAnalytics.slice(midPoint);

  // If we don't have enough data for comparison
  if (firstPeriod.length === 0 || secondPeriod.length === 0) return "unknown";

  // Calculate daily activity rates for both periods
  const firstPeriodDays =
    (firstPeriod[firstPeriod.length - 1]._creationTime -
      firstPeriod[0]._creationTime) /
    (1000 * 60 * 60 * 24);
  const secondPeriodDays =
    (secondPeriod[secondPeriod.length - 1]._creationTime -
      secondPeriod[0]._creationTime) /
    (1000 * 60 * 60 * 24);

  // Avoid division by zero
  if (firstPeriodDays === 0 || secondPeriodDays === 0) return "unknown";

  const firstPeriodRate = firstPeriod.length / firstPeriodDays;
  const secondPeriodRate = secondPeriod.length / secondPeriodDays;

  // Calculate percentage change
  const percentageChange =
    ((secondPeriodRate - firstPeriodRate) / firstPeriodRate) * 100;

  // Define thresholds for trend determination
  if (percentageChange > 20) return "increasing";
  if (percentageChange < -20) return "decreasing";
  return "steady";
}
