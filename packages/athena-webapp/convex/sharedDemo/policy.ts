import { ConvexError } from "convex/values";

import {
  SHARED_DEMO_ACTION_DENIED_CODE,
  SHARED_DEMO_ACTION_DENIED_MESSAGE,
} from "../../shared/sharedDemoActionError";
import {
  ATHENA_CAPABILITY_CATALOG,
  isSharedDemoCapabilityAllowed,
  SHARED_DEMO_ALLOWED_CAPABILITIES,
  type AthenaCapability,
} from "../platform/capabilityCatalog";
import type { AthenaReadIntent } from "../platform/readIntentCatalog";
import type {
  OperationDefinition,
  OperationReadDefinition,
} from "../operationAdmission/types";

export const SHARED_DEMO_UNAVAILABLE = SHARED_DEMO_ACTION_DENIED_MESSAGE;

export function denySharedDemoAction(): never {
  throw new ConvexError({
    code: SHARED_DEMO_ACTION_DENIED_CODE,
    message: SHARED_DEMO_ACTION_DENIED_MESSAGE,
  });
}

export const SHARED_DEMO_CAPABILITY_CLASSIFICATIONS =
  ATHENA_CAPABILITY_CATALOG.map(({ id: capability }) => ({
    capability,
    decision: isSharedDemoCapabilityAllowed(capability)
      ? ("allowed" as const)
      : ("denied" as const),
  }));

export type SharedDemoCapability = AthenaCapability;

export const SHARED_DEMO_EFFECT_CLASSIFICATIONS = [
  {
    gateway: "customer_message.send",
    decision: "simulated",
    label: "No customer message was sent.",
  },
  {
    gateway: "order_notification.send",
    decision: "simulated",
    label: "No customer notification was sent.",
  },
  { gateway: "payment.collect", decision: "denied" },
  {
    gateway: "payment.refund",
    decision: "simulated",
    label: "No live payment refund was issued.",
  },
  { gateway: "export.deliver", decision: "denied" },
  { gateway: "integration.dispatch", decision: "denied" },
] as const;

/**
 * Closed grant set for shared-demo READS.
 *
 * Read intents are not write capabilities, so demo read reach gets its own
 * list rather than being inferred from `SHARED_DEMO_ALLOWED_CAPABILITIES`.
 * Seeded in U1a from the intents of every read definition that is currently
 * `sharedDemo: "admit"`. `readIntentGrants.test.ts` asserts seed ⊇ derived: a
 * demo-admitted read whose intent is missing here is a failure, so demo reach
 * can never widen silently. The set may run AHEAD of the migrated definitions
 * only for a surface the demo demonstrably shows today — every entry below
 * that is not yet derivable names its evidence.
 *
 * Every addition to this list is a deliberate widening of what a demo visitor
 * can observe. The default answer for a Phase B unit is "do not add"; adding
 * requires that the demo already renders the surface.
 */
export const SHARED_DEMO_ALLOWED_READ_INTENTS = [
  "cash_controls.view",
  "daily_close.view",
  "daily_operations.view",
  // The demo runtime reads its own context and register bootstrap
  // (`sharedDemo/public:getContext`, `:getRegisterBootstrap`) on every demo
  // page; without this grant the demo cannot render at all.
  "demo.context.view",
  // The demo sidebar links POS → Expense reports
  // (`/pos/expense-reports`, and one report's detail). Both read expense
  // transactions; before the read rails they were unwrapped queries the demo
  // answered, so the grant restores that surface rather than widening reach.
  "expenses.view",
  // The webapp's identity probe (`app:getCurrentUser`,
  // `inventory/athenaUser:getAuthenticatedUser`) runs unconditionally on every
  // page; the retired `reports.read` auth bridge answered it for the demo
  // principal, so the intent replaces that bridge rather than widening reach.
  "identity.view",
  "inventory.catalog.view",
  "online_orders.view",
  "operations.workItems.view",
  "organization.view",
  "pos.view",
  // Successor to the retired `reports.read` write capability, which existed
  // only to let the demo READ the Reports surface. Reports reads are reads, so
  // the grant now lives where reads are granted; deleting `reports.read`
  // narrows nothing and widens nothing.
  "reports.view",
  // The demo sidebar carries a Services group — Service Intake, Appointments,
  // Active Cases, Catalog Management. Every one of those four views reads the
  // service catalog, assignable staff, and customer search; cases also read
  // one case's detail. They were unwrapped queries before the read rails.
  "service_ops.view",
  "stock_adjustments.view",
  // The POS hub (`/pos`) and POS settings read the store's schedule summary to
  // decide what the operating day looks like. It was an unwrapped query
  // before the read rails, and without it the demo's headline surface — the
  // one every "Make a sale" entry point routes through — cannot render.
  //
  // Second consumer, easy to miss: this list is also intersected with
  // role-derived intents by `delegatedAuthority.ts` to build a demo agent
  // run's held read intents, with no per-definition key. Granting this intent
  // therefore also makes `cap_synthetic_fleet_stores` projectable into a demo
  // agent run once its `organization_overview` profile is published — a
  // deployment toggle, not a code guard. Worth seeing before publishing it.
  "store.configuration.view",
  // The demo sidebar carries Reviews, and `reviews.manage` is already an
  // allowed demo WRITE capability: moderating a review is a demo activity, so
  // the review LIST behind it is a read the demo has always answered. The
  // sidebar's pending-count badge is deliberately NOT justification here:
  // `app-sidebar.tsx` skips that query in the demo and its definition stays
  // denied, because a grant nothing reaches is reach nobody reviewed.
  "storefront.reviews.view",
] as const satisfies readonly AthenaReadIntent[];

const SHARED_DEMO_ALLOWED_READ_INTENT_SET = new Set<string>(
  SHARED_DEMO_ALLOWED_READ_INTENTS,
);

export function isSharedDemoReadIntentAllowed(intent: string) {
  return SHARED_DEMO_ALLOWED_READ_INTENT_SET.has(intent);
}

export const SHARED_DEMO_POLICY = { defaultDecision: "denied" } as const;
export const SHARED_DEMO_LIFECYCLE_CAPABILITY = "demo.lifecycle";

function isSharedDemoOperationCapabilityAllowed(
  capability: SharedDemoCapability,
) {
  return (
    capability === SHARED_DEMO_LIFECYCLE_CAPABILITY ||
    isSharedDemoCapabilityAllowed(capability)
  );
}

const SHARED_DEMO_FULFILLMENT_STATUSES = new Set([
  "cancelled",
  "out-for-delivery",
  "pickup-exception",
  "ready-for-delivery",
  "ready-for-pickup",
  "picked-up",
  "delivered",
]);

export function requireSharedDemoOrderFulfillmentUpdate(
  update: Record<string, unknown>,
) {
  const keys = Object.keys(update);
  const isFulfillmentStatusUpdate =
    keys.length === 1 &&
    keys[0] === "status" &&
    typeof update.status === "string" &&
    SHARED_DEMO_FULFILLMENT_STATUSES.has(update.status);
  const isPaymentCollectionUpdate =
    keys.length === 2 &&
    keys.includes("paymentCollected") &&
    keys.includes("paymentCollectedAt") &&
    update.paymentCollected === true &&
    typeof update.paymentCollectedAt === "number";
  if (!isFulfillmentStatusUpdate && !isPaymentCollectionUpdate) {
    denySharedDemoAction();
  }
}

export function requireSharedDemoRegisterSessionSyncReview(args: {
  decision: "approved" | "rejected";
  reviewKinds: readonly string[];
}) {
  if (
    args.decision !== "rejected" ||
    args.reviewKinds.length === 0 ||
    args.reviewKinds.some(
      (reviewKind) => reviewKind !== "duplicate_register_open",
    )
  ) {
    denySharedDemoAction();
  }
}

export function classifySharedDemoExternalGateway(gateway: string) {
  return (
    SHARED_DEMO_EFFECT_CLASSIFICATIONS.find(
      (entry) => entry.gateway === gateway,
    ) ?? { gateway, decision: "denied" as const }
  );
}

export function requireSharedDemoCapability(capability: SharedDemoCapability) {
  if (!isSharedDemoOperationCapabilityAllowed(capability)) {
    denySharedDemoAction();
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
  if (!entry)
    return { kind: "denied" as const, reason: "unclassified" as const };
  if (entry.decision === "simulated") {
    return { kind: "simulated" as const, label: entry.label };
  }
  return { kind: "denied" as const, reason: "protected" as const };
}

/** How a definition names itself in a coverage error. */
function describeDefinition(
  definition: OperationDefinition | OperationReadDefinition,
) {
  return (
    definition.functionName ??
    (definition.route
      ? `${definition.route.method} ${definition.route.path}`
      : definition.operationId)
  );
}

/** Every capability a write definition can require, static or dynamic. */
function declaredCapabilities(
  definition: OperationDefinition,
): readonly AthenaCapability[] {
  const capability = definition.capability;
  return typeof capability === "string" ? [capability] : capability.candidates;
}

/**
 * The capabilities the demo can actually reach, derived from the definitions.
 *
 * This replaces the hand-maintained `SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY`.
 * The inventory had to be edited by hand whenever a function moved, so it
 * could drift into claiming representation that no longer existed; a
 * definition with `actors.sharedDemo: "admit"` IS the representation, so
 * deriving cannot drift.
 */
export function deriveSharedDemoRepresentedCapabilities(
  definitions: readonly OperationDefinition[],
): ReadonlySet<AthenaCapability> {
  const represented = new Set<AthenaCapability>();
  for (const definition of definitions) {
    if (definition.actors.sharedDemo !== "admit") continue;
    for (const capability of declaredCapabilities(definition)) {
      represented.add(capability);
    }
  }
  return represented;
}

/** The read intents the demo can actually reach, derived the same way. */
export function deriveSharedDemoRepresentedReadIntents(
  readDefinitions: readonly OperationReadDefinition[],
): ReadonlySet<AthenaReadIntent> {
  const represented = new Set<AthenaReadIntent>();
  for (const definition of readDefinitions) {
    if (definition.actors.sharedDemo !== "admit") continue;
    represented.add(definition.access.intent);
  }
  return represented;
}

export type SharedDemoGatewayBinding = {
  gateway: string;
  operation: string;
  demoReachable: boolean;
};

/**
 * Which protected external gateways each definition binds.
 *
 * Replaces `SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS`, which listed
 * `module -> handler-local guard name` pairs and was verified by grepping the
 * module source for that identifier. Those guards are retired; the successor
 * fact is `effects: { mode: "protected", gateways }` on the definition, which
 * the rail enforces rather than a test merely observing.
 */
export function deriveSharedDemoGatewayBindings(
  definitions: readonly OperationDefinition[],
): readonly SharedDemoGatewayBinding[] {
  const bindings: SharedDemoGatewayBinding[] = [];
  for (const definition of definitions) {
    if (definition.effects.mode !== "protected") continue;
    for (const gateway of definition.effects.gateways) {
      bindings.push({
        gateway,
        operation: describeDefinition(definition),
        demoReachable: definition.actors.sharedDemo === "admit",
      });
    }
  }
  return bindings;
}

/**
 * The shared-demo coverage invariant, both directions, over the definitions.
 *
 * Forward: every granted capability/intent has at least one demo-admitted
 * definition representing it — a grant nothing implements is a stale grant.
 * Reverse: every demo-admitted definition declares only granted capabilities
 * and intents — a definition that admits the demo for something ungranted is
 * a silent widening of demo reach. Plus: no demo-reachable definition may
 * bind a gateway that policy classifies as fully denied, and every gateway a
 * definition binds must be classified at all.
 */
export function validateSharedDemoCoverage(
  definitions: readonly OperationDefinition[],
  readDefinitions: readonly OperationReadDefinition[],
) {
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

  const represented = deriveSharedDemoRepresentedCapabilities(definitions);
  for (const capability of SHARED_DEMO_ALLOWED_CAPABILITIES) {
    if (!represented.has(capability)) {
      errors.push(
        `No admitted definition represents allowed demo capability: ${capability}`,
      );
    }
  }
  for (const capability of represented) {
    if (!isSharedDemoOperationCapabilityAllowed(capability)) {
      errors.push(
        `Definition admits the shared demo for ungranted capability: ${capability}`,
      );
    }
  }

  const representedIntents =
    deriveSharedDemoRepresentedReadIntents(readDefinitions);
  for (const intent of SHARED_DEMO_ALLOWED_READ_INTENTS) {
    if (!representedIntents.has(intent)) {
      errors.push(
        `No admitted read definition represents allowed demo read intent: ${intent}`,
      );
    }
  }
  for (const intent of representedIntents) {
    if (!isSharedDemoReadIntentAllowed(intent)) {
      errors.push(
        `Read definition admits the shared demo for ungranted intent: ${intent}`,
      );
    }
  }

  for (const binding of deriveSharedDemoGatewayBindings(definitions)) {
    const classification = classifySharedDemoExternalGateway(binding.gateway);
    if (!seenGateways.has(binding.gateway)) {
      errors.push(
        `Unclassified protected gateway on ${binding.operation}: ${binding.gateway}`,
      );
      continue;
    }
    if (binding.demoReachable && classification.decision !== "simulated") {
      errors.push(
        `${binding.operation} admits the shared demo but binds a non-simulated gateway: ${binding.gateway}`,
      );
    }
  }

  return errors;
}
