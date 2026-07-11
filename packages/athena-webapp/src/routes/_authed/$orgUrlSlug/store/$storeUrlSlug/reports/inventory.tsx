import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { z } from "zod";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import {
  ReportsInventoryView,
  type ReportInventoryResult,
} from "@/components/reports/ReportsInventoryView";
import { api } from "~/convex/_generated/api";

const inventorySearchSchema = z.object({
  cursor: z.string().optional(),
  preset: z
    .enum(["wtd", "today", "prior_week", "trailing_30", "custom"])
    .optional(),
});
const reportingApi = (
  api as unknown as {
    reporting: { public: { listReportInventory: FunctionReference<"query"> } };
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
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/inventory",
)({ component: ReportsInventoryRoute, validateSearch: inventorySearchSchema });
function ReportsInventoryRoute() {
  const { activeStore } = useGetActiveStore();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isCustom = search.preset === "custom";
  const presetData = useQuery(
    reportingApi.listReportInventory,
    activeStore?._id && !isCustom
      ? {
          paginationOpts: { cursor: search.cursor ?? null, numItems: 50 },
          periodKey: search.preset ?? "wtd",
          storeId: activeStore._id,
        }
      : "skip",
  ) as ReportInventoryResult | undefined;
  const customData = useQuery(
    customReportingApi.getReportsCustomRangePresentation,
    activeStore?._id && isCustom && search.runId
      ? {
          paginationOpts: { cursor: search.cursor ?? null, numItems: 50 },
          runId: search.runId,
          storeId: activeStore._id,
          surface: "inventory",
        }
      : "skip",
  ) as
    | {
        continueCursor: string;
        data?: {
          completeness?: string | null;
          inventoryLimitingReason?: string | null;
          limitingReason?: string | null;
          movementSummary?: { metrics: Record<string, number | null> } | null;
          trust?: {
            completeness?: string | null;
            limitingReason?: string | null;
          };
        };
        isDone: boolean;
        page: Array<{
          identity?: ReportInventoryResult["page"][number]["identity"];
          inventory?: {
            asOf?: number;
            completeness?: string;
            metrics?: Record<string, number | null>;
            valuationCurrencyCode?: string | null;
            valuationCurrencyMinorUnitScale?: number | null;
          } | null;
          metrics: Record<string, number | null>;
          productSkuId: string;
          trust: { completeness: string };
        }>;
        status: string;
      }
    | undefined;
  const data: ReportInventoryResult | undefined = isCustom
    ? customData && {
        ...customData,
        completeness:
          customData.data?.trust?.completeness ?? customData.data?.completeness,
        inventoryLimitingReason: customData.data?.inventoryLimitingReason,
        limitingReason:
          customData.data?.trust?.limitingReason ??
          customData.data?.limitingReason,
        movementSummary: customData.data?.movementSummary
          ? {
              metrics: {
                adjustmentsQuantity:
                  customData.data.movementSummary.metrics.adjustmentsQuantity ??
                  customData.data.movementSummary.metrics
                    .inventory_adjustment_units ??
                  null,
                commitmentQuantity:
                  customData.data.movementSummary.metrics.commitmentQuantity ??
                  customData.data.movementSummary.metrics
                    .purchase_commitment_units ??
                  null,
                consumedQuantity:
                  customData.data.movementSummary.metrics.consumedQuantity ??
                  customData.data.movementSummary.metrics
                    .inventory_consumed_units ??
                  null,
                receiptsQuantity:
                  customData.data.movementSummary.metrics.receiptsQuantity ??
                  customData.data.movementSummary.metrics
                    .inventory_received_units ??
                  null,
                returnsQuantity:
                  customData.data.movementSummary.metrics.returnsQuantity ??
                  customData.data.movementSummary.metrics.units_returned ??
                  null,
                salesQuantity:
                  customData.data.movementSummary.metrics.salesQuantity ??
                  customData.data.movementSummary.metrics.units_sold ??
                  null,
              },
            }
          : null,
        page: customData.page.map((row) => ({
          asOf: row.inventory?.asOf ?? 0,
          completeness: row.trust.completeness,
          identity: row.identity,
          metrics: row.inventory?.metrics ?? {},
          movement: {
            adjustmentsQuantity: row.metrics.inventory_adjustment_units ?? null,
            commitmentQuantity: row.metrics.purchase_commitment_units ?? null,
            consumedQuantity: row.metrics.inventory_consumed_units ?? null,
            receiptsQuantity: row.metrics.units_received ?? null,
            returnsQuantity: row.metrics.units_returned ?? null,
            salesQuantity: row.metrics.units_sold ?? null,
          },
          productSkuId: row.productSkuId,
          valuationCurrencyCode: row.inventory?.valuationCurrencyCode ?? null,
          valuationCurrencyMinorUnitScale:
            row.inventory?.valuationCurrencyMinorUnitScale ?? null,
        })),
      }
    : presetData;
  return (
    <ReportsInventoryView
      data={data}
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
    />
  );
}
