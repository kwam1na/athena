import { Button } from "@/components/ui/button";
import { ReportStatusBand } from "./ReportStatusBand";
import { ReportsItemsTable, type ReportItemRow } from "./ReportsItemsTable";
import { getReportStatusKind } from "./reportPresentation";

export type ReportItemsSort =
  "revenue" | "margin" | "units" | "cover" | "inventory_value" | "attention";
export type ReportItemsClassification =
  | "all"
  | "fast_mover"
  | "slow_mover"
  | "nonmoving"
  | "low_cover"
  | "high_revenue_low_margin";
export type ReportItemsResult = {
  continueCursor: string;
  facets?: Array<{ value: string; count?: number }>;
  isDone: boolean;
  completeness?: string | null;
  limitingReason?: string | null;
  page: ReportItemRow[];
  rollups?: unknown[];
  status: string;
};

const SORTS: Array<{ label: string; value: ReportItemsSort }> = [
  { label: "Net sales", value: "revenue" },
  { label: "Margin", value: "margin" },
  { label: "Units", value: "units" },
  { label: "Cover", value: "cover" },
  { label: "Inventory value", value: "inventory_value" },
  { label: "Attention", value: "attention" },
];

export function ReportsItemsView({
  classification,
  controlsEnabled = true,
  data,
  onClassificationChange,
  onLoadMore,
  onOpenItem,
  onSortChange,
  sort,
}: {
  classification: ReportItemsClassification;
  controlsEnabled?: boolean;
  data: ReportItemsResult | undefined;
  onClassificationChange: (classification: ReportItemsClassification) => void;
  onLoadMore?: () => void;
  onOpenItem: (row: ReportItemRow) => void;
  onSortChange: (sort: ReportItemsSort) => void;
  sort: ReportItemsSort;
}) {
  if (!data)
    return (
      <p aria-live="polite" role="status">
        Loading item performance…
      </p>
    );
  if (data.status === "pre_cutover")
    return <ReportStatusBand kind="pre_cutover" />;
  if (data.status === "materializing")
    return <ReportStatusBand kind="materializing" />;
  if (data.status === "failed" || data.status === "unavailable")
    return <ReportStatusBand kind="failed" />;
  return (
    <section
      aria-labelledby="reports-items-heading"
      className="space-y-layout-lg py-layout-lg"
    >
      <ReportStatusBand kind={getReportStatusKind(data)} />
      <div>
        <h2 className="font-display text-2xl" id="reports-items-heading">
          Item performance
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          SKU-first performance for the selected reporting period.
        </p>
      </div>
      {controlsEnabled ? (
        <>
          <div
            aria-label="Filter item performance"
            className="flex flex-wrap gap-2"
          >
            <Button
              aria-pressed={classification === "all"}
              onClick={() => onClassificationChange("all")}
              size="sm"
              variant={classification === "all" ? "default" : "outline"}
            >
              All
            </Button>
            {data.facets?.map((facet) => (
              <Button
                aria-pressed={classification === facet.value}
                key={facet.value}
                onClick={() =>
                  onClassificationChange(
                    facet.value as ReportItemsClassification,
                  )
                }
                size="sm"
                variant={classification === facet.value ? "default" : "outline"}
              >
                {facet.value.replaceAll("_", " ")}
                {facet.count === undefined ? "" : ` (${facet.count})`}
              </Button>
            ))}
          </div>
          <div
            aria-label="Sort item performance"
            className="flex flex-wrap gap-2"
          >
            {SORTS.map((option) => (
              <Button
                aria-label={`Sort by ${option.label}, descending`}
                aria-pressed={sort === option.value}
                key={option.value}
                onClick={() => onSortChange(option.value)}
                size="sm"
                variant={sort === option.value ? "default" : "outline"}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Custom results use a stable server order.
        </p>
      )}
      {data.page.length ? (
        <ReportsItemsTable onOpenItem={onOpenItem} rows={data.page} />
      ) : (
        <p className="rounded-lg border border-border p-layout-lg text-sm text-muted-foreground">
          No item activity matches this view.
        </p>
      )}
      {!data.isDone && onLoadMore ? (
        <Button onClick={onLoadMore} variant="outline">
          Next 25 items
        </Button>
      ) : null}
    </section>
  );
}
