import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ReportsSkuDetailView } from "@/components/reports/ReportsSkuDetailView";
import {
  dateRangeForItemsPeriod,
  REPORT_PERIOD_TYPES,
} from "@/components/reports/reportPeriodKeys";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportsSkuDetailSearchSchema = z.object({
  periodType: z.enum(REPORT_PERIOD_TYPES).optional(),
  periodDate: dateSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  page: z.coerce.number().int().positive().optional(),
  /**
   * Encoded origin path for `useNavigateBack`. Declared because
   * `validateSearch` strips unknown keys before the hook can read them.
   */
  o: z.string().optional(),
});

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveSkuDetailDateRange(
  search: z.infer<typeof reportsSkuDetailSearchSchema>,
): { startDate: string; endDate: string } {
  if (search.periodType && search.periodDate) {
    return dateRangeForItemsPeriod(search.periodType, search.periodDate);
  }

  return {
    endDate: search.endDate ?? isoDateOffset(0),
    startDate: search.startDate ?? isoDateOffset(-29),
  };
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
)({
  component: ReportsItemDetailRoute,
  validateSearch: reportsSkuDetailSearchSchema,
});

function ReportsItemDetailRoute() {
  const { productSkuId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const { endDate, startDate } = resolveSkuDetailDateRange(search);

  return (
    <ReportsSkuDetailView
      endDate={endDate}
      onRangeChange={(next) =>
        void navigate({
          replace: true,
          search: (current) => ({
            ...current,
            periodType: undefined,
            periodDate: undefined,
            startDate: next.startDate,
            endDate: next.endDate,
            page: undefined,
          }),
        })
      }
      onPageChange={(page) =>
        void navigate({
          replace: true,
          search: (current) => ({
            ...current,
            page: page === 1 ? undefined : page,
          }),
        })
      }
      page={search.page ?? 1}
      productSkuId={productSkuId}
      startDate={startDate}
    />
  );
}
