import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { getRelativeTime, snakeCaseToWords } from "~/src/lib/utils";
import { Analytic, BagItem } from "~/types";
import { ArrowRight, Monitor, Smartphone, User } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { getOrigin } from "~/src/lib/navigationUtils";

export const columns: ColumnDef<Analytic>[] = [
  {
    accessorKey: "action",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Activity" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return (
        <p className="flex items-center gap-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Link
                to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
                params={(p) => ({
                  ...p,
                  storeUrlSlug: p.storeUrlSlug!,
                  orgUrlSlug: p.orgUrlSlug!,
                  userId: item.storeFrontUserId,
                })}
                search={{ o: getOrigin() }}
                className="flex items-center gap-2"
              >
                <p className="text-sm font-bold">
                  {`User-${item.storeFrontUserId.slice(-5)}`}
                </p>
              </Link>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 hover:cursor-pointer">
                      <span className="font-medium">
                        {snakeCaseToWords(item.action)}
                      </span>
                    </div>
                  </TooltipTrigger>
                  {item.data.productImageUrl && (
                    <TooltipContent>
                      <div className="flex flex-col gap-2 items-center p-2">
                        <img
                          src={item.data?.productImageUrl}
                          alt={"product image"}
                          className="w-24 h-24 aspect-square object-cover rounded-lg"
                        />
                      </div>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-4">
              {item.origin && (
                <span className="text-muted-foreground">
                  from {snakeCaseToWords(item.origin)}
                </span>
              )}

              {item.origin && (
                <p className="text-xs text-muted-foreground">·</p>
              )}

              <p className="text-muted-foreground">
                {getRelativeTime(item._creationTime)}
              </p>

              <p className="text-xs text-muted-foreground">·</p>

              {item.device === "desktop" && (
                <Monitor className="w-4 h-4 text-muted-foreground" />
              )}

              {item.device === "mobile" && (
                <Smartphone className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </p>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
