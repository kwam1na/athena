import { useQuery } from "@tanstack/react-query";
import { useRewardsQueries } from "@/lib/queries/rewards";
import { Award } from "lucide-react";

interface OrderPointsDisplayProps {
  orderId: string;
  hasVerifiedPayment: boolean;
  compact?: boolean;
}

export function OrderPointsDisplay({
  orderId,
  hasVerifiedPayment,
  compact = false,
}: OrderPointsDisplayProps) {
  const rewardsQueries = useRewardsQueries();

  const { data, isLoading } = useQuery(
    rewardsQueries.orderPointsQuery(orderId)
  );

  if (isLoading) {
    return null;
  }

  if (!data || !data.points) {
    return null;
  }

  const points = data.points;
  const isAwarded = !!data.transaction;

  if (!hasVerifiedPayment && !isAwarded) {
    return null;
  }

  if (compact) {
    return <span className="text-sm">{points.toLocaleString()}</span>;
  }

  return (
    <div
      className={`flex items-center gap-2 mt-1 ${
        isAwarded ? "text-accent2" : ""
      }`}
    >
      <Award className="w-4 h-4" />
      <span className={`text-sm`}>
        {isAwarded
          ? `+${points.toLocaleString()} points earned`
          : `${points.toLocaleString()} points will be awarded once your account is verified`}
      </span>
    </div>
  );
}
