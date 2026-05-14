import type {
  SkuActivityDiagnostic,
  SkuActivityReservationRow,
  SkuActivitySourceType,
  SkuActivityTimelineRow,
  SkuActivityTimelineViewModel,
} from "./SkuActivityTimeline";

export type SkuActivityQueryResult = {
  activeReservations: {
    checkoutQuantity: number;
    entries: Array<{
      activityEventId?: string;
      quantity: number;
      sourceId: string;
      sourceLabel: string;
      sourceType: string;
      status: string;
    }>;
    posQuantity: number;
    totalQuantity: number;
  };
  productSku: {
    _id: string;
    productName?: string | null;
    sku?: string | null;
  };
  stock: {
    durableQuantityAvailable?: number;
    inventoryCount: number;
    quantityAvailable: number;
  };
  timeline: Array<{
    _id?: string;
    activityType: string;
    occurredAt: number;
    quantityDelta?: number;
    reservationQuantity?: number;
    sourceId: string;
    sourceLabel?: string | null;
    sourceType: string;
    status?: string;
    stockQuantityDelta?: number;
  }>;
  warnings: Array<{
    code: string;
    message: string;
  }>;
} | null;

function normalizeSourceType(sourceType: string): SkuActivitySourceType {
  return sourceType
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase() as SkuActivitySourceType;
}

function getTimelineQuantity(
  row: NonNullable<SkuActivityQueryResult>["timeline"][number],
) {
  if (row.reservationQuantity !== undefined) {
    return row.reservationQuantity;
  }

  if (row.stockQuantityDelta !== undefined) {
    return Math.abs(row.stockQuantityDelta);
  }

  if (row.quantityDelta !== undefined) {
    return Math.abs(row.quantityDelta);
  }

  return undefined;
}

export function buildSkuActivityTimelineViewModel(
  result: SkuActivityQueryResult,
): SkuActivityTimelineViewModel | null {
  if (!result) {
    return null;
  }

  const activeReservations: SkuActivityReservationRow[] =
    result.activeReservations.entries.map((reservation) => ({
      id:
        reservation.activityEventId ??
        `${reservation.sourceType}:${reservation.sourceId}`,
      quantity: reservation.quantity,
      sourceLabel: reservation.sourceLabel,
      sourceType: normalizeSourceType(reservation.sourceType),
      status: reservation.status,
    }));

  const activityRows: SkuActivityTimelineRow[] = result.timeline.map((row) => ({
    activityType: row.activityType,
    id: row._id ?? `${row.sourceType}:${row.sourceId}:${row.occurredAt}`,
    occurredAt: row.occurredAt,
    quantity: getTimelineQuantity(row),
    sourceLabel: row.sourceLabel,
    sourceType: normalizeSourceType(row.sourceType),
    status: row.status ?? "inferred",
  }));

  const diagnostics: SkuActivityDiagnostic[] = result.warnings.map((warning) => ({
    id: warning.code,
    kind: warning.code,
    message: warning.message,
    severity: "warning",
  }));

  return {
    activeReservations,
    activityRows,
    diagnostics,
    sku: {
      displayName:
        result.productSku.productName ??
        result.productSku.sku ??
        result.productSku._id,
      productSkuId: result.productSku._id,
      sku: result.productSku.sku,
    },
    stock: {
      checkoutReservedQuantity: result.activeReservations.checkoutQuantity,
      durableQuantityAvailable: result.stock.durableQuantityAvailable,
      inventoryCount: result.stock.inventoryCount,
      posReservedQuantity: result.activeReservations.posQuantity,
      quantityAvailable: result.stock.quantityAvailable,
      reservedQuantity: result.activeReservations.totalQuantity,
    },
  };
}
