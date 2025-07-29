import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Analytic } from "~/types";
import { Id } from "~/convex/_generated/dataModel";
import { columns, CombinedAnalyticUser } from "./combined-users-table/columns";
import { CombinedUsersTable } from "./combined-users-table/data-table";
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

export default function AnalyticsCombinedUsers({
  items,
}: {
  items: Analytic[];
}) {
  // Process analytics to get user metrics
  const userMetrics = processAnalyticsToUsers(items);
  const userIds = Object.keys(userMetrics);

  // Fetch actual user data to get emails and registration info
  const users = useQuery(api.storeFront.users.getByIds, {
    ids: userIds as Id<"storeFrontUser">[],
  });

  if (!users) return null;

  // Create user lookup map
  const userMap = new Map<string, NonNullable<(typeof users)[0]>>();
  users.forEach((user) => {
    if (user) {
      userMap.set(user._id, user);
    }
  });

  // Determine if users are new (registered within last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // Combine analytics data with user data
  const combinedData: CombinedAnalyticUser[] = userIds.map((userId) => {
    const metrics = userMetrics[userId];
    const user = userMap.get(userId);

    // Determine user type and if they're new
    // Check if user exists and has the properties of a registered user
    const userType: "Registered" | "Guest" =
      user && "storeId" in user && "email" in user ? "Registered" : "Guest";
    const isNewUser = user ? user._creationTime > sevenDaysAgo : false;
    const isNewActivity = metrics.firstSeen > sevenDaysAgo;

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
      email: user && "email" in user ? user.email : undefined,
      userType,
      isNewUser,
      isNewActivity,
      totalActions: metrics.totalActions,
      lastActive: metrics.lastActive,
      firstSeen: metrics.firstSeen,
      devicePreference,
      mostRecentAction,
      uniqueProducts: metrics.uniqueProducts.size,
      mostRecentActionData: metrics.mostRecentActionData,
      user,
    };
  });

  // Sort by total actions (most active first)
  const sortedData = combinedData.sort(
    (a, b) => b.totalActions - a.totalActions
  );

  return (
    <div className="container mx-auto">
      <div className="py-8">
        <CombinedUsersTable data={sortedData} pageSize={5} columns={columns} />
      </div>
    </div>
  );
}
