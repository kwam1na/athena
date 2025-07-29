import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { formatUserId, getRelativeTime } from "~/src/lib/utils";
import {
  Monitor,
  Smartphone,
  User,
  Activity,
  Sparkle,
  UserRoundCheck,
  Crown,
} from "lucide-react";
import { Badge } from "../../ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Doc } from "~/convex/_generated/dataModel";

export interface CombinedAnalyticUser {
  userId: string;
  email?: string;
  userType: "Registered" | "Guest";
  isNewUser: boolean; // New registration (within 7 days)
  isNewActivity: boolean; // New to analytics/activity (within 7 days)
  totalActions: number;
  lastActive: number;
  firstSeen: number;
  devicePreference: "mobile" | "desktop" | "unknown";
  mostRecentAction: string;
  uniqueProducts: number;
  mostRecentActionData?: {
    product?: string;
    productSku?: string;
    productImageUrl?: string;
    selectedVariant?: number;
  };
  user?: Doc<"storeFrontUser"> | Doc<"guest">;
}

export const columns: ColumnDef<CombinedAnalyticUser>[] = [
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="User" />
    ),
    cell: ({ row }) => {
      const user = row.original;

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
          params={(p) => ({
            ...p,
            orgUrlSlug: p.orgUrlSlug!,
            storeUrlSlug: p.storeUrlSlug!,
            userId: user.userId,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-3"
        >
          <div className="flex items-center justify-center w-8 h-8 bg-muted rounded-full">
            <User className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">
                {user.email || formatUserId(user.userId)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {user.isNewUser && (
                <Badge
                  variant="outline"
                  className="bg-green-50 border-green-50 text-green-600 flex items-center gap-1 text-xs"
                >
                  <Sparkle className="w-3 h-3" />
                  New User
                </Badge>
              )}
              {!user.isNewUser && (
                <Badge
                  variant="outline"
                  className="bg-blue-50 border-blue-50 text-blue-500 flex items-center gap-1 text-xs"
                >
                  <UserRoundCheck className="w-3 h-3" />
                  Returning
                </Badge>
              )}
              {/* {user.isNewActivity && !user.isNewUser && (
                <Badge
                  variant="outline"
                  className="bg-purple-50 border-purple-200 text-purple-600 text-xs"
                >
                  New Activity
                </Badge>
              )} */}
            </div>
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "totalActions",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Engagement" />
    ),
    cell: ({ row }) => {
      const user = row.original;

      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-medium">{user.totalActions}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {user.totalActions === 1 ? "interaction" : "interactions"}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "lastActive",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last Activity" />
    ),
    cell: ({ row }) => {
      const user = row.original;

      return (
        <div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {user.mostRecentActionData?.product &&
                user.mostRecentActionData?.productSku ? (
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: p.orgUrlSlug!,
                      storeUrlSlug: p.storeUrlSlug!,
                      productSlug: user.mostRecentActionData?.product!,
                    })}
                    search={{
                      o: getOrigin(),
                      variant: user.mostRecentActionData?.productSku,
                    }}
                    className="flex flex-col"
                  >
                    <span className="text-sm capitalize font-medium">
                      {user.mostRecentAction}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {getRelativeTime(user.lastActive)}
                    </span>
                  </Link>
                ) : (
                  <div className="flex flex-col">
                    <span className="text-sm capitalize font-medium">
                      {user.mostRecentAction}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {getRelativeTime(user.lastActive)}
                    </span>
                  </div>
                )}
              </TooltipTrigger>
              {user.mostRecentActionData?.productImageUrl && (
                <TooltipContent>
                  <div className="flex flex-col gap-2 items-center p-2">
                    <img
                      src={user.mostRecentActionData.productImageUrl}
                      alt="product image"
                      className="w-24 h-24 aspect-square object-cover rounded-lg"
                    />
                  </div>
                </TooltipContent>
              )}
              {user.mostRecentActionData?.selectedVariant !== undefined && (
                <TooltipContent>
                  <div className="flex flex-col gap-2 items-center p-2">
                    <p>
                      Variant {user.mostRecentActionData.selectedVariant + 1}
                    </p>
                  </div>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      );
    },
  },
  {
    accessorKey: "uniqueProducts",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Products viewed" />
    ),
    cell: ({ row }) => {
      const user = row.original;

      return (
        <div className="flex flex-col">
          <span className="font-medium">{user.uniqueProducts}</span>
          <span className="text-xs text-muted-foreground">
            {user.uniqueProducts === 1 ? "product" : "products"}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "devicePreference",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Device" />
    ),
    cell: ({ row }) => {
      const user = row.original;

      return (
        <div className="flex items-center gap-2">
          {user.devicePreference === "desktop" && (
            <>
              <Monitor className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Desktop</span>
            </>
          )}
          {user.devicePreference === "mobile" && (
            <>
              <Smartphone className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Mobile</span>
            </>
          )}
          {user.devicePreference === "unknown" && (
            <>
              <span className="w-4 h-4 flex items-center justify-center text-muted-foreground">
                ?
              </span>
              <span className="text-sm text-muted-foreground">Unknown</span>
            </>
          )}
        </div>
      );
    },
  },
];
