export type PosApplicationBoundaryClassification =
  | "human_administration"
  | "pos_business_operation"
  | "device_control"
  | "intentionally_public";

type PosApplicationBoundaryInventoryEntry = {
  classification: PosApplicationBoundaryClassification;
  functionName: string;
};

function entries(
  moduleName: string,
  classification: PosApplicationBoundaryClassification,
  exportNames: readonly string[],
): PosApplicationBoundaryInventoryEntry[] {
  return exportNames.map((exportName) => ({
    classification,
    functionName: `${moduleName}:${exportName}`,
  }));
}

export const POS_APPLICATION_BOUNDARY_SOURCE_MODULES = [
  "pos/public/catalog",
  "pos/public/customers",
  "pos/public/transactions",
  "pos/public/register",
  "pos/public/posRecoveryCodes",
  "pos/public/sync",
  "pos/public/terminals",
  "pos/public/terminalAppSessions",
  "inventory/posSessionItems",
  "inventory/posSessions",
  "operations/staffCredentials",
] as const;

export const POS_APPLICATION_COMMAND_BOUNDARY_SOURCE_MODULES = [
  "pos/application/commands/register",
] as const;

export const POS_APPLICATION_BOUNDARY_INVENTORY = [
  ...entries("pos/public/posRecoveryCodes", "intentionally_public", [
    "requestPosTerminalRecoveryDisposition",
  ]),
  ...entries("pos/public/posRecoveryCodes", "human_administration", [
    "getRecoveryCodeStatus",
    "rotateRecoveryCode",
    "revokeRecoveryCode",
    "unlockRecoveryCode",
  ]),
  ...entries("pos/public/catalog", "pos_business_operation", [
    "search",
    "listRegisterCatalogSnapshot",
    "getRegisterCatalogRevision",
    "listRegisterCatalogSnapshotWithRevision",
    "listRegisterCatalogAvailability",
    "listRegisterCatalogAvailabilitySnapshot",
    "barcodeLookup",
    "quickAddSku",
    "createOrReusePendingCheckoutItemForSale",
  ]),
  ...entries("pos/public/catalog", "human_administration", [
    "listPendingCheckoutItemsForReview",
    "listPendingCheckoutProductPageBinding",
    "listLinkedPendingCheckoutAliasesBySku",
    "listLinkedPendingCheckoutProvisionalBindingsBySku",
    "finalizePendingCheckoutTrustedInventoryFromProductPage",
    "resolvePendingCheckoutItemReview",
  ]),
  ...entries("pos/public/customers", "pos_business_operation", [
    "searchCustomers",
    "getCustomerById",
    "createCustomer",
    "updateCustomer",
    "updateCustomerStats",
    "resolvePosCustomerSelection",
    "getCustomerTransactions",
    "linkToStoreFrontUser",
    "linkToGuest",
    "resolveStoreFrontUserMatch",
    "resolveGuestMatch",
    "findByStoreFrontUser",
    "findPotentialMatches",
  ]),
  ...entries("pos/public/transactions", "pos_business_operation", [
    "updateInventory",
    "completeTransaction",
    "getTransaction",
    "getTransactionsByStore",
    "getCompletedTransactions",
    "getTransactionById",
    "voidTransaction",
    "markReceiptPrinted",
    "createTransactionFromSession",
    "correctTransactionCustomer",
    "correctTransactionPaymentMethod",
    "adjustTransactionItems",
    "getRecentTransactionsWithCustomers",
    "getTodaySummary",
  ]),
  ...entries("pos/public/register", "pos_business_operation", [
    "getState",
    "openDrawer",
  ]),
  ...entries("pos/application/commands/register", "pos_business_operation", [
    "openDrawer",
  ]),
  ...entries("pos/public/sync", "pos_business_operation", [
    "ingestLocalEvents",
    "ingestRegisterSessionActivity",
    "resolveLocalSyncReview",
  ]),
  ...entries("pos/public/terminals", "human_administration", [
    "listTerminals",
    "getTerminalByFingerprint",
    "listTerminalHealthSummaries",
    "getTerminalHealthSummary",
    "getRegisterLifecycleAuthorityAcknowledgement",
    "previewTerminalRecovery",
    "listTerminalHealth",
    "getTerminalHealthDetail",
    "registerTerminal",
    "reassignTerminal",
    "reactivateTerminal",
    "getTerminalReconnectIntentResolution",
    "reactivateTerminalFromReconnectIntent",
    "updateTerminal",
    "deleteTerminal",
    "disconnectTerminal",
    "resolveTerminalCloudRepair",
    "issueTerminalRecoveryCommand",
  ]),
  ...entries("pos/public/terminals", "device_control", [
    "getTerminalRuntimeConfig",
    "getRegisterLifecycleAuthorityShadow",
    "getRegisterLifecycleAuthority",
    "acknowledgeRegisterLifecycleAuthority",
    "submitTerminalRuntimeStatus",
    "reportTerminalRuntimeStatus",
    "getRuntimeRemoteAssistSession",
    "disconnectRemoteAssistSession",
    "rotateTerminalProof",
    "listTerminalRecoveryCommands",
    "claimTerminalRecoveryCommand",
    "acknowledgeTerminalRecoveryCommand",
  ]),
  ...entries("pos/public/terminalAppSessions", "intentionally_public", [
    "validateTerminalAppSessionRecovery",
  ]),
  ...entries("pos/public/terminalAppSessions", "device_control", [
    "activatePreparedPosTerminalSession",
    "abortPreparedPosTerminalSession",
  ]),
  ...entries("pos/public/terminalAppSessions", "pos_business_operation", [
    "getCurrentPosTerminalServiceSession",
    "refreshCurrentPosTerminalOfflineAuthorityReceipt",
  ]),
  ...entries("inventory/posSessionItems", "pos_business_operation", [
    "getSessionItems",
    "addOrUpdateItem",
    "removeItem",
  ]),
  ...entries("inventory/posSessions", "human_administration", [
    "getStoreActiveSessionOperations",
    "expireSessionFromOperations",
    "getStoreSessions",
    "cleanupOldSessions",
    "expireAllSessionsForStaff",
  ]),
  ...entries("inventory/posSessions", "pos_business_operation", [
    "getSessionById",
    "createSession",
    "bindSessionToRegisterSession",
    "updateSession",
    "holdSession",
    "resumeSession",
    "completeSession",
    "voidSession",
    "releaseSessionInventoryHoldsAndDeleteItems",
    "syncSessionCheckoutState",
    "getActiveSession",
  ]),
  ...entries("operations/staffCredentials", "human_administration", [
    "getStaffCredentialUsernameAvailability",
    "listStaffCredentialsByStore",
    "createStaffCredential",
    "updateStaffCredential",
  ]),
  ...entries("operations/staffCredentials", "pos_business_operation", [
    "authenticateStaffCredential",
    "authenticateStaffCredentialForTerminal",
    "validateRestoredPosLocalStaffProof",
    "refreshTerminalStaffAuthority",
    "authenticateStaffCredentialForApproval",
  ]),
] as const satisfies readonly PosApplicationBoundaryInventoryEntry[];

const CLASSIFICATION_BY_FUNCTION = new Map(
  POS_APPLICATION_BOUNDARY_INVENTORY.map((entry) => [
    entry.functionName,
    entry.classification,
  ]),
);

export function classifyPosApplicationBoundary(functionName: string):
  | {
      classification: PosApplicationBoundaryClassification;
      decision: "classified";
    }
  | { decision: "unclassified" } {
  const classification = CLASSIFICATION_BY_FUNCTION.get(functionName);
  return classification
    ? { classification, decision: "classified" }
    : { decision: "unclassified" };
}

export function findUnclassifiedPosApplicationBoundaries(
  functionNames: readonly string[],
) {
  return functionNames.filter(
    (functionName) =>
      classifyPosApplicationBoundary(functionName).decision ===
      "unclassified",
  );
}

export function validatePosApplicationBoundaryInventory() {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of POS_APPLICATION_BOUNDARY_INVENTORY) {
    if (seen.has(entry.functionName)) {
      errors.push(`Duplicate POS application boundary: ${entry.functionName}`);
    }
    seen.add(entry.functionName);
  }
  return errors;
}
