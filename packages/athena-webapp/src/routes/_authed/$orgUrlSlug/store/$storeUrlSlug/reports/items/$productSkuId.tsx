import { createFileRoute } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback, useState } from "react";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import {
  ReportsSkuDetailView,
  type ReportItemDetail,
} from "@/components/reports/ReportsSkuDetailView";
import type { ReportEvidenceRow } from "@/components/reports/ReportsSkuEvidenceList";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

const evidenceApi = (
  api as unknown as {
    reporting: { evidence: { listSkuEvidence: FunctionReference<"action"> } };
  }
).reporting.evidence;
const reportingApi = (
  api as unknown as {
    reporting: { public: { getReportItemDetail: FunctionReference<"query"> } };
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
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
)({ component: ReportsItemDetailRoute });

function ReportsItemDetailRoute() {
  const { productSkuId } = Route.useParams();
  const search = Route.useSearch();
  const { activeStore } = useGetActiveStore();
  const listEvidence = useAction(evidenceApi.listSkuEvidence);
  const [evidence, setEvidence] = useState<
    { isDone: boolean; page: ReportEvidenceRow[] } | null | undefined
  >();
  const isCustom = search.preset === "custom";
  const presetDetail = useQuery(
    reportingApi.getReportItemDetail,
    activeStore?._id && !isCustom
      ? {
          periodKey: search.preset ?? "wtd",
          productSkuId: productSkuId as Id<"productSku">,
          storeId: activeStore._id,
        }
      : "skip",
  ) as { data: ReportItemDetail | null; status: string } | undefined;
  const customDetail = useQuery(
    customReportingApi.getReportsCustomRangePresentation,
    activeStore?._id && isCustom && search.runId
      ? {
          paginationOpts: { cursor: null, numItems: 1 },
          productSkuId: productSkuId as Id<"productSku">,
          runId: search.runId,
          storeId: activeStore._id,
          surface: "item_detail",
        }
      : "skip",
  ) as
    | {
        data: {
          inventoryLimitingReason?: string | null;
          period?: { endOperatingDate: string; startOperatingDate: string };
          periodEnd?: number;
          periodStart?: number;
        } | null;
        page: Array<{
          identity?: ReportItemDetail["identity"];
          currencyCode?: string | null;
          currencyMinorUnitScale?: number | null;
          inventory?: ReportItemDetail["inventory"];
          metrics: Record<string, number | null>;
          trust: ReportItemDetail["trust"];
        }>;
        status: string;
      }
    | undefined;
  const detailResult:
    { data: ReportItemDetail | null; status: string } | undefined = isCustom
    ? customDetail && {
        data: customDetail.page[0]
          ? {
              identity: customDetail.page[0].identity,
              inventory: customDetail.page[0].inventory,
              inventoryLimitingReason:
                customDetail.data?.inventoryLimitingReason,
              periodSummary: {
                metrics: {
                  ...customDetail.page[0].metrics,
                  knownGrossProfitMinor:
                    customDetail.page[0].metrics.knownGrossProfitMinor ??
                    customDetail.page[0].metrics.known_gross_profit ??
                    null,
                  netRevenueMinor:
                    customDetail.page[0].metrics.netRevenueMinor ??
                    customDetail.page[0].metrics.net_sales ??
                    null,
                  netSoldUnits:
                    customDetail.page[0].metrics.netSoldUnits ??
                    customDetail.page[0].metrics.units_sold ??
                    null,
                },
                revenueCurrencyCode: customDetail.page[0].currencyCode,
                revenueCurrencyMinorUnitScale:
                  customDetail.page[0].currencyMinorUnitScale,
              },
              period: customDetail.data?.period,
              periodEnd: customDetail.data?.periodEnd,
              periodStart: customDetail.data?.periodStart,
              status: customDetail.status,
              trust: customDetail.page[0].trust,
            }
          : null,
        status: customDetail.status,
      }
    : presetDetail;
  const loadEvidence = useCallback(() => {
    if (!activeStore?._id) return;
    setEvidence(undefined);
    void listEvidence({
      paginationOpts: { cursor: null, numItems: 50 },
      ...(detailResult?.data?.periodStart === undefined ||
      detailResult?.data?.periodEnd === undefined
        ? {}
        : {
            periodEnd: detailResult.data.periodEnd,
            periodStart: detailResult.data.periodStart,
          }),
      productSkuId: productSkuId as Id<"productSku">,
      storeId: activeStore._id,
    })
      .then((result) =>
        setEvidence(result as { isDone: boolean; page: ReportEvidenceRow[] }),
      )
      .catch(() => setEvidence(null));
  }, [
    activeStore?._id,
    detailResult?.data?.periodEnd,
    detailResult?.data?.periodStart,
    listEvidence,
    productSkuId,
  ]);
  const detail =
    detailResult === undefined
      ? undefined
      : detailResult.data
        ? { ...detailResult.data, status: detailResult.status }
        : ({ status: detailResult.status } as ReportItemDetail);
  return (
    <ReportsSkuDetailView
      detail={detail}
      evidence={evidence}
      loadEvidence={loadEvidence}
      productSkuId={productSkuId}
    />
  );
}
