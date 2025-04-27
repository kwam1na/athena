import { useParams } from "@tanstack/react-router";
import View from "../View";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { AtSign, IdCard, Phone } from "lucide-react";
import { FadeIn } from "../common/FadeIn";
import { SimplePageHeader } from "../common/PageHeader";
import { UserActivity } from "./UserActivity";
import { UserBag } from "./UserBag";
import { UserOnlineOrders } from "./UserOnlineOrders";
import { UserInsightsSection } from "./UserInsightsSection";

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
              <p className="text-sm font-medium">Contact details</p>
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
              <p className="text-sm font-medium">Bag details</p>
              <UserBag />
            </div>

            <div className="space-y-8">
              <p className="text-sm font-medium">Online orders</p>
              <UserOnlineOrders />
            </div>

            <UserInsightsSection />
          </div>

          <div className="w-[40%]">
            <UserActivity />
          </div>
        </div>
      </FadeIn>
    </View>
  );
};
