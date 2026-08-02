import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ReportsItemsView } from "@/components/reports/ReportsItemsView";
import {
  REPORT_PERIOD_TYPES,
  todayOperatingDateGuess,
} from "@/components/reports/reportPeriodKeys";
import type { ReportSkuSortBy } from "~/shared/reportsContract";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportsItemsSearchSchema = z.object({
  periodType: z.enum(REPORT_PERIOD_TYPES).optional(),
  periodDate: dateSchema.optional(),
  sortBy: z.enum(["revenue", "units"]).optional(),
  cursor: z.string().optional(),
  cursorTrail: z.array(z.string()).optional(),
  /**
   * Encoded origin path for the shared back-navigation hook. Declared here
   * because `validateSearch` strips keys it does not know, which would drop
   * the caller's origin before `useNavigateBack` ever sees it.
   */
  o: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/",
)({
  component: ReportsItemsRoute,
  validateSearch: reportsItemsSearchSchema,
});

function ReportsItemsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const periodDate = search.periodDate ?? todayOperatingDateGuess();
  const periodType = search.periodType ?? "day";
  return (
    <div className="space-y-layout-xl md:space-y-layout-2xl">
      <ReportsItemsView
        cursor={search.cursor}
        cursorTrail={search.cursorTrail ?? []}
        onCursorChange={(cursor, cursorTrail) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              cursor,
              cursorTrail: cursorTrail.length > 0 ? cursorTrail : undefined,
            }),
          })
        }
        onPeriodDateChange={(periodDate) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              periodDate,
              cursor: undefined,
              cursorTrail: undefined,
            }),
          })
        }
        onPeriodTypeChange={(periodType) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              periodType,
              cursor: undefined,
              cursorTrail: undefined,
            }),
          })
        }
        onSortByChange={(sortBy) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              sortBy,
              cursor: undefined,
              cursorTrail: undefined,
            }),
          })
        }
        periodDate={periodDate}
        periodType={periodType}
        sortBy={(search.sortBy ?? "revenue") as ReportSkuSortBy}
        variant="canvas"
      />
    </div>
  );
}
