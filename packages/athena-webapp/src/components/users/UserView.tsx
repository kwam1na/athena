import { useParams } from "@tanstack/react-router";
import View from "../View";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import {
  AtSign,
  Calendar,
  CalendarPlus,
  Hash,
  IdCard,
  Phone,
} from "lucide-react";
import { FadeIn } from "../common/FadeIn";
import { SimplePageHeader } from "../common/PageHeader";
import { UserActivity } from "./UserActivity";
import { UserBag } from "./UserBag";
import { UserOnlineOrders } from "./UserOnlineOrders";
import { UserInsightsSection } from "./UserInsightsSection";
import { LinkedAccounts } from "./LinkedAccounts";
import { formatDate } from "~/convex/utils";
import { formatUserId } from "~/src/lib/utils";
import { Badge } from "../ui/badge";

// Component to determine if user is new or returning
const UserStatus = ({
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
          ? "bg-blue-50 border-blue-50 text-blue-400"
          : "bg-green-50 border-green-50 text-green-500"
      }
    >
      {isReturning ? "Returning" : "New"}
    </Badge>
  );
};

export const UserView = () => {
  const { userId } = useParams({ strict: false });

  const user = useQuery(
    api.storeFront.user.getByIdentifier,
    userId ? { id: userId as Id<"storeFrontUser"> } : "skip"
  );

  if (!user) return null;

  const name =
    !user.firstName || !user.lastName
      ? null
      : `${user.firstName} ${user.lastName}`;

  const hasContactDetails = name || user.email || user.phoneNumber;

  return (
    <View header={<SimplePageHeader title="User details" />}>
      <FadeIn className="container mx-auto h-full w-full p-8 space-y-12">
        <div className="flex justify-between gap-24">
          <div className="space-y-16 w-[60%]">
            <div className="space-y-8">
              <p className="text-sm font-medium">Contact Details</p>
              {!hasContactDetails ? (
                <p className="text-sm text-muted-foreground">
                  This user hasn't provided any contact details.
                </p>
              ) : (
                <div className="space-y-4">
                  {name && (
                    <div className="flex items-center gap-2">
                      <IdCard className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm">{name}</p>
                    </div>
                  )}

                  {user.email && (
                    <div className="flex items-center gap-2">
                      <AtSign className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm">{user.email}</p>
                    </div>
                  )}

                  {user.phoneNumber && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm">{user.phoneNumber}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-8">
              <p className="text-sm font-medium">User details</p>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm">{formatUserId(user._id)}</p>
                </div>

                <div className="flex items-center gap-2">
                  <CalendarPlus className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm">{formatDate(user._creationTime)}</p>
                  <UserStatus
                    creationTime={user._creationTime}
                    userId={user._id}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-8">
              <p className="text-sm font-medium">Bag details</p>
              <UserBag />
            </div>

            <div className="space-y-8">
              <p className="text-sm font-medium">Online orders</p>
              <UserOnlineOrders />
            </div>

            <div className="space-y-8">
              <p className="text-sm font-medium">Linked accounts</p>
              <LinkedAccounts />
            </div>
          </div>

          <div className="w-[40%] space-y-24">
            <UserInsightsSection />
            <UserActivity />
          </div>
        </div>
      </FadeIn>
    </View>
  );
};
