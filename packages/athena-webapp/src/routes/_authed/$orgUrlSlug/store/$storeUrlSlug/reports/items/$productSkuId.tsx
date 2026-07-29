import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ReportsSkuDetailView } from "@/components/reports/ReportsSkuDetailView";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportsSkuDetailSearchSchema = z.object({
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

  const endDate = search.endDate ?? isoDateOffset(0);
  const startDate = search.startDate ?? isoDateOffset(-29);

  return (
    <ReportsSkuDetailView
      endDate={endDate}
      onRangeChange={(next) =>
        void navigate({
          replace: true,
          search: (current) => ({
            ...current,
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
