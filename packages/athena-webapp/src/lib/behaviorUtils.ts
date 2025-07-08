import { Analytic } from "~/types";
import { getRelativeTime } from "./utils";

export type CustomerJourneyStage =
  | "new"
  | "browsing"
  | "considering"
  | "converting"
  | "converted";

export type BehaviorRiskType =
  | "abandoned_cart"
  | "checkout_dropout"
  | "inactive_user";

export interface RiskIndicator {
  type: BehaviorRiskType;
  severity: "low" | "medium" | "high";
  message: string;
  actionable: boolean;
}

export interface EngagementMetrics {
  totalActivities: number;
  uniqueProductsViewed: number;
  daysSinceLastActivity: number;
  lastActivityTimestamp: number;
  preferredDevice: "desktop" | "mobile" | "mixed";
  weeklyActivities: number;
  commerceActions: number;
}

/**
 * Determines the customer's journey stage based on their activities
 */
export const getCustomerJourneyStage = (
  activities: Analytic[]
): CustomerJourneyStage => {
  if (!activities.length) return "new";

  const hasCheckoutCompleted = activities.some((a) =>
    ["completed_checkout", "completed_payment_on_delivery_checkout"].includes(
      a.action
    )
  );
  const hasCheckoutStarted = activities.some((a) =>
    ["initiated_checkout", "finalized_checkout"].includes(a.action)
  );
  const hasBagActivity = activities.some(
    (a) => a.action === "added_product_to_bag"
  );
  const hasProductViews = activities.some((a) => a.action === "viewed_product");

  const daysSinceFirstActivity = Math.floor(
    (Date.now() - Math.min(...activities.map((a) => a._creationTime))) /
      (1000 * 60 * 60 * 24)
  );

  if (hasCheckoutCompleted) return "converted";
  if (hasCheckoutStarted) return "converting";
  if (hasBagActivity) return "considering";
  if (hasProductViews) return "browsing";
  if (daysSinceFirstActivity < 7) return "new";

  return "browsing";
};

/**
 * Calculates risk indicators based on user behavior patterns
 */
export const calculateRiskIndicators = (
  activities: Analytic[],
  bagItemsCount: number
): RiskIndicator[] => {
  const risks: RiskIndicator[] = [];
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const threeDaysMs = 3 * oneDayMs;

  // Abandoned Cart - items in bag with no recent checkout activity
  if (bagItemsCount > 0) {
    const recentCheckout = activities.find(
      (a) =>
        [
          "initiated_checkout",
          "completed_checkout",
          "finalized_checkout",
          "completed_payment_on_delivery_checkout",
          "finalized_payment_on_delivery_checkout",
        ].includes(a.action) && now - a._creationTime < oneDayMs
    );

    if (!recentCheckout) {
      const lastBagActivity = activities
        .filter((a) => a.action === "added_product_to_bag")
        .sort((a, b) => b._creationTime - a._creationTime)[0];

      const hoursSinceLastBagActivity = lastBagActivity
        ? Math.floor((now - lastBagActivity._creationTime) / (1000 * 60 * 60))
        : 0;

      if (hoursSinceLastBagActivity >= 24) {
        risks.push({
          type: "abandoned_cart",
          severity: "high",
          message: `${bagItemsCount} item(s) in bag for ${Math.floor(hoursSinceLastBagActivity / 24)}+ days`,
          actionable: true,
        });
      } else if (hoursSinceLastBagActivity >= 2) {
        risks.push({
          type: "abandoned_cart",
          severity: "medium",
          message: `${bagItemsCount} item(s) in bag for ${hoursSinceLastBagActivity} hours`,
          actionable: true,
        });
      }
    }
  }

  // Checkout Dropout - initiated checkout but didn't complete within reasonable time
  const checkoutInitiated = activities
    .filter((a) => a.action === "initiated_checkout")
    .sort((a, b) => b._creationTime - a._creationTime)[0];

  if (checkoutInitiated) {
    const checkoutCompleted = activities.find(
      (a) =>
        [
          "completed_checkout",
          "completed_payment_on_delivery_checkout",
        ].includes(a.action) &&
        a._creationTime > checkoutInitiated._creationTime
    );

    const hoursSinceCheckoutStart = Math.floor(
      (now - checkoutInitiated._creationTime) / (1000 * 60 * 60)
    );

    if (!checkoutCompleted && hoursSinceCheckoutStart >= 1) {
      risks.push({
        type: "checkout_dropout",
        severity: hoursSinceCheckoutStart >= 24 ? "high" : "medium",
        message: `Checkout abandoned (started ${getRelativeTime(
          checkoutInitiated._creationTime
        )})`,
        actionable: true,
      });
    }
  }

  // Inactive User - no activity in recent period despite previous engagement
  if (activities.length >= 5) {
    // Only flag if they were previously engaged
    const lastActivity = Math.max(...activities.map((a) => a._creationTime));
    const daysSinceLastActivity = Math.floor((now - lastActivity) / oneDayMs);

    if (daysSinceLastActivity >= 14) {
      risks.push({
        type: "inactive_user",
        severity: daysSinceLastActivity >= 30 ? "high" : "medium",
        message: `No activity for ${daysSinceLastActivity} days`,
        actionable: true,
      });
    }
  }

  return risks;
};

/**
 * Calculates engagement metrics from user activities
 */
export const calculateEngagementMetrics = (
  activities: Analytic[]
): EngagementMetrics => {
  if (!activities.length) {
    return {
      totalActivities: 0,
      uniqueProductsViewed: 0,
      daysSinceLastActivity: Infinity,
      lastActivityTimestamp: 0,
      preferredDevice: "mixed",
      weeklyActivities: 0,
      commerceActions: 0,
    };
  }

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  // Unique products viewed
  const uniqueProducts = new Set(
    activities.filter((a) => a.data?.product).map((a) => a.data.product)
  ).size;

  // Last activity
  const lastActivity = Math.max(...activities.map((a) => a._creationTime));
  const daysSinceLastActivity = Math.floor(
    (now - lastActivity) / (24 * 60 * 60 * 1000)
  );

  // Device preference (efficient single pass)
  const deviceCounts = activities.reduce(
    (acc, a) => {
      if (a.device) {
        acc[a.device] = (acc[a.device] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  const preferredDevice =
    (deviceCounts.desktop || 0) > (deviceCounts.mobile || 0)
      ? "desktop"
      : (deviceCounts.mobile || 0) > (deviceCounts.desktop || 0)
        ? "mobile"
        : "mixed";

  // Weekly activities
  const weeklyActivities = activities.filter(
    (a) => now - a._creationTime < weekMs
  ).length;

  // Commerce actions
  const commerceActionTypes = [
    "added_product_to_bag",
    "initiated_checkout",
    "completed_checkout",
    "finalized_checkout",
    "completed_payment_on_delivery_checkout",
  ];
  const commerceActions = activities.filter((a) =>
    commerceActionTypes.includes(a.action)
  ).length;

  return {
    totalActivities: activities.length,
    uniqueProductsViewed: uniqueProducts,
    daysSinceLastActivity,
    lastActivityTimestamp: lastActivity,
    preferredDevice,
    weeklyActivities,
    commerceActions,
  };
};

/**
 * Gets activity priority for highlighting in timeline
 */
export const getActivityPriority = (
  action: string
): "high" | "medium" | "low" => {
  const highPriorityActions = [
    "completed_checkout",
    "completed_payment_on_delivery_checkout",
    "initiated_checkout",
    "added_product_to_bag",
  ];

  const mediumPriorityActions = [
    "viewed_shopping_bag",
    "clicked_on_discount_code_trigger",
    "finalized_checkout",
    "removed_product_from_bag",
    "added_product_to_saved",
  ];

  if (highPriorityActions.includes(action)) return "high";
  if (mediumPriorityActions.includes(action)) return "medium";
  return "low";
};

/**
 * Gets display information for customer journey stages
 */
export const getJourneyStageInfo = (stage: CustomerJourneyStage) => {
  const stageInfo = {
    new: {
      label: "New Visitor",
      description: "Just discovered your store",
      color: "bg-blue-100 text-blue-800 border-blue-200",
      icon: "👋",
    },
    browsing: {
      label: "Browsing",
      description: "Exploring products",
      color: "bg-purple-100 text-purple-800 border-purple-200",
      icon: "👀",
    },
    considering: {
      label: "Considering",
      description: "Added items to cart",
      color: "bg-orange-100 text-orange-800 border-orange-200",
      icon: "🛒",
    },
    converting: {
      label: "Converting",
      description: "In checkout process",
      color: "bg-yellow-100 text-yellow-800 border-yellow-200",
      icon: "💳",
    },
    converted: {
      label: "Customer",
      description: "Made a purchase",
      color: "bg-green-100 text-green-800 border-green-200",
      icon: "✅",
    },
  };

  return stageInfo[stage];
};
