import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { TimelineEventList } from "./TimelineEventCard";
import {
  enrichTimelineEvents,
  getTimeRangeLabel,
  type TimelineEvent,
} from "~/src/lib/timelineUtils";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Calendar,
  Monitor,
  Smartphone,
  TrendingUp,
  User,
  Package,
} from "lucide-react";
import { Skeleton } from "../ui/skeleton";

interface CustomerBehaviorTimelineProps {
  userId: Id<"storeFrontUser"> | Id<"guest">;
}

type TimeRange = "24h" | "7d" | "30d" | "all";

export function CustomerBehaviorTimeline({
  userId,
}: CustomerBehaviorTimelineProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [groupByDay, setGroupByDay] = useState(true);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Fetch timeline data
  const timeline = useQuery(
    api.storeFront.customerBehaviorTimeline.getCustomerBehaviorTimeline,
    {
      userId,
      timeRange,
      limit: 100,
    }
  );

  // Fetch summary statistics
  const summary = useQuery(
    api.storeFront.customerBehaviorTimeline.getCustomerBehaviorSummary,
    {
      userId,
      timeRange,
    }
  );

  if (!timeline || !summary) {
    return <TimelineSkeleton />;
  }

  // Enrich timeline events with display information
  const enrichedEvents = enrichTimelineEvents(timeline as TimelineEvent[]);

  // Calculate category breakdown
  const categoryBreakdown = enrichedEvents.reduce(
    (acc, event) => {
      acc[event.category] = (acc[event.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Customer Activity Timeline
          </h2>
          <p className="text-sm text-gray-500">
            {getTimeRangeLabel(timeRange)}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Select
            value={timeRange}
            onValueChange={(value) => setTimeRange(value as TimeRange)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={groupByDay ? "default" : "outline"}
            size="sm"
            onClick={() => setGroupByDay(!groupByDay)}
            className="flex items-center space-x-1"
          >
            <Calendar className="w-4 h-4" />
            <span>Group by day</span>
          </Button>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col h-full">
              <p className="text-xs text-muted-foreground mb-4">
                Total Activities
              </p>
              <p className="text-2xl font-bold">{summary.totalActions}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col h-full">
              <p className="text-xs text-muted-foreground mb-4">
                Products Viewed
              </p>
              <p className="text-2xl font-bold">{summary.uniqueProducts}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col h-full">
              <p className="text-xs text-muted-foreground mb-4">Device Usage</p>
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2">
                  <Monitor className="w-4 h-4 text-muted-foreground" />
                  <p className="text-2xl font-bold">
                    {summary.deviceBreakdown.desktop}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Smartphone className="w-4 h-4 text-muted-foreground" />
                  <p className="text-2xl font-bold">
                    {summary.deviceBreakdown.mobile}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity Categories */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(categoryBreakdown).map(([category, count]) => (
              <Badge key={category} variant="secondary" className="capitalize">
                {category}: {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setSortDirection(sortDirection === "desc" ? "asc" : "desc")
          }
          className="flex items-center space-x-1"
        >
          {sortDirection === "desc" ? (
            <ArrowDown className="w-4 h-4" />
          ) : (
            <ArrowUp className="w-4 h-4" />
          )}
          <span>{sortDirection === "desc" ? "Newest" : "Oldest"}</span>
        </Button>
      </div>

      {/* Timeline */}
      {enrichedEvents.length > 0 ? (
        <TimelineEventList
          events={enrichedEvents}
          groupByDay={groupByDay}
          sortDirection={sortDirection}
        />
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No activity found
            </h3>
            <p className="text-gray-500">
              No customer activity recorded for the selected time period.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Loading skeleton component
function TimelineSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex justify-between items-center">
        <div>
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex space-x-3">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Statistics skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Skeleton className="w-4 h-4" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-16" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Activity breakdown skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-20" />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Timeline skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-start space-x-4">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
