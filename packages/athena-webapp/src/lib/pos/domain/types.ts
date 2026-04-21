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
  | Id<"expenseSessionItem">
  | Id<"expenseTransactionItem">;

export interface PosCartLineInput {
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
  areProcessingFeesAbsorbed?: boolean;
}

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
