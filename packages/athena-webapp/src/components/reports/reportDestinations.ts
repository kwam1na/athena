export type ReportDestination =
  | { kind: "reports_item"; productSkuId: string }
  | { kind: "sku_activity"; productSkuId: string }
  | { kind: "procurement"; sku?: string }
  | { kind: "transaction"; transactionId: string }
  | { kind: "product_edit"; productSlug: string }
  | { kind: "terminal_health" }
  | { kind: "unavailable"; reason?: string };

export function getReportDestinationPath(destination: ReportDestination) {
  switch (destination.kind) {
    case "reports_item":
      return `reports/items/${destination.productSkuId}`;
    case "sku_activity":
      return "operations/sku-activity";
    case "procurement":
      return "procurement";
    case "transaction":
      return `pos/transactions/${destination.transactionId}`;
    case "product_edit":
      return `products/${destination.productSlug}/edit`;
    case "terminal_health":
      return "pos/terminals";
    case "unavailable":
      return null;
  }
}
