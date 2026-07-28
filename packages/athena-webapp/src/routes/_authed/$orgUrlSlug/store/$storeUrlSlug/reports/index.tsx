import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ReportCustomRangePanel } from "@/components/reports/ReportCustomRangePanel";
import { ReportDaysPanel } from "@/components/reports/ReportDaysPanel";
import { ReportsOverviewView } from "@/components/reports/ReportsOverviewView";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportsOverviewSearchSchema = z.object({
  daysStart: dateSchema.optional(),
  daysEnd: dateSchema.optional(),
  rangeStart: dateSchema.optional(),
  rangeEnd: dateSchema.optional(),
  requestKey: z.string().min(1).optional(),
});

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/",
)({
  component: ReportsOverviewRoute,
  validateSearch: reportsOverviewSearchSchema,
});

function ReportsOverviewRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const daysEnd = search.daysEnd ?? isoDateOffset(0);
  const daysStart = search.daysStart ?? isoDateOffset(-13);
  const rangeEnd = search.rangeEnd ?? isoDateOffset(0);
  const rangeStart = search.rangeStart ?? isoDateOffset(-29);

  return (
    <div className="space-y-layout-lg">
      <ReportsOverviewView />
      <ReportDaysPanel
        endDate={daysEnd}
        onRangeChange={(next) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              daysStart: next.startDate,
              daysEnd: next.endDate,
            }),
          })
        }
        startDate={daysStart}
      />
      <ReportCustomRangePanel
        endDate={rangeEnd}
        onEndDateChange={(value) =>
          void navigate({
            replace: true,
            search: (current) => ({ ...current, rangeEnd: value, requestKey: undefined }),
          })
        }
        onRequestKeyChange={(requestKey) =>
          void navigate({
            replace: true,
            search: (current) => ({ ...current, requestKey }),
          })
        }
        onStartDateChange={(value) =>
          void navigate({
            replace: true,
            search: (current) => ({ ...current, rangeStart: value, requestKey: undefined }),
          })
        }
        requestKey={search.requestKey}
        startDate={rangeStart}
      />
    </div>
  );
}
