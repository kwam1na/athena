import { AlertTriangle, Circle, PackageSearch } from "lucide-react";

import { capitalizeWords, cn, getRelativeTime } from "~/src/lib/utils";
import { Badge } from "../ui/badge";

export type SkuActivitySourceType =
  | "checkout"
  | "exchange"
  | "inventory_movement"
  | "pos_session"
  | "receiving"
  | "repair"
  | "return"
  | "sale"
  | "service_usage"
  | "stock_adjustment"
  | (string & {});

export type SkuActivityReservationStatus =
  | "active"
  | "consumed"
  | "expired"
  | "released"
  | (string & {});

export type SkuActivityDiagnosticSeverity =
  | "info"
  | "warning"
  | "error";

export type SkuActivityStockSummary = {
  checkoutReservedQuantity?: number;
  durableQuantityAvailable?: number;
  inventoryCount: number;
  posReservedQuantity?: number;
  quantityAvailable: number;
  reservedQuantity?: number;
};

export type SkuActivitySkuSummary = {
  barcode?: string | null;
  displayName: string;
  productSkuId: string;
  sku?: string | null;
};

export type SkuActivityReservationRow = {
  id: string;
  quantity: number;
  sourceHref?: string;
  sourceLabel: string;
  sourceType: SkuActivitySourceType;
  status: SkuActivityReservationStatus;
};

export type SkuActivityTimelineRow = {
  activityType: string;
  id: string;
  occurredAt: number;
  quantity?: number;
  sourceHref?: string;
  sourceLabel?: string | null;
  sourceType: SkuActivitySourceType;
  status: string;
};

export type SkuActivityDiagnostic = {
  id: string;
  kind: string;
  message: string;
  severity: SkuActivityDiagnosticSeverity;
};

export type SkuActivityTimelineViewModel = {
  activeReservations: SkuActivityReservationRow[];
  activityRows: SkuActivityTimelineRow[];
  diagnostics: SkuActivityDiagnostic[];
  sku: SkuActivitySkuSummary;
  stock: SkuActivityStockSummary;
};

export type SkuActivityTimelineQueryResult =
  | SkuActivityTimelineViewModel
  | null
  | undefined;

type SkuActivityTimelineProps = {
  error?: unknown;
  isLoading?: boolean;
  viewModel: SkuActivityTimelineQueryResult;
};

const INVENTORY_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

function formatInventoryNumber(value: number) {
  return INVENTORY_NUMBER_FORMATTER.format(value).toLowerCase();
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatQuantity(value: number) {
  return `${formatInventoryNumber(value)} ${pluralize(value, "unit")}`;
}

function formatBackendLabel(value: string) {
  return capitalizeWords(value.replaceAll("_", " ").replaceAll("-", " "));
}

function getReservationTitle(sourceType: SkuActivitySourceType) {
  switch (sourceType) {
    case "checkout":
      return "Reserved by checkout";
    case "pos_session":
      return "Reserved by POS session";
    default:
      return "Reserved";
  }
}

function getActivityTitle(row: SkuActivityTimelineRow) {
  const status = row.status.toLowerCase();
  const activityType = row.activityType.toLowerCase();

  if (status === "consumed" || activityType.includes("sale")) {
    return "Consumed by sale";
  }

  if (status === "released" || activityType.includes("release")) {
    return "Released";
  }

  if (status === "expired" || activityType.includes("expire")) {
    return "Expired";
  }

  if (row.sourceType === "checkout" && activityType.includes("reserv")) {
    return "Reserved by checkout";
  }

  if (row.sourceType === "pos_session" && activityType.includes("reserv")) {
    return "Reserved by POS session";
  }

  if (row.sourceType === "receiving") {
    return "Received";
  }

  if (row.sourceType === "stock_adjustment") {
    return "Adjusted";
  }

  if (row.sourceType === "return") {
    return "Returned";
  }

  if (row.sourceType === "exchange") {
    return "Exchanged";
  }

  if (row.sourceType === "service_usage") {
    return "Used by service";
  }

  if (row.sourceType === "repair") {
    return "Repair activity";
  }

  return formatBackendLabel(row.activityType);
}

function getDiagnosticTitle(diagnostic: SkuActivityDiagnostic) {
  if (diagnostic.kind === "unexplained_availability_gap") {
    return "Unexplained availability gap";
  }

  return diagnostic.severity === "warning"
    ? "Stock warning"
    : "Stock diagnostic";
}

function getDiagnosticTone(severity: SkuActivityDiagnosticSeverity) {
  switch (severity) {
    case "error":
      return "border-danger/30 bg-danger/10";
    case "warning":
      return "border-warning/30 bg-warning/10";
    default:
      return "border-border bg-muted/30";
  }
}

function getStatusTone(status: string) {
  switch (status.toLowerCase()) {
    case "active":
      return "border-warning/30 bg-warning/10 text-foreground";
    case "consumed":
    case "released":
      return "border-success/30 bg-success/10 text-foreground";
    case "expired":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function StockMetric({
  helper,
  label,
  value,
}: {
  helper?: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
        {formatInventoryNumber(value)}
      </p>
      {helper ? (
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

function InlineState({
  description,
  title,
}: {
  description?: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
      <div className="flex items-start gap-layout-sm">
        <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function maybeLinkedLabel(row: {
  sourceHref?: string;
  sourceLabel?: string | null;
}) {
  if (!row.sourceLabel) {
    return null;
  }

  if (!row.sourceHref) {
    return row.sourceLabel;
  }

  return (
    <a className="underline-offset-4 hover:underline" href={row.sourceHref}>
      {row.sourceLabel}
    </a>
  );
}

export function SkuActivityTimeline({
  error,
  isLoading = false,
  viewModel,
}: SkuActivityTimelineProps) {
  if (isLoading || viewModel === undefined) {
    return (
      <InlineState
        title="Loading SKU activity."
        description="Current stock and reservation evidence will appear here."
      />
    );
  }

  if (error) {
    return (
      <InlineState
        title="SKU activity unavailable."
        description="Refresh the SKU or try again from the inventory view."
      />
    );
  }

  if (!viewModel) {
    return (
      <InlineState
        title="No SKU selected."
        description="Select a SKU to inspect stock activity and reservations."
      />
    );
  }

  const orderedActivityRows = [...viewModel.activityRows].sort(
    (left, right) => left.occurredAt - right.occurredAt,
  );
  const stock = viewModel.stock;
  const reservedQuantity =
    stock.reservedQuantity ??
    Math.max(0, stock.inventoryCount - stock.quantityAvailable);

  return (
    <section className="space-y-layout-lg rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
      <div className="flex flex-col gap-layout-sm border-b border-border pb-layout-md">
        <div className="flex flex-wrap items-end gap-layout-xs">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              SKU activity
            </p>
            <h2 className="mt-1 line-clamp-2 text-base font-medium text-foreground">
              {capitalizeWords(viewModel.sku.displayName)}
            </h2>
          </div>
        </div>
        {viewModel.sku.barcode ? (
          <p className="text-xs text-muted-foreground">
            Barcode {viewModel.sku.barcode}
          </p>
        ) : null}
      </div>

      <div className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-3">
        <StockMetric label="On hand" value={stock.inventoryCount} />
        <StockMetric label="Available" value={stock.quantityAvailable} />
        <StockMetric label="Reserved" value={reservedQuantity} />
        {stock.durableQuantityAvailable !== undefined ? (
          <StockMetric
            helper="Before active reservation overlays."
            label="Durable available"
            value={stock.durableQuantityAvailable}
          />
        ) : null}
        {stock.posReservedQuantity ? (
          <StockMetric label="POS" value={stock.posReservedQuantity} />
        ) : null}
        {stock.checkoutReservedQuantity ? (
          <StockMetric
            label="Checkout"
            value={stock.checkoutReservedQuantity}
          />
        ) : null}
      </div>

      {viewModel.diagnostics.length > 0 ? (
        <div className="space-y-layout-sm">
          {viewModel.diagnostics.map((diagnostic) => (
            <div
              className={cn(
                "rounded-md border px-layout-md py-layout-sm",
                getDiagnosticTone(diagnostic.severity),
              )}
              key={diagnostic.id}
            >
              <div className="flex items-start gap-layout-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {getDiagnosticTitle(diagnostic)}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {diagnostic.message}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-layout-sm">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Active reservations
        </p>
        {viewModel.activeReservations.length > 0 ? (
          <ul aria-label="Active reservations" className="space-y-layout-sm">
            {viewModel.activeReservations.map((reservation) => (
              <li
                className="rounded-md border border-border bg-background px-layout-md py-layout-sm"
                key={reservation.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-layout-sm">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {getReservationTitle(reservation.sourceType)}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {maybeLinkedLabel(reservation)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-layout-xs">
                    <Badge
                      className={getStatusTone(reservation.status)}
                      variant="outline"
                    >
                      {formatBackendLabel(reservation.status)}
                    </Badge>
                    <span className="text-sm font-medium tabular-nums text-foreground">
                      {formatQuantity(reservation.quantity)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-border bg-muted/30 px-layout-md py-layout-sm text-sm leading-6 text-muted-foreground">
            No active reservations are linked to this SKU.
          </p>
        )}
      </div>

      <div className="space-y-layout-sm">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Timeline
        </p>
        {orderedActivityRows.length > 0 ? (
          <ol aria-label="SKU activity timeline" className="space-y-layout-md">
            {orderedActivityRows.map((row) => (
              <li className="flex items-start gap-layout-sm" key={row.id}>
                <Circle className="mt-2 h-2 w-2 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 border-b border-border pb-layout-md last:border-b-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-layout-sm">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {getActivityTitle(row)}
                      </p>
                      {row.sourceLabel ? (
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {maybeLinkedLabel(row)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-layout-xs">
                      {row.quantity !== undefined ? (
                        <span className="text-sm font-medium tabular-nums text-foreground">
                          {formatQuantity(row.quantity)}
                        </span>
                      ) : null}
                      <Badge
                        className={getStatusTone(row.status)}
                        variant="outline"
                      >
                        {formatBackendLabel(row.status)}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getRelativeTime(row.occurredAt)} ·{" "}
                    {formatBackendLabel(row.sourceType)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-md border border-border bg-muted/30 px-layout-md py-layout-sm text-sm leading-6 text-muted-foreground">
            No SKU activity recorded.
          </p>
        )}
      </div>
    </section>
  );
}
