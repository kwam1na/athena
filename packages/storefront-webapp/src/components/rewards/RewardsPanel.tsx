import { useState } from "react";
import { useStoreContext } from "@/contexts/StoreContext";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RewardTier, redeemRewardPoints } from "@/api/rewards";
import { useRewardsQueries } from "@/lib/queries/rewards";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";

export function RewardsPanel() {
  const { store } = useStoreContext();
  const queryClient = useQueryClient();
  const [isRedeeming, setIsRedeeming] = useState(false);
  const rewardsQueries = useRewardsQueries();

  const { data: pointsData, isLoading: pointsLoading } = useQuery(
    rewardsQueries.pointsQuery(store?._id || "")
  );

  // const { data: tiersData, isLoading: tiersLoading } = useQuery(
  //   rewardsQueries.tiersQuery(store?._id || "")
  // );

  const { data: historyData, isLoading: historyLoading } = useQuery(
    rewardsQueries.historyQuery()
  );

  const points = pointsData?.points;

  const handleRedeemReward = async (tier: RewardTier) => {
    if (!store) {
      return;
    }

    try {
      setIsRedeeming(true);
      const result = await redeemRewardPoints(store._id);

      if (result.success) {
        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: rewardsQueries.points() });
        queryClient.invalidateQueries({ queryKey: rewardsQueries.history() });

        toast.success(
          `Redeemed ${tier.name}! ${result.discount?.value}${result.discount?.type === "percentage" ? "%" : " NGN"} off your next order.`
        );
      } else {
        toast.error(result.error || "Failed to redeem points");
      }
    } catch (error) {
      toast.error("Error redeeming points");
      console.error(error);
    } finally {
      setIsRedeeming(false);
    }
  };

  const hasPoints =
    historyData?.transactions && historyData.transactions.length > 0;

  return (
    <div className="space-y-16">
      <div className="bg-white rounded-lg border p-6">
        <div className="mb-6 p-6 rounded-md text-center">
          <div className="text-sm text-gray-500 mb-2">Available Points</div>
          {pointsLoading && <Skeleton className="h-10 w-32 mx-auto mb-2" />}

          {!pointsLoading && points !== undefined && points >= 0 && (
            <div className="text-4xl font-light">{points.toLocaleString()}</div>
          )}
        </div>
      </div>

      {hasPoints && (
        <h2 className="text-lg font-medium mb-4">Points History</h2>
      )}

      {historyLoading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="py-3 space-y-2">
              <Skeleton className="h-6 w-24 mb-2" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!historyLoading &&
        historyData?.transactions &&
        historyData.transactions.length > 0 && (
          <div className="">
            <div className="overflow-x-auto">
              <div className="w-full text-left">
                <div className="space-y-4">
                  {historyData.transactions.map((transaction, index) => (
                    <div key={transaction._id}>
                      <div className="py-3 space-y-2">
                        <p
                          className={`font-light ${transaction.points > 0 ? "text-accent2" : "text-red-600"}`}
                        >
                          {transaction.points > 0 ? "+" : ""}
                          {transaction.points.toLocaleString()} pts
                        </p>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {transaction.orderId && (
                            <Link
                              to={`/shop/orders/$orderId`}
                              params={{ orderId: transaction.orderId }}
                            >
                              <p>Order #{transaction.orderNumber}</p>
                            </Link>
                          )}
                          <p>·</p>
                          <p>{formatDate(transaction._creationTime)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
