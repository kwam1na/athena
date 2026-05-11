import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { ArrowDown, ArrowUp } from "lucide-react";
import { TimelineEventList } from "./TimelineEventCard";
import { getTimeRangeLabel } from "~/src/lib/timelineUtils";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  formatObservabilityLabel,
  type CustomerObservabilityTimelineData,
} from "~/src/lib/customerObservabilityTimeline";

interface CustomerBehaviorTimelineProps {
  userId: Id<"storeFrontUser"> | Id<"guest">;
}

type TimeRange = "24h" | "7d" | "30d" | "all";

export function CustomerBehaviorTimeline({
  userId,
}: CustomerBehaviorTimelineProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [groupByDay] = useState(true);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const timelineData = useQuery(
    api.storeFront.customerBehaviorTimeline.getCustomerObservabilityTimeline,
    {
      userId,
      timeRange,
      limit: 100,
    },
  );

  if (!timelineData) {
    return null;
  }

  const { summary, events } = timelineData as CustomerObservabilityTimelineData;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Customer Journey
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
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Latest state"
          value={
            summary.latestEvent
              ? `${formatObservabilityLabel(summary.latestEvent.journey)} / ${formatObservabilityLabel(summary.latestEvent.step)}`
              : "No journey events"
          }
          meta={
            summary.latestEvent
              ? formatObservabilityLabel(summary.latestEvent.status)
              : "Waiting for observability data"
          }
        />
        <SummaryCard
          label="Failure events"
          value={String(summary.failureCount)}
          meta="Failed and blocked steps"
        />
        <SummaryCard
          label="Correlated sessions"
          value={String(summary.uniqueSessions)}
          meta={`${summary.totalEvents} observability events`}
        />
      </div>

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
            <ArrowDown className="h-4 w-4" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
          <span>{sortDirection === "desc" ? "Newest" : "Oldest"}</span>
        </Button>
      </div>

      {events.length > 0 ? (
        <TimelineEventList
          events={events}
          groupByDay={groupByDay}
          sortDirection={sortDirection}
        />
      ) : (
        <p className="pt-8 text-center text-sm text-muted-foreground">
          No storefront observability events recorded for the selected time
          period.
        </p>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-2 text-base font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
      </CardContent>
    </Card>
  );
}
