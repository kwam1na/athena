import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRewardsQueries } from "@/lib/queries/rewards";
import { awardPointsForPastOrder, EligibleOrder } from "@/api/rewards";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { useStoreContext } from "@/contexts/StoreContext";
import { formatStoredAmount } from "@/lib/currency";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadingButton } from "@/components/ui/loading-button";

interface PastOrdersRewardsProps {
  userEmail: string;
}

export function PastOrdersRewards({ userEmail }: PastOrdersRewardsProps) {
  const queryClient = useQueryClient();
  const { formatter } = useStoreContext();
  const rewardsQueries = useRewardsQueries();
  const [claimedOrderIds, setClaimedOrderIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Get eligible orders
  const { data, isLoading } = useQuery(
    rewardsQueries.pastOrdersQuery(userEmail)
  );

  // Mutation for claiming points
  const claimPointsMutation = useMutation({
    mutationFn: awardPointsForPastOrder,
    onSuccess: (result, orderId) => {
      if (result.success) {
        // Update local state
        setClaimedOrderIds((prev) => [...prev, orderId]);
        setSuccessMessage(
          `Successfully claimed ${result.points?.toLocaleString() || result.points} points!`
        );

        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: rewardsQueries.points() });
        queryClient.invalidateQueries({ queryKey: rewardsQueries.history() });

        // Clear success message after 5 seconds
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setError(result.error || "Failed to claim points");

        // Clear error after 5 seconds
        setTimeout(() => setError(null), 5000);
      }
    },
    onError: (error) => {
      setError("Error claiming points. Please try again.");

      // Clear error after 5 seconds
      setTimeout(() => setError(null), 5000);
    },
  });

  const handleClaimPoints = (order: EligibleOrder) => {
    setError(null);
    setSuccessMessage(null);
    claimPointsMutation.mutate(order._id);
  };

  if (isLoading) {
    return (
      <div className="py-4 text-sm text-muted-foreground" role="status">
        Checking for past orders...
      </div>
    );
  }

  const eligibleOrders = data?.orders || [];

  if (eligibleOrders.length === 0 && claimedOrderIds.length === 0) {
    return null; // Don't show anything if no eligible orders
  }

  return (
    <section className="mt-8 rounded-lg border bg-surface p-6 shadow-surface">
      <h2 className="mb-4 text-2xl font-semibold">Claim points for past orders</h2>

      {error && (
        <InlineAlert tone="danger" title="Unable to claim points">
          {error}
        </InlineAlert>
      )}

      {successMessage && (
        <InlineAlert tone="success" title="Points claimed">
          {successMessage}
        </InlineAlert>
      )}

      {eligibleOrders.length > 0 ? (
        <div className="space-y-4">
          <p className="mb-4 text-sm text-muted-foreground">
            We found previous orders associated with your email. Claim your
            reward points now!
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b">
                  <th className="pb-2">Order #</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Points</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {eligibleOrders.map((order, index) => (
                  <tr
                    key={order._id}
                    className={
                      index < eligibleOrders.length - 1 ? "border-b" : ""
                    }
                  >
                    <td className="py-3">{order.orderNumber}</td>
                    <td className="py-3">{formatDate(order._creationTime)}</td>
                    <td className="py-3">
                      {formatStoredAmount(formatter, order.amount)}
                    </td>
                    <td className="py-3">
                      {order.potentialPoints.toLocaleString()}
                    </td>
                    <td className="py-3">
                      <LoadingButton
                        size="sm"
                        onClick={() => handleClaimPoints(order)}
                        isLoading={
                          claimPointsMutation.isPending &&
                          !claimedOrderIds.includes(order._id)
                        }
                        disabled={
                          claimPointsMutation.isPending ||
                          claimedOrderIds.includes(order._id)
                        }
                      >
                        {claimedOrderIds.includes(order._id)
                          ? "Claimed"
                          : claimPointsMutation.isPending
                            ? "Claiming..."
                            : "Claim Points"}
                      </LoadingButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : claimedOrderIds.length > 0 ? (
        <div className="py-4 text-center text-success" role="status">
          All available points have been claimed!
        </div>
      ) : null}
    </section>
  );
}
