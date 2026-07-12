import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { z } from "zod";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import {
  ReportsItemsView,
  type ReportItemsClassification,
  type ReportItemsResult,
  type ReportItemsSort,
} from "@/components/reports/ReportsItemsView";
import { api } from "~/convex/_generated/api";

const itemsSearchSchema = z.object({
  classification: z
    .enum([
      "all",
      "fast_mover",
      "slow_mover",
      "nonmoving",
      "low_cover",
      "high_revenue_low_margin",
    ])
    .optional(),
  cursor: z.string().optional(),
  itemSort: z
    .enum([
      "revenue",
      "margin",
      "units",
      "cover",
      "inventory_value",
      "attention",
    ])
    .optional(),
  preset: z
    .enum(["wtd", "today", "prior_week", "trailing_30", "custom"])
    .optional(),
});
const reportingApi = (
  api as unknown as {
    reporting: { public: { listReportItems: FunctionReference<"query"> } };
  }
).reporting.public;
const customReportingApi = (
  api as unknown as {
    reporting: {
      public: { getReportsCustomRangePresentation: FunctionReference<"query"> };
    };
  }
).reporting.public;

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/",
)({ component: ReportsItemsRoute, validateSearch: itemsSearchSchema });

function ReportsItemsRoute() {
  const { activeStore } = useGetActiveStore();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const sort = (search.itemSort ?? "revenue") as ReportItemsSort;
  const classification = (search.classification ??
    "all") as ReportItemsClassification;
  const isCustom = search.preset === "custom";
  const presetData = useQuery(
    reportingApi.listReportItems,
    activeStore?._id && !isCustom
      ? {
          classification,
          paginationOpts: { cursor: search.cursor ?? null, numItems: 50 },
          periodKey: search.preset ?? "wtd",
          sort,
          storeId: activeStore._id,
        }
      : "skip",
  ) as ReportItemsResult | undefined;
  const customData = useQuery(
    customReportingApi.getReportsCustomRangePresentation,
    activeStore?._id && isCustom && search.runId
      ? {
          paginationOpts: { cursor: search.cursor ?? null, numItems: 50 },
          classification,
          runId: search.runId,
          sort,
          storeId: activeStore._id,
          surface: "items",
        }
      : "skip",
  ) as
    | {
        continueCursor: string;
        data?: {
          completeness?: string | null;
          limitingReason?: string | null;
          trust?: {
            completeness?: string | null;
            limitingReason?: string | null;
          };
        } | null;
        isDone: boolean;
        page: Array<{
          identity?: ReportItemsResult["page"][number]["identity"];
          classifications: string[];
          currencyCode?: string | null;
          currencyMinorUnitScale?: number | null;
          metrics: Record<string, number | null>;
          productSkuId: string;
          trust: { completeness: string };
        }>;
        status: string;
      }
    | undefined;
  const data: ReportItemsResult | undefined = isCustom
    ? customData && {
        ...customData,
        completeness:
          customData.data?.trust?.completeness ?? customData.data?.completeness,
        facets: [
          "fast_mover",
          "slow_mover",
          "nonmoving",
          "low_cover",
          "high_revenue_low_margin",
        ].map((value) => ({ value })),
        limitingReason:
          customData.data?.trust?.limitingReason ??
          customData.data?.limitingReason,
        page: customData.page.map((row) => ({
          ...row,
          attentionSort: 0,
          completeness: row.trust.completeness,
          coverSort: row.metrics.projectedDaysOfCover ?? 0,
          inventoryValueSort: row.metrics.knownInventoryValueMinor ?? 0,
          marginSort:
            row.metrics.knownGrossProfitMinor ??
            row.metrics.known_gross_profit ??
            0,
          metrics: {
            ...row.metrics,
            knownGrossProfitMinor:
              row.metrics.knownGrossProfitMinor ??
              row.metrics.known_gross_profit ??
              null,
            netRevenueMinor:
              row.metrics.netRevenueMinor ?? row.metrics.net_sales ?? null,
            netSoldUnits:
              row.metrics.netSoldUnits ?? row.metrics.units_sold ?? null,
          },
          revenueCurrencyCode: row.currencyCode ?? null,
          revenueCurrencyMinorUnitScale: row.currencyMinorUnitScale ?? null,
          revenueSort:
            row.metrics.netRevenueMinor ?? row.metrics.net_sales ?? 0,
          unitsSort: row.metrics.netSoldUnits ?? row.metrics.units_sold ?? 0,
        })),
      }
    : presetData;
  return (
    <ReportsItemsView
      classification={classification}
      controlsEnabled
      data={data}
      onClassificationChange={(nextClassification) => {
        void navigate({
          replace: true,
          search: (current) => ({
            ...current,
            classification:
              nextClassification === "all" ? undefined : nextClassification,
            cursor: undefined,
          }),
        });
      }}
      onLoadMore={
        data?.continueCursor
          ? () => {
              void navigate({
                search: (current) => ({
                  ...current,
                  cursor: data.continueCursor,
                }),
              });
            }
          : undefined
      }
      onOpenItem={(row) => {
        void navigate({
          to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
          params: (current) => ({ ...current, productSkuId: row.productSkuId }),
          search: true,
        });
      }}
      onSortChange={(itemSort) => {
        void navigate({
          replace: true,
          search: (current) => ({ ...current, cursor: undefined, itemSort }),
        });
      }}
      sort={sort}
    />
  );
}
