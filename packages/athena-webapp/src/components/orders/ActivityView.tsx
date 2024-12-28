import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import {
  currencyFormatter,
  getRelativeTime,
  slugToWords,
} from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Circle } from "lucide-react";

export function ActivityView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  // combine the refunds {amount, date} and transitions {status, date} into one array
  // of activities, sorted by date with a type field to differentiate between the two

  const refundActions = order.refunds?.map((refund) => ({
    ...refund,
    type: "refund",
  }));

  const transitionActions = order.transitions?.map((transition) => ({
    ...transition,
    type: "transition",
  }));

  const activities = [
    { status: "created", date: order._creationTime, type: "transition" },
    ...(refundActions ?? []),
    ...(transitionActions ?? []),
  ].sort((a, b) => b.date - a.date);

  return (
    <View
      className="h-auto w-full"
      hideBorder
      hideHeaderBottomBorder
      header={<p className="text-sm text-sm text-muted-foreground">Activity</p>}
    >
      <div className="container mx-auto h-full w-full p-8 space-y-8">
        {activities.map((activity, idx) => (
          <div className="flex items-center" key={idx}>
            <div className="space-y-2">
              <div className="flex items-center">
                <Circle className="h-2 w-2 mt-1 mr-2 text-muted-foreground" />
                {activity.type === "refund" && (
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-medium">refunded</p>
                    <p className="text-sm text-red-700">
                      - {formatter.format((activity as any).amount / 100)}
                    </p>
                  </div>
                )}
                {activity.type === "transition" && (
                  <div className="flex items-center gap-1">
                    {(activity as any).status == "created" ? (
                      <p className="text-sm text-muted-foreground">order was</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        order transitioned &rarr;
                      </p>
                    )}

                    <p className="text-sm font-medium">
                      {slugToWords((activity as any).status)}
                    </p>
                  </div>
                )}
              </div>
              <p className="text-xs ml-4 text-muted-foreground">
                {getRelativeTime(activity.date)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </View>
  );
}
