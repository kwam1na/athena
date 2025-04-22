import { useQuery } from "convex/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { analyticsColumns } from "../analytics/analytics-data-table/analytics-columns";
import { GenericDataTable } from "../base/table/data-table";
import { api } from "~/convex/_generated/api";
import { useParams } from "@tanstack/react-router";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import CopyButton from "../ui/copy-button";

const ActivityHeader = () => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
        >
          <DotsHorizontalIcon className="w-4 h-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        <DropdownMenuItem>
          <div className="flex items-center gap-2">
            <CopyButton stringToCopy={{}} />
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const UserActivity = () => {
  const { userId } = useParams({ strict: false });
  const analytics = useQuery(
    api.storeFront.user.getAllUserActivity,
    userId ? { id: userId as Id<"storeFrontUser"> } : "skip"
  );

  if (!analytics) return null;

  // console.log(analytics);

  const items = analytics.sort((a, b) => b._creationTime - a._creationTime);

  return <GenericDataTable data={items} columns={analyticsColumns} />;
};
