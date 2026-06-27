import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";
import type { StaffAuthenticationResult } from "@/components/staff-auth/StaffAuthenticationDialog";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockStartSession = vi.fn();
const mockAddItem = vi.fn();
const mockHoldSession = vi.fn();
const mockCompleteTransaction = vi.fn();
const mockOpenDrawer = vi.fn();
const mockResumeSession = vi.fn();
const mockVoidSession = vi.fn();
const mockUpdateSession = vi.fn();
const mockSyncSessionCheckoutState = vi.fn();
const mockReleaseSessionInventoryHoldsAndDeleteItems = vi.fn();
const mockRemoveItem = vi.fn();
const mockBindSessionToRegisterSession = vi.fn();
const mockSubmitRegisterSessionCloseout = vi.fn();
const mockAuthenticateStaffCredentialForApproval = vi.fn();
const mockReopenRegisterSessionCloseout = vi.fn();
const mockCorrectRegisterSessionOpeningFloat = vi.fn();
const mockRegisterTerminal = vi.fn();
const mockNavigateBack = vi.fn();
const mockUsePosLocalSyncRuntimeStatus = vi.fn();
const mockUseConvexRegisterCatalogAvailability = vi.fn();
const mockReadStoredTerminalFingerprint = vi.fn();
const mockAppendLocalEvent = vi.fn();
const mockAttachStaffProofTokenToPendingEvents = vi.fn();
const mockListLocalEvents = vi.fn();
const mockReadProvisionedTerminalSeed = vi.fn();
const mockWriteProvisionedTerminalSeed = vi.fn();
const mockWriteProvisionedTerminalSeedAndClearTerminalIntegrity = vi.fn();
const mockGetStaffAuthorityReadiness = vi.fn();
const mockReadStoreDayReadiness = vi.fn();
const mockReadCashierPresence = vi.fn();
const mockClearCashierPresence = vi.fn();
const mockInvalidateCashierPresenceForTerminal = vi.fn();
const mockWriteCashierPresence = vi.fn();
const mockMarkLocalEventsSynced = vi.fn();
const mockWriteLocalCloudMapping = vi.fn();
const mockListLocalCloudMappings = vi.fn();
const mockReadDrawerAuthorityState = vi.fn();
const mockReadTerminalIntegrityState = vi.fn();
const mockWriteDrawerAuthorityState = vi.fn();
const mockUsePosTerminalAppSessionRecoveryRuntimeInput = vi.fn();

let mockActiveStore: {
  _id: Id<"store">;
  currency: string;
  organizationId: Id<"organization">;
} | null;
let mockTerminal:
  | {
      _id: Id<"posTerminal">;
      displayName: string;
      registerNumber?: string;
      transactionCapability?:
        | "products_and_services"
        | "products_only"
        | "services_only";
    }
  | null
  | undefined;
let mockRegisterState:
  | {
      phase: "requiresCashier" | "readyToStart" | "resumable" | "active";
      terminal: { _id: string; displayName: string } | null;
      cashier: {
        _id: string;
        firstName: string;
        lastName: string;
        activeRoles?: Array<
          "manager" | "front_desk" | "stylist" | "technician" | "cashier"
        >;
      } | null;
      activeRegisterSession: {
        _id: string;
        status: "open" | "active" | "closing" | "closeout_rejected" | "closed";
        terminalId?: string;
        registerNumber?: string;
        openingFloat: number;
        expectedCash: number;
        countedCash?: number;
        managerApprovalRequestId?: Id<"approvalRequest">;
        openedAt: number;
        notes?: string;
        variance?: number;
        workflowTraceId?: string;
        localSyncStatus?: {
          description?: string;
          label?: string;
          onRetrySync?: () => void;
          pendingEventCount?: number;
          reconciliationItems?: Array<{
            countedCash?: number | null;
            expectedCash?: number | null;
            localEventId?: string | null;
            summary?: string | null;
            type?: string | null;
            variance?: number | null;
          }>;
          status:
            | "synced"
            | "syncing"
            | "pending_sync"
            | "locally_closed_pending_sync"
            | "needs_review";
        };
      } | null;
      activeSession: { _id: string; sessionNumber: string } | null;
      activeSessionConflict?: {
        kind: "activeOnOtherTerminal";
        message: string;
        terminalId?: string;
      } | null;
      resumableSession: { _id: string; sessionNumber: string } | null;
    }
  | undefined;
let mockActiveSession:
  | {
      _id: Id<"posSession">;
      status: "active";
      expiresAt: number;
      sessionNumber: string;
      updatedAt: number;
      registerSessionId?: Id<"registerSession">;
      cartItems: Array<{
        id: Id<"posSessionItem">;
        name: string;
        barcode: string;
        price: number;
        quantity: number;
        productId: Id<"product">;
        skuId: Id<"productSku">;
        inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
      }>;
      payments?: Array<{
        method: "cash" | "card" | "mobile_money";
        amount: number;
        timestamp: number;
      }>;
      localSyncStatus?: {
        description?: string;
        label?: string;
        onRetrySync?: () => void;
        pendingEventCount?: number;
        reconciliationItems?: Array<{
          summary?: string;
          type?: string;
        }>;
        status:
          | "synced"
          | "syncing"
          | "pending_sync"
          | "locally_closed_pending_sync"
          | "needs_review";
      };
      customer: {
        _id: Id<"posCustomer">;
        name: string;
        email?: string;
        phone?: string;
        customerProfileId?: Id<"customerProfile">;
      } | null;
    }
  | null
  | undefined;
let mockHeldSessions:
  | Array<{
      _id: Id<"posSession">;
      expiresAt: number;
      sessionNumber: string;
      updatedAt: number;
      cartItems: [];
      customer: null;
    }>
  | undefined;
let mockBarcodeSearchResult: null;
let mockProductIdSearchResults: [] | null;
let mockCashier: { firstName: string; lastName: string } | null;
let mockUser: { _id: Id<"athenaUser"> } | null;
let mockRegisterCatalogRows: Array<{
  id: Id<"productSku">;
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  productId: Id<"product">;
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
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  availabilityPolicy?:
    | "trusted_inventory"
    | "active_provisional_import"
    | "pending_checkout";
}>;
let mockRegisterServiceCatalogRows: Array<{
  serviceCatalogId: Id<"serviceCatalog">;
  name: string;
  description?: string;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
  basePrice?: number;
  status: "active";
}>;
let mockRegisterCatalogAvailabilityRows: Array<{
  availabilitySource?: "live" | "local";
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  inStock: boolean;
  quantityAvailable: number;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  availabilityPolicy?:
    | "trusted_inventory"
    | "active_provisional_import"
    | "pending_checkout";
}>;

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "wigclub",
  }),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: mockActiveStore,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: () => mockTerminal,
}));

vi.mock("@/lib/pos/infrastructure/terminal/fingerprint", () => ({
  readStoredTerminalFingerprint: () => mockReadStoredTerminalFingerprint(),
}));

vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => mockNavigateBack,
}));

vi.mock("@/hooks/usePOSProducts", () => ({
  usePOSBarcodeSearch: () => mockBarcodeSearchResult,
  usePOSProductIdSearch: () => mockProductIdSearchResults,
}));

vi.mock("@/lib/pos/infrastructure/convex/catalogGateway", () => ({
  useConvexRegisterCatalog: () => mockRegisterCatalogRows,
  useConvexRegisterServiceCatalog: () => mockRegisterServiceCatalogRows,
  useConvexRegisterCatalogAvailability: (...args: unknown[]) =>
    mockUseConvexRegisterCatalogAvailability(...args),
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: (value: string) => value,
}));

vi.mock("@/lib/pos/infrastructure/convex/registerGateway", () => ({
  useConvexRegisterState: () => mockRegisterState,
}));

vi.mock("@/lib/pos/infrastructure/convex/sessionGateway", () => ({
  useConvexActiveSession: () => mockActiveSession,
  useConvexHeldSessions: () => mockHeldSessions,
  useConvexSessionActions: () => ({
    resumeSession: mockResumeSession,
    voidSession: mockVoidSession,
    updateSession: mockUpdateSession,
    syncSessionCheckoutState: mockSyncSessionCheckoutState,
    releaseSessionInventoryHoldsAndDeleteItems:
      mockReleaseSessionInventoryHoldsAndDeleteItems,
    removeItem: mockRemoveItem,
    bindSessionToRegisterSession: mockBindSessionToRegisterSession,
  }),
}));

vi.mock("@/lib/pos/infrastructure/convex/commandGateway", () => ({
  useConvexCommandGateway: () => ({
    startSession: mockStartSession,
    addItem: mockAddItem,
    holdSession: mockHoldSession,
    completeTransaction: mockCompleteTransaction,
    openDrawer: mockOpenDrawer,
  }),
}));

vi.mock("@/lib/pos/infrastructure/local/usePosLocalSyncRuntime", () => ({
  usePosLocalSyncRuntimeStatus: (...args: unknown[]) =>
    mockUsePosLocalSyncRuntimeStatus(...args),
}));

vi.mock(
  "@/lib/pos/infrastructure/terminal/posTerminalAppSessionRecoveryContext",
  () => ({
    usePosTerminalAppSessionRecoveryRuntimeInput: () =>
      mockUsePosTerminalAppSessionRecoveryRuntimeInput(),
  }),
);

vi.mock("@/lib/pos/infrastructure/local/posLocalStore", () => ({
  POS_LOCAL_STORE_SCHEMA_VERSION: 1,
  canUploadPosLocalEventType: (type: string) =>
    type === "register.opened" ||
    type === "transaction.completed" ||
    type === "cart.cleared" ||
    type === "register.closeout_started" ||
    type === "register.reopened",
  createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({})),
  createPosLocalStore: vi.fn(() => ({
    appendEvent: mockAppendLocalEvent,
    attachStaffProofTokenToPendingEvents:
      mockAttachStaffProofTokenToPendingEvents,
    getStaffAuthorityReadiness: mockGetStaffAuthorityReadiness,
    listEvents: mockListLocalEvents,
    listEventsForUpload: mockListLocalEvents,
    listLocalCloudMappings: mockListLocalCloudMappings,
    readActiveCashierPresence: mockReadCashierPresence,
    readCashierPresence: mockReadCashierPresence,
    readDrawerAuthorityState: mockReadDrawerAuthorityState,
    readProvisionedTerminalSeed: mockReadProvisionedTerminalSeed,
    readStoreDayReadiness: mockReadStoreDayReadiness,
    readTerminalIntegrityState: mockReadTerminalIntegrityState,
    clearActiveCashierPresence: mockClearCashierPresence,
    clearCashierPresence: mockClearCashierPresence,
    invalidateCashierPresenceForTerminal:
      mockInvalidateCashierPresenceForTerminal,
    writeCashierPresence: mockWriteCashierPresence,
    markEventsSynced: mockMarkLocalEventsSynced,
    writeProvisionedTerminalSeed: mockWriteProvisionedTerminalSeed,
    writeProvisionedTerminalSeedAndClearTerminalIntegrity:
      mockWriteProvisionedTerminalSeedAndClearTerminalIntegrity,
    writeDrawerAuthorityState: mockWriteDrawerAuthorityState,
    writeLocalCloudMapping: mockWriteLocalCloudMapping,
  })),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function buildRegisterCatalogRow(
  overrides: Partial<(typeof mockRegisterCatalogRows)[number]> = {},
): (typeof mockRegisterCatalogRows)[number] {
  return {
    id: "sku-2" as Id<"productSku">,
    productSkuId: "sku-2" as Id<"productSku">,
    skuId: "sku-2" as Id<"productSku">,
    productId: "product-2" as Id<"product">,
    name: "Deep Wave",
    sku: "DW-18",
    barcode: "1234567890123",
    price: 10_000,
    category: "Hair",
    description: "Deep wave bundle",
    image: null,
    size: "18",
    length: 18,
    color: "natural",
    areProcessingFeesAbsorbed: false,
    ...overrides,
  };
}

function buildRegisterCatalogAvailabilityRow(
  overrides: Partial<(typeof mockRegisterCatalogAvailabilityRows)[number]> = {},
): (typeof mockRegisterCatalogAvailabilityRows)[number] {
  return {
    productSkuId: "sku-2" as Id<"productSku">,
    skuId: "sku-2" as Id<"productSku">,
    inStock: true,
    quantityAvailable: 5,
    ...overrides,
  };
}

function buildLocalEvent(
  overrides: Partial<Record<string, unknown>> & {
    sequence: number;
    type: string;
  },
) {
  const { sequence, type, ...rest } = overrides;

  return {
    localEventId: `event-${sequence}`,
    schemaVersion: 1,
    sequence,
    type,
    uploadSequence: sequence,
    terminalId: "local-terminal-1",
    storeId: "store-1",
    registerNumber: "1",
    localRegisterSessionId: "drawer-1",
    staffProfileId: "staff-1",
    payload: {},
    createdAt: 1_000 + sequence,
    sync: { status: "pending" },
    ...rest,
  };
}

function buildStaffAuthenticationResult(
  overrides: Partial<Record<string, unknown>> = {},
): StaffAuthenticationResult {
  const expiresAt = Date.now() + 60_000;
  return {
    activeRoles: ["manager"],
    localStaffAuthority: {
      activeRoles: ["manager"],
      credentialId: "credential-1",
      credentialVersion: 2,
      displayName: "Ama Kusi",
      expiresAt,
      issuedAt: Date.now() - 1_000,
      organizationId: "org-1",
      refreshedAt: Date.now(),
      staffProfileId: "staff-1",
      status: "active",
      storeId: "store-1",
      terminalId: "terminal-1",
      username: "ama",
      verifier: {
        algorithm: "PBKDF2-SHA256",
        hash: "hash",
        iterations: 100_000,
        salt: "salt",
        version: 1,
      },
      wrappedPosLocalStaffProof: {
        ciphertext: "ciphertext",
        expiresAt,
        iv: "iv",
      },
    },
    staffProfileId: "staff-1" as Id<"staffProfile">,
    staffProfile: {
      firstName: "Ama",
      lastName: "Kusi",
    },
    posLocalStaffProof: {
      expiresAt,
      token: "staff-proof-token",
    },
    ...overrides,
  };
}

function getTestOperatingDate(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function buildCashierPresence(
  overrides: Partial<Record<string, unknown>> = {},
) {
  const expiresAt = Date.now() + 60_000;
  return {
    activeRoles: ["cashier"],
    credentialId: "credential-1",
    credentialVersion: 2,
    displayName: "Ama Kusi",
    expiresAt,
    lastValidatedAt: Date.now(),
    offlineFreshUntil: expiresAt,
    operatingDate: getTestOperatingDate(),
    organizationId: "org-1",
    signedInAt: Date.now(),
    staffProfileId: "staff-1",
    storeId: "store-1",
    terminalId: "terminal-1",
    username: "ama",
    wrappedPosLocalStaffProof: {
      ciphertext: "ciphertext",
      expiresAt,
      iv: "iv",
    },
    ...overrides,
  };
}

type RegisterViewModelSnapshot = {
  debug?: {
    localStaffAuthorityStatus: string;
    syncFlow: {
      lastLocalSequence?: number;
    };
  };
};

async function waitForLocalRegisterEffects(
  result: { current: RegisterViewModelSnapshot },
  options: { expectReadModel?: boolean } = {},
) {
  await waitFor(() =>
    expect(result.current.debug?.localStaffAuthorityStatus).not.toBe("unknown"),
  );

  if (options.expectReadModel ?? true) {
    await waitFor(() =>
      expect(result.current.debug?.syncFlow.lastLocalSequence).toBeDefined(),
    );
  }
}

describe("useRegisterViewModel", () => {
  beforeEach(() => {
    mockActiveStore = {
      _id: "store-1" as Id<"store">,
      currency: "GHS",
      organizationId: "org-1" as Id<"organization">,
    };
    mockTerminal = {
      _id: "terminal-1" as Id<"posTerminal">,
      displayName: "Front Counter",
      registerNumber: "1",
    };
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
        notes: "Ready",
        workflowTraceId: "register_session:drawer-1",
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      _id: "session-1" as Id<"posSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "POS-0001",
      updatedAt: Date.now(),
      registerSessionId: "drawer-1" as Id<"registerSession">,
      cartItems: [
        {
          id: "item-1" as Id<"posSessionItem">,
          name: "Body Wave",
          barcode: "1234567890",
          price: 120,
          quantity: 1,
          productId: "product-1" as Id<"product">,
          skuId: "sku-1" as Id<"productSku">,
        },
      ],
      customer: {
        _id: "customer-1" as Id<"posCustomer">,
        name: "Ama Serwa",
        email: "ama@example.com",
        phone: "555-0100",
        customerProfileId: "profile-1" as Id<"customerProfile">,
      },
    };
    mockHeldSessions = [];
    mockBarcodeSearchResult = null;
    mockProductIdSearchResults = null;
    mockCashier = {
      firstName: "Ama",
      lastName: "Kusi",
    };
    mockUser = {
      _id: "user-1" as Id<"athenaUser">,
    };
    mockRegisterCatalogRows = [];
    mockRegisterServiceCatalogRows = [];
    mockRegisterCatalogAvailabilityRows = [];
    mockUseConvexRegisterCatalogAvailability.mockReset();
    mockUseConvexRegisterCatalogAvailability.mockImplementation(
      () => mockRegisterCatalogAvailabilityRows,
    );
    localStorage.clear();
    mockReadStoredTerminalFingerprint.mockReset();
    mockReadStoredTerminalFingerprint.mockReturnValue(null);

    mockUseQuery.mockImplementation(() => mockCashier);
    mockUsePosTerminalAppSessionRecoveryRuntimeInput.mockReset();
    mockUsePosTerminalAppSessionRecoveryRuntimeInput.mockReturnValue(null);
    mockUsePosLocalSyncRuntimeStatus.mockReset();
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue(null);
    Object.defineProperty(globalThis.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    mockAppendLocalEvent.mockReset();
    mockAppendLocalEvent.mockResolvedValue({
      ok: true,
      value: { localEventId: "local-event-1" },
    });
    mockAttachStaffProofTokenToPendingEvents.mockReset();
    mockAttachStaffProofTokenToPendingEvents.mockResolvedValue({
      ok: true,
      value: 0,
    });
    mockListLocalEvents.mockReset();
    mockListLocalEvents.mockResolvedValue({ ok: true, value: [] });
    mockReadProvisionedTerminalSeed.mockReset();
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        displayName: "Front Counter",
        provisionedAt: 1,
        schemaVersion: 1,
        syncSecretHash: "sync-secret-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });
    mockWriteProvisionedTerminalSeed.mockReset();
    mockWriteProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: null,
    });
    mockWriteProvisionedTerminalSeedAndClearTerminalIntegrity.mockReset();
    mockWriteProvisionedTerminalSeedAndClearTerminalIntegrity.mockResolvedValue(
      {
        ok: true,
        value: null,
      },
    );
    mockGetStaffAuthorityReadiness.mockReset();
    mockGetStaffAuthorityReadiness.mockResolvedValue({
      ok: true,
      value: "ready",
    });
    mockReadStoreDayReadiness.mockReset();
    mockReadStoreDayReadiness.mockResolvedValue({
      ok: true,
      value: {
        operatingDate: getTestOperatingDate(),
        source: "local",
        status: "started",
        storeId: "store-1",
        updatedAt: Date.now(),
      },
    });
    mockReadCashierPresence.mockReset();
    mockReadCashierPresence.mockResolvedValue({
      ok: true,
      value: null,
    });
    mockClearCashierPresence.mockReset();
    mockClearCashierPresence.mockResolvedValue({ ok: true });
    mockInvalidateCashierPresenceForTerminal.mockReset();
    mockInvalidateCashierPresenceForTerminal.mockResolvedValue({ ok: true });
    mockWriteCashierPresence.mockReset();
    mockWriteCashierPresence.mockResolvedValue({ ok: true, value: {} });
    mockMarkLocalEventsSynced.mockReset();
    mockMarkLocalEventsSynced.mockResolvedValue({ ok: true, value: [] });
    mockWriteLocalCloudMapping.mockReset();
    mockWriteLocalCloudMapping.mockResolvedValue({ ok: true, value: {} });
    mockListLocalCloudMappings.mockReset();
    mockListLocalCloudMappings.mockResolvedValue({ ok: true, value: [] });
    mockReadDrawerAuthorityState.mockReset();
    mockReadDrawerAuthorityState.mockResolvedValue({ ok: true, value: null });
    mockReadTerminalIntegrityState.mockReset();
    mockReadTerminalIntegrityState.mockResolvedValue({ ok: true, value: null });
    mockWriteDrawerAuthorityState.mockReset();
    mockWriteDrawerAuthorityState.mockResolvedValue({ ok: true, value: {} });
    (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB =
      {} as IDBFactory;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.fill(7);
          return bytes;
        },
        subtle: {
          digest: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
        },
      },
    });
    mockUseMutation.mockReset();
    mockUseMutation.mockImplementation(
      () => (args: Record<string, unknown>) => {
        if ("actionKey" in args) {
          return mockAuthenticateStaffCredentialForApproval(args);
        }
        if ("countedCash" in args) {
          return mockSubmitRegisterSessionCloseout(args);
        }
        if ("correctedOpeningFloat" in args) {
          return mockCorrectRegisterSessionOpeningFloat(args);
        }
        if ("syncSecretHash" in args) {
          return mockRegisterTerminal(args);
        }
        return mockReopenRegisterSessionCloseout(args);
      },
    );
    mockSubmitRegisterSessionCloseout.mockReset();
    mockSubmitRegisterSessionCloseout.mockResolvedValue(
      ok({
        action: "closed",
      }),
    );
    mockAuthenticateStaffCredentialForApproval.mockReset();
    mockAuthenticateStaffCredentialForApproval.mockResolvedValue(
      ok({
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "staff-1" as Id<"staffProfile">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockReopenRegisterSessionCloseout.mockReset();
    mockReopenRegisterSessionCloseout.mockResolvedValue(
      ok({
        action: "reopened",
      }),
    );
    mockCorrectRegisterSessionOpeningFloat.mockReset();
    mockCorrectRegisterSessionOpeningFloat.mockResolvedValue(
      ok({
        action: "corrected",
      }),
    );
    mockRegisterTerminal.mockReset();
    mockRegisterTerminal.mockImplementation(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-1" as Id<"posTerminal">,
        _creationTime: 1,
        browserInfo: args.browserInfo,
        displayName: args.displayName,
        fingerprintHash: args.fingerprintHash,
        registeredAt: 1,
        registeredByUserId: "user-1" as Id<"athenaUser">,
        registerNumber: args.registerNumber,
        status: "active" as const,
        storeId: args.storeId,
        syncSecretHash: args.syncSecretHash,
      },
    }));
    mockStartSession.mockReset();
    mockStartSession.mockResolvedValue(
      ok({
        sessionId: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockAddItem.mockReset();
    mockAddItem.mockResolvedValue(
      ok({
        itemId: "item-2" as Id<"posSessionItem">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockHoldSession.mockReset();
    mockHoldSession.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockCompleteTransaction.mockReset();
    mockCompleteTransaction.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        transactionNumber: "TXN-0001",
      }),
    );
    mockOpenDrawer.mockReset();
    mockOpenDrawer.mockResolvedValue(
      ok({
        _id: "drawer-2" as Id<"registerSession">,
        status: "open",
        terminalId: "terminal-1" as Id<"posTerminal">,
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
        notes: "Opening float ready",
        workflowTraceId: "register_session:drawer-2",
      }),
    );
    mockResumeSession.mockReset();
    mockResumeSession.mockResolvedValue(
      ok({
        sessionId: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockVoidSession.mockReset();
    mockVoidSession.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
      }),
    );
    mockUpdateSession.mockReset();
    mockUpdateSession.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockSyncSessionCheckoutState.mockReset();
    mockSyncSessionCheckoutState.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockReleaseSessionInventoryHoldsAndDeleteItems.mockReset();
    mockReleaseSessionInventoryHoldsAndDeleteItems.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
      }),
    );
    mockRemoveItem.mockReset();
    mockRemoveItem.mockResolvedValue(
      ok({
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockBindSessionToRegisterSession.mockReset();
    mockBindSessionToRegisterSession.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockNavigateBack.mockReset();
  });

  it("maps register state into shell-ready props without the legacy store", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.header.isSessionActive).toBe(true);
    expect(result.current.registerInfo.registerLabel).toBe("Front Counter");
    expect(result.current.checkout.payments).toEqual([]);
    expect(result.current.checkout.total).toBe(120);
    expect(result.current.sessionPanel?.canClearSale).toBe(true);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.productEntry.canQuickAddProduct).toBe(true);
    expect(result.current.productEntry.canAddPendingCheckoutItem).toBe(true);
    expect(result.current.authDialog?.open).toBe(false);
    expect(result.current.syncStatus).toBeNull();
  });

  it("marks active cart work as unsafe for update apply", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.updateApplyBlocker).toEqual({
        active: true,
        label: "Sale in progress",
        priority: "critical-workflow",
        guidance:
          "Finish, hold, or clear this sale before applying the update.",
      }),
    );
  });

  it("leaves update apply unblocked when the register has no active sale work", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
      payments: [],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.updateApplyBlocker).toEqual({
        active: false,
        label: "Register ready",
        priority: "critical-workflow",
        guidance: "Apply the update when you are ready.",
      }),
    );
  });

  it("marks active payments as unsafe for update apply", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.updateApplyBlocker).toEqual({
        active: true,
        label: "Sale in progress",
        priority: "critical-workflow",
        guidance:
          "Finish, hold, or clear this sale before applying the update.",
      }),
    );
  });

  it("persists terminal-scoped cashier presence after successful cashier sign-in", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() =>
      expect(mockWriteCashierPresence).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialId: "credential-1",
          credentialVersion: 2,
          operatingDate: getTestOperatingDate(),
          organizationId: "org-1",
          staffProfileId: "staff-1",
          storeId: "store-1",
          terminalId: "terminal-1",
          username: "ama",
          wrappedPosLocalStaffProof: expect.objectContaining({
            ciphertext: "ciphertext",
          }),
        }),
      ),
    );
  });

  it("keeps cashier sign-in closed while cashier presence restore is pending", async () => {
    const pendingPresence = deferred<{ ok: true; value: null }>();
    mockReadCashierPresence.mockReturnValueOnce(pendingPresence.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    expect(result.current.cashierPresenceRestore.status).toBe("pending");
    expect(result.current.authDialog?.open).toBe(false);

    await act(async () => {
      pendingPresence.resolve({ ok: true, value: null });
    });

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe("missing"),
    );
    expect(result.current.authDialog?.open).toBe(true);
  });

  it("does not let a delayed presence restore clear a fresh cashier sign-in", async () => {
    const pendingPresence = deferred<{
      ok: true;
      value: ReturnType<typeof buildCashierPresence>;
    }>();
    mockReadCashierPresence.mockReturnValueOnce(pendingPresence.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });
    expect(result.current.cashierPresenceRestore.status).toBe("restored");

    await act(async () => {
      pendingPresence.resolve({
        ok: true,
        value: buildCashierPresence({ staffProofToken: "stale-token" }),
      });
      await pendingPresence.promise;
    });

    expect(result.current.cashierPresenceRestore.status).toBe("restored");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.authDialog?.open).toBe(false);
  });

  it("does not trust plaintext staff proof fields from restored cashier presence", async () => {
    mockReadCashierPresence.mockResolvedValue({
      ok: true,
      value: buildCashierPresence({
        activeRoles: ["manager"],
        freshnessExpiresAt: Date.now() + 60_000,
        proofExpiresAt: Date.now() + 60_000,
        staffProofToken: "forged-proof-token",
      }),
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe(
        "validation_pending",
      ),
    );

    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.authDialog?.restoredCashier).toEqual({
      displayName: "Ama Kusi",
      username: "ama",
    });
    expect(result.current.debug?.cashierPresence).toBe("validation_pending");
    expect(result.current.debug?.syncFlow.staffProof).toBe("missing");
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("requires sign-in for persisted cashier presence that still needs proof validation", async () => {
    mockReadCashierPresence.mockResolvedValue({
      ok: true,
      value: buildCashierPresence(),
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe(
        "validation_pending",
      ),
    );

    expect(result.current.cashierPresenceRestore.message).toBe(
      "Checking cashier access before new sales.",
    );
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.sessionPanel?.disableNewSession).toBe(true);
  });

  it("invalidates cashier presence for mismatched scope and clears the record", async () => {
    mockReadCashierPresence.mockResolvedValue({
      ok: true,
      value: buildCashierPresence({
        terminalId: "terminal-2",
      }),
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe("invalidated"),
    );

    expect(result.current.cashierPresenceRestore.message).toBe(
      "Cashier sign-in no longer matches this register. Sign in to continue.",
    );
    expect(result.current.cashierCard).toBeNull();
    expect(result.current.authDialog?.open).toBe(true);
    expect(mockClearCashierPresence).toHaveBeenCalledWith({
      operatingDate: getTestOperatingDate(),
      organizationId: "org-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
  });

  it("requires an online refresh when offline cashier presence freshness expires", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mockReadCashierPresence.mockResolvedValue({
      ok: true,
      value: buildCashierPresence({
        offlineFreshUntil: Date.now() - 1_000,
      }),
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe(
        "offline_freshness_expired",
      ),
    );

    expect(result.current.cashierPresenceRestore.message).toBe(
      "This terminal needs an online staff refresh before offline sign-in. Reconnect, then sign in once.",
    );
    expect(result.current.authDialog?.open).toBe(true);
    expect(mockClearCashierPresence).toHaveBeenCalledWith({
      operatingDate: getTestOperatingDate(),
      organizationId: "org-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
  });

  it("clears expired cashier presence and opens deterministic sign-in guidance", async () => {
    mockReadCashierPresence.mockResolvedValue({
      ok: true,
      value: buildCashierPresence({
        expiresAt: Date.now() - 1_000,
        offlineFreshUntil: Date.now() - 1_000,
        wrappedPosLocalStaffProof: {
          ciphertext: "ciphertext",
          expiresAt: Date.now() - 1_000,
          iv: "iv",
        },
      }),
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe("expired"),
    );

    expect(result.current.cashierPresenceRestore.message).toBe(
      "Cashier sign-in expired. Sign in to continue.",
    );
    expect(result.current.cashierCard).toBeNull();
    expect(result.current.authDialog?.open).toBe(true);
    expect(mockClearCashierPresence).toHaveBeenCalledWith({
      operatingDate: getTestOperatingDate(),
      organizationId: "org-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
  });

  it("maps local pending-sync status into POS presentation state", async () => {
    const onRetrySync = vi.fn();
    mockActiveSession = {
      ...mockActiveSession!,
      localSyncStatus: {
        status: "pending_sync",
        pendingEventCount: 3,
        onRetrySync,
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        description:
          "Register activity is saved locally and will sync when ready.",
        label: "Pending sync",
        pendingEventCount: 3,
        status: "pending_sync",
        tone: "warning",
      }),
    );

    act(() => {
      result.current.syncStatus?.onRetrySync?.();
    });

    expect(onRetrySync).toHaveBeenCalled();
  });

  it("does not start a sale immediately after cashier sign-in when the drawer is already open", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      await result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "session.started",
      ),
    ).toHaveLength(0);
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
    expect(result.current.productEntry.disabled).toBe(false);
    expect(toast.success).not.toHaveBeenCalledWith("Sale started");
  });

  it("does not start a sale after cashier sign-in when local drawer bootstrap finishes", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: null,
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    const pendingLocalEvents = deferred<{
      ok: true;
      value: Array<ReturnType<typeof buildLocalEvent>>;
    }>();
    mockListLocalEvents.mockImplementation(() => pendingLocalEvents.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      await result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "session.started",
      ),
    ).toHaveLength(0);

    await act(async () => {
      pendingLocalEvents.resolve({
        ok: true,
        value: [
          buildLocalEvent({
            sequence: 1,
            staffProofToken: "staff-proof-token",
            type: "register.opened",
            payload: {
              expectedCash: 5_000,
              localRegisterSessionId: "drawer-1",
              openingFloat: 5_000,
              status: "open",
            },
          }),
        ],
      });
      await pendingLocalEvents.promise;
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "session.started",
      ),
    ).toHaveLength(0);
    expect(result.current.productEntry.disabled).toBe(false);
  });

  it("does not keep a cashier sign-in start pending until the local drawer is sellable", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "register.opened"
        ? Promise.resolve(
            userError({
              code: "unavailable",
              message: "Local drawer seed not ready.",
            }),
          )
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      await result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) =>
          event.type === "register.opened" || event.type === "session.started",
      ),
    ).toHaveLength(0);

    mockAppendLocalEvent.mockResolvedValue({
      ok: true,
      value: { localEventId: "local-event-2" },
    });
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          staffProofToken: "staff-proof-token",
          type: "register.opened",
          payload: {
            expectedCash: 5_000,
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            status: "open",
          },
        }),
      ],
    });

    const runtimeInput = mockUsePosLocalSyncRuntimeStatus.mock.calls.at(
      -1,
    )?.[0] as { onLocalEventsChanged?: () => void } | undefined;
    await act(async () => {
      runtimeInput?.onLocalEventsChanged?.();
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "session.started",
      ),
    ).toHaveLength(0);
    expect(result.current.productEntry.disabled).toBe(false);
  });

  it("does not start a new sale after sign-in when the active-session summary is stale but no sale is operable", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "stale-session-1", sessionNumber: "POS-OLD" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      await result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "session.started",
      ),
    ).toHaveLength(0);
    expect(result.current.sessionPanel?.disableNewSession).toBe(false);
  });

  it("does not start local sales when cashier sign-in completes twice", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    const pendingStart = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "session.started"
        ? pendingStart.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "session.started",
      ),
    ).toHaveLength(0);

    pendingStart.resolve({
      ok: true,
      value: { localEventId: "local-session-event-1" },
    });
    await act(async () => {
      await pendingStart.promise;
    });
  });

  it("uses pending status from the local-first runtime before Convex session state", async () => {
    const onRetrySync = vi.fn();
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue({
      status: "pending",
      pendingEventCount: 2,
      onRetrySync,
    });
    mockActiveSession = {
      ...mockActiveSession!,
      localSyncStatus: {
        status: "synced",
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(mockUsePosLocalSyncRuntimeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        label: "Pending sync",
        pendingEventCount: 2,
        status: "pending_sync",
        tone: "warning",
      }),
    );

    act(() => {
      result.current.syncStatus?.onRetrySync?.();
    });

    expect(onRetrySync).toHaveBeenCalled();
  });

  it("passes app-session recovery context into the active register runtime status", async () => {
    const appSessionRecovery = {
      reason: "validated",
      routeScope: "pos_hub",
      status: "recoverable",
    };
    mockUsePosTerminalAppSessionRecoveryRuntimeInput.mockReturnValue(
      appSessionRecovery,
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(mockUsePosLocalSyncRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          appSessionRecovery,
          mode: "status-only",
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      ),
    );
  });

  it("does not let debug-only runtime metadata mask pending local read-model events", async () => {
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue({
      debug: {
        lastTrigger: "route-entry",
        lastTriggerAt: 1_000,
        lastTriggerPriority: "normal",
      },
    });
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          staffProofToken: "staff-proof-token",
          type: "register.opened",
          payload: {
            expectedCash: 5_000,
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            status: "open",
          },
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() =>
      expect(result.current.debug?.syncFlow.source).toBe("local-read-model"),
    );
    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        label: "Pending sync",
        pendingEventCount: 1,
        status: "pending_sync",
      }),
    );
    expect(result.current.debug?.syncFlow).toEqual(
      expect.objectContaining({
        lastRuntimeTrigger: "route-entry",
        pendingEventCount: 1,
        status: "pending_sync",
      }),
    );
  });

  it("passes runtime heartbeat, local read model, and repair state through debug runtime state", async () => {
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue({
      debug: {
        activeRegisterSessionRepair: {
          directive: {
            cloudRegisterSessionId: "cloud-register-1",
            expectedCash: 13_000,
            localRegisterSessionId: "cloud-register-1",
            observedAt: 200,
            openedAt: 100,
            openingFloat: 13_000,
            registerNumber: "8",
            staffProfileId: "staff-1",
            status: "active",
          },
          observedAt: 300,
          seedResult: "seeded",
        },
      },
      runtimeStatus: {
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "cloud-register-1",
          observedAt: 200,
          openedAt: 100,
          registerNumber: "8",
          status: "active",
        },
        localStore: {
          available: true,
          schemaVersion: 1,
          terminalSeedReady: true,
        },
        reportedAt: 400,
        source: "runtime",
        staffAuthority: {
          staffProfileId: "staff-1",
          status: "ready",
        },
        sync: {
          pendingEventCount: 1,
          status: "pending_sync",
          uploadableEventCount: 1,
        },
      },
      status: "pending",
    });
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          localRegisterSessionId: "cloud-register-1",
          payload: {
            expectedCash: 13_000,
            localRegisterSessionId: "cloud-register-1",
            openingFloat: 13_000,
            status: "active",
          },
          sequence: 1,
          staffProofToken: "staff-proof-token",
          sync: { status: "pending" },
          type: "register.opened",
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.runtimeState).toEqual(
        expect.objectContaining({
          heartbeat: expect.objectContaining({
            activeRegisterSession: expect.objectContaining({
              localRegisterSessionId: "cloud-register-1",
            }),
            sync: expect.objectContaining({
              status: "pending_sync",
            }),
          }),
          localReadModel: expect.objectContaining({
            activeRegisterSession: expect.objectContaining({
              localRegisterSessionId: "cloud-register-1",
              status: "active",
            }),
            canSell: true,
            sourceEventCount: 1,
          }),
          repair: expect.objectContaining({
            seedResult: "seeded",
          }),
        }),
      ),
    );
  });

  it("does not show pending sync for local session-start records that cannot upload alone", async () => {
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue({
      debug: {
        lastTrigger: "event-appended",
        lastTriggerAt: 1_000,
        lastTriggerPriority: "high",
      },
    });
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          localPosSessionId: "local-pos-session-1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localRegisterSessionId: "drawer-1",
            status: "active",
          },
          sequence: 1,
          type: "session.started",
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.syncFlow.source).toBe("none"),
    );
    expect(result.current.syncStatus).toBeNull();
    expect(result.current.debug?.syncFlow).toEqual(
      expect.objectContaining({
        lastRuntimeTrigger: "event-appended",
        pendingEventCount: 0,
        status: "synced",
      }),
    );
  });

  it("shows synced after uploaded local history when only local-only records remain", async () => {
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue({
      debug: {
        lastTrigger: "event-appended",
        lastTriggerAt: 1_000,
        lastTriggerPriority: "high",
      },
    });
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          sync: { status: "synced", uploaded: true },
          type: "register.opened",
        }),
        buildLocalEvent({
          localPosSessionId: "local-pos-session-1",
          sequence: 2,
          sync: { status: "synced", uploaded: true },
          type: "session.started",
        }),
        buildLocalEvent({
          localPosSessionId: "local-pos-session-1",
          sequence: 3,
          sync: { status: "synced", uploaded: true },
          type: "transaction.completed",
        }),
        buildLocalEvent({
          localPosSessionId: "local-pos-session-1",
          sequence: 4,
          staffProofToken: undefined,
          type: "cart.cleared",
          uploadSequence: undefined,
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() =>
      expect(result.current.syncStatus).toEqual(
        expect.objectContaining({
          label: "Synced",
          status: "synced",
        }),
      ),
    );
  });

  it("shows synced after this cashier's completed sale syncs while manager review residue remains", async () => {
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue({
      onRetrySync: vi.fn(),
      pendingEventCount: 0,
      status: "needs_review",
    });
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          sync: { status: "synced", uploaded: true },
          type: "register.opened",
        }),
        buildLocalEvent({
          localPosSessionId: "local-pos-session-1",
          sequence: 2,
          sync: { status: "synced", uploaded: true },
          type: "transaction.completed",
        }),
        buildLocalEvent({
          localEventId: "manager-review-event",
          staffProfileId: "staff-2",
          sequence: 3,
          sync: { status: "needs_review", uploaded: true },
          type: "register.opened",
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() =>
      expect(result.current.syncStatus).toEqual(
        expect.objectContaining({
          label: "Synced",
          status: "synced",
        }),
      ),
    );
  });

  it("does not show another staff member's pending local upload count", async () => {
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue({
      debug: {
        lastTrigger: "route-entry",
        lastTriggerAt: 1_000,
        lastTriggerPriority: "normal",
      },
    });
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          staffProfileId: "staff-2",
          staffProofToken: "staff-2-proof-token",
          type: "register.opened",
          payload: {
            expectedCash: 5_000,
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            status: "open",
          },
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.syncFlow.source).toBe("none"),
    );
    expect(result.current.syncStatus).toBeNull();

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({
          staffProfileId: "staff-1" as Id<"staffProfile">,
        }),
      );
    });

    expect(result.current.syncStatus).toBeNull();
    expect(result.current.debug?.syncFlow).toEqual(
      expect.objectContaining({
        pendingEventCount: 0,
        status: "synced",
      }),
    );
  });

  it("starts a separate sale when another staff member has a hidden non-empty local cart", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          expectedCash: 5_000,
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          status: "open",
        },
      }),
      buildLocalEvent({
        localPosSessionId: "local-sale-1",
        payload: {
          localPosSessionId: "local-sale-1",
          localRegisterSessionId: "drawer-1",
          status: "active",
        },
        sequence: 2,
        staffProfileId: "staff-1",
        type: "session.started",
      }),
      buildLocalEvent({
        localPosSessionId: "local-sale-1",
        payload: {
          localItemId: "local-item-1",
          localPosSessionId: "local-sale-1",
          productId: "product-1",
          productName: "Nicca",
          productSku: "6N2Y-WMA-EAW",
          productSkuId: "sku-1",
          quantity: 2,
          price: 6_500,
        },
        sequence: 3,
        staffProfileId: "staff-1",
        type: "cart.item_added",
      }),
    ];
    mockListLocalEvents.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        value: localEvents,
      }),
    );
    mockAppendLocalEvent.mockImplementation(async (event) => {
      localEvents.push(
        buildLocalEvent({
          ...event,
          sequence: localEvents.length + 1,
          type: event.type,
        }),
      );
      return {
        ok: true,
        value: { localEventId: `event-${localEvents.length}` },
      };
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.syncFlow.lastLocalSequence).toBe(3),
    );

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.cart.items).toEqual([]);
    expect(result.current.checkout.total).toBe(0);

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({
          staffProfileId: "staff-2" as Id<"staffProfile">,
        }),
      );
    });

    expect(result.current.cart.items).toEqual([]);
    expect(result.current.checkout.total).toBe(0);
    expect(result.current.productEntry.disabled).toBe(false);
    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "session.started",
      ),
    ).toHaveLength(0);

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
    });

    expect(toast.error).not.toHaveBeenCalledWith(
      "This local sale belongs to another signed-in staff member.",
    );
    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "cart.cleared",
      ),
    ).toHaveLength(0);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        staffProfileId: "staff-2",
      }),
    );
  });

  it("replaces another staff member's empty local sale when starting a new sale", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        terminalId: "terminal-1",
        type: "register.opened",
        payload: {
          expectedCash: 5_000,
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          status: "open",
        },
      }),
      buildLocalEvent({
        localPosSessionId: "local-sale-1",
        payload: {
          localPosSessionId: "local-sale-1",
          localRegisterSessionId: "drawer-1",
          status: "active",
        },
        sequence: 2,
        staffProfileId: "staff-1",
        terminalId: "terminal-1",
        type: "session.started",
      }),
    ];
    mockListLocalEvents.mockImplementation(() =>
      Promise.resolve({ ok: true, value: localEvents }),
    );
    mockAppendLocalEvent.mockImplementation(async (event) => {
      localEvents.push(
        buildLocalEvent({
          ...event,
          sequence: localEvents.length + 1,
          type: event.type,
        }),
      );
      return {
        ok: true,
        value: { localEventId: `event-${localEvents.length}` },
      };
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.syncFlow.lastLocalSequence).toBe(2),
    );

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({
          staffProfileId: "staff-2" as Id<"staffProfile">,
        }),
      );
    });

    expect(result.current.productEntry.disabled).toBe(false);

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
    });

    expect(toast.error).not.toHaveBeenCalledWith(
      "This local sale belongs to another signed-in staff member.",
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.cleared",
        localPosSessionId: "local-sale-1",
        staffProfileId: "staff-2",
        initialSyncStatus: "synced",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        staffProfileId: "staff-2",
      }),
    );
  });

  it("adds a product to a new separate sale when another staff member has a hidden non-empty local cart", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          expectedCash: 5_000,
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          status: "open",
        },
      }),
      buildLocalEvent({
        localPosSessionId: "local-sale-1",
        payload: {
          localPosSessionId: "local-sale-1",
          localRegisterSessionId: "drawer-1",
          status: "active",
        },
        sequence: 2,
        staffProfileId: "staff-1",
        type: "session.started",
      }),
      buildLocalEvent({
        localPosSessionId: "local-sale-1",
        payload: {
          localItemId: "local-item-1",
          localPosSessionId: "local-sale-1",
          productId: "product-1",
          productName: "Nicca",
          productSku: "6N2Y-WMA-EAW",
          productSkuId: "sku-1",
          quantity: 2,
          price: 6_500,
        },
        sequence: 3,
        staffProfileId: "staff-1",
        type: "cart.item_added",
      }),
    ];
    mockListLocalEvents.mockImplementation(() =>
      Promise.resolve({ ok: true, value: localEvents }),
    );
    mockAppendLocalEvent.mockImplementation(async (event) => {
      localEvents.push(
        buildLocalEvent({
          ...event,
          sequence: localEvents.length + 1,
          type: event.type,
        }),
      );
      return {
        ok: true,
        value: { localEventId: `event-${localEvents.length}` },
      };
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.syncFlow.lastLocalSequence).toBe(3),
    );

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({
          staffProfileId: "staff-2" as Id<"staffProfile">,
        }),
      );
    });

    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(true);
    expect(toast.error).not.toHaveBeenCalledWith(
      "This local sale belongs to another signed-in staff member.",
    );
    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event.type === "cart.cleared",
      ),
    ).toHaveLength(0);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        staffProfileId: "staff-2",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        staffProfileId: "staff-2",
      }),
    );
  });

  it("replaces another staff member's empty local sale before adding a product", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          expectedCash: 5_000,
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          status: "open",
        },
      }),
      buildLocalEvent({
        localPosSessionId: "local-sale-1",
        payload: {
          localPosSessionId: "local-sale-1",
          localRegisterSessionId: "drawer-1",
          status: "active",
        },
        sequence: 2,
        staffProfileId: "staff-1",
        type: "session.started",
      }),
    ];
    mockListLocalEvents.mockImplementation(() =>
      Promise.resolve({ ok: true, value: localEvents }),
    );
    mockAppendLocalEvent.mockImplementation(async (event) => {
      localEvents.push(
        buildLocalEvent({
          ...event,
          sequence: localEvents.length + 1,
          type: event.type,
        }),
      );
      return {
        ok: true,
        value: { localEventId: `event-${localEvents.length}` },
      };
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.syncFlow.lastLocalSequence).toBe(2),
    );

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({
          staffProfileId: "staff-2" as Id<"staffProfile">,
        }),
      );
    });

    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(true);
    expect(toast.error).not.toHaveBeenCalledWith(
      "This local sale belongs to another signed-in staff member.",
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.cleared",
        localPosSessionId: "local-sale-1",
        staffProfileId: "staff-2",
        initialSyncStatus: "synced",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        staffProfileId: "staff-2",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        staffProfileId: "staff-2",
      }),
    );
  });

  it("restores a reloaded local cart for the staff member who started it", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          payload: {
            expectedCash: 5_000,
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            status: "open",
          },
        }),
        buildLocalEvent({
          localPosSessionId: "local-sale-1",
          payload: {
            localPosSessionId: "local-sale-1",
            localRegisterSessionId: "drawer-1",
            status: "active",
          },
          sequence: 2,
          staffProfileId: "staff-1",
          type: "session.started",
        }),
        buildLocalEvent({
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            localPosSessionId: "local-sale-1",
            productId: "product-1",
            productName: "Nicca",
            productSku: "6N2Y-WMA-EAW",
            productSkuId: "sku-1",
            quantity: 2,
            price: 6_500,
          },
          sequence: 3,
          staffProfileId: "staff-1",
          type: "cart.item_added",
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.syncFlow.lastLocalSequence).toBe(3),
    );

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0]).toEqual(
      expect.objectContaining({
        name: "Nicca",
        quantity: 2,
      }),
    );
    expect(result.current.checkout.total).toBe(13_000);
  });

  it("nudges local sync after pending events receive staff proof", async () => {
    mockAttachStaffProofTokenToPendingEvents.mockResolvedValue({
      ok: true,
      value: 1,
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());
    const expiresAt = Date.now() + 60_000;

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt,
          token: "staff-proof-token",
        },
      });
    });

    await waitFor(() =>
      expect(mockAttachStaffProofTokenToPendingEvents).toHaveBeenCalledWith({
        staffProfileId: "staff-1",
        staffProofToken: "staff-proof-token",
      }),
    );
    await waitFor(() =>
      expect(mockUsePosLocalSyncRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          drainOnAppend: true,
          eventAppendToken: 1,
          mode: "status-only",
          onLocalEventsChanged: expect.any(Function),
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      ),
    );
  });

  it("maps local reconciliation exceptions without blocking the retry callback", async () => {
    const onRetrySync = vi.fn();
    mockActiveSession = {
      ...mockActiveSession!,
      localSyncStatus: {
        status: "needs_review",
        reconciliationItems: [
          {
            summary: "Payment record needs manager review.",
            type: "payment_conflict",
          },
        ],
        onRetrySync,
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        label: "Needs review",
        reconciliationItems: [
          {
            summary: "Payment record needs manager review.",
            type: "payment_conflict",
          },
        ],
        status: "needs_review",
        tone: "danger",
      }),
    );

    act(() => {
      result.current.syncStatus?.onRetrySync?.();
    });

    expect(onRetrySync).toHaveBeenCalled();
  });

  it("keeps POS usable when the active drawer has a closeout review conflict", async () => {
    mockRegisterState = {
      ...mockRegisterState!,
      activeRegisterSession: {
        ...mockRegisterState!.activeRegisterSession!,
        status: "active",
        countedCash: undefined,
        variance: undefined,
        localSyncStatus: {
          status: "needs_review",
          reconciliationItems: [
            {
              countedCash: 4_500,
              expectedCash: 5_000,
              localEventId: "register-closeout-local-1",
              summary:
                "Register closeout variance requires manager review before synced closeout can be applied.",
              type: "register_closeout",
              variance: -500,
            },
          ],
        },
      },
      activeSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-new",
          payload: {
            expectedCash: 5_000,
            localRegisterSessionId: "local-register-new",
            openingFloat: 5_000,
            status: "open",
          },
          sync: { status: "pending", uploaded: false },
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });
    await waitForLocalRegisterEffects(result);

    expect(result.current.drawerGate).toBeNull();
    expect(result.current.productEntry.disabled).toBe(false);
    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        label: "Pending sync",
        pendingEventCount: 1,
        status: "pending_sync",
      }),
    );
    expect(mockStartSession).not.toHaveBeenCalled();

    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        localRegisterSessionId: "local-register-new",
        type: "session.started",
      }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        localRegisterSessionId: "drawer-1",
        type: "session.started",
      }),
    );
  });

  it("holds the active POS session before signing the cashier out when session data is present", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await act(async () => {
      await result.current.cashierCard?.onSignOut();
    });

    expect(mockUpdateSession).toHaveBeenCalled();
    expect(mockHoldSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      staffProfileId: "staff-1",
      reason: "Signing out",
    });
    expect(mockClearCashierPresence).toHaveBeenCalledWith({
      operatingDate: getTestOperatingDate(),
      organizationId: "org-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    expect(result.current.authDialog?.open).toBe(true);
  });

  it("invalidates terminal cashier presence on sign-out when live store organization metadata is unavailable", async () => {
    mockActiveStore = null;
    mockRegisterState = undefined;
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.activeStoreSource).toBe("local"),
    );

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await act(async () => {
      await result.current.cashierCard?.onSignOut();
    });

    expect(mockClearCashierPresence).not.toHaveBeenCalled();
    expect(mockInvalidateCashierPresenceForTerminal).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    expect(result.current.authDialog?.open).toBe(true);
  });

  it("keeps cashier signed in when cashier presence cannot be cleared on sign-out", async () => {
    mockActiveSession = null;
    mockRegisterState = {
      ...mockRegisterState!,
      activeSession: null,
    };
    mockClearCashierPresence.mockResolvedValueOnce({ ok: false });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await act(async () => {
      await result.current.cashierCard?.onSignOut();
    });

    expect(mockClearCashierPresence).toHaveBeenCalledWith({
      operatingDate: getTestOperatingDate(),
      organizationId: "org-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Cashier sign-out could not finish. Try again.",
    );
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.authDialog?.open).toBe(false);
  });

  it("opens the cashier auth dialog when a terminal exists but no cashier is signed in", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitForLocalRegisterEffects(result);

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.cashierCard).toBeNull();
  });

  it("uses the local POS entry seed as store authority when the live active store is unavailable", async () => {
    mockActiveStore = null;
    mockRegisterState = undefined;
    mockActiveSession = null;
    mockTerminal = {
      _id: "terminal-1" as Id<"posTerminal">,
      displayName: "Front Counter",
      registerNumber: "1",
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.localEntryStatus).toBe("ready"),
    );

    expect(result.current.hasActiveStore).toBe(true);
    expect(result.current.authDialog).toEqual(
      expect.objectContaining({
        open: true,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.current.debug).toEqual(
      expect.objectContaining({
        activeStoreSource: "local",
        hasLiveActiveStore: false,
        localEntryStatus: "ready",
      }),
    );
  });

  it("prefills restored cashier unlock from local presence while offline without live store metadata", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mockActiveStore = null;
    mockRegisterState = undefined;
    mockActiveSession = null;
    mockTerminal = {
      _id: "terminal-1" as Id<"posTerminal">,
      displayName: "Front Counter",
      registerNumber: "1",
    };
    mockReadCashierPresence.mockResolvedValue({
      ok: true,
      value: buildCashierPresence(),
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe(
        "validation_pending",
      ),
    );

    expect(mockReadCashierPresence).toHaveBeenCalledWith({
      now: expect.any(Number),
      operatingDate: getTestOperatingDate(),
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.authDialog?.restoredCashier).toEqual({
      displayName: "Ama Kusi",
      username: "ama",
    });
    expect(result.current.debug).toEqual(
      expect.objectContaining({
        activeStoreSource: "local",
        hasLiveActiveStore: false,
      }),
    );
  });

  it("uses the short-lived local POS staff proof for local events", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());
    const expiresAt = Date.now() + 60_000;

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe("missing"),
    );
    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.authDialog?.onAuthenticated).toBeTypeOf("function");

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt,
          token: "staff-proof-token",
        },
      });
    });

    expect(result.current.authDialog?.open).toBe(false);

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        staffProfileId: "staff-1",
        type: "cart.item_added",
      }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        staffProofToken: expect.any(String),
      }),
    );
  });

  it("does not trust persisted local POS staff proof as cashier sign-in", async () => {
    localStorage.setItem(
      "athena.pos.localStaffProof.store-1.terminal-1",
      JSON.stringify({
        expiresAt: Date.now() + 60_000,
        staffProfileId: "staff-1",
        token: "forged-proof-token",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.cashierPresenceRestore.status).toBe("missing"),
    );
    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.cashierCard).toBeNull();

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "real-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        staffProfileId: "staff-1",
        type: "cart.item_added",
      }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        staffProofToken: expect.any(String),
      }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        staffProofToken: "forged-proof-token",
      }),
    );
  });

  it("leaves onboarding once terminal and cashier access are configured", async () => {
    mockUseQuery.mockImplementation(() => [
      {
        credentialStatus: "active",
        primaryRole: "cashier",
        roles: ["cashier"],
        status: "active",
      },
    ]);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitForLocalRegisterEffects(result);

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.onboarding).toEqual({
      shouldShow: false,
      terminalReady: true,
      cashierSetupReady: true,
      cashierSignedIn: false,
      cashierCount: 1,
      nextStep: "ready",
    });
  });

  it("does not flash onboarding while cashier access is still loading", async () => {
    mockUseQuery.mockImplementation(() => undefined);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitForLocalRegisterEffects(result);

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.onboarding).toEqual({
      shouldShow: false,
      terminalReady: true,
      cashierSetupReady: true,
      cashierSignedIn: false,
      cashierCount: 0,
      nextStep: "ready",
    });
  });

  it("does not flash terminal onboarding while terminal lookup is still loading", async () => {
    mockTerminal = undefined;
    mockUseQuery.mockImplementation(() => [
      {
        credentialStatus: "active",
        primaryRole: "cashier",
        roles: ["cashier"],
        status: "active",
      },
    ]);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitForLocalRegisterEffects(result, { expectReadModel: false });

    expect(result.current.authDialog).toBeNull();
    expect(result.current.onboarding).toEqual({
      shouldShow: false,
      terminalReady: false,
      cashierSetupReady: true,
      cashierSignedIn: false,
      cashierCount: 1,
      nextStep: "ready",
    });
  });

  it("holds bootstrap on a missing drawer and exposes the drawer gate", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.errorMessage).toBeNull();
    expect(result.current.checkout.registerNumber).toBe("1");
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("does not operate from a stale local drawer when the cloud register session is closed", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closed",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
            status: "open",
          },
          sync: { status: "synced", uploaded: true },
        }),
      ],
    });
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "drawer-1",
          mappedAt: 1_100,
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });
    await waitForLocalRegisterEffects(result);

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(
      mockAppendLocalEvent.mock.calls.some(
        ([event]) => event.type === "session.started",
      ),
    ).toBe(false);
  });

  it("keeps an active local sale recoverable when its mapped cloud register session is closed", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closed",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
            status: "open",
          },
          sync: { status: "synced", uploaded: true },
        }),
        buildLocalEvent({
          sequence: 2,
          type: "session.started",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localPosSessionId: "local-sale-1",
            status: "active",
          },
          sync: { status: "synced", uploaded: true },
        }),
        buildLocalEvent({
          sequence: 3,
          type: "cart.item_added",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "SKU-1",
            productName: "Body Wave",
            price: 7_500,
            quantity: 2,
          },
          sync: { status: "synced", uploaded: true },
        }),
        buildLocalEvent({
          sequence: 4,
          type: "session.payments_updated",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localPosSessionId: "local-sale-1",
            payments: [{ method: "cash", amount: 15_000, timestamp: 1_004 }],
            stage: "paymentAdded",
          },
          sync: { status: "synced", uploaded: true },
        }),
      ],
    });
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "drawer-1",
          mappedAt: 1_100,
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });
    await waitForLocalRegisterEffects(result);

    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.drawerGate?.canOpenDrawer).toBe(true);
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.serviceEntry?.disabled).toBe(true);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 15_000 }),
    ]);

    vi.mocked(toast.error).mockClear();
    await act(async () => {
      await result.current.drawerGate?.onSignOut();
    });

    expect(toast.error).not.toHaveBeenCalledWith(
      "Complete or clear this local sale before leaving the register.",
    );
    expect(result.current.cashierCard).toBeNull();
    expect(result.current.checkout.cartItems).toEqual([]);
    expect(result.current.checkout.payments).toEqual([]);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.cleared",
        localRegisterSessionId: "local-register-1",
        localPosSessionId: "local-sale-1",
      }),
    );

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });
    await waitForLocalRegisterEffects(result);

    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.checkout.cartItems).toHaveLength(1);

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        localRegisterSessionId: "local-register-1",
        localPosSessionId: "local-sale-1",
      }),
    );
  });

  it("uses offline authenticated manager roles for drawer access", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          fullName: "Offline Manager",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.canOpenDrawer).toBe(true);
    expect(result.current.cashierCard?.cashierName).toBe("Offline Manager");
  });

  it("opens replacement drawer setup directly for submitted review-only closeouts", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        countedCash: 4_500,
        managerApprovalRequestId: "approval-1" as Id<"approvalRequest">,
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
        variance: -500,
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.registerNumber).toBe("1");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(result.current.drawerGate?.onSubmit).toEqual(expect.any(Function));
    expect(result.current.drawerGate?.openingFloat).toBe("");
    expect(result.current.drawerGate?.notes).toBe("");
    expect(
      result.current.drawerGate?.closeoutSecondaryActionLabel,
    ).toBeUndefined();
    expect(result.current.drawerGate?.onSubmitCloseout).toBeUndefined();
    expect(result.current.drawerGate?.onReopenRegister).toBeUndefined();
    expect(result.current.drawerGate?.closeoutSubmittedReason).toBeUndefined();
    expect(result.current.drawerGate?.canOpenCashControls).toBe(true);
    expect(result.current.drawerGate?.cashControlsRegisterSessionId).toBe(
      "drawer-1",
    );
    expect(
      result.current.drawerGate?.hasPendingCloseoutApproval,
    ).toBeUndefined();
  });

  it("opens replacement drawer setup directly for rejected closeout drawers", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closeout_rejected",
        countedCash: 4_500,
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
        variance: -500,
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.onSubmit).toEqual(expect.any(Function));
    expect(result.current.drawerGate?.onReopenRegister).toBeUndefined();
    expect(result.current.drawerGate?.closeoutSubmittedReason).toBeUndefined();
    expect(result.current.drawerGate?.canOpenCashControls).toBe(true);
    expect(result.current.drawerGate?.cashControlsRegisterSessionId).toBe(
      "drawer-1",
    );
    expect(
      result.current.drawerGate?.closeoutSecondaryActionLabel,
    ).toBeUndefined();
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
  });

  it("allows a newer local drawer to sell while a different cloud closeout awaits manager review", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["cashier"],
      },
      activeRegisterSession: {
        _id: "drawer-pending-approval",
        status: "closing",
        countedCash: 4_600,
        managerApprovalRequestId: "approval-1" as Id<"approvalRequest">,
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now() - 60_000,
        variance: -400,
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-new",
          payload: {
            expectedCash: 5_000,
            localRegisterSessionId: "local-register-new",
            openingFloat: 5_000,
            status: "open",
          },
          sync: { status: "pending", uploaded: false },
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({ activeRoles: ["cashier"] }),
      );
    });
    await waitForLocalRegisterEffects(result);

    expect(result.current.drawerGate).toBeNull();
    expect(result.current.productEntry.disabled).toBe(false);
  });

  it("submits closeout from the POS drawer gate with the current cashier", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("48.00");
      result.current.drawerGate?.onCloseoutNotesChange?.("End of shift count");
    });

    expect(result.current.drawerGate?.closeoutDraftVariance).toBe(-200);

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockSubmitRegisterSessionCloseout).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.closeout_started",
          localRegisterSessionId: "drawer-1",
          payload: expect.objectContaining({
            countedCash: 4_800,
            notes: "End of shift count",
          }),
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Register closed.");
  });

  it("keeps the POS drawer gate open when local closeout persistence fails", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "register.closeout_started"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        payload: expect.objectContaining({
          countedCash: 5_000,
          notes: null,
        }),
      }),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Unable to close this register. Try again.",
    );
  });

  it("allows POS closeout variance without closeout notes", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("48.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockSubmitRegisterSessionCloseout).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.closeout_started",
          localRegisterSessionId: "drawer-1",
          payload: expect.objectContaining({
            countedCash: 4_800,
            notes: null,
          }),
        }),
      ),
    );
    expect(result.current.drawerGate?.errorMessage).toBeUndefined();
  });

  it("records closeout locally without waiting for a server approval response", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("48.00");
      result.current.drawerGate?.onCloseoutNotesChange?.("End of shift count");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockSubmitRegisterSessionCloseout).not.toHaveBeenCalled();
    expect(result.current.commandApprovalDialog).toBeNull();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: "drawer-1",
        payload: expect.objectContaining({
          countedCash: 4_800,
          notes: "End of shift count",
        }),
      }),
    );
  });

  it("syncs zero-variance cloud-backed closeouts immediately after saving the local record", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: "drawer-1",
        payload: expect.objectContaining({
          countedCash: 5_000,
          notes: null,
        }),
      }),
    );
    expect(mockSubmitRegisterSessionCloseout).toHaveBeenCalledWith(
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        actorUserId: "user-1",
        countedCash: 5_000,
        registerSessionId: "drawer-1",
        storeId: "store-1",
      }),
    );
    expect(mockMarkLocalEventsSynced).toHaveBeenCalledWith(["local-event-1"], {
      uploaded: true,
    });
  });

  it("keeps zero-variance cloud-backed closeouts pending when the cloud closeout fails", async () => {
    mockSubmitRegisterSessionCloseout.mockResolvedValueOnce(
      userError({
        code: "precondition_failed",
        message: "Register session changed before closeout could finish.",
      }),
    );
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: "drawer-1",
      }),
    );
    expect(mockSubmitRegisterSessionCloseout).toHaveBeenCalled();
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Closeout saved locally. Athena will finish it after sync.",
    );
    expect(toast.success).not.toHaveBeenCalledWith("Register closed.");
  });

  it("opens the closeout drawer gate from an active empty register", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.closeoutControl?.canCloseout).toBe(true);

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    expect(result.current.drawerGate?.mode).toBe("closeoutBlocked");
    expect(result.current.drawerGate?.expectedCash).toBe(5_000);
    expect(result.current.drawerGate?.registerSessionCode).toMatch(
      /^[A-Z0-9-]{6}$/,
    );
    expect(result.current.drawerGate?.registerSessionCode).not.toContain(
      "local-register",
    );
    expect(result.current.drawerGate?.registerSessionCodeScope).toBe("cloud");
    expect(result.current.drawerGate?.closeoutSecondaryActionLabel).toBe(
      "Return to sale",
    );
    expect(result.current.productEntry.disabled).toBe(true);

    act(() => {
      result.current.drawerGate?.onCloseoutSecondaryAction?.();
    });

    expect(result.current.drawerGate).toBeNull();
    expect(result.current.productEntry.disabled).toBe(false);
  });

  it("submits cloud-backed local closeout with the original local drawer id", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          localEventId: "event-opened",
          localRegisterSessionId: "local-register-1",
          sequence: 1,
          sync: { status: "synced", uploaded: true },
          type: "register.opened",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
            status: "open",
          },
        }),
      ],
    });
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "drawer-1",
          mappedAt: 1_100,
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() =>
      expect(result.current.closeoutControl?.canCloseout).toBe(true),
    );

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.mode).toBe("closeoutBlocked"),
    );

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: "local-register-1",
      }),
    );
  });

  it("routes register actions through the active-terminal conflict gate", async () => {
    mockActiveSession = null;
    mockRegisterState = {
      ...mockRegisterState!,
      activeSession: null,
      activeSessionConflict: {
        kind: "activeOnOtherTerminal",
        message: "A session is active for this cashier on a different terminal",
        terminalId: "terminal-2",
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
      });
    });

    expect(result.current.sessionPanel?.hasExpiredSession).toBe(false);
    expect(result.current.sessionPanel?.disableNewSession).toBe(false);
    expect(result.current.closeoutControl?.canCloseout).toBe(true);
    expect(result.current.closeoutControl?.canShowOpeningFloatCorrection).toBe(
      true,
    );
    expect(result.current.closeoutControl?.canCorrectOpeningFloat).toBe(true);

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
      result.current.closeoutControl?.onRequestCloseout();
      result.current.closeoutControl?.onRequestOpeningFloatCorrection();
    });

    expect(result.current.drawerGate).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "Cashier already has an active session on another terminal",
    );
  });

  it("leaves a ready register idle after other-terminal sessions have expired", async () => {
    mockActiveSession = null;
    mockRegisterState = {
      ...mockRegisterState!,
      phase: "readyToStart",
      activeSession: null,
      activeSessionConflict: null,
    };
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.started" }),
    );
    expect(result.current.sessionPanel?.hasExpiredSession).toBe(false);
  });

  it("corrects the opening float from the active POS register", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.closeoutControl?.canShowOpeningFloatCorrection).toBe(
      true,
    );
    expect(result.current.closeoutControl?.canCorrectOpeningFloat).toBe(true);

    act(() => {
      result.current.closeoutControl?.onRequestOpeningFloatCorrection();
    });

    expect(result.current.drawerGate?.mode).toBe("openingFloatCorrection");
    expect(result.current.drawerGate?.currentOpeningFloat).toBe(5_000);
    expect(result.current.drawerGate?.correctedOpeningFloat).toBe("50");
    expect(result.current.productEntry.disabled).toBe(true);

    act(() => {
      result.current.drawerGate?.onCorrectedOpeningFloatChange?.("45.00");
      result.current.drawerGate?.onCorrectionReasonChange?.("Cashier typo");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitOpeningFloatCorrection?.();
    });

    expect(mockCorrectRegisterSessionOpeningFloat).toHaveBeenCalledWith({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      approvalProofId: undefined,
      correctedOpeningFloat: 4_500,
      reason: "Cashier typo",
      registerSessionId: "drawer-1",
      storeId: "store-1",
    });
    expect(toast.success).toHaveBeenCalledWith("Opening float corrected");
  });

  it("opens manager re-auth when opening float correction requires approval", async () => {
    mockCorrectRegisterSessionOpeningFloat
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: {
          action: {
            key: "cash_controls.register_session.correct_opening_float",
            label: "Correct opening float",
          },
          copy: {
            title: "Manager approval required",
            message:
              "Authorization is needed from a manager to correct this register opening float.",
            primaryActionLabel: "Approve correction",
            secondaryActionLabel: "Cancel",
          },
          reason:
            "Manager approval is required to correct the register opening float.",
          requiredRole: "manager",
          resolutionModes: [{ kind: "inline_manager_proof" }],
          selfApproval: "allowed",
          subject: {
            id: "drawer-1",
            label: "1",
            type: "register_session",
          },
        },
      })
      .mockResolvedValueOnce(
        ok({
          action: "corrected",
        }),
      );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.closeoutControl?.onRequestOpeningFloatCorrection();
    });

    act(() => {
      result.current.drawerGate?.onCorrectedOpeningFloatChange?.("45.00");
      result.current.drawerGate?.onCorrectionReasonChange?.("Cashier typo");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitOpeningFloatCorrection?.();
    });

    expect(result.current.drawerGate?.errorMessage).toBeNull();
    expect(result.current.commandApprovalDialog?.open).toBe(true);
    expect(result.current.commandApprovalDialog?.approval?.action.key).toBe(
      "cash_controls.register_session.correct_opening_float",
    );

    await act(async () => {
      const approval = result.current.commandApprovalDialog!.approval!;
      await result.current.commandApprovalDialog?.onApproved({
        approval,
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "staff-1" as Id<"staffProfile">,
        expiresAt: Date.now() + 60_000,
      });
    });

    expect(mockCorrectRegisterSessionOpeningFloat).toHaveBeenLastCalledWith({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      approvalProofId: "proof-1",
      correctedOpeningFloat: 4_500,
      reason: "Cashier typo",
      registerSessionId: "drawer-1",
      storeId: "store-1",
    });
    expect(toast.success).toHaveBeenCalledWith("Opening float corrected");
  });

  it("opens a fresh local drawer when the cloud register session is closing", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    expect(result.current.drawerGate?.mode).toBe("initialSetup");

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
      result.current.drawerGate?.onNotesChange?.("Fresh drawer");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(mockReopenRegisterSessionCloseout).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "register.reopened" }),
    );
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.opened",
          localRegisterSessionId: expect.not.stringMatching(/^drawer-1$/),
          payload: expect.objectContaining({
            notes: "Fresh drawer",
            openingFloat: 5_000,
          }),
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Drawer open");
  });

  it("does not expose local register reopen to non-manager cashiers for closing sessions", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["cashier"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.onReopenRegister).toBeUndefined();
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "register.reopened" }),
    );
  });

  it("keeps the opening drawer gate when fresh drawer persistence fails after a closing session", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "register.opened"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Unable to open the drawer. Try again.",
    );
    expect(toast.success).not.toHaveBeenCalledWith(
      "Register reopened. You can start selling.",
    );
  });

  it("gates an active POS session without a register assignment while preserving the sale", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockResumeSession).not.toHaveBeenCalled();
  });

  it("blocks starting a sale when drawer authority is missing", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
    });

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.started" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Drawer closed. Open the drawer before starting a sale.",
    );
  });

  it("gates an active POS session assigned to a closing drawer with drawer recovery", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockBindSessionToRegisterSession).not.toHaveBeenCalled();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(result.current.drawerGate?.onSubmit).toEqual(expect.any(Function));
    expect(result.current.drawerGate?.onSubmitCloseout).toBeUndefined();
    expect(result.current.drawerGate?.closeoutSubmittedReason).toBeUndefined();
  });

  it("gates an active POS session assigned to a different open drawer", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-2",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Sale assigned to a different drawer. Open that drawer before continuing.",
    );
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockBindSessionToRegisterSession).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[POS] Skipped checkout persistence while drawer recovery is required",
      ),
    );
    consoleWarn.mockRestore();
  });

  it("does not add products through direct handlers while an active session lacks drawer assignment", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        name: "Deep Wave",
        price: 100,
        barcode: "123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "SKU-2",
        quantityAvailable: 5,
      } as never);
    });

    expect(mockAddItem).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Drawer closed. Open the drawer before adding items.",
    );
  });

  it("blocks completing a preserved sale when drawer authority is missing", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(false);
    expect(mockCompleteTransaction).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "transaction.completed" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Drawer closed. Open the drawer before completing this sale.",
    );
  });

  it("records pending local session and cart events after starting a sale", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.started",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: expect.stringMatching(/^local-pos-session-/),
        }),
      ),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: expect.stringMatching(/^local-pos-session-/),
        payload: expect.objectContaining({
          localItemId: expect.stringMatching(/^local-item-/),
          productSkuId: "sku-2",
          quantity: 1,
        }),
      }),
    );
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockWriteLocalCloudMapping).not.toHaveBeenCalled();
  });

  it("durably clears an empty local sale when voiding it", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            registerSessionId: "drawer-1",
          },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
      ],
    });
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.sessionPanel?.activeSessionNumber).toBe(
        "Local sale",
      ),
    );
    expect(result.current.checkout.cartItems).toEqual([]);

    mockAppendLocalEvent.mockClear();
    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.cleared",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "local-pos-session-1",
        initialSyncStatus: "synced",
      }),
    );

    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        ...(await mockListLocalEvents()).value,
        {
          localEventId: "local-event-clear",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.cleared",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });
    const { projectLocalRegisterReadModel } =
      await import("../../infrastructure/local/registerReadModel");
    const replayed = projectLocalRegisterReadModel({
      events: (await mockListLocalEvents()).value,
      isOnline: true,
      terminalSeed: null,
    });
    expect(replayed.activeSale).toBeNull();
    expect(mockVoidSession).not.toHaveBeenCalled();
  });

  it("seeds the active cloud drawer before explicitly starting a new local sale", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: { firstName: "Ama", lastName: "Kusi" },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
    });

    expect(
      mockAppendLocalEvent.mock.calls.map(([event]) => event.type),
    ).toEqual(["register.opened", "session.started"]);
    expect(mockAppendLocalEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "register.opened",
        localRegisterSessionId: "drawer-1",
        staffProofToken: "staff-proof-token",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.started",
        localRegisterSessionId: "drawer-1",
      }),
    );
  });

  it("adds an exact in-stock catalog match once from local register search", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "cart.item_added",
          payload: expect.objectContaining({
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            barcode: "1234567890123",
            productName: "Deep Wave",
            quantity: 1,
          }),
        }),
      ),
    );
    expect(mockAddItem).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.productEntry.onBarcodeSubmit({
        preventDefault: vi.fn(),
      } as never);
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event?.type === "cart.item_added",
      ),
    ).toHaveLength(1);
  });

  it("surfaces only service lookup when the terminal is configured for services", async () => {
    mockTerminal = {
      ...mockTerminal!,
      transactionCapability: "services_only",
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    await waitFor(() =>
      expect(result.current.productEntry.searchResults).toEqual([]),
    );
    expect(result.current.productEntry.canSearchProducts).toBe(false);
    expect(result.current.productEntry.canSearchServices).toBe(true);
    expect(
      mockAppendLocalEvent.mock.calls.some(
        ([event]) => event?.type === "cart.item_added",
      ),
    ).toBe(false);

    act(() => {
      result.current.productEntry.setProductSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );
    expect(result.current.serviceEntry?.searchResults[0]).toEqual(
      expect.objectContaining({ name: "Closure Repair" }),
    );
  });

  it("surfaces only product lookup when the terminal is configured for product SKUs", async () => {
    mockTerminal = {
      ...mockTerminal!,
      transactionCapability: "products_only",
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.productEntry.canSearchProducts).toBe(true);
    expect(result.current.productEntry.canSearchServices).toBe(false);
    expect(result.current.serviceEntry).toBeUndefined();

    act(() => {
      result.current.productEntry.setProductSearchQuery("deep");
    });

    await waitFor(() =>
      expect(result.current.productEntry.searchResults).toHaveLength(1),
    );
    expect(result.current.productEntry.searchResults[0]).toEqual(
      expect.objectContaining({ name: "Deep Wave" }),
    );
  });

  it("adds service lines to the register review state and blocks checkout without customer attribution", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      customer: null,
    };
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );
    expect(result.current.serviceEntry?.serviceSearchQuery).toBe("closure");

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    expect(result.current.cart.serviceItems).toEqual([
      expect.objectContaining({
        name: "Closure Repair",
        pricingModel: "fixed",
        price: 4500,
      }),
    ]);
    expect(result.current.checkout.serviceLines).toEqual([
      expect.objectContaining({
        name: "Closure Repair",
        quantity: 1,
        totalPrice: 4500,
      }),
    ]);
    expect(result.current.checkout.total).toBe(4620);
    expect(result.current.serviceEntry?.checkoutBlockMessage).toBe(
      "Customer required. Add a customer before checking out services.",
    );
    expect(result.current.checkout.completionBlockMessage).toBe(
      "Customer required. Add a customer before checking out services.",
    );

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Customer required. Add a customer before checking out services.",
    );
  });

  it("keeps service checkout blocked after sale-only name attribution", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      customer: null,
    };
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    expect(result.current.checkout.completionBlockMessage).toBe(
      "Customer required. Add a customer before checking out services.",
    );

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        name: "Kwamina",
        email: "",
        phone: "",
      });
      await result.current.customerPanel.onCustomerCommitted({
        name: "Kwamina",
        email: "",
        phone: "",
      });
    });

    expect(result.current.customerPanel.customerInfo.name).toBe("Kwamina");
    expect(result.current.serviceEntry?.checkoutBlockMessage).toBe(
      "Customer required. Add a customer before checking out services.",
    );
    expect(result.current.checkout.completionBlockMessage).toBe(
      "Customer required. Add a customer before checking out services.",
    );

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Customer required. Add a customer before checking out services.",
    );
  });

  it("allows service checkout after profile-backed customer attribution", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      customer: null,
    };
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    expect(result.current.checkout.completionBlockMessage).toBe(
      "Customer required. Add a customer before checking out services.",
    );

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Kwamina",
        email: "",
        phone: "",
      });
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Kwamina",
        email: "",
        phone: "",
      });
    });

    expect(result.current.customerPanel.customerInfo.name).toBe("Kwamina");
    expect(result.current.serviceEntry?.checkoutBlockMessage).toBeUndefined();
    expect(result.current.checkout.completionBlockMessage).toBeUndefined();
  });

  it("does not add the same service twice", async () => {
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );
    const service = result.current.serviceEntry?.searchResults[0];
    expect(service).toBeDefined();

    await act(async () => {
      await result.current.serviceEntry?.onAddService(service!);
      await result.current.serviceEntry?.onAddService(service!);
    });

    expect(result.current.cart.serviceItems).toEqual([
      expect.objectContaining({
        name: "Closure Repair",
        pricingModel: "fixed",
        price: 4500,
        quantity: 1,
      }),
    ]);

    const serviceEvents = mockAppendLocalEvent.mock.calls.filter(
      ([event]) => event.type === "cart.service_added",
    );
    expect(serviceEvents).toHaveLength(1);
    expect(serviceEvents[0]?.[0].payload).toEqual(
      expect.objectContaining({
        quantity: 1,
        unitPrice: 4500,
        totalPrice: 4500,
      }),
    );
  });

  it("clears a service-only sale through the local clear event", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.serviceEntry?.setServiceSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    expect(result.current.cart.serviceItems).toHaveLength(1);

    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockVoidSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.cleared",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        payload: expect.objectContaining({
          localPosSessionId: "session-1",
          reason: "Sale cleared",
        }),
      }),
    );
    expect(result.current.cart.serviceItems).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith("Sale cleared");
  });

  it("removes a service-only cart item through the bootstrapped local sale", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.serviceEntry?.setServiceSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    const serviceLineId = result.current.cart.serviceItems?.[0]?.id;
    expect(serviceLineId).toBeDefined();

    await act(async () => {
      await result.current.cart.onRemoveService?.(serviceLineId!);
    });

    const appendedEventTypes = mockAppendLocalEvent.mock.calls.map(
      ([event]) => event.type,
    );
    expect(appendedEventTypes.slice(0, 2)).toEqual([
      "register.opened",
      "session.started",
    ]);
    expect(appendedEventTypes.at(-1)).toBe("cart.service_added");
    expect(mockAppendLocalEvent.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        type: "cart.service_added",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        payload: expect.objectContaining({
          localPosSessionId: "session-1",
          quantity: 0,
          unitPrice: 0,
          totalPrice: 0,
        }),
      }),
    );
    expect(result.current.cart.serviceItems).toEqual([]);
    expect(toast.error).not.toHaveBeenCalledWith(
      "Unable to update this sale. Try again.",
    );
  });

  it("surfaces drawer recovery when a service sale loses drawer authority", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.serviceEntry?.setServiceSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    expect(result.current.cart.serviceItems).toHaveLength(1);

    mockActiveSession = null;
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: null,
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };

    rerender();

    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.serviceEntry?.disabled).toBe(true);
    expect(result.current.cart.serviceItems).toHaveLength(1);
  });

  it("blocks service line edits when a preserved sale loses register binding", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.serviceEntry?.setServiceSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    const serviceLineId = result.current.cart.serviceItems?.[0]?.id;
    expect(serviceLineId).toBeDefined();
    expect(result.current.cart.serviceItems?.[0]).toEqual(
      expect.objectContaining({
        price: 4500,
      }),
    );
    const initialLocalEventCount = mockAppendLocalEvent.mock.calls.length;

    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };
    rerender();

    await act(async () => {
      await result.current.cart.onUpdateServiceAmount?.(serviceLineId!, 6000);
      await result.current.cart.onRemoveService?.(serviceLineId!);
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledTimes(initialLocalEventCount);
    expect(result.current.cart.serviceItems).toEqual([
      expect.objectContaining({
        id: serviceLineId,
        price: 4500,
      }),
    ]);
    expect(toast.error).toHaveBeenCalledWith(
      "Drawer closed. Open the drawer before changing this sale.",
    );
  });

  it("includes service lines in the durable local completion payload", async () => {
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.serviceEntry?.setServiceSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 4620);
    });

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transaction.completed",
          payload: expect.objectContaining({
            serviceLines: [
              expect.objectContaining({
                serviceCatalogId: "service-1",
                serviceCatalogName: "Closure Repair",
                serviceMode: "repair",
                pricingModel: "fixed",
                quantity: 1,
                unitPrice: 4500,
                totalPrice: 4500,
                customerProfileId: "profile-1",
              }),
            ],
          }),
        }),
      ),
    );
  });

  it("waits for pending service draft writes before completing checkout", async () => {
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];
    const pendingServiceWrite = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((event: { type: string }) => {
      if (event.type === "cart.service_added") {
        return pendingServiceWrite.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: `local-${event.type}` },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.serviceEntry?.setServiceSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    let addServicePromise: Promise<boolean | undefined> | undefined;
    await act(async () => {
      addServicePromise = result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 4620);
    });

    let completePromise: Promise<boolean> | undefined;
    await act(async () => {
      completePromise = result.current.checkout.onCompleteTransaction();
    });

    expect(
      mockAppendLocalEvent.mock.calls.some(
        ([event]) => event.type === "transaction.completed",
      ),
    ).toBe(false);

    pendingServiceWrite.resolve({
      ok: true,
      value: { localEventId: "local-service-event-1" },
    });
    await act(async () => {
      await addServicePromise;
      await completePromise;
    });

    expect(
      mockAppendLocalEvent.mock.calls.map(([event]) => event.type),
    ).toEqual([
      "register.opened",
      "session.started",
      "cart.service_added",
      "session.payments_updated",
      "transaction.completed",
    ]);
  });

  it("blocks service draft edits while checkout completion is in flight", async () => {
    mockRegisterServiceCatalogRows = [
      {
        serviceCatalogId: "service-1" as Id<"serviceCatalog">,
        name: "Closure Repair",
        description: "Repair a closure install.",
        serviceMode: "repair",
        pricingModel: "fixed",
        basePrice: 4500,
        status: "active",
      },
    ];
    const pendingCompletionWrite = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((event: { type: string }) => {
      if (event.type === "transaction.completed") {
        return pendingCompletionWrite.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: `local-${event.type}` },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.serviceEntry?.setServiceSearchQuery("closure");
    });

    await waitFor(() =>
      expect(result.current.serviceEntry?.searchResults).toHaveLength(1),
    );

    await act(async () => {
      await result.current.serviceEntry?.onAddService(
        result.current.serviceEntry.searchResults[0],
      );
    });
    const serviceLineId = result.current.cart.serviceItems?.[0]?.id;
    const updateServiceAmount = result.current.cart.onUpdateServiceAmount;
    const removeService = result.current.cart.onRemoveService;
    expect(serviceLineId).toBeDefined();
    expect(updateServiceAmount).toBeDefined();
    expect(removeService).toBeDefined();

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 4620);
    });

    let completePromise: Promise<boolean> | undefined;
    await act(async () => {
      completePromise = result.current.checkout.onCompleteTransaction();
    });
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "transaction.completed" }),
      ),
    );

    await act(async () => {
      await updateServiceAmount!(serviceLineId!, 6000);
      await removeService!(serviceLineId!);
    });

    const serviceEvents = mockAppendLocalEvent.mock.calls.filter(
      ([event]) => event.type === "cart.service_added",
    );
    expect(serviceEvents).toHaveLength(1);
    expect(result.current.cart.serviceItems).toEqual([
      expect.objectContaining({
        id: serviceLineId,
        price: 4500,
      }),
    ]);
    expect(toast.error).toHaveBeenCalledWith(
      "Finish the current checkout update before changing the sale.",
    );

    pendingCompletionWrite.resolve({
      ok: true,
      value: { localEventId: "local-transaction-event-1" },
    });
    await act(async () => {
      await completePromise;
    });
  });

  it("does not repeat exact barcode auto-add after the local write completes", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({ quantityAvailable: 1 }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "cart.item_added" }),
      ),
    );
    expect(result.current.cart.items).toEqual([
      expect.objectContaining({
        name: "Deep Wave",
        quantity: 1,
        skuId: "sku-2",
      }),
    ]);

    rerender();

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event?.type === "cart.item_added",
      ),
    ).toHaveLength(1);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("keeps out-of-stock exact catalog matches visible without auto-adding", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        inStock: false,
        quantityAvailable: 0,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("DW-18");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(1);
    expect(result.current.productEntry.searchResults[0]).toEqual(
      expect.objectContaining({
        skuId: "sku-2",
        inStock: false,
        quantityAvailable: 0,
      }),
    );
    expect(mockAddItem).not.toHaveBeenCalled();
  });
  it("keeps exact catalog matches visible but not addable while availability is unknown", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(1);
    expect(result.current.productEntry.searchResults[0]).toEqual(
      expect.objectContaining({
        availabilityMessage:
          "Availability not ready. Reconnect or refresh this terminal before selling this item.",
        availabilityStatus: "unknown",
        skuId: "sku-2",
        inStock: false,
        quantityAvailable: undefined,
      }),
    );

    await act(async () => {
      await result.current.productEntry.onBarcodeSubmit({
        preventDefault: vi.fn(),
      } as never);
    });

    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "cart.item_added" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Availability not ready. Reconnect or refresh this terminal before selling this item.",
    );
  });

  it("uses command-returned availability when attaching a barcode before availability refresh catches up", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        sku: "DW-18",
        barcode: "26377739293888393",
        price: 10_000,
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        availabilityStatus: "available",
        quantityAvailable: 5,
        size: "18",
        length: 18,
        color: "natural",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        areProcessingFeesAbsorbed: false,
      });
    });

    expect(toast.error).not.toHaveBeenCalledWith(
      "Availability not ready. Reconnect or refresh this terminal before selling this item.",
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          productId: "product-2",
          productSkuId: "sku-2",
          productSku: "DW-18",
        }),
      }),
    );
  });

  it("subtracts active terminal-local cart quantity from trusted availability", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        id: "sku-1" as Id<"productSku">,
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        productId: "product-1" as Id<"product">,
        name: "Body Wave",
        sku: "BW-12",
        barcode: "1234567890",
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "local",
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
    ];
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
            status: "open",
          },
        }),
        buildLocalEvent({
          sequence: 2,
          type: "session.started",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1", status: "active" },
        }),
        buildLocalEvent({
          sequence: 3,
          type: "cart.item_added",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "BW-12",
            productName: "Body Wave",
            price: 120,
            quantity: 1,
          },
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("BW-12");
    });

    await waitFor(() =>
      expect(result.current.productEntry.searchResults).toEqual([
        expect.objectContaining({
          skuId: "sku-1",
          inStock: true,
          quantityAvailable: 1,
        }),
      ]),
    );
  });

  it("does not subtract active cart quantity from live hold-aware availability", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        id: "sku-1" as Id<"productSku">,
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        productId: "product-1" as Id<"product">,
        name: "Body Wave",
        sku: "BW-12",
        barcode: "1234567890",
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "live",
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 1,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("BW-12");
    });

    expect(result.current.productEntry.searchResults).toEqual([
      expect.objectContaining({
        availabilityStatus: "available",
        skuId: "sku-1",
        inStock: true,
        quantityAvailable: 1,
      }),
    ]);
  });

  it("subtracts unsynced cart updates on mapped cloud-backed local sessions", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "live",
        quantityAvailable: 1,
      }),
    ];
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
            status: "open",
          },
          sync: { status: "synced", cloudEventId: "cloud-event-1" },
        }),
        buildLocalEvent({
          sequence: 2,
          type: "session.started",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1", status: "active" },
          sync: { status: "synced", cloudEventId: "cloud-event-2" },
        }),
        buildLocalEvent({
          sequence: 3,
          type: "cart.item_added",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            productName: "Deep Wave",
            price: 100,
            quantity: 1,
          },
        }),
      ],
    });
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "posSession",
          localId: "local-sale-1",
          cloudId: "session-1",
          mappedAt: 1_100,
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    await waitFor(() =>
      expect(result.current.productEntry.searchResults).toEqual([
        expect.objectContaining({
          availabilityStatus: "out_of_stock",
          skuId: "sku-2",
          inStock: false,
          quantityAvailable: 0,
        }),
      ]),
    );
  });

  it("subtracts only the unsynced cart delta on mapped cloud-backed local sessions", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "live",
        quantityAvailable: 2,
      }),
    ];
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
            status: "open",
          },
          sync: { status: "synced", cloudEventId: "cloud-event-1" },
        }),
        buildLocalEvent({
          sequence: 2,
          type: "session.started",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1", status: "active" },
          sync: { status: "synced", cloudEventId: "cloud-event-2" },
        }),
        buildLocalEvent({
          sequence: 3,
          type: "cart.item_added",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            productName: "Deep Wave",
            price: 100,
            quantity: 1,
          },
          sync: { status: "synced", cloudEventId: "cloud-event-3" },
        }),
        buildLocalEvent({
          sequence: 4,
          type: "cart.item_added",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            productName: "Deep Wave",
            price: 100,
            quantity: 2,
          },
        }),
      ],
    });
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "posSession",
          localId: "local-sale-1",
          cloudId: "session-1",
          mappedAt: 1_100,
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    await waitFor(() =>
      expect(result.current.productEntry.searchResults).toEqual([
        expect.objectContaining({
          availabilityStatus: "available",
          skuId: "sku-2",
          inStock: true,
          quantityAvailable: 1,
        }),
      ]),
    );
  });

  it("does not subtract cloud-held cart quantity from trusted local fallback", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        id: "sku-1" as Id<"productSku">,
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        productId: "product-1" as Id<"product">,
        name: "Body Wave",
        sku: "BW-12",
        barcode: "1234567890",
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "local",
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 1,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("BW-12");
    });

    expect(result.current.productEntry.searchResults).toEqual([
      expect.objectContaining({
        availabilityStatus: "available",
        skuId: "sku-1",
        inStock: true,
        quantityAvailable: 1,
      }),
    ]);
  });

  it("keeps completed terminal-local sales consuming trusted availability until sync", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        id: "sku-1" as Id<"productSku">,
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        productId: "product-1" as Id<"product">,
        name: "Body Wave",
        sku: "BW-12",
        barcode: "1234567890",
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "local",
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 1,
      }),
    ];
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
            status: "open",
          },
        }),
        buildLocalEvent({
          sequence: 2,
          type: "session.started",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1", status: "active" },
        }),
        buildLocalEvent({
          sequence: 3,
          type: "cart.item_added",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "BW-12",
            productName: "Body Wave",
            price: 120,
            quantity: 1,
          },
        }),
        buildLocalEvent({
          sequence: 4,
          type: "transaction.completed",
          localPosSessionId: "local-sale-1",
          localTransactionId: "local-txn-1",
          payload: {
            localPosSessionId: "local-sale-1",
            localTransactionId: "local-txn-1",
            receiptNumber: "R-1",
            subtotal: 120,
            tax: 0,
            total: 120,
            payments: [{ method: "cash", amount: 120, timestamp: 1_004 }],
          },
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("BW-12");
    });

    await waitFor(() =>
      expect(result.current.productEntry.searchResults).toEqual([
        expect.objectContaining({
          availabilityStatus: "out_of_stock",
          skuId: "sku-1",
          inStock: false,
          quantityAvailable: 0,
        }),
      ]),
    );

    let added = true;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct(
        result.current.productEntry.searchResults[0],
      );
    });

    expect(added).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          productSkuId: "sku-1",
          quantity: 2,
        }),
      }),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      "No trusted availability remains for this item on this terminal.",
    );
  });

  it("allows trusted count mismatches inside the local add queue", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "local",
        quantityAvailable: 1,
      }),
    ];
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
          status: "open",
        },
      }),
    ];
    mockListLocalEvents.mockImplementation(async () => ({
      ok: true,
      value: [...localEvents],
    }));
    mockAppendLocalEvent.mockImplementation(async (event) => {
      if (event?.type === "cart.item_added") {
        localEvents.push(
          buildLocalEvent({
            ...event,
            sequence: localEvents.length + 1,
          }),
        );
      }

      return { ok: true, value: { localEventId: "local-event-1" } };
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    const product = result.current.productEntry.searchResults[0];
    await act(async () => {
      await Promise.all([
        result.current.productEntry.onAddProduct(product),
        result.current.productEntry.onAddProduct(product),
      ]);
    });

    const cartItemAddedEvents = mockAppendLocalEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event?.type === "cart.item_added");
    expect(cartItemAddedEvents.length).toBeGreaterThanOrEqual(2);
    expect(cartItemAddedEvents.at(-1)?.payload).toEqual(
      expect.objectContaining({
        productSkuId: "sku-2",
        quantity: 3,
      }),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      "No trusted availability remains for this item on this terminal.",
    );
  });

  it("adds the requested product quantity through the local cart event", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "local",
        quantityAvailable: 5,
      }),
    ];
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
          status: "open",
        },
      }),
    ];
    mockListLocalEvents.mockImplementation(async () => ({
      ok: true,
      value: [...localEvents],
    }));
    mockAppendLocalEvent.mockImplementation(async (event) => {
      localEvents.push(
        buildLocalEvent({
          ...event,
          sequence: localEvents.length + 1,
        }),
      );

      return { ok: true, value: { localEventId: "local-event-1" } };
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    const product = {
      id: "sku-2",
      name: "Deep Wave",
      price: 10_000,
      barcode: "1234567890123",
      productId: "product-2" as Id<"product">,
      skuId: "sku-2" as Id<"productSku">,
      sku: "DW-18",
      category: "Hair",
      description: "Deep wave bundle",
      image: null,
      inStock: true,
      quantityAvailable: 5,
    };
    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct(product, 3);
    });

    expect(added).toBe(true);
    const cartEvent = mockAppendLocalEvent.mock.calls.find(
      ([event]) => event?.type === "cart.item_added",
    )?.[0];
    expect(cartEvent?.payload).toEqual(
      expect.objectContaining({
        productSkuId: "sku-2",
        quantity: 3,
      }),
    );
  });

  it("adds requested product quantity beyond trusted availability", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "local",
        quantityAvailable: 2,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    const product = {
      id: "sku-2",
      name: "Deep Wave",
      price: 10_000,
      barcode: "1234567890123",
      productId: "product-2" as Id<"product">,
      skuId: "sku-2" as Id<"productSku">,
      sku: "DW-18",
      category: "Hair",
      description: "Deep wave bundle",
      image: null,
      inStock: true,
      quantityAvailable: 2,
    };
    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct(product, 3);
    });

    expect(added).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          productSkuId: "sku-2",
          quantity: 3,
        }),
      }),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      "No trusted availability remains for this item on this terminal.",
    );
  });

  it("allows trusted count mismatches inside queued quantity updates", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilitySource: "local",
        quantityAvailable: 1,
      }),
    ];
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
          status: "open",
        },
        sync: { status: "synced", cloudEventId: "cloud-event-1" },
      }),
      buildLocalEvent({
        sequence: 2,
        type: "session.started",
        localPosSessionId: "session-1",
        payload: { localPosSessionId: "session-1", status: "active" },
        sync: { status: "synced", cloudEventId: "cloud-event-2" },
      }),
      buildLocalEvent({
        sequence: 3,
        type: "cart.item_added",
        localPosSessionId: "session-1",
        payload: {
          localItemId: "item-1",
          productId: "product-2",
          productSkuId: "sku-2",
          productSku: "DW-18",
          productName: "Deep Wave",
          price: 100,
          quantity: 1,
        },
        sync: { status: "synced", cloudEventId: "cloud-event-3" },
      }),
    ];
    mockListLocalEvents.mockImplementation(async () => ({
      ok: true,
      value: [...localEvents],
    }));
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "posSession",
          localId: "session-1",
          cloudId: "session-1",
          mappedAt: 1_100,
        },
      ],
    });
    mockAppendLocalEvent.mockResolvedValue({
      ok: true,
      value: { localEventId: "local-event-1" },
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await Promise.all([
        result.current.cart.onUpdateQuantity(
          "item-1" as Id<"posSessionItem">,
          2,
        ),
        result.current.cart.onUpdateQuantity(
          "item-1" as Id<"posSessionItem">,
          3,
        ),
      ]);
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event?.type === "cart.item_added",
      ),
    ).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalledWith(
      "No trusted availability remains for this item on this terminal.",
    );
  });

  it("does not recheck trusted availability when updating provisional import quantities", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
        quantityAvailable: 0,
      }),
    ];
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
          status: "open",
        },
        sync: { status: "synced", cloudEventId: "cloud-event-1" },
      }),
      buildLocalEvent({
        sequence: 2,
        type: "session.started",
        localPosSessionId: "session-1",
        payload: { localPosSessionId: "session-1", status: "active" },
        sync: { status: "synced", cloudEventId: "cloud-event-2" },
      }),
      buildLocalEvent({
        sequence: 3,
        type: "cart.item_added",
        localPosSessionId: "session-1",
        payload: {
          localItemId: "item-1",
          productId: "product-2",
          productSkuId: "sku-2",
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
          productSku: "DW-18",
          productName: "Deep Wave",
          price: 100,
          quantity: 1,
        },
        sync: { status: "synced", cloudEventId: "cloud-event-3" },
      }),
    ];
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: localEvents,
    });
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "posSession",
          localId: "session-1",
          cloudId: "session-1",
          mappedAt: 1_100,
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        3,
      );
    });

    expect(toast.error).not.toHaveBeenCalledWith(
      "No trusted availability remains for this item on this terminal.",
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
          productSkuId: "sku-2",
          quantity: 3,
        }),
      }),
    );
  });

  it("updates a newly added provisional import line before the local projection refreshes", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        id: "provisional-import-sku-1" as Id<"productSku">,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
        quantityAvailable: 0,
      }),
    ];
    mockListLocalEvents.mockResolvedValue({ ok: true, value: [] });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "provisional-import-sku-1",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      });
    });

    expect(result.current.cart.items).toEqual([
      expect.objectContaining({
        id: "optimistic:provisional-import-sku-1",
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        quantity: 1,
      }),
    ]);

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        result.current.cart.items[0].id as Id<"posSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        quantity: 2,
      }),
    ]);
    expect(toast.error).not.toHaveBeenCalledWith(
      "No trusted availability remains for this item on this terminal.",
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
          productSkuId: "sku-2",
          quantity: 2,
        }),
      }),
    );
  });

  it("updates a newly added provisional import line after local projection refreshes", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        id: "provisional-import-sku-1" as Id<"productSku">,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
        quantityAvailable: 0,
      }),
    ];

    const localEvents: ReturnType<typeof buildLocalEvent>[] = [];
    mockListLocalEvents.mockImplementation(async () => ({
      ok: true,
      value: localEvents,
    }));
    mockAppendLocalEvent.mockImplementation(async (event) => {
      localEvents.push(
        buildLocalEvent({
          ...event,
          sequence: localEvents.length + 1,
        }),
      );
      return {
        ok: true,
        value: { localEventId: `event-${localEvents.length}` },
      };
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "provisional-import-sku-1",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      });
    });

    await waitFor(() =>
      expect(result.current.cart.items[0]).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^local-item-/),
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
          quantity: 1,
        }),
      ),
    );

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        result.current.cart.items[0].id as Id<"posSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        quantity: 2,
      }),
    ]);
    expect(toast.error).not.toHaveBeenCalledWith(
      "No trusted availability remains for this item on this terminal.",
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
          productSkuId: "sku-2",
          quantity: 2,
        }),
      }),
    );
  });

  it("adds distinct provisional import rows that share a trusted SKU", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        id: "provisional-import-sku-1" as Id<"productSku">,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      }),
      buildRegisterCatalogRow({
        id: "provisional-import-sku-2" as Id<"productSku">,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-2" as Id<"inventoryImportProvisionalSku">,
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
        quantityAvailable: 0,
      }),
    ];
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
          status: "open",
        },
      }),
      buildLocalEvent({
        sequence: 2,
        type: "session.started",
        localPosSessionId: "session-1",
        payload: { localPosSessionId: "session-1", status: "active" },
      }),
    ];
    mockListLocalEvents.mockImplementation(async () => ({
      ok: true,
      value: [...localEvents],
    }));
    mockAppendLocalEvent.mockResolvedValue({
      ok: true,
      value: { localEventId: "local-event-1" },
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    const firstProduct = {
      ...buildRegisterCatalogRow({
        id: "provisional-import-sku-1" as Id<"productSku">,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      }),
      availabilityStatus: "available" as const,
      inStock: true,
      quantityAvailable: 0,
    };
    const secondProduct = {
      ...buildRegisterCatalogRow({
        id: "provisional-import-sku-2" as Id<"productSku">,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-2" as Id<"inventoryImportProvisionalSku">,
      }),
      availabilityStatus: "available" as const,
      inStock: true,
      quantityAvailable: 0,
    };

    let firstAdded = false;
    let secondAdded = false;
    await act(async () => {
      firstAdded = await result.current.productEntry.onAddProduct(firstProduct);
      secondAdded =
        await result.current.productEntry.onAddProduct(secondProduct);
    });

    expect(firstAdded).toBe(true);
    expect(secondAdded).toBe(true);
    expect(toast.error).not.toHaveBeenCalledWith(
      "This item is already in the cart from a different inventory source. Remove it and add it again.",
    );
    const cartEvents = mockAppendLocalEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event?.type === "cart.item_added");
    expect(cartEvents).toHaveLength(2);
    expect(cartEvents[0]?.payload).toEqual(
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        productSkuId: "sku-2",
        quantity: 1,
      }),
    );
    expect(cartEvents[1]?.payload).toEqual(
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-2",
        productSkuId: "sku-2",
        quantity: 1,
      }),
    );
    await waitFor(() =>
      expect(result.current.cart.items).toEqual([
        expect.objectContaining({
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
          quantity: 1,
          skuId: "sku-2",
        }),
        expect.objectContaining({
          inventoryImportProvisionalSkuId: "provisional-import-sku-2",
          quantity: 1,
          skuId: "sku-2",
        }),
      ]),
    );
    expect(mockUseConvexRegisterCatalogAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        productSkuIds: expect.arrayContaining(["sku-2"]),
      }),
    );
    const latestAvailabilityInput =
      mockUseConvexRegisterCatalogAvailability.mock.calls.at(-1)?.[0] as
        | { productSkuIds?: string[] }
        | undefined;
    expect(latestAvailabilityInput?.productSkuIds).not.toContain(
      "provisional-import-sku-1",
    );
    expect(latestAvailabilityInput?.productSkuIds).not.toContain(
      "provisional-import-sku-2",
    );
  });

  it("blocks adding a trusted cart line over a same-SKU provisional import row", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow({
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
        quantityAvailable: 0,
      }),
    ];
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
            status: "open",
          },
        }),
        buildLocalEvent({
          sequence: 2,
          type: "session.started",
          localPosSessionId: "session-1",
          payload: { localPosSessionId: "session-1", status: "active" },
        }),
        buildLocalEvent({
          sequence: 3,
          type: "cart.item_added",
          localPosSessionId: "session-1",
          payload: {
            localItemId: "item-provisional-1",
            productId: "product-2",
            productSkuId: "sku-2",
            inventoryImportProvisionalSkuId: "provisional-import-sku-1",
            productSku: "DW-18",
            productName: "Deep Wave",
            price: 10_000,
            quantity: 1,
          },
        }),
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    const trustedProduct = {
      ...buildRegisterCatalogRow(),
      availabilityStatus: "available" as const,
      inStock: true,
      quantityAvailable: 5,
    };
    let added = true;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct(trustedProduct);
    });

    expect(added).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "This item is already in the cart from a different inventory source. Remove it and add it again.",
    );
    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event?.type === "cart.item_added",
      ),
    ).toHaveLength(0);
  });

  it("prioritizes cart item SKUs in the availability request before search results", async () => {
    mockRegisterCatalogRows = Array.from({ length: 55 }, (_, index) =>
      buildRegisterCatalogRow({
        id: `sku-search-${index}` as Id<"productSku">,
        productSkuId: `sku-search-${index}` as Id<"productSku">,
        skuId: `sku-search-${index}` as Id<"productSku">,
        productId: `product-search-${index}` as Id<"product">,
        name: `Searchable Wave ${index}`,
        sku: `SEARCH-${index}`,
        barcode: `barcode-${index}`,
      }),
    );
    mockUseConvexRegisterCatalogAvailability.mockImplementation(
      (input: { productSkuIds?: Array<Id<"productSku">> }) =>
        input.productSkuIds?.includes("sku-2" as Id<"productSku">)
          ? [
              buildRegisterCatalogAvailabilityRow({
                availabilitySource: "live",
                quantityAvailable: 5,
              }),
            ]
          : [],
    );

    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
          status: "open",
        },
        sync: { status: "synced", cloudEventId: "cloud-event-1" },
      }),
      buildLocalEvent({
        sequence: 2,
        type: "session.started",
        localPosSessionId: "session-1",
        payload: { localPosSessionId: "session-1", status: "active" },
        sync: { status: "synced", cloudEventId: "cloud-event-2" },
      }),
      buildLocalEvent({
        sequence: 3,
        type: "cart.item_added",
        localPosSessionId: "session-1",
        payload: {
          localItemId: "item-1",
          productId: "product-2",
          productSkuId: "sku-2",
          productSku: "DW-18",
          productName: "Deep Wave",
          price: 100,
          quantity: 1,
        },
        sync: { status: "synced", cloudEventId: "cloud-event-3" },
      }),
    ];
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: localEvents,
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });
    await waitFor(() =>
      expect(result.current.cart.items).toEqual([
        expect.objectContaining({
          id: "item-1",
          quantity: 1,
          skuId: "sku-2",
        }),
      ]),
    );
    act(() => {
      result.current.productEntry.setProductSearchQuery("searchable");
    });
    await waitFor(() => {
      const latestInput =
        mockUseConvexRegisterCatalogAvailability.mock.calls.at(-1)?.[0] as
          | { productSkuIds?: Array<Id<"productSku">> }
          | undefined;
      const cartSkuIndex =
        latestInput?.productSkuIds?.indexOf("sku-2" as Id<"productSku">) ?? -1;
      const searchSkuIndex =
        latestInput?.productSkuIds?.indexOf(
          "sku-search-0" as Id<"productSku">,
        ) ?? -1;
      expect(cartSkuIndex).toBeGreaterThanOrEqual(0);
      expect(cartSkuIndex).toBeLessThan(50);
      expect(searchSkuIndex).toBeGreaterThan(cartSkuIndex);
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
    });

    expect(mockUseConvexRegisterCatalogAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        productSkuIds: expect.arrayContaining(["sku-2"]),
      }),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      "Availability not ready. Reconnect or refresh this terminal before selling this item.",
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          productSkuId: "sku-2",
          quantity: 2,
        }),
      }),
    );
  });

  it("adds an exact in-stock SKU match on submit without auto-adding first", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("DW-18");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(1);
    expect(mockAddItem).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.productEntry.onBarcodeSubmit({
        preventDefault: vi.fn(),
      } as never);
    });

    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          productId: "product-2",
          productSkuId: "sku-2",
          productSku: "DW-18",
        }),
      }),
    );
  });

  it("shows product-id variants from local catalog without auto-adding", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow(),
      buildRegisterCatalogRow({
        id: "sku-3" as Id<"productSku">,
        productSkuId: "sku-3" as Id<"productSku">,
        skuId: "sku-3" as Id<"productSku">,
        sku: "DW-20",
        barcode: "9876543210123",
        length: 20,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("product-2");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(2);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("keeps local search result order stable when availability changes", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow(),
      buildRegisterCatalogRow({
        id: "sku-3" as Id<"productSku">,
        productSkuId: "sku-3" as Id<"productSku">,
        skuId: "sku-3" as Id<"productSku">,
        sku: "DW-20",
        barcode: "9876543210123",
        length: 20,
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        inStock: false,
        quantityAvailable: 0,
      }),
      buildRegisterCatalogAvailabilityRow({
        productSkuId: "sku-3" as Id<"productSku">,
        skuId: "sku-3" as Id<"productSku">,
        inStock: true,
        quantityAvailable: 8,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("product-2");
    });

    expect(
      result.current.productEntry.searchResults.map((product) => ({
        skuId: product.skuId,
        quantityAvailable: product.quantityAvailable,
      })),
    ).toEqual([
      { skuId: "sku-2", quantityAvailable: 0 },
      { skuId: "sku-3", quantityAvailable: 8 },
    ]);

    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        quantityAvailable: 2,
      }),
      buildRegisterCatalogAvailabilityRow({
        productSkuId: "sku-3" as Id<"productSku">,
        skuId: "sku-3" as Id<"productSku">,
        inStock: false,
        quantityAvailable: 0,
      }),
    ];

    rerender();

    expect(
      result.current.productEntry.searchResults.map((product) => ({
        skuId: product.skuId,
        quantityAvailable: product.quantityAvailable,
      })),
    ).toEqual([
      { skuId: "sku-2", quantityAvailable: 2 },
      { skuId: "sku-3", quantityAvailable: 0 },
    ]);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("pauses resumable-session auto-resume while no active drawer exists", async () => {
    mockRegisterState = {
      phase: "resumable",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: { _id: "session-2", sessionNumber: "POS-0002" },
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(mockResumeSession).not.toHaveBeenCalled();
  });

  it("opens the drawer locally and waits for an explicit sale start", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
      result.current.drawerGate?.onNotesChange?.("Opening float ready");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
        payload: expect.objectContaining({
          openingFloat: 5_000,
          notes: "Opening float ready",
        }),
        staffProofToken: "staff-proof-token",
      }),
    );
    expect(mockStartSession).not.toHaveBeenCalled();

    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-2",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };

    await act(async () => {
      rerender();
    });

    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("requires a fresh staff proof before appending an online drawer opening", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
      });
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
      result.current.drawerGate?.onNotesChange?.("Opening float ready");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
      }),
    );
    expect(result.current.authDialog?.open).toBe(false);
    expect(result.current.drawerGate).toEqual(
      expect.objectContaining({
        errorMessage: "Sign in again before opening the drawer.",
      }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Sign out, then sign in again before opening the drawer.",
    );
  });

  it("allows offline drawer opening without a fresh staff proof", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        activeRoles: ["manager"],
        firstName: "Ama",
        lastName: "Kusi",
      },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
      result.current.drawerGate?.onNotesChange?.("Opening float ready");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
        staffProofToken: undefined,
      }),
    );
    expect(result.current.drawerGate?.errorMessage).not.toBe(
      "Sign in again before opening the drawer.",
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      "Sign out, then sign in again before opening the drawer.",
    );
  });

  it("allows cashier sign-ins to open the drawer without manager-only controls", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        activeRoles: ["cashier"],
        firstName: "Ama",
        lastName: "Kusi",
      },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({ activeRoles: ["cashier"] }),
      );
    });

    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.canOpenDrawer).toBe(true);
    expect(result.current.drawerGate?.canOpenCashControls).toBe(false);
    expect(result.current.closeoutControl?.canShowOpeningFloatCorrection).toBe(
      false,
    );
    expect(result.current.closeoutControl?.canCorrectOpeningFloat).toBe(false);
    expect(result.current.productEntry.canQuickAddProduct).toBe(false);
    expect(result.current.productEntry.canAddPendingCheckoutItem).toBe(false);

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
      }),
    );
  });

  it("lets a cashier open the drawer for a preserved active POS session", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({ activeRoles: ["cashier"] }),
      );
    });

    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.drawerGate?.canOpenDrawer).toBe(true);
    expect(result.current.drawerGate?.canOpenCashControls).toBe(false);

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    mockRegisterState = {
      ...mockRegisterState,
      activeRegisterSession: {
        _id: "drawer-2",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
    };

    await act(async () => {
      rerender();
    });

    expect(mockBindSessionToRegisterSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      staffProfileId: "staff-1",
      registerSessionId: "drawer-2",
    });
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 120 }),
    ]);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
  });

  it("keeps a preserved active POS session usable after opening a local drawer before cloud binding", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
      cartItems: [],
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult({ activeRoles: ["cashier"] }),
      );
    });

    expect(result.current.drawerGate?.mode).toBe("recovery");

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    await waitFor(() => expect(result.current.drawerGate).toBeNull());
    expect(result.current.productEntry.disabled).toBe(false);
    expect(mockBindSessionToRegisterSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
      }),
    );
  });

  it("keeps a preserved sale gated when drawer recovery binding fails", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };
    mockBindSessionToRegisterSession.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "This sale is already bound to another drawer.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    mockRegisterState = {
      ...mockRegisterState,
      activeRegisterSession: {
        _id: "drawer-2",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
    };

    await act(async () => {
      rerender();
    });

    await waitFor(() => {
      expect(result.current.drawerGate?.errorMessage).toBe(
        "This sale is already bound to another drawer.",
      );
    });
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 120 }),
    ]);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("keeps the operator on the drawer gate when opening the drawer fails", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "register.opened"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Unable to open the drawer. Try again.",
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("opens the drawer locally even if the old cloud drawer command would fail", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockOpenDrawer.mockRejectedValueOnce(
      new Error(
        "Uncaught Error: A register session is already open for this register number.",
      ),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate).toBeNull();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("validates the drawer opening float before sending an open-drawer command", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate?.errorMessage).toBe(
      "Opening float required. Enter an amount greater than 0.",
    );
    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("records a pending local drawer-open event after opening the drawer", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.opened",
          localRegisterSessionId: expect.stringMatching(
            /^local-register-terminal-1-/,
          ),
          payload: expect.objectContaining({
            openingFloat: 5_000,
          }),
        }),
      ),
    );
    expect(mockWriteLocalCloudMapping).not.toHaveBeenCalled();
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
  });

  it("requires a provisioned local sync seed before opening the drawer locally", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: null,
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate?.errorMessage).toBe(
      "Terminal setup required. Register this terminal before opening the drawer.",
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "register.opened" }),
    );
  });

  it("routes terminal integrity blocks to the terminal repair drawer gate", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "local-terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5000,
          },
          createdAt: 100,
          sync: { status: "synced" },
        },
      ],
    });
    mockReadTerminalIntegrityState.mockResolvedValue({
      ok: true,
      value: {
        observedAt: 110,
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.mode).toBe("terminalRepair"),
    );
  });

  it("auto repairs terminal setup when the local seed matches the browser fingerprint", async () => {
    mockReadStoredTerminalFingerprint.mockReturnValue({
      fingerprintHash: "local-terminal-1",
      browserInfo: { userAgent: "test-browser" },
    });
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "local-terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5000,
          },
          createdAt: 100,
          sync: { status: "synced" },
        },
      ],
    });
    mockReadTerminalIntegrityState.mockResolvedValue({
      ok: true,
      value: {
        observedAt: 110,
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.mode).toBe("terminalRepair"),
    );
    expect(result.current.drawerGate?.errorMessage).toBeNull();

    await waitFor(() =>
      expect(mockRegisterTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          browserInfo: { userAgent: "test-browser" },
          displayName: "Front Counter",
          fingerprintHash: "local-terminal-1",
          registerNumber: "1",
          storeId: "store-1",
          syncSecretHash: expect.any(String),
        }),
      ),
    );
    expect(
      mockWriteProvisionedTerminalSeedAndClearTerminalIntegrity,
    ).toHaveBeenCalledWith({
      seed: expect.objectContaining({
        cloudTerminalId: "terminal-1",
        displayName: "Front Counter",
        registerNumber: "1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
      terminalIntegrity: {
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });
    expect(toast.success).not.toHaveBeenCalledWith("Terminal setup repaired");
  });

  it("keeps the drawer usable when stale lifecycle authority exists locally", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "local-terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5000,
          },
          createdAt: 100,
          sync: { status: "synced" },
        },
      ],
    });
    mockReadDrawerAuthorityState.mockResolvedValue({
      ok: true,
      value: {
        localRegisterSessionId: "local-register-1",
        observedAt: 110,
        reason: "lifecycle_rejected",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() => expect(result.current.drawerGate).toBeNull());
    expect(result.current.productEntry.disabled).toBe(false);
  });

  it("routes closed drawer authority blocks to the open-drawer gate", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "local-terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5000,
          },
          createdAt: 100,
          sync: { status: "synced" },
        },
      ],
    });
    mockReadDrawerAuthorityState.mockResolvedValue({
      ok: true,
      value: {
        localRegisterSessionId: "local-register-1",
        observedAt: 110,
        reason: "cloud_closed",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.mode).toBe("initialSetup"),
    );
    expect(result.current.drawerGate?.onSubmit).toBeTypeOf("function");
    expect(result.current.drawerGate?.onRetrySync).toBeUndefined();
  });

  it("does not persist drawer authority from the register view hot path", async () => {
    mockRegisterState = {
      ...mockRegisterState!,
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closed",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5000,
        expectedCash: 5000,
        openedAt: 100,
      },
      activeSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "local-terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5000,
          },
          createdAt: 100,
          sync: { status: "synced" },
        },
      ],
    });
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "drawer-1",
          mappedAt: 101,
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    renderHook(() => useRegisterViewModel());

    await waitFor(() => expect(mockListLocalCloudMappings).toHaveBeenCalled());
    expect(mockWriteDrawerAuthorityState).not.toHaveBeenCalled();
  });

  it("requires a provisioned local sync seed before changing checkout state", async () => {
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: null,
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let added = true;
    await act(async () => {
      added = await result.current.checkout.onAddPayment("cash", 120);
    });
    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(added).toBe(false);
    expect(completed).toBe(false);
    expect(result.current.checkout.payments).toEqual([]);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.payments_updated" }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "transaction.completed" }),
    );
  });

  it("seeds an existing cloud drawer into the local log before starting a local sale", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
        localRegisterSessionId: "drawer-1",
        staffProofToken: "staff-proof-token",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: expect.stringMatching(/^local-pos-session-/),
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: "drawer-1",
      }),
    );
  });

  it("seeds an existing cloud active sale before accepting local cart writes", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-1" as Id<"posSession">,
      cartItems: [],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 10_000);
    });
    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    const localEvents = mockAppendLocalEvent.mock.calls.map(([event]) => event);
    const eventTypes = localEvents.map((event) => event.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "register.opened",
        "session.started",
        "cart.item_added",
        "session.payments_updated",
        "transaction.completed",
      ]),
    );
    expect(eventTypes.indexOf("register.opened")).toBeLessThan(
      eventTypes.indexOf("cart.item_added"),
    );
    expect(eventTypes.indexOf("session.started")).toBeLessThan(
      eventTypes.indexOf("cart.item_added"),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
      }),
    );
    for (const event of localEvents.filter(
      (candidate) =>
        candidate.type === "session.started" ||
        candidate.type === "cart.item_added" ||
        candidate.type === "session.payments_updated" ||
        candidate.type === "transaction.completed",
    )) {
      expect(event.localPosSessionId).toBe("session-1");
    }
  });

  it("records a pending checkout definition before the local cart line that uses it", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-1" as Id<"posSession">,
      cartItems: [],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["cashier"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct(
        {
          id: "local-pending-sku-1",
          name: "Uncataloged item",
          price: 12000,
          barcode: "999999999999",
          productId: "local-pending-product-1" as Id<"product">,
          skuId: "local-pending-sku-1" as Id<"productSku">,
          sku: "6B92-8DE-3A1",
          category: "Pending checkout",
          description: "Pending owner review",
          image: null,
          inStock: true,
          pendingCheckoutItemId:
            "local-pending-1" as Id<"posPendingCheckoutItem">,
          pendingCheckoutItemLocalDefinition: {
            localPendingCheckoutItemId: "local-pending-1",
            lookupCode: "999999999999",
            name: "Uncataloged item",
            price: 12000,
            quantitySold: 2,
            localMetadata: {
              schema: "pos_pending_checkout_item_local_metadata_v1",
              cloudValidation: "uncertain",
              createdOffline: true,
            },
          },
          quantityAvailable: undefined,
        },
        2,
      );
    });

    const localEvents = mockAppendLocalEvent.mock.calls.map(([event]) => event);
    const pendingDefinitionIndex = localEvents.findIndex(
      (event) => event?.type === "pending_checkout_item.defined",
    );
    const cartItemIndex = localEvents.findIndex(
      (event) => event?.type === "cart.item_added",
    );

    expect(pendingDefinitionIndex).toBeGreaterThanOrEqual(0);
    expect(cartItemIndex).toBeGreaterThanOrEqual(0);
    expect(pendingDefinitionIndex).toBeLessThan(cartItemIndex);
    expect(localEvents[pendingDefinitionIndex]).toMatchObject({
      localPosSessionId: "session-1",
      payload: expect.objectContaining({
        localPendingCheckoutItemId: "local-pending-1",
        quantitySold: 2,
      }),
      type: "pending_checkout_item.defined",
    });
    expect(localEvents[cartItemIndex]).toMatchObject({
      localPosSessionId: "session-1",
      payload: expect.objectContaining({
        pendingCheckoutItemId: "local-pending-1",
        quantity: 2,
      }),
      type: "cart.item_added",
    });
  });

  it("returns locally added pending checkout items in product search", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-1" as Id<"posSession">,
      cartItems: [],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["cashier"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "local-pending-sku-1",
        name: "Hodor",
        price: 550,
        barcode: "",
        productId: "local-pending-product-1" as Id<"product">,
        skuId: "local-pending-sku-1" as Id<"productSku">,
        sku: "6B92-8DE-3A1",
        category: "Pending checkout",
        description: "Pending owner review",
        image: null,
        inStock: true,
        availabilityStatus: "available",
        pendingCheckoutItemId:
          "local-pending-1" as Id<"posPendingCheckoutItem">,
        pendingCheckoutItemLocalDefinition: {
          localPendingCheckoutItemId: "local-pending-1",
          name: "Hodor",
          price: 550,
          quantitySold: 1,
          localMetadata: {
            schema: "pos_pending_checkout_item_local_metadata_v1",
            cloudValidation: "uncertain",
            createdOffline: true,
          },
        },
      });
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("hodor");
    });

    expect(result.current.productEntry.searchResults).toEqual([
      expect.objectContaining({
        name: "Hodor",
        pendingCheckoutItemId: "local-pending-1",
        sku: "6B92-8DE-3A1",
        skuId: "local-pending-sku-1",
      }),
    ]);
  });

  it("returns locally saved pending checkout items in product search for later transactions", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
        }),
        buildLocalEvent({
          sequence: 2,
          type: "session.started",
          localPosSessionId: "session-1",
          payload: {
            localPosSessionId: "session-1",
            registerSessionId: "drawer-1",
          },
        }),
        buildLocalEvent({
          sequence: 3,
          type: "pending_checkout_item.defined",
          localPosSessionId: "session-1",
          payload: {
            localPendingCheckoutItemId: "local-pending-1",
            name: "Hodor",
            price: 550,
            quantitySold: 1,
            localMetadata: {
              schema: "pos_pending_checkout_item_local_metadata_v1",
              cloudValidation: "uncertain",
              createdOffline: true,
            },
          },
        }),
        buildLocalEvent({
          sequence: 4,
          type: "cart.item_added",
          localPosSessionId: "session-1",
          payload: {
            localItemId: "local-item-1",
            productId: "local-pending-product-1",
            productSkuId: "local-pending-sku-1",
            pendingCheckoutItemId: "local-pending-1",
            productName: "Hodor",
            productSku: "6B92-8DE-3A1",
            quantity: 1,
            price: 550,
          },
        }),
        buildLocalEvent({
          sequence: 5,
          type: "transaction.completed",
          localPosSessionId: "session-1",
          localTransactionId: "transaction-1",
          payload: {
            localTransactionId: "transaction-1",
            receiptNumber: "LOCAL-1",
            items: [
              {
                localItemId: "local-item-1",
                productId: "local-pending-product-1",
                productSkuId: "local-pending-sku-1",
                pendingCheckoutItemId: "local-pending-1",
                productName: "Hodor",
                productSku: "6B92-8DE-3A1",
                quantity: 1,
                price: 550,
              },
            ],
            payments: [{ id: "payment-1", method: "cash", amount: 550 }],
            subtotal: 550,
            tax: 0,
            total: 550,
          },
        }),
        buildLocalEvent({
          sequence: 6,
          type: "session.started",
          localPosSessionId: "session-2",
          payload: {
            localPosSessionId: "session-2",
            registerSessionId: "drawer-1",
          },
        }),
      ],
    });
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-2", sessionNumber: "POS-0002" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-2" as Id<"posSession">,
      cartItems: [],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["cashier"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("hodor");
    });

    await waitFor(() =>
      expect(result.current.productEntry.searchResults).toEqual([
        expect.objectContaining({
          name: "Hodor",
          pendingCheckoutItemId: "local-pending-1",
          sku: "6B92-8DE-3A1",
          skuId: "local-pending-sku-1",
        }),
      ]),
    );
  });

  it("completes cloud-backed local cart changes with existing cloud cart lines", async () => {
    const localEvents: Array<Record<string, unknown>> = [];
    mockAppendLocalEvent.mockImplementation(
      async (input: Record<string, unknown>) => {
        localEvents.push({
          localEventId: `local-event-${localEvents.length + 1}`,
          schemaVersion: 1,
          sequence: localEvents.length + 1,
          createdAt: 1_000 + localEvents.length + 1,
          sync: { status: "pending" },
          ...input,
        });
        return {
          ok: true,
          value: { localEventId: `local-event-${localEvents.length}` },
        };
      },
    );
    mockListLocalEvents.mockImplementation(() =>
      Promise.resolve({ ok: true, value: localEvents }),
    );
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-1" as Id<"posSession">,
      cartItems: [
        {
          id: "item-1" as Id<"posSessionItem">,
          name: "Body Wave",
          barcode: "BW-1",
          price: 120,
          quantity: 1,
          productId: "product-1" as Id<"product">,
          skuId: "sku-1" as Id<"productSku">,
        },
      ],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 220);
    });

    let completed = false;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        localPosSessionId: "session-1",
        payload: expect.objectContaining({
          subtotal: 220,
          total: 220,
          items: expect.arrayContaining([
            expect.objectContaining({
              localItemId: "item-1",
              productSkuId: "sku-1",
              price: 120,
              quantity: 1,
            }),
            expect.objectContaining({
              localItemId: expect.stringMatching(/^local-item-/),
              productSkuId: "sku-2",
              price: 100,
              quantity: 1,
            }),
          ]),
        }),
      }),
    );
  });

  it("durably clears a cloud-backed sale that has local-first events", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: {
            localPosSessionId: "session-1",
            registerSessionId: "drawer-1",
          },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-cart",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productName: "Body Wave",
            productSku: "BW-12",
            quantity: 1,
            price: 120,
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-1" as Id<"posSession">,
      cartItems: [],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.sessionPanel?.activeSessionNumber).toBe(
        "Local sale",
      ),
    );

    mockAppendLocalEvent.mockClear();
    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.cleared",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
      }),
    );
    expect(mockVoidSession).not.toHaveBeenCalled();
    expect(result.current.sessionPanel?.activeSessionNumber).toBeNull();
    expect(result.current.sessionPanel?.disableNewSession).toBe(false);
  });

  it("lets a pending local drawer open build an offline cart without cloud drawer or session ids", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockOpenDrawer.mockResolvedValueOnce(
      userError({
        code: "unavailable",
        message: "Connection unavailable.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
      result.current.drawerGate?.onNotesChange?.("Opening float ready");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.opened",
          localRegisterSessionId: expect.stringMatching(
            /^local-register-terminal-1-/,
          ),
          staffProofToken: "staff-proof-token",
          payload: expect.objectContaining({
            openingFloat: 5_000,
            notes: "Opening float ready",
          }),
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Drawer open");
    await waitFor(() => expect(result.current.drawerGate).toBeNull());
    expect(result.current.productEntry.disabled).toBe(false);
    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        status: "pending_sync",
        label: "Pending sync",
      }),
    );
    expect(mockStartSession).not.toHaveBeenCalled();

    const registerOpenedEvent = mockAppendLocalEvent.mock.calls.find(
      ([event]) => event.type === "register.opened",
    )?.[0];
    expect(registerOpenedEvent).toBeDefined();
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          localEventId: "event-opened",
          localRegisterSessionId: registerOpenedEvent.localRegisterSessionId,
          payload: registerOpenedEvent.payload,
          sequence: 1,
          sync: { status: "synced", uploaded: true },
          type: "register.opened",
        }),
      ],
    });

    const runtimeInput = mockUsePosLocalSyncRuntimeStatus.mock.calls.at(
      -1,
    )?.[0] as { onLocalEventsChanged?: () => void } | undefined;
    await act(async () => {
      runtimeInput?.onLocalEventsChanged?.();
    });

    await waitFor(() =>
      expect(result.current.syncStatus).toEqual(
        expect.objectContaining({
          status: "synced",
          label: "Synced",
        }),
      ),
    );

    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(true);
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 1,
        }),
      ]),
    );
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.started",
          localRegisterSessionId: expect.stringMatching(
            /^local-register-terminal-1-/,
          ),
          localPosSessionId: expect.stringMatching(/^local-pos-session-/),
        }),
      ),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
        localPosSessionId: expect.stringMatching(/^local-pos-session-/),
      }),
    );

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "optimistic:sku-2" as Id<"posSessionItem">,
        2,
      );
    });
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "sku-2",
          quantity: 2,
        }),
      ]),
    );

    await act(async () => {
      await result.current.cart.onRemoveItem(
        "optimistic:sku-2" as Id<"posSessionItem">,
      );
    });
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(result.current.cart.items).toEqual([]);

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });
    await act(async () => {
      await result.current.cart.onClearCart();
    });
    expect(
      mockReleaseSessionInventoryHoldsAndDeleteItems,
    ).not.toHaveBeenCalled();
    expect(result.current.cart.items).toEqual([]);

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "optimistic:sku-2" as Id<"posSessionItem">,
        2,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 200);
    });
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.payments_updated",
          localPosSessionId: expect.stringMatching(/^local-pos-session-/),
          payload: expect.objectContaining({
            payments: [
              expect.objectContaining({ method: "cash", amount: 200 }),
            ],
            stage: "paymentAdded",
          }),
        }),
      ),
    );

    let completed = false;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockCompleteTransaction).not.toHaveBeenCalled();
    expect(result.current.checkout.completedOrderNumber).toMatch(/^\d{6}$/);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
        localPosSessionId: expect.stringMatching(/^local-pos-session-/),
        localTransactionId: expect.stringMatching(/^local-txn-/),
        staffProofToken: "staff-proof-token",
        payload: expect.objectContaining({
          receiptNumber: expect.stringMatching(/^\d{6}$/),
          total: 200,
          items: [
            expect.objectContaining({
              localItemId: "optimistic:sku-2",
              productSkuId: "sku-2",
              price: 100,
              quantity: 2,
            }),
          ],
          payments: [expect.objectContaining({ method: "cash", amount: 200 })],
        }),
      }),
    );
  });

  it("replays a persisted local register sale and payment draft into the active UI", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-1",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-2",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-3",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            productName: "Deep Wave",
            price: 100,
            quantity: 2,
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-4",
          schemaVersion: 1,
          sequence: 4,
          type: "session.payments_updated",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            payments: [{ method: "cash", amount: 200, timestamp: 1_003 }],
            stage: "paymentAdded",
          },
          createdAt: 1_003,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.checkout.cartItems).toEqual([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 2,
        }),
      ]),
    );
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 200 }),
    ]);
    expect(result.current.closeoutControl?.canCloseout).toBe(false);
  });

  it("clears stale local register state when the local event log cannot be read", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-1",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-2",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-3",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            productName: "Deep Wave",
            price: 100,
            quantity: 2,
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.checkout.cartItems).toEqual([
        expect.objectContaining({ name: "Deep Wave", quantity: 2 }),
      ]),
    );

    mockListLocalEvents.mockResolvedValue({
      ok: false,
      error: { message: "IndexedDB unavailable" },
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 10_000);
    });

    await waitFor(() => expect(result.current.checkout.cartItems).toEqual([]));
    expect(result.current.checkout.payments).toEqual([]);
  });

  it("shows the closeout gate immediately after a local closeout is submitted", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-1",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-2",
          schemaVersion: 1,
          sequence: 2,
          type: "register.closeout_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            countedCash: 5_000,
            notes: null,
          },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.mode).toBe("initialSetup"),
    );
    expect(result.current.drawerGate?.closeoutSubmittedReason).toBeUndefined();
    expect(
      result.current.drawerGate?.closeoutSubmittedCountedCash,
    ).toBeUndefined();
    expect(
      result.current.drawerGate?.closeoutSubmittedVariance,
    ).toBeUndefined();
    expect(result.current.drawerGate?.closeoutSecondaryActionLabel).toBeUndefined();
    expect(result.current.drawerGate?.onSubmit).toEqual(expect.any(Function));
    expect(result.current.drawerGate?.onSubmitCloseout).toBeUndefined();
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.closeoutControl?.canCloseout).toBe(false);
    expect(result.current.drawerGate?.onReopenRegister).toBeUndefined();
  });

  it("opens a new drawer when the cloud register closed before local closeout sync cleared", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closed",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: {
            expectedCash: 5_000,
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
          },
          sync: { status: "synced", uploaded: true },
        }),
        buildLocalEvent({
          sequence: 2,
          type: "register.closeout_started",
          localRegisterSessionId: "local-register-1",
          payload: {
            countedCash: 5_000,
            notes: null,
          },
          sync: { status: "pending", uploaded: false },
        }),
      ],
    });
    mockListLocalCloudMappings.mockResolvedValue({
      ok: true,
      value: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "drawer-1",
          mappedAt: 1_100,
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });
    await waitForLocalRegisterEffects(result);

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.closeoutSubmittedReason).toBeUndefined();
    expect(
      result.current.drawerGate?.closeoutSecondaryActionLabel,
    ).toBeUndefined();
    expect(result.current.drawerGate?.onSubmit).toEqual(expect.any(Function));
    expect(result.current.drawerGate?.onSubmitCloseout).toBeUndefined();
    expect(result.current.productEntry.disabled).toBe(true);

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
    });

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.started" }),
    );

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("12.00");
      result.current.drawerGate?.onNotesChange?.("Replacement drawer");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        localRegisterSessionId: expect.not.stringMatching(/^local-register-1$/),
        payload: expect.objectContaining({
          notes: "Replacement drawer",
          openingFloat: 1_200,
        }),
        type: "register.opened",
      }),
    );
  });

  it("does not present a synced local closeout as pending sync or closeout in progress", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-1",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "synced", uploaded: true },
        },
        {
          localEventId: "local-event-2",
          schemaVersion: 1,
          sequence: 2,
          type: "register.closeout_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            countedCash: 5_000,
            notes: null,
          },
          createdAt: 1_001,
          sync: { status: "synced", uploaded: true },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.mode).toBe("initialSetup"),
    );
    expect(result.current.syncStatus?.status).toBe("synced");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.closeoutControl?.canCloseout).toBe(false);
    expect(result.current.drawerGate?.onReopenRegister).toBeUndefined();
  });

  it("lets a locally opened empty drawer enter the local closeout flow", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });
    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });
    await waitFor(() =>
      expect(result.current.closeoutControl?.canCloseout).toBe(true),
    );

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });
    expect(result.current.drawerGate?.registerSessionCode).toMatch(
      /^[A-Z0-9-]{6}$/,
    );
    expect(result.current.drawerGate?.registerSessionCode).not.toContain(
      "local-register",
    );
    expect(result.current.drawerGate?.registerSessionCodeScope).toBe("local");
    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("50.00");
    });
    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
        staffProofToken: "staff-proof-token",
        payload: expect.objectContaining({ countedCash: 5_000 }),
      }),
    );
  });

  it("uses the projected local drawer cash total for closeout after local cash sales", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const localEvents: ReturnType<typeof buildLocalEvent>[] = [];
    mockAppendLocalEvent.mockImplementation(async (event) => {
      const sequence = localEvents.length + 1;
      const localEvent = buildLocalEvent({
        ...event,
        localEventId: `local-event-${sequence}`,
        sequence,
        createdAt: 1_000 + sequence,
        sync: { status: "pending" },
      });
      localEvents.push(localEvent);
      return { ok: true, value: localEvent };
    });
    mockListLocalEvents.mockImplementation(async () => ({
      ok: true,
      value: [...localEvents],
    }));
    let notifyLocalEventsChanged: (() => void) | undefined;
    mockUsePosLocalSyncRuntimeStatus.mockImplementation(
      (input: { onLocalEventsChanged?: () => void }) => {
        notifyLocalEventsChanged = input.onLocalEventsChanged;
        return null;
      },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("90.00");
    });
    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });
    await waitFor(() =>
      expect(result.current.closeoutControl?.canCloseout).toBe(true),
    );

    const localRegisterSessionId = localEvents.find(
      (event) => event.type === "register.opened",
    )?.localRegisterSessionId;
    expect(localRegisterSessionId).toEqual(expect.stringMatching(/^local-/));
    localEvents.push(
      buildLocalEvent({
        sequence: localEvents.length + 1,
        type: "transaction.completed",
        localRegisterSessionId,
        localPosSessionId: "local-sale-1",
        localTransactionId: "local-txn-1",
        payload: {
          localPosSessionId: "local-sale-1",
          localTransactionId: "local-txn-1",
          receiptNumber: "R-1",
          subtotal: 4_000,
          tax: 0,
          total: 4_000,
          payments: [{ method: "cash", amount: 4_000, timestamp: 1_004 }],
        },
      }),
    );
    act(() => {
      notifyLocalEventsChanged?.();
    });
    await waitFor(() =>
      expect(result.current.closeoutControl?.canCloseout).toBe(true),
    );

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.expectedCash).toBe(13_000),
    );
    expect(result.current.drawerGate?.mode).toBe("closeoutBlocked");
  });

  it("keeps a local sale active instead of claiming an unsupported local hold", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });
    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });
    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });
    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.sessionPanel?.onHoldCurrentSession();
    });

    expect(mockHoldSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.held" }),
    );
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(toast.error).toHaveBeenCalledWith(
      "Complete or clear this local sale before leaving the register.",
    );
    expect(toast.success).not.toHaveBeenCalledWith("Sale placed on hold");
  });

  it("voids an empty active session when navigating away/unmounting", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, unmount } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.onNavigateBack();
    });

    await act(async () => {
      unmount();
    });

    expect(mockHoldSession).not.toHaveBeenCalled();
    expect(mockVoidSession).toHaveBeenCalledWith({
      sessionId: "session-1" as Id<"posSession">,
    });
    expect(mockNavigateBack).toHaveBeenCalled();
  });

  it("leaves an unauthenticated empty local sale without requiring register sign-in", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() => expect(result.current.authDialog?.open).toBe(true));
    await act(async () => {
      await result.current.onNavigateBack();
    });

    expect(mockNavigateBack).toHaveBeenCalled();
    expect(mockVoidSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "cart.cleared" }),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      "Register sign-in required. Sign in before clearing it.",
    );
  });

  it("does not show the sale-cleared toast when voiding an empty sale", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockVoidSession).toHaveBeenCalledWith({
      sessionId: "session-1" as Id<"posSession">,
    });
    expect(toast.success).not.toHaveBeenCalledWith("Sale cleared");
  });

  it("shows the sale-cleared toast when voiding a sale with cart items", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockVoidSession).toHaveBeenCalledWith({
      sessionId: "session-1" as Id<"posSession">,
    });
    expect(toast.success).toHaveBeenCalledWith("Sale cleared");
  });

  it("orders session-panel local clear after pending payment writes", async () => {
    mockActiveSession = null;
    mockRegisterState = {
      ...mockRegisterState!,
      activeSession: null,
    };
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-cart",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localItemId: "item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productName: "Body Wave",
            productSku: "BW-1",
            price: 120,
            quantity: 1,
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });
    const pendingPaymentUpdate = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) => {
      if (input.type === "session.payments_updated") {
        return pendingPaymentUpdate.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: "local-clear-event-1" },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });
    await waitFor(() =>
      expect(result.current.checkout.cartItems).toHaveLength(1),
    );

    let addPaymentPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPaymentPromise = result.current.checkout.onAddPayment("cash", 120);
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.sessionPanel?.onVoidCurrentSession();
    });

    pendingPaymentUpdate.resolve({
      ok: true,
      value: { localEventId: "local-payment-event-1" },
    });
    await act(async () => {
      await addPaymentPromise;
      await clearPromise;
    });

    expect(
      mockAppendLocalEvent.mock.calls.map(([event]) => event.type),
    ).toEqual(["session.payments_updated", "cart.cleared"]);
    expect(result.current.checkout.payments).toEqual([]);
    expect(result.current.checkout.cartItems).toEqual([]);
  });

  it("does not void an empty active session before resuming a held one", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
    };
    mockHeldSessions = [
      {
        _id: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
        sessionNumber: "POS-0002",
        updatedAt: Date.now(),
        cartItems: [],
        customer: null,
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onResumeSession(
        "session-2" as Id<"posSession">,
      );
    });

    expect(mockVoidSession).not.toHaveBeenCalled();
    expect(mockResumeSession).toHaveBeenCalledWith({
      sessionId: "session-2",
      staffProfileId: "staff-1",
      terminalId: "terminal-1",
    });
  });

  it("does not treat customer-only drafts as holdable sessions", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: {
        _id: "customer-1" as Id<"posCustomer">,
        name: "Ama Serwa",
        email: "ama@example.com",
        phone: "555-0100",
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.sessionPanel?.canHoldSession).toBe(false);
    expect(result.current.sessionPanel?.canClearSale).toBe(true);

    await act(async () => {
      await result.current.onNavigateBack();
    });

    expect(mockHoldSession).not.toHaveBeenCalled();
    expect(mockVoidSession).toHaveBeenCalledWith({
      sessionId: "session-1" as Id<"posSession">,
    });
    expect(mockNavigateBack).toHaveBeenCalled();
  });

  it("does not expose clear sale for an empty active session", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      payments: [],
      customer: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.sessionPanel?.canHoldSession).toBe(false);
    expect(result.current.sessionPanel?.canClearSale).toBe(false);
  });

  it("does not require the legacy register store or orchestration hooks", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(currentDir, "useRegisterViewModel.ts"),
      "utf8",
    );

    expect(source).not.toContain("usePOSStore");
    expect(source).not.toContain("useCartOperations");
    expect(source).not.toContain("useCustomerOperations");
    expect(source).not.toContain("usePOSOperations");
    expect(source).not.toContain("usePOSSessions");
    expect(source).not.toContain("useSessionManagement");
    expect(source).not.toContain("useSessionManagerOperations");
    expect(source).not.toContain("usePOSProductSearch");
    expect(source).not.toContain("usePOSBarcodeSearch");
    expect(source).not.toContain("usePOSProductIdSearch");
  });

  it("refuses quantity updates for malformed cart items that are missing sku metadata", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [
        {
          ...mockActiveSession!.cartItems[0],
          skuId: undefined,
        } as never,
      ],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
    });

    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("optimistically updates cart quantity while the server mutation is pending", async () => {
    let resolveAddItem: (value: ReturnType<typeof ok>) => void = () => {};
    mockAddItem.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAddItem = resolve as typeof resolveAddItem;
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items[0].quantity).toBe(2);
    expect(result.current.checkout.cartItems[0].quantity).toBe(2);

    resolveAddItem(
      ok({
        itemId: "item-1" as Id<"posSessionItem">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    await act(async () => {
      await updatePromise;
    });
  });

  it("optimistically adds product selections while the local write is pending", async () => {
    const pendingAppend = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 1,
        }),
      ]),
    );
    expect(result.current.checkout.cartItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 1,
        }),
      ]),
    );

    pendingAppend.resolve({
      ok: true,
      value: { localEventId: "local-event-1" },
    });
    await act(async () => {
      await addPromise;
    });
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        payload: expect.objectContaining({
          localItemId: expect.stringMatching(/^local-item-/),
          productSkuId: "sku-2",
          quantity: 1,
        }),
      }),
    );
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
  });

  it("optimistically increments existing product selections while the local write is pending", async () => {
    const pendingAppend = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct({
        id: "sku-1",
        name: "Body Wave",
        price: 120,
        barcode: "1234567890",
        productId: "product-1" as Id<"product">,
        skuId: "sku-1" as Id<"productSku">,
        sku: "BW-12",
        category: "Hair",
        description: "Body wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(result.current.cart.items[0].quantity).toBe(2);
    expect(result.current.checkout.cartItems[0].quantity).toBe(2);

    pendingAppend.resolve({
      ok: true,
      value: { localEventId: "local-event-1" },
    });
    await act(async () => {
      await addPromise;
    });
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("rolls back optimistic quantity changes when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items[0].quantity).toBe(2);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await updatePromise;
    });

    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems[0].quantity).toBe(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to update this sale. Try again.",
    );
  });

  it("rolls back optimistic product selections when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
        }),
      ]),
    );

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await addPromise;
    });

    expect(result.current.cart.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "sku-2",
        }),
      ]),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to add this item. Try again.",
    );
  });

  it("keeps an optimistic cart item and records a pending local cart event", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    vi.mocked(toast.success).mockClear();
    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(true);
    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 1,
        }),
      ]),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
      }),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith("Connection unavailable.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("snapshots optimistic cart items into a pending local sale on completion", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "optimistic:sku-2" as Id<"posSessionItem">,
        2,
      );
    });
    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });
    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 10_000);
    });
    await waitFor(() =>
      expect(result.current.checkout.payments).toEqual([
        expect.objectContaining({ method: "cash", amount: 10_000 }),
      ]),
    );

    let completed = false;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        staffProofToken: "staff-proof-token",
        payload: expect.objectContaining({
          customerEmail: "efua@example.com",
          customerName: "Efua Mensah",
          customerPhone: "555-2222",
          customerProfileId: "profile-2",
          items: expect.arrayContaining([
            expect.objectContaining({
              localItemId: "optimistic:sku-2",
              productSkuId: "sku-2",
              price: 100,
              quantity: 2,
            }),
          ]),
          payments: [
            expect.objectContaining({ method: "cash", amount: 10_000 }),
          ],
        }),
      }),
    );
  });

  it("does not claim a local cart add when the sale session cannot be saved locally", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.started"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    let added = true;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(false);
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.started" }),
    );
    expect(result.current.cart.items).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to start this sale. Try again.",
    );
  });

  it("rolls back optimistic existing product selections when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct({
        id: "sku-1",
        name: "Body Wave",
        price: 120,
        barcode: "1234567890",
        productId: "product-1" as Id<"product">,
        skuId: "sku-1" as Id<"productSku">,
        sku: "BW-12",
        category: "Hair",
        description: "Body wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(result.current.cart.items[0].quantity).toBe(2);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await addPromise;
    });

    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems[0].quantity).toBe(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to add this item. Try again.",
    );
  });

  it("hides remove-to-zero quantity changes while the local write is pending and restores on failure", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        0,
      );
    });

    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await removePromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to update this sale. Try again.",
    );
  });

  it("hides explicit cart item removals while the local write is pending", async () => {
    const pendingAppend = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "item-1" as Id<"posSessionItem">,
      );
    });

    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);

    pendingAppend.resolve({
      ok: true,
      value: { localEventId: "local-event-1" },
    });
    await act(async () => {
      await removePromise;
    });
    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it("updates and removes a just-added provisional optimistic row by row identity", async () => {
    mockActiveSession = null;
    const localEvents = [
      buildLocalEvent({
        sequence: 1,
        type: "register.opened",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
          status: "open",
        },
      }),
      buildLocalEvent({
        sequence: 2,
        type: "session.started",
        localPosSessionId: "session-1",
        payload: { localPosSessionId: "session-1", status: "active" },
      }),
    ];
    mockListLocalEvents.mockImplementation(async () => ({
      ok: true,
      value: [...localEvents],
    }));
    mockAppendLocalEvent.mockResolvedValue({
      ok: true,
      value: { localEventId: "local-event-1" },
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "provisional-import-sku-1",
        name: "Deep Wave",
        price: 10_000,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      });
    });

    await waitFor(() =>
      expect(result.current.cart.items).toEqual([
        expect.objectContaining({
          id: "optimistic:provisional-import-sku-1",
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
          quantity: 1,
          skuId: "sku-2",
        }),
      ]),
    );

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "optimistic:provisional-import-sku-1" as Id<"posSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items).toEqual([
      expect.objectContaining({
        id: "optimistic:provisional-import-sku-1",
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        quantity: 2,
        skuId: "sku-2",
      }),
    ]);

    await act(async () => {
      await result.current.cart.onRemoveItem(
        "optimistic:provisional-import-sku-1" as Id<"posSessionItem">,
      );
    });

    expect(result.current.cart.items).toEqual([]);
    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event?.type === "cart.item_added",
      ),
    ).toHaveLength(3);
    expect(mockAppendLocalEvent.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
          productSkuId: "sku-2",
          quantity: 0,
        }),
      }),
    );
  });

  it("does not complete with an empty refreshed local cart after a pending removal settles", async () => {
    const pendingRemove = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    const localEvents: unknown[] = [
      {
        localEventId: "local-event-open",
        schemaVersion: 1,
        sequence: 1,
        type: "register.opened",
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
        },
        createdAt: 1_000,
        sync: { status: "pending" },
      },
      {
        localEventId: "local-event-session",
        schemaVersion: 1,
        sequence: 2,
        type: "session.started",
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        staffProfileId: "staff-1",
        payload: { localPosSessionId: "session-1" },
        createdAt: 1_001,
        sync: { status: "pending" },
      },
    ];
    mockAppendLocalEvent.mockImplementation(
      (input: Record<string, unknown>) => {
        localEvents.push({
          localEventId: `local-event-${localEvents.length + 1}`,
          schemaVersion: 1,
          sequence: localEvents.length + 1,
          createdAt: 1_000 + localEvents.length + 1,
          sync: { status: "pending" },
          ...input,
        });
        if (input.type === "cart.item_added") {
          return pendingRemove.promise;
        }
        return Promise.resolve({
          ok: true,
          value: { localEventId: `local-event-${localEvents.length}` },
        });
      },
    );
    mockListLocalEvents.mockImplementation(() =>
      Promise.resolve({ ok: true, value: localEvents }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "item-1" as Id<"posSessionItem">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    let completePromise: Promise<boolean> | undefined;
    let completed = true;
    await act(async () => {
      completePromise = result.current.checkout
        .onCompleteTransaction()
        .then((value) => {
          completed = value;
          return value;
        });
    });

    pendingRemove.resolve({
      ok: true,
      value: { localEventId: "local-remove-event-1" },
    });
    await act(async () => {
      await removePromise;
      await completePromise;
    });

    expect(completed).toBe(false);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "transaction.completed" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Add an item before completing the sale.",
    );
  });

  it("restores explicit cart item removals when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "item-1" as Id<"posSessionItem">,
      );
    });

    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await removePromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to update this sale. Try again.",
    );
  });

  it("keeps cart items visible until the local clear write is durable", async () => {
    const pendingAppend = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);

    pendingAppend.resolve({
      ok: true,
      value: { localEventId: "local-event-1" },
    });
    await act(async () => {
      await clearPromise;
    });

    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("Sale cleared");
  });

  it("rolls back optimistic clear-cart removals when a local removal write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    expect(result.current.cart.items).toHaveLength(1);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await clearPromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to update this sale. Try again.",
    );
  });

  it("saves payment milestones locally for the normal online register path", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });
    const localPaymentId = result.current.checkout.payments[0]?.id;

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        localPosSessionId: "session-1",
        staffProfileId: "staff-1",
        payload: expect.objectContaining({
          checkoutStateVersion: expect.any(Number),
          stage: "paymentAdded",
          paymentMethod: "cash",
          amount: 120,
          payments: [
            expect.objectContaining({
              localPaymentId,
              method: "cash",
              amount: 120,
            }),
          ],
        }),
      }),
    );
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
  });

  it("does not present a payment draft until the local event is durable", async () => {
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.payments_updated"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to update this payment. Try again.",
    );

    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(false);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "transaction.completed" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Payment required. Add payment before completing the sale.",
    );
  });

  it("saves payment edits, removals, and manual clears locally before updating UI state", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 60);
    });
    const paymentId = result.current.checkout.payments[0].id;

    await act(async () => {
      await result.current.checkout.onUpdatePayment(paymentId, 80);
    });

    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ amount: 80, method: "cash" }),
    ]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          amount: 80,
          paymentMethod: "cash",
          previousAmount: 60,
          stage: "paymentUpdated",
        }),
      }),
    );

    await act(async () => {
      await result.current.checkout.onRemovePayment(paymentId);
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          amount: 80,
          paymentMethod: "cash",
          payments: [],
          stage: "paymentRemoved",
        }),
      }),
    );

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 40);
      await result.current.checkout.onClearPayments();
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          payments: [],
          stage: "paymentsCleared",
        }),
      }),
    );
  });

  it("keeps payment edit state unchanged when local update persistence fails", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 60);
    });
    const paymentId = result.current.checkout.payments[0].id;

    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.payments_updated"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    let updated = true;
    await act(async () => {
      updated = await result.current.checkout.onUpdatePayment(paymentId, 80);
    });

    expect(updated).toBe(false);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ amount: 60, method: "cash" }),
    ]);
  });

  it("keeps same-method payment totals unchanged when the second local write fails", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 60);
    });
    const firstPaymentId = result.current.checkout.payments[0].id;

    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.payments_updated"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    let added = true;
    await act(async () => {
      added = await result.current.checkout.onAddPayment("cash", 40);
    });

    expect(added).toBe(false);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({
        id: firstPaymentId,
        amount: 60,
        method: "cash",
      }),
    ]);
  });

  it("waits for queued payment edits before completing a local sale", async () => {
    const pendingPaymentUpdate = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) => {
      if (input.type === "session.payments_updated") {
        return pendingPaymentUpdate.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: "local-event-1" },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPaymentPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPaymentPromise = result.current.checkout.onAddPayment("cash", 120);
    });
    expect(result.current.checkout.payments).toEqual([]);

    let completed: boolean | undefined;
    let completePromise: Promise<void> | undefined;
    await act(async () => {
      completePromise = result.current.checkout
        .onCompleteTransaction()
        .then((result) => {
          completed = result;
        });
    });

    pendingPaymentUpdate.resolve({
      ok: true,
      value: { localEventId: "local-payment-event-1" },
    });
    await act(async () => {
      await addPaymentPromise;
      await completePromise;
    });

    expect(completed).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        payload: expect.objectContaining({
          payments: [
            expect.objectContaining({
              amount: 120,
              method: "cash",
            }),
          ],
        }),
      }),
    );
  });

  it("rejects payment edits that start while a local completion is in progress", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [
        {
          ...mockActiveSession!.cartItems[0],
          inventoryImportProvisionalSkuId:
            "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
        },
      ],
    };
    const pendingCompletion = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) => {
      if (input.type === "transaction.completed") {
        return pendingCompletion.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: "local-event-1" },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });
    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });
    const paymentId = result.current.checkout.payments[0].id;

    let completePromise: Promise<boolean> | undefined;
    await act(async () => {
      completePromise = result.current.checkout.onCompleteTransaction();
    });

    let updated = true;
    await act(async () => {
      updated = await result.current.checkout.onUpdatePayment(paymentId, 80);
    });

    pendingCompletion.resolve({
      ok: true,
      value: { localEventId: "local-completion-event-1" },
    });
    await act(async () => {
      await completePromise;
    });

    expect(updated).toBe(false);
    expect(
      mockAppendLocalEvent.mock.calls.map(([event]) => event.type),
    ).toEqual(["session.payments_updated", "transaction.completed"]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        payload: expect.objectContaining({
          items: [
            expect.objectContaining({
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productSkuId: "sku-1",
            }),
          ],
        }),
      }),
    );
  });

  it("orders clear sale after pending payment writes and blocks later payment edits", async () => {
    const pendingPaymentUpdate = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) => {
      if (input.type === "session.payments_updated") {
        return pendingPaymentUpdate.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: "local-event-1" },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPaymentPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPaymentPromise = result.current.checkout.onAddPayment("cash", 120);
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    let addedDuringClear = true;
    await act(async () => {
      addedDuringClear = await result.current.checkout.onAddPayment("card", 80);
    });

    pendingPaymentUpdate.resolve({
      ok: true,
      value: { localEventId: "local-payment-event-1" },
    });
    await act(async () => {
      await addPaymentPromise;
      await clearPromise;
    });

    expect(addedDuringClear).toBe(false);
    expect(
      mockAppendLocalEvent.mock.calls.map(([event]) => event.type),
    ).toEqual(["session.payments_updated", "cart.cleared"]);
    expect(result.current.checkout.payments).toEqual([]);
    expect(result.current.checkout.cartItems).toEqual([]);
  });

  it("keeps local payment draft state but skips payment sync while drawer recovery is required", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[POS] Skipped checkout persistence while drawer recovery is required",
      ),
    );
    consoleWarn.mockRestore();
  });

  it("blocks cart mutation handlers while drawer recovery is required", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
      await result.current.cart.onRemoveItem("item-1" as Id<"posSessionItem">);
      await result.current.cart.onClearCart();
    });

    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(
      mockReleaseSessionInventoryHoldsAndDeleteItems,
    ).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Drawer closed. Open the drawer before updating this sale.",
    );
  });

  it("keeps back-to-back payment additions in sync with the latest checkout state", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 60);
      await result.current.checkout.onAddPayment("card", 60);
    });

    expect(result.current.checkout.payments).toHaveLength(2);
    expect(
      result.current.checkout.payments.map((payment) => payment.method),
    ).toEqual(["cash", "card"]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          checkoutStateVersion: expect.any(Number),
          stage: "paymentAdded",
          payments: [expect.objectContaining({ method: "cash", amount: 60 })],
        }),
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          checkoutStateVersion: expect.any(Number),
          stage: "paymentAdded",
          payments: [
            expect.objectContaining({ method: "cash", amount: 60 }),
            expect.objectContaining({ method: "card", amount: 60 }),
          ],
        }),
      }),
    );
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
  });

  it("saves cleared payments locally when the cart becomes empty after item removal", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    await act(async () => {
      rerender();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.payments_updated",
          payload: expect.objectContaining({
            stage: "paymentsCleared",
            payments: [],
          }),
        }),
      ),
    );
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
    expect(result.current.checkout.payments).toEqual([]);
  });

  it("reduces non-cash payments when the cart total drops below the paid amount", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "mobile_money", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [
        {
          ...mockActiveSession!.cartItems[0],
          price: 90,
        },
      ],
      payments: [{ method: "mobile_money", amount: 120, timestamp: 1_000 }],
    };

    await act(async () => {
      rerender();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.payments_updated",
          payload: expect.objectContaining({
            stage: "paymentUpdated",
            payments: [expect.objectContaining({ amount: 90 })],
          }),
        }),
      ),
    );
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ amount: 90, method: "mobile_money" }),
    ]);
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
  });

  it("completes with stale non-cash overpayment when adjustment persistence fails", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "mobile_money", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.payments_updated"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [
        {
          ...mockActiveSession!.cartItems[0],
          price: 90,
        },
      ],
      payments: [{ method: "mobile_money", amount: 120, timestamp: 1_000 }],
    };

    await act(async () => {
      rerender();
    });
    let completed = false;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        payload: expect.objectContaining({
          total: 90,
          payments: [
            expect.objectContaining({
              amount: 120,
              method: "mobile_money",
            }),
          ],
        }),
      }),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      "Unable to update this payment. Try again.",
    );
  });

  it("does not show the sale-cleared toast when clearing an already-empty cart", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.cart.onClearCart();
    });

    expect(
      mockReleaseSessionInventoryHoldsAndDeleteItems,
    ).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "cart.item_added" }),
    );
    expect(toast.success).not.toHaveBeenCalledWith("Sale cleared");
  });

  it("completes the transaction without a separate checkout-submitted sync round-trip", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });
    const localPaymentId = result.current.checkout.payments[0]?.id;

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "checkoutSubmitted",
      }),
    );
    expect(mockCompleteTransaction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transaction.completed",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          payload: expect.objectContaining({
            receiptNumber: expect.stringMatching(/^\d{6}$/),
            items: [
              expect.objectContaining({
                localItemId: "item-1",
                productSkuId: "sku-1",
                quantity: 1,
                price: 120,
              }),
            ],
            payments: [
              expect.objectContaining({
                localPaymentId,
                method: "cash",
                amount: 120,
              }),
            ],
          }),
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
  });

  it("records a pending local sale when cloud completion fails", async () => {
    mockCompleteTransaction.mockResolvedValueOnce(
      userError({
        code: "unavailable",
        message: "Connection unavailable.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    vi.mocked(toast.success).mockClear();
    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(result.current.checkout.isTransactionCompleted).toBe(true);
    expect(result.current.checkout.completedOrderNumber).toMatch(/^\d{6}$/);
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transaction.completed",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: expect.objectContaining({
            localReceiptNumber: expect.stringMatching(/^local-txn-/),
            receiptNumber: expect.stringMatching(/^\d{6}$/),
            items: [expect.objectContaining({ localItemId: "item-1" })],
            payments: [
              expect.objectContaining({ method: "cash", amount: 120 }),
            ],
          }),
        }),
      ),
    );
    const completedEvent = mockAppendLocalEvent.mock.calls.find(
      ([event]) => event.type === "transaction.completed",
    )?.[0];
    expect(completedEvent?.payload).toEqual(
      expect.objectContaining({
        localReceiptNumber: completedEvent?.localTransactionId,
      }),
    );
    expect(
      result.current.checkout.completedTransactionData?.localTransactionId,
    ).toBe(completedEvent?.localTransactionId);
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("marks local sale events as app-session-unverified while recovery waits for network", async () => {
    mockUsePosTerminalAppSessionRecoveryRuntimeInput.mockReturnValue({
      reason: "network_offline",
      routeScope: "pos_hub",
      status: "waiting_for_network",
    });
    mockCompleteTransaction.mockResolvedValueOnce(
      userError({
        code: "unavailable",
        message: "Connection unavailable.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transaction.completed",
          validationMetadata: expect.objectContaining({
            flags: ["app-session-unverified", "cloud-validation-uncertain"],
            uploadDeferredUntil: "app-session-validated",
          }),
        }),
      ),
    );
  });

  it("does not resurrect a cloud-backed sale after completing it locally", async () => {
    mockCompleteTransaction.mockResolvedValueOnce(
      userError({
        code: "unavailable",
        message: "Connection unavailable.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    mockAppendLocalEvent.mockClear();
    await act(async () => {
      await result.current.checkout.onStartNewTransaction();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.started",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
        }),
      ),
    );
    await waitFor(() => expect(result.current.checkout.cartItems).toEqual([]));
    expect(result.current.checkout.total).toBe(0);
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
  });

  it("does not keep retrying a new sale when terminal setup blocks post-completion start", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        buildLocalEvent({
          sequence: 1,
          terminalId: "terminal-1",
          type: "register.opened",
          payload: {
            expectedCash: 5_000,
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            status: "open",
          },
        }),
      ],
    });
    mockCompleteTransaction.mockResolvedValueOnce(
      userError({
        code: "unavailable",
        message: "Connection unavailable.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        buildStaffAuthenticationResult(),
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    mockAppendLocalEvent.mockClear();
    vi.mocked(toast.error).mockClear();
    mockReadTerminalIntegrityState.mockResolvedValue({
      ok: true,
      value: {
        observedAt: 110,
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    await act(async () => {
      await result.current.checkout.onStartNewTransaction();
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.mode).toBe("terminalRepair"),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.started" }),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Terminal setup needs repair before selling can continue.",
    );
  });

  it("does not resurrect a cloud-backed sale after a reload replays local completion", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-complete",
          schemaVersion: 1,
          sequence: 3,
          type: "transaction.completed",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          localTransactionId: "local-txn-1",
          staffProfileId: "staff-1",
          payload: {
            localPosSessionId: "session-1",
            localTransactionId: "local-txn-1",
            receiptNumber: "123456",
            subtotal: 120,
            tax: 0,
            total: 120,
            items: [
              {
                localItemId: "item-1",
                productId: "product-1",
                productSkuId: "sku-1",
                productSku: "",
                productName: "Body Wave",
                price: 120,
                quantity: 1,
              },
            ],
            payments: [{ method: "cash", amount: 120, timestamp: 1_002 }],
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() => expect(result.current.checkout.cartItems).toEqual([]));
    expect(result.current.checkout.total).toBe(0);
    expect(result.current.sessionPanel?.activeSessionNumber).toBeNull();
  });

  it("does not resurrect a cloud-backed sale after a reload replays local clear", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-clear",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.cleared",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "session-1" },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() => expect(result.current.checkout.cartItems).toEqual([]));
    expect(result.current.checkout.total).toBe(0);
    expect(result.current.sessionPanel?.activeSessionNumber).toBeNull();
    expect(result.current.sessionPanel?.disableNewSession).toBe(false);
  });

  it("does not complete the sale when the local transaction write fails", async () => {
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "transaction.completed"
        ? {
            ok: false,
            error: {
              message: "POS local store could not write the local event.",
            },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(false);
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
    expect(result.current.checkout.completedOrderNumber).toBeNull();
    expect(result.current.checkout.completedTransactionData).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to complete this sale. Try again.",
    );
  });

  it("keeps draft state when holding the current sale fails", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "card", amount: 120, timestamp: 1_000 }],
    };
    mockHoldSession.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "Unable to hold this sale right now.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("body wave");
    });

    await act(async () => {
      await result.current.sessionPanel?.onHoldCurrentSession();
    });

    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "card", amount: 120 }),
    ]);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.productEntry.productSearchQuery).toBe("body wave");
    expect(toast.success).not.toHaveBeenCalledWith("Sale placed on hold.");
  });

  it("keeps draft state and does not start a new sale when auto-hold fails", async () => {
    mockHoldSession.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "Unable to hold this sale right now.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
    });

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
  });

  it("keeps draft state and does not resume another sale when auto-hold fails", async () => {
    mockHeldSessions = [
      {
        _id: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
        sessionNumber: "POS-0002",
        updatedAt: Date.now(),
        cartItems: [],
        customer: null,
      },
    ];
    mockHoldSession.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "Unable to hold this sale right now.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onResumeSession(
        "session-2" as Id<"posSession">,
      );
    });

    expect(mockResumeSession).not.toHaveBeenCalled();
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
  });

  it("commits customer changes through the session update path", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        customerProfileId: "profile-2",
        customerInfo: {
          name: "Efua Mensah",
          email: "efua@example.com",
          phone: "555-2222",
        },
      }),
    );
  });

  it("commits profile-backed customer attribution through the session update path without resetting sale state", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("deep wave");
    });

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        customerProfileId: "profile-2",
        customerInfo: {
          name: "Efua Mensah",
          email: "efua@example.com",
          phone: "555-2222",
        },
      }),
    );
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 120 }),
    ]);
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.productEntry.productSearchQuery).toBe("deep wave");
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
  });

  it("serializes rapid customer attribution commits so the latest operator action persists last", async () => {
    const firstUpdate = deferred<ReturnType<typeof ok>>();
    mockUpdateSession
      .mockReset()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValue(
        ok({
          sessionId: "session-1" as Id<"posSession">,
          expiresAt: Date.now() + 60_000,
        }),
      );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let firstCommit!: Promise<void>;
    let secondCommit!: Promise<void>;
    await act(async () => {
      firstCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      secondCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-3" as Id<"customerProfile">,
        name: "Kofi Boateng",
        email: "kofi@example.com",
        phone: "555-3333",
      });
      await Promise.resolve();
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        customerProfileId: "profile-2",
      }),
    );

    firstUpdate.resolve(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );

    await act(async () => {
      await Promise.all([firstCommit, secondCommit]);
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(2);
    expect(mockUpdateSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customerProfileId: "profile-3",
      }),
    );
  });

  it("does not continue queued customer attribution commits after the register view unmounts", async () => {
    const firstUpdate = deferred<ReturnType<typeof ok>>();
    mockUpdateSession
      .mockReset()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValue(
        ok({
          sessionId: "session-1" as Id<"posSession">,
          expiresAt: Date.now() + 60_000,
        }),
      );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, unmount } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let firstCommit!: Promise<void>;
    let secondCommit!: Promise<void>;
    await act(async () => {
      firstCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      secondCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-3" as Id<"customerProfile">,
        name: "Kofi Boateng",
        email: "kofi@example.com",
        phone: "555-3333",
      });
      await Promise.resolve();
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);

    unmount();
    firstUpdate.resolve(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );

    await act(async () => {
      await Promise.all([firstCommit, secondCommit]);
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
  });

  it("does not apply queued customer attribution commits to the previous active session", async () => {
    const firstUpdate = deferred<ReturnType<typeof ok>>();
    mockUpdateSession
      .mockReset()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValue(
        ok({
          sessionId: "session-2" as Id<"posSession">,
          expiresAt: Date.now() + 60_000,
        }),
      );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let firstCommit!: Promise<void>;
    await act(async () => {
      firstCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      await Promise.resolve();
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: "session-1",
        customerProfileId: "profile-2",
      }),
    );

    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-2" as Id<"posSession">,
      sessionNumber: "SES-002",
    };

    await act(async () => {
      rerender();
    });

    let secondCommit!: Promise<void>;
    await act(async () => {
      secondCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-3" as Id<"customerProfile">,
        name: "Kofi Boateng",
        email: "kofi@example.com",
        phone: "555-3333",
      });
      await Promise.resolve();
    });

    firstUpdate.resolve(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );

    await act(async () => {
      await Promise.all([firstCommit, secondCommit]);
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(2);
    expect(mockUpdateSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: "session-2",
        customerProfileId: "profile-3",
      }),
    );
    expect(mockUpdateSession).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        customerProfileId: "profile-3",
      }),
    );
  });

  it("commits name-only attribution as sale-only customer info without customer ids", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        name: "Walk In Buyer",
        email: "",
        phone: "",
      });
      await result.current.customerPanel.onCustomerCommitted({
        name: "Walk In Buyer",
        email: "",
        phone: "",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        customerProfileId: undefined,
        customerInfo: {
          name: "Walk In Buyer",
          email: undefined,
          phone: undefined,
        },
      }),
    );
  });

  it("clears persisted attribution while preserving active sale state", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "card", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("body wave");
    });

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        name: "",
        email: "",
        phone: "",
      });
      await result.current.customerPanel.onCustomerCommitted({
        name: "",
        email: "",
        phone: "",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        customerProfileId: undefined,
        customerInfo: undefined,
      }),
    );
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "card", amount: 120 }),
    ]);
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.productEntry.productSearchQuery).toBe("body wave");
    expect(result.current.drawerGate).toBeNull();
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
  });

  it("updates local customer attribution without session mutation when no active session exists", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });

    expect(result.current.customerPanel.customerInfo).toEqual({
      customerProfileId: "profile-2",
      name: "Efua Mensah",
      email: "efua@example.com",
      phone: "555-2222",
    });
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });
});
