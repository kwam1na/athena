import type { Id } from "../../../../convex/_generated/dataModel";

export type PosRegisterPhase =
  | "requiresTerminal"
  | "requiresCashier"
  | "active"
  | "resumable"
  | "readyToStart";

export type PosCartLineId =
  | Id<"posSessionItem">
  | Id<"posTransactionItem">
  | Id<"posTransactionServiceLine">
  | Id<"expenseSessionItem">
  | Id<"expenseTransactionItem">
  | `service:${string}`;

export type PosCartLineKind = "product" | "service";

export type PosServiceMode =
  | "same_day"
  | "consultation"
  | "repair"
  | "revamp";

export type PosServiceLinePricingSource =
  | "catalog_base_price"
  | "pos_entered"
  | "service_case_quote"
  | "deposit_rule";

export interface PosProductCartLineInput {
  lineKind?: "product";
  id: PosCartLineId;
  name: string;
  barcode: string;
  sku?: string;
  price: number;
  quantity: number;
  image?: string | null;
  size?: string;
  length?: number | null;
  color?: string;
  productId?: Id<"product">;
  skuId?: Id<"productSku">;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  pendingCheckoutAliasState?: "linked_to_catalog";
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  areProcessingFeesAbsorbed?: boolean;
}

export interface PosServiceCartLineInput {
  lineKind: "service";
  id: PosCartLineId;
  name: string;
  displayName: string;
  serviceCatalogId: Id<"serviceCatalog">;
  serviceCaseId?: Id<"serviceCase">;
  serviceMode: PosServiceMode;
  pricingSource: PosServiceLinePricingSource;
  unitPrice: number;
  price: number;
  quantity: number;
  image?: string | null;
  size?: string;
  length?: number | null;
  color?: string;
  notes?: string | null;
  barcode?: never;
  sku?: never;
  productId?: never;
  skuId?: never;
  areProcessingFeesAbsorbed?: never;
}

export type PosCartLineInput =
  | PosProductCartLineInput
  | PosServiceCartLineInput;

export interface PosMoneyTotals {
  subtotal: number;
  tax: number;
  total: number;
}

export type PosPaymentMethod = "cash" | "card" | "mobile_money";

export interface PosPayment {
  id: string;
  method: PosPaymentMethod;
  amount: number;
  timestamp: number;
}

export interface PosPaymentState {
  payments: PosPayment[];
  totalPaid: number;
  remainingDue: number;
}

export interface PosRegisterPhaseInput {
  hasTerminal: boolean;
  hasCashier: boolean;
  activeSessionId: string | null;
  resumableSessionId: string | null;
}
