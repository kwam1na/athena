import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Analytic } from "~/types";
import { Id } from "~/convex/_generated/dataModel";
import { columns, AnalyticUser } from "./analytics-users-table/columns";
import { AnalyticsUsersTable } from "./analytics-users-table/data-table";
import { snakeCaseToWords } from "~/src/lib/utils";

// Helper function to process analytics data into user metrics
function processAnalyticsToUsers(items: Analytic[]): Record<
  string,
  {
    userId: string;
    totalActions: number;
    lastActive: number;
    firstSeen: number;
    deviceCounts: Record<string, number>;
    actionCounts: Record<string, number>;
    uniqueProducts: Set<string>;
    mostRecentAction: string;
    mostRecentActionTime: number;
    mostRecentActionData?: {
      product?: string;
      productSku?: string;
      productImageUrl?: string;
      selectedVariant?: number;
    };
  }
> {
  const userMetrics: Record<
    string,
    {
      userId: string;
      totalActions: number;
      lastActive: number;
      firstSeen: number;
      deviceCounts: Record<string, number>;
      actionCounts: Record<string, number>;
      uniqueProducts: Set<string>;
      mostRecentAction: string;
      mostRecentActionTime: number;
      mostRecentActionData?: {
        product?: string;
        productSku?: string;
        productImageUrl?: string;
        selectedVariant?: number;
      };
    }
  > = {};

  items.forEach((item) => {
    const userId = item.storeFrontUserId;

    if (!userMetrics[userId]) {
      userMetrics[userId] = {
        userId,
        totalActions: 0,
        lastActive: item._creationTime,
        firstSeen: item._creationTime,
        deviceCounts: {},
        actionCounts: {},
        uniqueProducts: new Set(),
        mostRecentAction: item.action,
        mostRecentActionTime: item._creationTime,
        mostRecentActionData: item.data,
      };
    }

    const metrics = userMetrics[userId];

    // Update metrics
    metrics.totalActions++;
    metrics.lastActive = Math.max(metrics.lastActive, item._creationTime);
    metrics.firstSeen = Math.min(metrics.firstSeen, item._creationTime);

    // Update most recent action if this item is more recent
    if (item._creationTime >= metrics.mostRecentActionTime) {
      metrics.mostRecentAction = item.action;
      metrics.mostRecentActionTime = item._creationTime;
      metrics.mostRecentActionData = item.data;
    }

    // Count devices
    const device = item.device || "unknown";
    metrics.deviceCounts[device] = (metrics.deviceCounts[device] || 0) + 1;

    // Count actions
    metrics.actionCounts[item.action] =
      (metrics.actionCounts[item.action] || 0) + 1;

    // Track unique products
    if (item.data?.product) {
      metrics.uniqueProducts.add(item.data.product as string);
    }
  });

  return userMetrics;
}

export default function AnalyticsUsers({ items }: { items: Analytic[] }) {
  // Process analytics to get user metrics
  const userMetrics = processAnalyticsToUsers(items);
  const userIds = Object.keys(userMetrics);

  // Create user data without fetching individual user details for now
  // This keeps the component simple and efficient
  const combinedData: AnalyticUser[] = userIds.map((userId) => {
    const metrics = userMetrics[userId];

    // We'll show user ID instead of email for now
    // A future enhancement could fetch user details if needed
    let userType: "Registered" | "Guest" = "Guest";

    // Simple heuristic: if ID contains certain patterns, assume registered user
    if (userId.includes("storeFrontUser")) {
      userType = "Registered";
    }

    // Determine device preference
    const deviceEntries = Object.entries(metrics.deviceCounts);
    const devicePreference =
      deviceEntries.length > 0
        ? (deviceEntries.reduce((a, b) => (a[1] > b[1] ? a : b))[0] as
            | "mobile"
            | "desktop"
            | "unknown")
        : "unknown";

    // Get the most recent action
    const mostRecentAction = snakeCaseToWords(metrics.mostRecentAction);

    return {
      userId,
      email: undefined, // Will show user ID instead
      userType,
      totalActions: metrics.totalActions,
      lastActive: metrics.lastActive,
      firstSeen: metrics.firstSeen,
      devicePreference,
      mostRecentAction,
      uniqueProducts: metrics.uniqueProducts.size,
      mostRecentActionData: metrics.mostRecentActionData,
    };
  });

  // Sort by total actions (most active first)
  const sortedData = combinedData.sort(
    (a, b) => b.totalActions - a.totalActions
  );

  return (
    <div className="container mx-auto">
      <div className="py-8">
        <AnalyticsUsersTable pageSize={3} data={sortedData} columns={columns} />
      </div>
    </div>
  );
}
