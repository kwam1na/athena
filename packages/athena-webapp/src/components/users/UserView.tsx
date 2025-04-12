import { useParams } from "@tanstack/react-router";
import View from "../View";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { AtSign, IdCard, Phone } from "lucide-react";
import { BagDetails } from "../user-bags/BagView";
import { FadeIn } from "../common/FadeIn";
import { SimplePageHeader } from "../common/PageHeader";

export const UserView = () => {
  const { userId } = useParams({ strict: false });

  const user = useQuery(
    api.storeFront.user.getByIdentifier,
    userId ? { id: userId as Id<"storeFrontUser"> } : "skip"
  );

  const userBag = useQuery(
    api.storeFront.bag.getByUserId,
    user ? { storeFrontUserId: user._id } : "skip"
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
        <div className="space-y-16">
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
            {userBag && <BagDetails bag={userBag} />}
          </div>
        </div>
      </FadeIn>
    </View>
  );
};
