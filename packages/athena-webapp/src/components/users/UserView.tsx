import { useParams } from "@tanstack/react-router";
import View from "../View";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import {
  AtSign,
  Brain,
  Calendar,
  CalendarPlus,
  Hash,
  IdCard,
  OctagonX,
  Phone,
  Sparkle,
  Trash2,
  UserIcon,
  UserRoundCheck,
} from "lucide-react";
import { FadeIn } from "../common/FadeIn";
import { ComposedPageHeader, SimplePageHeader } from "../common/PageHeader";
import { UserActivity } from "./UserActivity";
import { UserBag } from "./UserBag";
import { UserOnlineOrders } from "./UserOnlineOrders";
import { UserInsightsSection } from "./UserInsightsSection";
import { LinkedAccounts } from "./LinkedAccounts";
import { UserBehaviorInsights } from "./behavioral-insights";
import { formatDate } from "~/convex/utils";
import { formatUserId } from "~/src/lib/utils";
import { Badge } from "../ui/badge";
import CopyButton from "../ui/copy-button";
import CopyWrapper from "../ui/copy-wrapper";
import { useCopyText } from "~/src/hooks/useCopyText";
import { LoadingButton } from "../ui/loading-button";
import { useState } from "react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { toast } from "sonner";
import { EmptyState } from "../states/empty/empty-state";
import { CounterClockwiseClockIcon } from "@radix-ui/react-icons";

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

const UserActions = () => {
  const { userId } = useParams({ strict: false });

  const [isLoading, setIsLoading] = useState(false);

  const { activeStore } = useGetActiveStore();

  const clearAnalytics = useMutation(api.storeFront.analytics.clear);

  const handleClearAnalytics = async () => {
    if (!activeStore?._id) {
      return;
    }

    setIsLoading(true);

    try {
      await clearAnalytics({
        storeFrontUserId: userId as Id<"storeFrontUser">,
        storeId: activeStore?._id,
      });

      toast.success("Analytics cleared for user");
    } catch (e) {
      console.error(e);
      toast.error("Failed to clear analytics");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LoadingButton
      isLoading={isLoading}
      onClick={handleClearAnalytics}
      variant="outline"
    >
      <OctagonX className="w-4 h-4 mr-2" />
      Clear Analytics
    </LoadingButton>
  );
};

export const UserView = () => {
  const { userId } = useParams({ strict: false });

  const user = useQuery(
    api.storeFront.user.getByIdentifier,
    userId ? { id: userId as Id<"storeFrontUser"> } : "skip"
  );

  const copyUserId = useCopyText(user?._id as string);

  if (!user)
    return (
      <View>
        <FadeIn className="flex items-center justify-center min-h-[60vh] w-full">
          <EmptyState
            title={
              <div className="flex gap-1 text-sm">
                <p className="text-muted-foreground">User not found</p>
              </div>
            }
          />
        </FadeIn>
      </View>
    );

  const name =
    !user.firstName || !user.lastName
      ? null
      : `${user.firstName} ${user.lastName}`;

  const hasContactDetails = name || user.email || user.phoneNumber;

  return (
    <View
      header={
        <ComposedPageHeader
          leadingContent={
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">User details</p>{" "}
              <UserStatus creationTime={user._creationTime} userId={user._id} />
            </div>
          }
          trailingContent={<UserActions />}
        />
      }
    >
      <FadeIn className="container mx-auto h-full w-full p-8 space-y-12">
        <div className="flex justify-between gap-24">
          <div className="space-y-16 w-[60%]">
            <div className="space-y-8">
              {/* <p className="text-sm font-medium">Contact Details</p> */}
              {!hasContactDetails ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm">{formatUserId(user._id)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarPlus className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm">{formatDate(user._creationTime)}</p>
                  </div>
                </div>
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

                  <div className="flex items-center gap-2">
                    <CalendarPlus className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm">{formatDate(user._creationTime)}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-8">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-medium">Behavioral Insights</p>
              </div>
              <UserBehaviorInsights userId={user._id} />
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
            {/* <UserInsightsSection /> */}
            <UserActivity />
          </div>
        </div>
      </FadeIn>
    </View>
  );
};
