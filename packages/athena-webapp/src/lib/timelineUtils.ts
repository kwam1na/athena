import {
  Eye,
  ShoppingCart,
  CreditCard,
  Ticket,
  Plus,
  Minus,
  Search,
  UserPlus,
  LogIn,
  Package,
  MousePointer,
  Star,
  Heart,
  Trash2,
  CheckCircle,
  MousePointerClick,
} from "lucide-react";
import { snakeCaseToWords } from "./utils";
import { getActivityPriority } from "./behaviorUtils";

export interface TimelineEvent {
  _id: string;
  _creationTime: number;
  storeFrontUserId: string;
  storeId: string;
  action: string;
  origin?: string;
  device?: string;
  data: Record<string, any>;
  userData?: {
    email?: string;
  };
  productInfo?: {
    name?: string;
    images?: string[];
    price?: number;
    currency?: string;
  };
}

export interface EnrichedTimelineEvent extends TimelineEvent {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  category: "product" | "commerce" | "engagement" | "account";
  priority: "high" | "medium" | "low";
}

// Activity type mappings with icons and colors
export const activityTypeMap: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    category: "product" | "commerce" | "engagement" | "account";
    getTitle: (event: TimelineEvent) => string;
    getDescription: (event: TimelineEvent) => string;
  }
> = {
  viewed_product: {
    icon: Eye,
    color: "text-blue-600 bg-blue-100",
    category: "product",
    getTitle: (event) => "Viewed Product",
    getDescription: (event) => {
      const productName = event.productInfo?.name || "Product";
      const variant = event.data.productSku
        ? ` (${event.data.productSku})`
        : "";
      return `Viewed ${productName}${variant}`;
    },
  },
  viewed_shopping_bag: {
    icon: ShoppingCart,
    color: "text-orange-600 bg-orange-100",
    category: "commerce",
    getTitle: (event) => "Viewed Shopping Bag",
    getDescription: (event) => "Opened shopping bag to review items",
  },
  initiated_checkout: {
    icon: CreditCard,
    color: "text-lime-600 bg-lime-100",
    category: "commerce",
    getTitle: (event) => "Started Checkout",
    getDescription: (event) => "Began the checkout process",
  },
  finalized_checkout: {
    icon: Package,
    color: "text-teal-600 bg-teal-100",
    category: "commerce",
    getTitle: (event) => "Finalized Checkout",
    getDescription: (event) => "Finalized checkout details",
  },
  completed_checkout: {
    icon: CheckCircle,
    color: "text-emerald-600 bg-emerald-100",
    category: "commerce",
    getTitle: (event) => "Completed Checkout",
    getDescription: (event) => "Successfully completed checkout",
  },
  completed_payment_on_delivery_checkout: {
    icon: CheckCircle,
    color: "text-emerald-600 bg-emerald-100",
    category: "commerce",
    getTitle: (event) => "Completed Checkout",
    getDescription: (event) => "Successfully completed checkout",
  },
  clicked_on_discount_code_trigger: {
    icon: Ticket,
    color: "text-amber-600 bg-amber-100",
    category: "engagement",
    getTitle: (event) => "Clicked Discount Code",
    getDescription: (event) => "Showed interest in promotional offers",
  },
  added_product_to_bag: {
    icon: Plus,
    color: "text-green-600 bg-green-100",
    category: "commerce",
    getTitle: (event) => "Added to Bag",
    getDescription: (event) => {
      const productName = event.productInfo?.name || "Product";
      const quantity = event.data.quantity ? ` (${event.data.quantity}x)` : "";
      return `Added ${productName}${quantity} to shopping bag`;
    },
  },
  removed_product_from_bag: {
    icon: Minus,
    color: "text-red-600 bg-red-100",
    category: "commerce",
    getTitle: (event) => "Removed from Bag",
    getDescription: (event) => {
      const productName = event.productInfo?.name || "Product";
      return `Removed ${productName} from shopping bag`;
    },
  },
  signed_up: {
    icon: UserPlus,
    color: "text-sky-600 bg-sky-100",
    category: "account",
    getTitle: (event) => "Created Account",
    getDescription: (event) => "Signed up for a new account",
  },
  logged_in: {
    icon: LogIn,
    color: "text-cyan-600 bg-cyan-100",
    category: "account",
    getTitle: (event) => "Signed In",
    getDescription: (event) => "Logged into their account",
  },
  added_product_to_saved: {
    icon: Heart,
    color: "text-pink-600 bg-pink-100",
    category: "engagement",
    getTitle: (event) => "Saved Item",
    getDescription: (event) => {
      const productName = event.productInfo?.name || "Product";
      return `Saved ${productName} for later`;
    },
  },
  removed_product_from_saved: {
    icon: Trash2,
    color: "text-rose-600 bg-rose-100",
    category: "engagement",
    getTitle: (event) => "Removed Saved Item",
    getDescription: (event) => {
      const productName = event.productInfo?.name || "Product";
      return `Removed ${productName} from saved items`;
    },
  },
};

// Fallback for unknown actions
const fallbackActivity = {
  icon: MousePointerClick,
  color: "text-gray-600 bg-gray-100",
  category: "engagement" as const,
  getTitle: (event: TimelineEvent) => snakeCaseToWords(event.action),
  getDescription: (event: TimelineEvent) =>
    `Performed action: ${snakeCaseToWords(event.action)}`,
};

export function enrichTimelineEvent(
  event: TimelineEvent
): EnrichedTimelineEvent {
  const activityConfig = activityTypeMap[event.action] || fallbackActivity;

  return {
    ...event,
    title: activityConfig.getTitle(event),
    description: activityConfig.getDescription(event),
    icon: activityConfig.icon,
    color: activityConfig.color,
    category: activityConfig.category,
    priority: getActivityPriority(event.action),
  };
}

export function enrichTimelineEvents(
  events: TimelineEvent[]
): EnrichedTimelineEvent[] {
  return events.map(enrichTimelineEvent);
}

export function groupEventsByTimeframe(
  events: EnrichedTimelineEvent[],
  timeframe: "hour" | "day" | "week" = "day"
) {
  const grouped = new Map<string, EnrichedTimelineEvent[]>();

  events.forEach((event) => {
    const date = new Date(event._creationTime);
    let key: string;

    switch (timeframe) {
      case "hour":
        key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
        break;
      case "day":
        key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        break;
      case "week":
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = `${weekStart.getFullYear()}-${weekStart.getMonth()}-${weekStart.getDate()}`;
        break;
    }

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(event);
  });

  return Array.from(grouped.entries())
    .map(([key, events]) => ({
      key,
      events: events.sort((a, b) => b._creationTime - a._creationTime),
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function getTimeRangeLabel(
  timeRange: "24h" | "7d" | "30d" | "all"
): string {
  switch (timeRange) {
    case "24h":
      return "Last 24 hours";
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "all":
      return "All time";
  }
}
