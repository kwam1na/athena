import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { getRelativeTime, snakeCaseToWords } from "~/src/lib/utils";
import { Analytic } from "~/types";
import { Monitor, Smartphone } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { getOrigin } from "~/src/lib/navigationUtils";
import { UserAnalyticsName } from "~/src/components/users/UserAnalyticsName";

export const analyticsColumns: ColumnDef<Analytic>[] = [
  {
    accessorKey: "action",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Activity" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return (
        <div className="flex items-center gap-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <UserAnalyticsName
                userId={item.storeFrontUserId}
                userData={item.userData}
              />

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {item.data.product && item.data.productSku ? (
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: p.orgUrlSlug!,
                          storeUrlSlug: p.storeUrlSlug!,
                          productSlug: item.data.product,
                        })}
                        search={{
                          o: getOrigin(),
                          variant: item.data.productSku,
                        }}
                        className="flex items-center gap-2"
                      >
                        <span className="font-medium">
                          {snakeCaseToWords(item.action)}
                        </span>
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2 hover:cursor-pointer">
                        <span className="font-medium">
                          {snakeCaseToWords(item.action)}
                        </span>
                      </div>
                    )}
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
                  {item.data.selectedVariant !== undefined && (
                    <TooltipContent>
                      <div className="flex flex-col gap-2 items-center p-2">
                        <p>Variant {item.data.selectedVariant + 1}</p>
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
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
