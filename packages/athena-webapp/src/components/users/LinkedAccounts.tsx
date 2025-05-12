import { useQuery } from "convex/react";
import { useParams } from "@tanstack/react-router";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Calendar, Clock, User, Hash } from "lucide-react";
import { formatRelative } from "date-fns";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Link } from "@tanstack/react-router";
import { formatUserId } from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";

export const LinkedAccounts = () => {
  const { userId, orgUrlSlug, storeUrlSlug } = useParams({ strict: false });

  const linkedAccounts = useQuery(
    api.storeFront.user.findLinkedAccounts,
    userId ? { userId: userId as Id<"storeFrontUser"> | Id<"guest"> } : "skip"
  );

  if (
    !linkedAccounts ||
    (linkedAccounts.storeFrontUsers.length === 0 &&
      linkedAccounts.guestUsers.length === 0)
  ) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">
          No linked accounts found with the same email address.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {linkedAccounts.storeFrontUsers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Storefront User Accounts</p>
          <div className="grid grid-cols-1 gap-4">
            {linkedAccounts.storeFrontUsers.map((user) => (
              <Card key={user._id} className="border border-border">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      {user.firstName || user.lastName
                        ? `${user.firstName || ""} ${user.lastName || ""}`
                        : user.email}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Hash className="h-3 w-3" />
                      {formatUserId(user._id)}
                    </div>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {user.email}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2 pb-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Created{" "}
                      {formatRelative(new Date(user._creationTime), new Date())}
                    </p>
                  </div>
                  {user.phoneNumber && (
                    <p className="text-xs">Phone: {user.phoneNumber}</p>
                  )}
                </CardContent>
                <CardFooter className="p-4 pt-2">
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="w-full"
                  >
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
                      params={{
                        orgUrlSlug: orgUrlSlug as string,
                        storeUrlSlug: storeUrlSlug as string,
                        userId: user._id,
                      }}
                      search={{
                        o: getOrigin(),
                      }}
                    >
                      View Account
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      {linkedAccounts.guestUsers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Guest Accounts</p>
          <div className="grid grid-cols-1 gap-4">
            {linkedAccounts.guestUsers.map((guest) => (
              <Card key={guest._id} className="border border-border">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Guest User
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Hash className="h-3 w-3" />
                      {formatUserId(guest._id)}
                    </div>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {guest.email}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2 pb-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Created{" "}
                      {formatRelative(
                        new Date(guest._creationTime),
                        new Date()
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Last active{" "}
                      {formatRelative(
                        new Date(guest._creationTime),
                        new Date()
                      )}
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="p-4 pt-2">
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="w-full"
                  >
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
                      params={{
                        orgUrlSlug: orgUrlSlug as string,
                        storeUrlSlug: storeUrlSlug as string,
                        userId: guest._id,
                      }}
                      search={{
                        o: getOrigin(),
                      }}
                    >
                      View Guest Account
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
