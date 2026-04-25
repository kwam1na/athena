import type { PosPaymentMethod, PosRegisterPhase } from "@/lib/pos/domain";
import type { Id } from "~/convex/_generated/dataModel";
import type { CommandResult } from "~/shared/commandResult";

export interface PosTerminalDto {
  _id: string;
  displayName: string;
  registerNumber?: string;
  status?: string;
  registeredAt?: number;
}

export interface PosRegisteredTerminalDto {
  _id: Id<"posTerminal">;
  displayName: string;
  registerNumber?: string;
  storeId?: Id<"store">;
  fingerprintHash?: string;
  registeredByUserId?: Id<"athenaUser">;
  browserInfo?: {
    userAgent: string;
    platform?: string;
    language?: string;
    vendor?: string;
    screenResolution?: string;
    colorDepth?: number;
  };
  status?: string;
  registeredAt?: number;
}

export interface PosCashierDto {
  _id: string;
  firstName: string;
  lastName: string;
  username?: string;
  active?: boolean;
}

export interface PosCashDrawerDto {
  _id: Id<"registerSession">;
  status: "open" | "active" | "closing" | "closed";
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
  openingFloat: number;
  expectedCash: number;
  openedAt: number;
  notes?: string;
  workflowTraceId?: string;
}

export interface PosRegisterSessionDto {
  _id: string;
  sessionNumber: string;
  status?: string;
  terminalId?: string;
  staffProfileId?: string;
  registerNumber?: string;
  registerSessionId?: string;
  expiresAt?: number;
  updatedAt?: number;
  heldAt?: number;
  workflowTraceId?: string;
}

export interface PosRegisterStateDto {
  phase: PosRegisterPhase;
  terminal: PosTerminalDto | null;
  cashier: PosCashierDto | null;
  activeRegisterSession: PosCashDrawerDto | null;
  activeSession: PosRegisterSessionDto | null;
  resumableSession: PosRegisterSessionDto | null;
}

export interface PosRegisterBootstrapDto {
  phase: PosRegisterPhase;
  canStartSession: boolean;
  canResumeSession: boolean;
  terminal: PosTerminalDto | null;
  cashier: PosCashierDto | null;
  activeRegisterSession: PosCashDrawerDto | null;
  activeSession: PosRegisterSessionDto | null;
  resumableSession: PosRegisterSessionDto | null;
}

export interface PosCatalogItemDto {
  id: Id<"productSku">;
  name: string;
  sku: string;
  barcode: string;
  price: number;
  category: string;
  description: string;
  inStock: boolean;
  quantityAvailable: number;
  image: string | null;
  size: string;
  length: number | null;
  color: string;
  productId: Id<"product">;
  skuId: Id<"productSku">;
  areProcessingFeesAbsorbed: boolean;
}

export interface PosRegisterStateQueryInput {
  storeId?: Id<"store">;
  terminalId?: Id<"posTerminal"> | null;
  staffProfileId?: Id<"staffProfile"> | null;
  registerNumber?: string;
}

export interface PosTerminalLookupInput {
  storeId?: Id<"store">;
  fingerprintHash?: string | null;
}

export interface PosProductSearchInput {
  storeId?: Id<"store">;
  searchQuery: string;
}

export interface PosBarcodeLookupInput {
  storeId?: Id<"store">;
  barcode: string;
}

export interface PosProductIdLookupInput {
  storeId?: Id<"store">;
  productId: string;
}

export interface PosQuickAddCatalogItemInput {
  storeId: Id<"store">;
  createdByUserId: Id<"athenaUser">;
  name: string;
  lookupCode?: string;
  price: number;
  quantityAvailable: number;
}

export interface PosStartSessionInput {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  staffProfileId?: Id<"staffProfile">;
  registerNumber?: string;
  registerSessionId?: Id<"registerSession">;
}

export interface PosOpenDrawerInput {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  registerNumber?: string;
  openingFloat: number;
  notes?: string;
}

export type PosOpenDrawerResultDto = CommandResult<PosCashDrawerDto | null>;

export interface PosAddItemInput {
  sessionId: Id<"posSession">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  staffProfileId: Id<"staffProfile">;
  productSku: string;
  barcode?: string;
  productName: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  length?: number;
  color?: string;
  areProcessingFeesAbsorbed?: boolean;
}

export interface PosHoldSessionInput {
  sessionId: Id<"posSession">;
  staffProfileId: Id<"staffProfile">;
  reason?: string;
}

export interface PosBindSessionToRegisterSessionInput {
  sessionId: Id<"posSession">;
  staffProfileId: Id<"staffProfile">;
  registerSessionId: Id<"registerSession">;
}

export interface PosPaymentDto {
  method: PosPaymentMethod | string;
  amount: number;
  timestamp: number;
}

export interface PosCompleteTransactionInput {
  sessionId: Id<"posSession">;
  payments: PosPaymentDto[];
  notes?: string;
  subtotal: number;
  tax: number;
  total: number;
}

export type PosMutationFailureDto = {
  success: false;
  message: string;
};

export type PosCreateSessionResultDto = CommandResult<{
  sessionId: Id<"posSession">;
  expiresAt: number;
}>;

export type PosStartSessionResultDto = PosCreateSessionResultDto;

export type PosAddItemResultDto = CommandResult<{
  itemId: Id<"posSessionItem">;
  expiresAt: number;
}>;

export type PosHoldSessionResultDto = CommandResult<{
  sessionId: Id<"posSession">;
  expiresAt: number;
}>;

export type PosBindSessionToRegisterSessionResultDto = CommandResult<{
  sessionId: Id<"posSession">;
  expiresAt: number;
}>;

export type PosCompleteTransactionResultDto = CommandResult<{
  sessionId: Id<"posSession">;
  transactionNumber: string;
}>;
