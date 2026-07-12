import { useQuery } from "convex/react";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import {
  ReportAttentionList,
  type ReportAttentionItem,
} from "./ReportAttentionList";
import { ReportStatusBand } from "./ReportStatusBand";
import { ReportsMetricGrid } from "./ReportsMetricGrid";
import { RevenueContribution } from "./RevenueContribution";
import { getReportStatusKind } from "./reportPresentation";

type OverviewData = {
  attention?: ReportAttentionItem[];
  completeness:
    "complete" | "partial" | "provisional" | "stale" | "unavailable";
  limitingReason?: string;
  metrics: Record<string, number | null | undefined>;
  currencyCode?: string | null;
  currencyMinorUnitScale?: number | null;
};

export function ReportsOverviewView({
  periodKey,
  runId,
}: {
  periodKey: "wtd" | "today" | "prior_week" | "trailing_30" | "custom";
  runId?: string;
}) {
  const { activeStore, isLoadingStores } = useGetActiveStore();
  const presetResult = useQuery(
    api.reporting.public.getReportsOverview,
    activeStore?._id && periodKey !== "custom"
      ? { periodKey, storeId: activeStore._id }
      : "skip",
  ) as { data?: OverviewData | null; status: string } | undefined;
  const customResult = useQuery(
    api.reporting.public.getReportsCustomRangePresentation,
    activeStore?._id && periodKey === "custom" && runId
      ? {
          paginationOpts: { cursor: null, numItems: 1 },
          runId: runId as never,
          storeId: activeStore._id,
          surface: "overview",
        }
      : "skip",
  ) as
    | {
        data?: {
          completeness: OverviewData["completeness"];
          currencyCode?: string | null;
          currencyMinorUnitScale?: number | null;
          limitingReason?: string | null;
          metrics: Record<string, number | null>;
          trust?: { completeness?: string; limitingReason?: string | null };
        } | null;
        status: string;
      }
    | undefined;
  const result =
    periodKey === "custom"
      ? customResult && {
          data: customResult.data
            ? {
                completeness: customResult.data.completeness,
                currencyCode: customResult.data.currencyCode,
                currencyMinorUnitScale:
                  customResult.data.currencyMinorUnitScale,
                limitingReason:
                  customResult.data.trust?.limitingReason ??
                  customResult.data.limitingReason ??
                  undefined,
                metrics: customResult.data.metrics,
              }
            : null,
          status: customResult.status,
        }
      : presetResult;

  if (isLoadingStores || (activeStore && result === undefined)) {
    return (
      <p
        aria-live="polite"
        className="py-layout-xl text-sm text-muted-foreground"
        role="status"
      >
        Loading report…
      </p>
    );
  }
  if (!activeStore) {
    return <ReportStatusBand kind="failed" />;
  }
  if (!result || !result.data) {
    return (
      <ReportStatusBand
        kind={getReportStatusKind({ status: result?.status ?? "unavailable" })}
      />
    );
  }

  const currency =
    result.data.currencyCode ??
    (activeStore as { currency?: string }).currency ??
    "USD";
  const minorUnitScale = result.data.currencyMinorUnitScale ?? 2;
  const withholdMoney = result.data.limitingReason === "mixed_currency";
  return (
    <div className="space-y-layout-lg py-layout-lg">
      <ReportStatusBand
        kind={getReportStatusKind({
          completeness: result.data.completeness,
          limitingReason: result.data.limitingReason,
          status: result.status,
        })}
      />
      <ReportsMetricGrid
        currency={currency}
        metrics={result.data.metrics}
        minorUnitScale={minorUnitScale}
        withholdMoney={withholdMoney}
      />
      <div className="grid grid-cols-1 gap-layout-md lg:grid-cols-2">
        <RevenueContribution
          currency={currency}
          metrics={result.data.metrics}
          minorUnitScale={minorUnitScale}
          withholdMoney={withholdMoney}
        />
        <ReportAttentionList items={result.data.attention ?? []} />
      </div>
    </div>
  );
}
