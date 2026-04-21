import type { PosPaymentMethod, PosRegisterPhase } from "@/lib/pos/domain";
import type { Id } from "~/convex/_generated/dataModel";

export interface PosTerminalDto {
  _id: string;
  displayName: string;
  status?: string;
  registeredAt?: number;
}

export interface PosRegisteredTerminalDto {
  _id: Id<"posTerminal">;
  displayName: string;
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

export interface PosRegisterSessionDto {
  _id: string;
  sessionNumber: string;
  status?: string;
  terminalId?: string;
  cashierId?: string;
  registerNumber?: string;
  expiresAt?: number;
  updatedAt?: number;
  heldAt?: number;
}

export interface PosRegisterStateDto {
  phase: PosRegisterPhase;
  terminal: PosTerminalDto | null;
  cashier: PosCashierDto | null;
  activeSession: PosRegisterSessionDto | null;
  resumableSession: PosRegisterSessionDto | null;
}

export interface PosRegisterBootstrapDto {
  phase: PosRegisterPhase;
  canStartSession: boolean;
  canResumeSession: boolean;
  terminal: PosTerminalDto | null;
  cashier: PosCashierDto | null;
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
  cashierId?: Id<"cashier"> | null;
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

export interface PosStartSessionInput {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  cashierId?: Id<"cashier">;
  registerNumber?: string;
}

export interface PosAddItemInput {
  sessionId: Id<"posSession">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  cashierId: Id<"cashier">;
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
  cashierId: Id<"cashier">;
  reason?: string;
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

export type PosCreateSessionResultDto =
  | {
      success: true;
      data: {
        sessionId: Id<"posSession">;
        expiresAt: number;
      };
    }
  | PosMutationFailureDto;

export type PosStartSessionResultDto = PosCreateSessionResultDto;

export type PosAddItemResultDto =
  | {
      success: true;
      data: {
        itemId: Id<"posSessionItem">;
        expiresAt: number;
      };
    }
  | PosMutationFailureDto;

export type PosHoldSessionResultDto =
  | {
      success: true;
      data: {
        sessionId: Id<"posSession">;
        expiresAt: number;
      };
    }
  | PosMutationFailureDto;

export type PosCompleteTransactionResultDto =
  | {
      success: true;
      data: {
        sessionId: Id<"posSession">;
        transactionNumber: string;
      };
    }
  | PosMutationFailureDto;
