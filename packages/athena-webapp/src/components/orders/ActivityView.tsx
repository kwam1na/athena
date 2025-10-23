import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import {
  currencyFormatter,
  getRelativeTime,
  slugToWords,
} from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Circle } from "lucide-react";
import { useMemo } from "react";
import { getProductName } from "~/src/lib/productUtils";

// Types
export enum ActivityType {
  Refund = "refund",
  Transition = "transition",
  FeedbackRequest = "feedback_request",
}

type CreatedAction = {
  status: "created";
  date: number;
  type: ActivityType.Transition;
};
type RefundAction = {
  amount: number;
  date: number;
  type: ActivityType.Refund;
};
type TransitionAction = {
  status: string;
  date: number;
  type: ActivityType.Transition;
  user?: string;
};
type FeedbackRequestAction = {
  date?: number;
  type: ActivityType.FeedbackRequest;
  user?: string;
  productName: string;
};
type Activity =
  | RefundAction
  | TransitionAction
  | CreatedAction
  | FeedbackRequestAction;

// Type guards
function isRefundAction(activity: Activity): activity is RefundAction {
  return activity.type === ActivityType.Refund;
}
function isTransitionAction(activity: Activity): activity is TransitionAction {
  return (
    activity.type === ActivityType.Transition && activity.status !== "created"
  );
}
function isCreatedAction(activity: Activity): activity is CreatedAction {
  return (
    activity.type === ActivityType.Transition && activity.status === "created"
  );
}
function isFeedbackRequestAction(
  activity: Activity
): activity is FeedbackRequestAction {
  return activity.type === ActivityType.FeedbackRequest;
}

// ActivityItem subcomponent
function ActivityItem({
  activity,
  order,
  formatter,
}: {
  activity: Activity;
  order: any;
  formatter: Intl.NumberFormat;
}) {
  return (
    <div className="flex items-center">
      <div className="space-y-2">
        <div className="flex items-center">
          <Circle className="h-2 w-2 mt-1 mr-2 text-muted-foreground" />
          {isRefundAction(activity) && (
            <div className="flex items-center gap-1">
              <p className="text-sm font-medium">refunded</p>
              <p className="text-sm text-red-700">
                - {formatter.format(activity.amount / 100)}
              </p>
            </div>
          )}
          {isCreatedAction(activity) && (
            <p className="text-sm text-muted-foreground">
              {order.customerDetails.email} created the order
            </p>
          )}
          {isTransitionAction(activity) && (
            <div className="flex items-center gap-1">
              <p className="text-sm text-muted-foreground">
                {activity.status === "payment_collected"
                  ? activity.user
                    ? `${activity.user} marked payment as collected`
                    : "payment marked as collected"
                  : activity.status === "payment_verified"
                    ? activity.user
                      ? `${activity.user} manually verified payment`
                      : "payment manually verified"
                    : activity.user
                      ? `${activity.user} transitioned order →`
                      : "order transitioned →"}
              </p>
              {activity.status !== "payment_collected" &&
                activity.status !== "payment_verified" && (
                  <p className="text-sm font-medium">
                    {slugToWords(activity.status)}
                  </p>
                )}
            </div>
          )}
          {isFeedbackRequestAction(activity) && (
            <div className="flex items-center gap-1">
              <p className="text-sm text-muted-foreground">
                {activity.user
                  ? `${activity.user} requested a review for`
                  : "a review was requested for"}
              </p>
              <p className="text-sm font-medium">{activity.productName}</p>
            </div>
          )}
        </div>
        {Boolean(activity.date) && activity.date && (
          <p className="text-xs ml-4 text-muted-foreground">
            {getRelativeTime(activity.date)}
          </p>
        )}
      </div>
    </div>
  );
}

// ActivityList subcomponent
function ActivityList({
  activities,
  order,
  formatter,
}: {
  activities: Activity[];
  order: any;
  formatter: Intl.NumberFormat;
}) {
  return (
    <>
      {activities.map((activity) => (
        <ActivityItem
          key={`${activity.type}-${activity.date}-${isRefundAction(activity) ? (activity as RefundAction).amount : (activity as any).status}`}
          activity={activity}
          order={order}
          formatter={formatter}
        />
      ))}
    </>
  );
}

export function ActivityView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  // Memoize activities array
  const activities: Activity[] = useMemo(() => {
    if (!order) return [];
    const refundActions: RefundAction[] =
      order?.refunds?.map((refund: any) => ({
        ...refund,
        type: ActivityType.Refund,
      })) ?? [];

    const transitionActions: TransitionAction[] =
      order?.transitions?.map((transition: any) => ({
        ...transition,
        type: ActivityType.Transition,
        user: transition.signedInAthenaUser?.email,
      })) ?? [];

    const createdAction: CreatedAction = {
      status: "created",
      date: order?._creationTime ?? 0,
      type: ActivityType.Transition,
    };

    const feedbackRequestActions: FeedbackRequestAction[] =
      order?.items
        ?.filter((item: any) => item.feedbackRequested)
        .map((item: any) => ({
          date: item.feedbackRequestedAt ?? 0,
          type: ActivityType.FeedbackRequest,
          user: item.feedbackRequestedBy?.email,
          productName: getProductName(item),
        })) ?? [];

    return [
      createdAction,
      ...refundActions,
      ...transitionActions,
      ...feedbackRequestActions,
    ].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  }, [order]);

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  return (
    <View
      className="h-auto w-full"
      hideBorder
      hideHeaderBottomBorder
      header={<p className="text-sm text-muted-foreground">Activity</p>}
    >
      <div className="container mx-auto h-full w-full py-4 space-y-8">
        <ActivityList
          activities={activities}
          order={order}
          formatter={formatter}
        />
      </div>
    </View>
  );
}
