import { Link } from "@tanstack/react-router";

export type ReportEvidenceDestination = { kind: string; targetId?: string };
export type ReportEvidenceRow = {
  identityKey: string;
  evidenceKind: string;
  factType?: string;
  effectType?: string;
  occurrenceAt: number;
  recognitionAt: number;
  completeness: string;
  quantity?: number;
  recognizedNetAmountMinor?: number;
  destinations?: ReportEvidenceDestination[];
};

function destinationLink(destination: ReportEvidenceDestination | undefined) {
  if (!destination?.targetId) return null;
  switch (destination.kind) {
    case "transaction":
      return {
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
        params: { transactionId: destination.targetId },
        search: {},
      };
    case "online_order":
      return {
        to: "/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug",
        params: { orderSlug: destination.targetId },
        search: {},
      };
    case "product_edit":
      return {
        to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit",
        params: { productSlug: destination.targetId },
        search: {},
      };
    case "sku_activity":
      return {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/sku-activity",
        params: {},
        search: { productSkuId: destination.targetId },
      };
    default:
      return null;
  }
}

export function ReportsSkuEvidenceList({
  rows,
}: {
  rows: ReportEvidenceRow[];
}) {
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        No source evidence is available for this item and period.
      </p>
    );
  return (
    <ol className="space-y-3">
      {rows.map((row) => {
        const destination = destinationLink(
          row.destinations?.find((item) => item.kind !== "unavailable"),
        );
        return (
          <li
            className="rounded-lg border border-border bg-surface-raised p-layout-md"
            key={row.identityKey}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-medium capitalize">
                {(
                  row.factType ??
                  row.effectType ??
                  row.evidenceKind
                ).replaceAll("_", " ")}
              </p>
              <time
                className="text-xs text-muted-foreground"
                dateTime={new Date(row.recognitionAt).toISOString()}
              >
                {new Date(row.recognitionAt).toLocaleString()}
              </time>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {row.quantity === undefined
                ? "Quantity unavailable"
                : `${row.quantity} units`}{" "}
              · {row.completeness}
            </p>
            {destination ? (
              <Link
                className="mt-3 inline-flex text-sm font-medium underline-offset-4 hover:underline"
                params={(current: Record<string, string>) =>
                  ({ ...current, ...destination.params }) as never
                }
                search={destination.search as never}
                to={destination.to as never}
              >
                Open source detail
              </Link>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Detail unavailable
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
