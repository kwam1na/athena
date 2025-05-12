import { Id } from "~/convex/_generated/dataModel";
import { formatUserId } from "~/src/lib/utils";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

interface UserAnalyticsNameProps {
  userId: Id<"storeFrontUser"> | Id<"guest">;
  userData?: {
    email?: string;
  };
}

export const UserAnalyticsName = ({
  userId,
  userData,
}: UserAnalyticsNameProps) => {
  // Use the prefetched userData instead of making a query
  const displayName = userData?.email ? userData.email : formatUserId(userId);

  return (
    <Link
      to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
      params={(p) => ({
        ...p,
        storeUrlSlug: p.storeUrlSlug!,
        orgUrlSlug: p.orgUrlSlug!,
        userId,
      })}
      search={{ o: getOrigin() }}
      className="flex items-center gap-2"
    >
      <p className="text-sm font-bold">{displayName}</p>
    </Link>
  );
};
