export const SHARED_DEMO_UNAVAILABLE =
  "This action is unavailable in the shared demo.";

export const SHARED_DEMO_CAPABILITY_CLASSIFICATIONS = [
  { capability: "pos.sale.complete", decision: "allowed" },
  { capability: "inventory.adjust", decision: "allowed" },
  { capability: "cash.control.write", decision: "allowed" },
  { capability: "orders.fulfill", decision: "allowed" },
  { capability: "staff.communication.write", decision: "allowed" },
  { capability: "daily_operations.write", decision: "allowed" },
  { capability: "reports.read", decision: "allowed" },
  { capability: "identity.manage", decision: "denied" },
  { capability: "permissions.manage", decision: "denied" },
  { capability: "billing.manage", decision: "denied" },
  { capability: "integrations.manage", decision: "denied" },
  { capability: "exports.generate", decision: "denied" },
  { capability: "payments.refund", decision: "denied" },
  { capability: "administration.destructive", decision: "denied" },
] as const;

export type SharedDemoCapability =
  (typeof SHARED_DEMO_CAPABILITY_CLASSIFICATIONS)[number]["capability"];

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
  { functionName: "pos/public/transactions:completeTransaction", capability: "pos.sale.complete" },
  { functionName: "stockOps/adjustments:submitStockAdjustmentBatch", capability: "inventory.adjust" },
  { functionName: "cashControls/deposits:recordRegisterSessionDeposit", capability: "cash.control.write" },
  { functionName: "storeFront/onlineOrder:update", capability: "orders.fulfill" },
  { functionName: "operations/staffMessages:postStaffMessage", capability: "staff.communication.write" },
  { functionName: "operations/dailyOpening:startStoreDay", capability: "daily_operations.write" },
  { functionName: "reporting/public:getReportsOverview", capability: "reports.read" },
  { functionName: "operations/staffCredentials:createStaffCredential", capability: "identity.manage" },
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
  const declared = SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY.find(
    (entry) => entry.functionName === functionName,
  );
  return declared
    ? { capability: declared.capability, decision: "declared" as const }
    : { decision: "denied" as const, reason: "unclassified" as const };
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
  const entry = SHARED_DEMO_CAPABILITY_CLASSIFICATIONS.find(
    (candidate) => candidate.capability === capability,
  );
  if (!entry || entry.decision !== "allowed") throw new Error(SHARED_DEMO_UNAVAILABLE);
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
  for (const [label, entries, key] of [
    ["capability", SHARED_DEMO_CAPABILITY_CLASSIFICATIONS, "capability"],
    ["gateway", SHARED_DEMO_EFFECT_CLASSIFICATIONS, "gateway"],
  ] as const) {
    const seen = new Set<string>();
    for (const entry of entries) {
      const value = entry[key];
      if (seen.has(value)) errors.push(`Duplicate shared demo ${label}: ${value}`);
      seen.add(value);
      if (entry.decision !== "allowed" && entry.decision !== "denied" && entry.decision !== "simulated") {
        errors.push(`Unknown shared demo decision: ${value}`);
      }
    }
  }
  const coveredCapabilities = new Set(
    SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY.map((entry) => entry.capability),
  );
  for (const entry of SHARED_DEMO_CAPABILITY_CLASSIFICATIONS) {
    if (!coveredCapabilities.has(entry.capability)) {
      errors.push(`No public function represents shared demo capability: ${entry.capability}`);
    }
  }
  return errors;
}
