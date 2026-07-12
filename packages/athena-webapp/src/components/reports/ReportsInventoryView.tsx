import { Button } from "@/components/ui/button";
import {
  InventoryExposureTable,
  type InventoryExposureRow,
} from "./InventoryExposureTable";
import { InventoryMovementSummary } from "./InventoryMovementSummary";
import { ReportStatusBand } from "./ReportStatusBand";
import { getReportStatusKind } from "./reportPresentation";

export type ReportInventoryResult = {
  continueCursor: string;
  isDone: boolean;
  completeness?: string | null;
  inventoryLimitingReason?: string | null;
  limitingReason?: string | null;
  movementSummary?: { metrics: Record<string, number | null> } | null;
  page: InventoryExposureRow[];
  status: string;
};

export function ReportsInventoryView({
  data,
  onLoadMore,
}: {
  data: ReportInventoryResult | undefined;
  onLoadMore?: () => void;
}) {
  if (!data)
    return (
      <p aria-live="polite" role="status">
        Loading inventory report…
      </p>
    );
  if (data.status === "pre_cutover")
    return <ReportStatusBand kind="pre_cutover" />;
  if (data.status === "materializing")
    return <ReportStatusBand kind="materializing" />;
  if (data.status === "failed" || data.status === "unavailable")
    return <ReportStatusBand kind="failed" />;
  const metrics = data.movementSummary?.metrics;
  const movement = metrics
    ? {
        receiptsQuantity: metrics.receiptsQuantity ?? null,
        salesQuantity: metrics.salesQuantity ?? null,
        returnsQuantity: metrics.returnsQuantity ?? null,
        consumedQuantity: metrics.consumedQuantity ?? null,
        adjustmentsQuantity: metrics.adjustmentsQuantity ?? null,
        commitmentQuantity: metrics.commitmentQuantity ?? null,
      }
    : null;
  return (
    <section className="space-y-layout-xl py-layout-lg">
      <ReportStatusBand kind={getReportStatusKind(data)} />
      <div>
        <h2 className="font-display text-2xl">Current inventory position</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Current stock and known value are shown as of the active inventory
          generation, separately from period movement.
        </p>
      </div>
      <InventoryMovementSummary movement={movement} />
      {data.page.length ? (
        <InventoryExposureTable rows={data.page} />
      ) : (
        <p className="rounded-lg border border-border p-layout-lg text-sm text-muted-foreground">
          No inventory exposure is available.
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
