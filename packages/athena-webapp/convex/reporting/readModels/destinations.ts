import type { ReportingDestination } from "../../../shared/reportingContract";

const sourceKinds = {
  pos_transaction: "transaction",
  storefront_order: "online_order",
  service_case: "service_case",
  payment_allocation: "payment_allocation",
  product: "product_edit",
  sku_activity: "sku_activity",
  procurement: "procurement",
  cash_controls: "cash_controls",
  terminal_health: "terminal_health",
} as const;

export function reportingDestination(input: {
  authorized?: boolean;
  sourceType: string;
  sourceId?: string;
}): ReportingDestination {
  if (input.authorized === false) return { kind: "unavailable" };
  const kind = sourceKinds[input.sourceType as keyof typeof sourceKinds];
  if (!kind) return { kind: "unavailable" };
  if (kind === "procurement") {
    return input.sourceId ? { kind, targetId: input.sourceId } : { kind };
  }
  if (kind === "cash_controls") {
    return input.sourceId ? { kind, targetId: input.sourceId } : { kind };
  }
  if (kind === "terminal_health") {
    return input.sourceId ? { kind, targetId: input.sourceId } : { kind };
  }
  if (!input.sourceId) return { kind: "unavailable" };
  switch (kind) {
    case "transaction": return { kind, targetId: input.sourceId };
    case "online_order": return { kind, targetId: input.sourceId };
    case "service_case": return { kind, targetId: input.sourceId };
    case "payment_allocation": return { kind, targetId: input.sourceId };
    case "product_edit": return { kind, targetId: input.sourceId };
    case "sku_activity": return { kind, targetId: input.sourceId };
  }
}
