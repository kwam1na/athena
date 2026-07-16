import {
  ATHENA_CAPABILITY_CATALOG,
  classifyAthenaPublicWrite,
  isSharedDemoCapabilityAllowed,
  SHARED_DEMO_ALLOWED_CAPABILITIES,
  type AthenaCapability,
} from "./capabilityCatalog";

export const SHARED_DEMO_UNAVAILABLE =
  "This action is unavailable in the demo.";

export const SHARED_DEMO_CAPABILITY_CLASSIFICATIONS =
  ATHENA_CAPABILITY_CATALOG.map(({ id: capability }) => ({
    capability,
    decision: isSharedDemoCapabilityAllowed(capability)
      ? ("allowed" as const)
      : ("denied" as const),
  }));

export type SharedDemoCapability = AthenaCapability;

export const SHARED_DEMO_EFFECT_CLASSIFICATIONS = [
  { gateway: "customer_message.send", decision: "simulated", label: "No customer message was sent." },
  { gateway: "order_notification.send", decision: "simulated", label: "No customer notification was sent." },
  { gateway: "payment.collect", decision: "denied" },
  { gateway: "payment.refund", decision: "denied" },
  { gateway: "export.deliver", decision: "denied" },
  { gateway: "integration.dispatch", decision: "denied" },
] as const;

export const SHARED_DEMO_POLICY = { defaultDecision: "denied" } as const;

const SHARED_DEMO_FULFILLMENT_STATUSES = new Set([
  "ready-for-delivery",
  "ready-for-pickup",
  "picked-up",
  "delivered",
]);

export function requireSharedDemoOrderFulfillmentUpdate(
  update: Record<string, unknown>,
) {
  const keys = Object.keys(update);
  if (
    keys.length !== 1 ||
    keys[0] !== "status" ||
    typeof update.status !== "string" ||
    !SHARED_DEMO_FULFILLMENT_STATUSES.has(update.status)
  ) {
    throw new Error(SHARED_DEMO_UNAVAILABLE);
  }
}

export const SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY = [
  { functionName: "operations/approvalRequests:decideApprovalRequest", capability: "approvals.manage" },
  { functionName: "operations/staffCredentials:authenticateStaffCredential", capability: "staff.authenticate" },
  { functionName: "operations/staffCredentials:authenticateStaffCredentialForApproval", capability: "staff.authenticate" },
  { functionName: "pos/public/transactions:completeTransaction", capability: "pos.sale.complete" },
  { functionName: "stockOps/adjustments:submitStockAdjustmentBatch", capability: "inventory.adjust" },
  { functionName: "cashControls/deposits:recordRegisterSessionDeposit", capability: "cash.control.write" },
  { functionName: "cashControls/closeouts:correctRegisterSessionOpeningFloat", capability: "cash.control.write" },
  { functionName: "cashControls/closeouts:submitRegisterSessionCloseout", capability: "cash.control.write" },
  { functionName: "cashControls/closeouts:reviewRegisterSessionCloseout", capability: "cash.control.write" },
  { functionName: "cashControls/closeouts:reopenRegisterSessionCloseout", capability: "cash.control.write" },
  { functionName: "pos/public/catalog:quickAddSku", capability: "catalog.quick_add" },
  { functionName: "storeFront/onlineOrder:update", capability: "orders.fulfill" },
  { functionName: "operations/staffMessages:postStaffMessage", capability: "staff.communication.write" },
  { functionName: "operations/dailyOpening:startStoreDay", capability: "daily_operations.write" },
  { functionName: "pos/public/terminals:registerTerminal", capability: "pos.terminal.manage" },
  { functionName: "pos/public/posApplicationAccess:enableApplicationAccess", capability: "pos.terminal.manage" },
  { functionName: "pos/public/posApplicationAccess:revokeApplicationAccess", capability: "pos.terminal.manage" },
  { functionName: "reporting/public:getReportsOverview", capability: "reports.read" },
  { functionName: "operations/staffCredentials:createStaffCredential", capability: "identity.manage" },
  { functionName: "operations/staffProfiles:createStaffProfile", capability: "staff.manage" },
  { functionName: "operations/staffProfiles:updateStaffProfile", capability: "staff.manage" },
  { functionName: "inventory/inviteCode:create", capability: "permissions.manage" },
  { functionName: "storeFront/payment:createTransaction", capability: "billing.manage" },
  { functionName: "inventory/stores:patchConfigV2Command", capability: "integrations.manage" },
  { functionName: "reporting/export:requestExport", capability: "exports.generate" },
  { functionName: "storeFront/onlineOrder:processReturnExchange", capability: "payments.refund" },
  { functionName: "inventory/stores:remove", capability: "administration.destructive" },
] as const satisfies ReadonlyArray<{
  functionName: string;
  capability: SharedDemoCapability;
}>;

export function classifySharedDemoPublicFunction(functionName: string) {
  const classification = classifyAthenaPublicWrite(functionName);
  if (classification.decision === "unclassified") {
    return { decision: "denied" as const, reason: "unclassified" as const };
  }
  return {
    capability: classification.capability,
    decision: "declared" as const,
    demoDecision: isSharedDemoCapabilityAllowed(classification.capability)
      ? ("allowed" as const)
      : ("denied" as const),
  };
}

export function classifySharedDemoExternalGateway(gateway: string) {
  return (
    SHARED_DEMO_EFFECT_CLASSIFICATIONS.find((entry) => entry.gateway === gateway) ??
    { gateway, decision: "denied" as const }
  );
}

export const SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS = [
  { moduleName: "storeFront/onlineOrder", binding: "decideSharedDemoEffect" },
  { moduleName: "storeFront/payment", binding: "enforceSharedDemoActionCapability" },
  { moduleName: "reporting/export", binding: "requireSharedDemoCapabilityIfApplicable" },
  { moduleName: "cloudflare/stream", binding: "requireAuthenticatedNonDemoEffect" },
  { moduleName: "inventory/productSku", binding: "requireNonDemoFoundation" },
  { moduleName: "inventory/stores", binding: "requireNonDemoFoundationMutation" },
  { moduleName: "storeFront/payment", binding: "enforceSharedDemoActionCapability" },
  { moduleName: "storeFront/paystackActions", binding: "requireAuthenticatedNonDemoEffect" },
  { moduleName: "storeFront/checkoutSession", binding: "requireAuthenticatedNonDemoEffect" },
] as const;

export function requireSharedDemoCapability(capability: SharedDemoCapability) {
  if (!isSharedDemoCapabilityAllowed(capability)) {
    throw new Error(SHARED_DEMO_UNAVAILABLE);
  }
  return capability;
}

export async function decideSharedDemoEffect(
  gateway: string,
  handlers: { live: () => Promise<unknown> },
) {
  // Deliberately do not invoke handlers.live for a shared-demo actor. Normal
  // actor dispatch remains owned by the existing provider boundary.
  void handlers;
  const entry = SHARED_DEMO_EFFECT_CLASSIFICATIONS.find(
    (candidate) => candidate.gateway === gateway,
  );
  if (!entry) return { kind: "denied" as const, reason: "unclassified" as const };
  if (entry.decision === "simulated") {
    return { kind: "simulated" as const, label: entry.label };
  }
  return { kind: "denied" as const, reason: "protected" as const };
}

export function validateSharedDemoCoverage() {
  const errors: string[] = [];
  const seenCapabilities = new Set<string>();
  for (const entry of SHARED_DEMO_CAPABILITY_CLASSIFICATIONS) {
    if (seenCapabilities.has(entry.capability)) {
      errors.push(`Duplicate demo capability: ${entry.capability}`);
    }
    seenCapabilities.add(entry.capability);
  }
  const seenGateways = new Set<string>();
  for (const entry of SHARED_DEMO_EFFECT_CLASSIFICATIONS) {
    if (seenGateways.has(entry.gateway)) {
      errors.push(`Duplicate demo gateway: ${entry.gateway}`);
    }
    seenGateways.add(entry.gateway);
  }
  const enforcedCapabilities = new Set(
    SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY.map((entry) => entry.capability),
  );
  for (const capability of SHARED_DEMO_ALLOWED_CAPABILITIES) {
    if (!enforcedCapabilities.has(capability)) {
      errors.push(`No enforced public function represents allowed demo capability: ${capability}`);
    }
  }
  return errors;
}
