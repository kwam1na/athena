import { useQuery } from "convex/react";
import { Sparkle, UserRoundCheck } from "lucide-react";
import { Badge } from "../ui/badge";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";

export const UserStatus = ({
  creationTime,
  userId,
}: {
  creationTime: number;
  userId: Id<"storeFrontUser"> | Id<"guest">;
}) => {
  // Get just the most recent user activity for efficiency
  const mostRecentActivity = useQuery(
    api.storeFront.user.getMostRecentActivity,
    { id: userId }
  );

  // Consider a user new if account created within the last 30 days
  const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
  const isNewAccount = Date.now() - creationTime < thirtyDaysInMs;

  if (mostRecentActivity === undefined) {
    return null;
  }

  // Check if most recent activity exists and is > 1 day after account creation
  let hasRecentActivity = false;
  if (mostRecentActivity) {
    const oneDayInMs = 24 * 60 * 60 * 1000;
    hasRecentActivity =
      mostRecentActivity._creationTime > creationTime + oneDayInMs;
  }

  const isReturning = !isNewAccount || hasRecentActivity;

  return (
    <Badge
      variant="outline"
      className={
        isReturning
          ? "bg-blue-50 border-blue-50 text-blue-500 flex items-center gap-1"
          : "bg-green-50 border-green-50 text-green-600 flex items-center gap-1"
      }
    >
      {isReturning && <UserRoundCheck className="w-3 h-3" />}
      {!isReturning && <Sparkle className="w-3 h-3" />}
      {isReturning ? "Returning" : "New"}
    </Badge>
  );
};
