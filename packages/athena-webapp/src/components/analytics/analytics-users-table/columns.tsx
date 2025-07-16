import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { formatUserId, getRelativeTime } from "~/src/lib/utils";
import { Monitor, Smartphone, User, Mail, Activity, Clock } from "lucide-react";
import { Badge } from "../../ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

export interface AnalyticUser {
  userId: string;
  email?: string;
  userType: "Registered" | "Guest";
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
}

export const columns: ColumnDef<AnalyticUser>[] = [
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Top Users" />
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
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {user.email || formatUserId(user.userId)}
              </span>
              {/* <Badge
                variant={
                  user.userType === "Registered" ? "default" : "secondary"
                }
                className="text-xs"
              >
                {user.userType}
              </Badge> */}
            </div>
            <span className="text-xs text-muted-foreground">
              {user.totalActions} event{user.totalActions !== 1 ? "s" : ""}
            </span>
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "totalActions",
    enableSorting: false,
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
                    className="flex items-center gap-2"
                  >
                    <div className="flex items-center gap-2">
                      {/* <Activity className="w-4 h-4 text-muted-foreground" /> */}
                      <div className="flex flex-col">
                        {/* <span className="font-medium">{user.totalActions}</span> */}
                        <span className="text-sm capitalize text-muted-foreground">
                          {user.mostRecentAction}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {getRelativeTime(user.lastActive)}
                        </span>
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div className="flex items-center gap-2">
                    {/* <Activity className="w-4 h-4 text-muted-foreground" /> */}
                    <div className="flex flex-col">
                      {/* <span className="font-medium">{user.totalActions}</span> */}
                      <span className="text-sm capitalize text-muted-foreground">
                        {user.mostRecentAction}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {getRelativeTime(user.lastActive)}
                      </span>
                    </div>
                  </div>
                )}
              </TooltipTrigger>
              {user.mostRecentActionData?.productImageUrl && (
                <TooltipContent>
                  <div className="flex flex-col gap-2 items-center p-2">
                    <img
                      src={user.mostRecentActionData.productImageUrl}
                      alt={"product image"}
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
    enableSorting: false,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Products Viewed" />
    ),
    cell: ({ row }) => {
      const user = row.original;

      return <span className="font-medium">{user.uniqueProducts}</span>;
    },
  },
  {
    accessorKey: "devicePreference",
    enableSorting: false,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Device" />
    ),
    cell: ({ row }) => {
      const user = row.original;

      return (
        <div className="flex items-center gap-2">
          {user.devicePreference === "desktop" && (
            <Monitor className="w-4 h-4 text-muted-foreground" />
          )}
          {user.devicePreference === "mobile" && (
            <Smartphone className="w-4 h-4 text-muted-foreground" />
          )}
          {user.devicePreference === "unknown" && (
            <span className="w-4 h-4 flex items-center justify-center text-muted-foreground">
              ?
            </span>
          )}
        </div>
      );
    },
  },
];
