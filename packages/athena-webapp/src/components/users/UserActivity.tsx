import { useState } from "react";
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
import { CustomerBehaviorTimeline } from "./CustomerBehaviorTimeline";
import { LayoutList } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

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
  const [viewMode, setViewMode] = useState<"timeline" | "table">("timeline");

  const analytics = useQuery(
    api.storeFront.user.getAllUserActivity,
    userId ? { id: userId as Id<"storeFrontUser"> } : "skip"
  );

  if (!analytics || !userId) return null;

  const items = analytics.sort((a, b) => b._creationTime - a._creationTime);

  return (
    <div className="space-y-4">
      <Tabs
        value={viewMode}
        onValueChange={(value) => setViewMode(value as "timeline" | "table")}
      >
        <div className="flex items-center justify-between">
          <TabsList className="grid w-[200px] grid-cols-2">
            <TabsTrigger
              value="timeline"
              className="flex items-center space-x-2"
            >
              {/* <Timeline className="w-4 h-4" /> */}
              <span>Timeline</span>
            </TabsTrigger>
            <TabsTrigger value="table" className="flex items-center space-x-2">
              <LayoutList className="w-4 h-4" />
              <span>Table</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="timeline" className="mt-6">
          <CustomerBehaviorTimeline
            userId={userId as Id<"storeFrontUser"> | Id<"guest">}
          />
        </TabsContent>

        <TabsContent value="table" className="mt-6">
          <GenericDataTable data={items} columns={analyticsColumns} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
