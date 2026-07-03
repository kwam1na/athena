import type {
  PosPaymentMethod,
  PosRegisterPhase,
  PosServiceLinePricingSource,
  PosServiceMode,
} from "@/lib/pos/domain";
import type { Id } from "~/convex/_generated/dataModel";
import type { CommandResult } from "~/shared/commandResult";
import type { PosTerminalLoginMode } from "~/shared/posTerminalLoginMode";
import type { PosTerminalTransactionCapability } from "~/shared/posTerminalCapability";

type PosOperationalRole =
  | "manager"
  | "front_desk"
  | "stylist"
  | "technician"
  | "cashier";

export interface PosTerminalDto {
  _id: string;
  cloudTerminalId?: string;
  displayName: string;
  localTerminalId?: string;
  registerNumber?: string;
  loginMode?: PosTerminalLoginMode;
  transactionCapability?: PosTerminalTransactionCapability;
  status?: string;
  registeredAt?: number;
}

export interface PosRegisteredTerminalDto {
  _id: Id<"posTerminal">;
  cloudTerminalId?: string;
  displayName: string;
  localTerminalId?: string;
  registerNumber?: string;
  loginMode?: PosTerminalLoginMode;
  transactionCapability?: PosTerminalTransactionCapability;
  storeId?: Id<"store">;
  fingerprintHash?: string;
  syncSecretHash?: string;
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
  activeRoles?: PosOperationalRole[];
  username?: string;
  active?: boolean;
}

export interface PosCashDrawerDto {
  _id: Id<"registerSession">;
  status: "open" | "active" | "closing" | "closeout_rejected" | "closed";
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
  openingFloat: number;
  expectedCash: number;
  countedCash?: number;
  managerApprovalRequestId?: Id<"approvalRequest">;
  openedAt: number;
  notes?: string;
  variance?: number;
  workflowTraceId?: string;
  pendingVoidApprovals?: {
    cashAffectingCount: number;
    cashAdjustmentCount?: number;
    cashAdjustmentDelta?: number;
    cashAmount: number;
    count: number;
  } | null;
  localSyncStatus?: {
    status: "needs_review";
    reconciliationItems: Array<{
      createdAt?: number | null;
      countedCash?: number | null;
      expectedCash?: number | null;
      id?: string;
      localEventId?: string | null;
      sequence?: number | null;
      status?: string | null;
      summary?: string | null;
      type?: string | null;
      variance?: number | null;
    }>;
  } | null;
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

export interface PosActiveSessionConflictDto {
  kind: "activeOnOtherTerminal";
  message: string;
  terminalId?: string;
}

export interface PosRegisterStateDto {
  phase: PosRegisterPhase;
  terminal: PosTerminalDto | null;
  cashier: PosCashierDto | null;
  activeRegisterSession: PosCashDrawerDto | null;
  activeSession: PosRegisterSessionDto | null;
  activeSessionConflict: PosActiveSessionConflictDto | null;
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
  activeSessionConflict: PosActiveSessionConflictDto | null;
  resumableSession: PosRegisterSessionDto | null;
}

export interface PosCatalogItemDto {
  id: Id<"productSku"> | Id<"inventoryImportProvisionalSku">;
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
  availabilityPolicy?: PosRegisterCatalogAvailabilityPolicy;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  pendingCheckoutAliasState?: "linked_to_catalog";
}

export type PosRegisterCatalogAvailabilityPolicy =
  | "trusted_inventory"
  | "active_provisional_import"
  | "pending_checkout";

export interface PosRegisterCatalogRowDto {
  id: Id<"productSku"> | Id<"inventoryImportProvisionalSku">;
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  productId: Id<"product">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  name: string;
  sku: string;
  barcode: string;
  price: number;
  category: string;
  description: string;
  image: string | null;
  size: string;
  length: number | null;
  color: string;
  areProcessingFeesAbsorbed: boolean;
  availabilityPolicy?: PosRegisterCatalogAvailabilityPolicy;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  pendingCheckoutAliasState?: "linked_to_catalog";
  linkedPendingCheckoutItemIds?: Array<Id<"posPendingCheckoutItem">>;
  linkedPendingCheckoutLocalEventIds?: string[];
}

export interface PosRegisterCatalogInput {
  metadataRefreshKey?: string | number;
  refreshMetadataSnapshot?: boolean;
  storeId?: Id<"store">;
}

export type PosServiceCatalogPricingModel =
  | "fixed"
  | "starting_at"
  | "quote_after_consultation";

export type PosServiceCatalogDepositType = "none" | "flat" | "percentage";

export type PosServiceCatalogCheckoutReadiness =
  | {
      status: "ready";
      reason: "fixed_price";
      canCheckoutDirectly: true;
      message: string;
      suggestedAmount?: number;
      minimumAmount?: number;
    }
  | {
      status: "amount_required";
      reason: "starting_at_amount_required";
      canCheckoutDirectly: false;
      message: string;
      suggestedAmount?: number;
      minimumAmount?: number;
    }
  | {
      status: "case_or_amount_required";
      reason: "quote_after_consultation_requires_case_or_amount";
      canCheckoutDirectly: false;
      requiresExistingCaseOrAmount: true;
      message: string;
      suggestedAmount?: number;
      minimumAmount?: number;
    };

export interface PosServiceCatalogRowDto {
  serviceCatalogId: Id<"serviceCatalog">;
  name: string;
  description?: string;
  serviceMode: PosServiceMode;
  pricingModel: PosServiceCatalogPricingModel;
  basePrice?: number;
  depositType: PosServiceCatalogDepositType;
  depositValue?: number;
  requiresManagerApproval: boolean;
  status: "active";
  updatedAt: number;
  checkoutReadiness: PosServiceCatalogCheckoutReadiness;
}

export interface PosRegisterCatalogAvailabilityRowDto {
  availabilitySource?: "live" | "local";
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  inStock: boolean;
  quantityAvailable: number;
  availabilityPolicy?: PosRegisterCatalogAvailabilityPolicy;
}

export interface PosRegisterCatalogAvailabilityInput {
  refreshFullAvailabilitySnapshot?: boolean;
  storeId?: Id<"store">;
  productSkuIds?: Array<Id<"productSku">>;
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
  staffProfileId: Id<"staffProfile">;
  registerNumber?: string;
  openingFloat: number;
  notes?: string;
}

export type PosOpenDrawerResultDto = CommandResult<PosCashDrawerDto | null>;

export interface PosAddItemInput {
  sessionId: Id<"posSession">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
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
  id?: string;
  method: PosPaymentMethod | string;
  amount: number;
  timestamp: number;
}

export interface PosProductSaleLineDto {
  lineKind: "product";
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  productName: string;
  productSku: string;
  barcode?: string;
  image?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface PosServiceSaleLineDto {
  lineKind: "service";
  serviceCatalogId: Id<"serviceCatalog">;
  serviceCaseId?: Id<"serviceCase">;
  serviceMode: PosServiceMode;
  displayName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  pricingSource: PosServiceLinePricingSource;
  notes?: string | null;
}

export type PosSaleLineDto = PosProductSaleLineDto | PosServiceSaleLineDto;

export interface PosCompleteTransactionInput {
  sessionId: Id<"posSession">;
  staffProfileId: Id<"staffProfile">;
  payments: PosPaymentDto[];
  saleLines?: PosSaleLineDto[];
  notes?: string;
  subtotal: number;
  tax: number;
  total: number;
  customerProfileId?: Id<"customerProfile">;
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
  transactionId?: Id<"posTransaction">;
  transactionNumber: string;
}>;
