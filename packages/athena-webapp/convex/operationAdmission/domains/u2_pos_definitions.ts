import type { OperationDefinition } from "../types";
import { defineOperation, storeWriteOperation } from "./_shapes";

/**
 * U2 - pos/** - write/action/http operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `definitions.ts` never need to
 * change again: the owning unit fills this array and edits nothing else.
 *
 * Capability choice follows the audited classification in
 * `platform/capabilityCatalog.ts` (`classifyAthenaPublicWrite`), and
 * `actors.sharedDemo` is `"admit"` exactly when that capability is in
 * `SHARED_DEMO_ALLOWED_CAPABILITIES`. Neither set is widened here.
 *
 * The terminal-proof ingresses (`syncSecretHash`) carry no Athena identity
 * today — the sync secret is their only boundary — so they declare
 * `public: "admit"` to keep the current contract byte-for-byte. The ones the
 * POS local-sync runtime drives on its own loop declare `pos.sync.write`
 * because they ARE the terminal/cloud sync channel; the operator-facing
 * terminal writes keep `pos.terminal.manage`.
 */

/** Store scope derived from a POS customer row (no storeId argument). */
const posCustomerScope = (argName: string) =>
  ({
    kind: "store" as const,
    resolve: async (ctx, operationArgs) => {
      const customerId = operationArgs[argName];
      if (typeof customerId !== "string") return {};
      const customer = await ctx.db.get("posCustomer", customerId as never);
      return customer ? { storeId: customer.storeId } : {};
    },
  }) satisfies OperationDefinition["scope"];

const storeArgScope = {
  kind: "store" as const,
  storeIdArg: "storeId",
} satisfies OperationDefinition["scope"];

/** A store write a demo visitor may never perform (capability not granted). */
function operatorStoreWrite(args: {
  capability: OperationDefinition["capability"];
  functionName: string;
  operationId: string;
  publicAccess?: "admit" | "deny";
  scope?: OperationDefinition["scope"];
}) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: args.scope ?? storeArgScope,
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: args.publicAccess ?? ("deny" as const),
    },
  });
}

/** A demo-reachable store write that is also reachable pre-auth today. */
function terminalProofStoreWrite(args: {
  capability: OperationDefinition["capability"];
  functionName: string;
  operationId: string;
}) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: storeArgScope,
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "admit" as const,
    },
  });
}

// --- pos/public/catalog ----------------------------------------------------

export const createOrReusePendingCheckoutItemForSaleOperationDefinition =
  operatorStoreWrite({
    capability: "pos.catalog.manage",
    functionName: "pos/public/catalog:createOrReusePendingCheckoutItemForSale",
    operationId: "pos/public/catalog.createOrReusePendingCheckoutItemForSale",
  });

export const finalizePendingCheckoutTrustedInventoryFromProductPageOperationDefinition =
  operatorStoreWrite({
    capability: "pos.catalog.manage",
    functionName:
      "pos/public/catalog:finalizePendingCheckoutTrustedInventoryFromProductPage",
    operationId:
      "pos/public/catalog.finalizePendingCheckoutTrustedInventoryFromProductPage",
  });

export const resolvePendingCheckoutItemReviewOperationDefinition =
  operatorStoreWrite({
    capability: "pos.catalog.manage",
    functionName: "pos/public/catalog:resolvePendingCheckoutItemReview",
    operationId: "pos/public/catalog.resolvePendingCheckoutItemReview",
  });

// --- pos/public/customers --------------------------------------------------

export const createPosCustomerOperationDefinition = operatorStoreWrite({
  capability: "pos.customer.manage",
  functionName: "pos/public/customers:createCustomer",
  operationId: "pos/public/customers.createCustomer",
});

export const updatePosCustomerOperationDefinition = operatorStoreWrite({
  capability: "pos.customer.manage",
  functionName: "pos/public/customers:updateCustomer",
  operationId: "pos/public/customers.updateCustomer",
  scope: posCustomerScope("customerId"),
});

export const updatePosCustomerStatsOperationDefinition = operatorStoreWrite({
  capability: "pos.customer.manage",
  functionName: "pos/public/customers:updateCustomerStats",
  operationId: "pos/public/customers.updateCustomerStats",
  scope: posCustomerScope("customerId"),
});

export const resolvePosCustomerSelectionOperationDefinition =
  operatorStoreWrite({
    capability: "pos.customer.manage",
    functionName: "pos/public/customers:resolvePosCustomerSelection",
    operationId: "pos/public/customers.resolvePosCustomerSelection",
    scope: posCustomerScope("customerId"),
  });

export const linkPosCustomerToStoreFrontUserOperationDefinition =
  operatorStoreWrite({
    capability: "pos.customer.manage",
    functionName: "pos/public/customers:linkToStoreFrontUser",
    operationId: "pos/public/customers.linkToStoreFrontUser",
    scope: posCustomerScope("posCustomerId"),
  });

export const linkPosCustomerToGuestOperationDefinition = operatorStoreWrite({
  capability: "pos.customer.manage",
  functionName: "pos/public/customers:linkToGuest",
  operationId: "pos/public/customers.linkToGuest",
  scope: posCustomerScope("posCustomerId"),
});

export const resolvePosCustomerStoreFrontUserMatchOperationDefinition =
  operatorStoreWrite({
    capability: "pos.customer.manage",
    functionName: "pos/public/customers:resolveStoreFrontUserMatch",
    operationId: "pos/public/customers.resolveStoreFrontUserMatch",
  });

export const resolvePosCustomerGuestMatchOperationDefinition =
  operatorStoreWrite({
    capability: "pos.customer.manage",
    functionName: "pos/public/customers:resolveGuestMatch",
    operationId: "pos/public/customers.resolveGuestMatch",
  });

// --- pos/public/posRecoveryCodes -------------------------------------------

export const rotatePosRecoveryCodeOperationDefinition = operatorStoreWrite({
  capability: "pos.recovery.manage",
  functionName: "pos/public/posRecoveryCodes:rotateRecoveryCode",
  operationId: "pos/public/posRecoveryCodes.rotateRecoveryCode",
});

export const revokePosRecoveryCodeOperationDefinition = operatorStoreWrite({
  capability: "pos.recovery.manage",
  functionName: "pos/public/posRecoveryCodes:revokeRecoveryCode",
  operationId: "pos/public/posRecoveryCodes.revokeRecoveryCode",
});

export const unlockPosRecoveryCodeOperationDefinition = operatorStoreWrite({
  capability: "pos.recovery.manage",
  functionName: "pos/public/posRecoveryCodes:unlockRecoveryCode",
  operationId: "pos/public/posRecoveryCodes.unlockRecoveryCode",
});

// --- pos/public/register ---------------------------------------------------

export const openRegisterDrawerOperationDefinition = storeWriteOperation({
  capability: "cash.control.write",
  functionName: "pos/public/register:openDrawer",
  operationId: "pos/public/register.openDrawer",
});

// --- pos/public/sync -------------------------------------------------------

export const resolveLocalSyncReviewOperationDefinition = storeWriteOperation({
  capability: "pos.sync.write",
  functionName: "pos/public/sync:resolveLocalSyncReview",
  operationId: "pos/public/sync.resolveLocalSyncReview",
});

// --- pos/public/telemetry --------------------------------------------------

export const recordPosClientEventsOperationDefinition = storeWriteOperation({
  capability: "pos.sync.write",
  functionName: "pos/public/telemetry:recordClientEvents",
  operationId: "pos/public/telemetry.recordClientEvents",
});

// --- pos/public/terminalAppSessions ----------------------------------------

/**
 * Session recovery runs precisely when the caller has lost its Athena session,
 * so it is anonymous-reachable by construction. A caller that still holds a
 * live demo session does not need recovery, and `pos.terminal.manage` is not a
 * demo grant, so shared demo is a typed denial rather than a fall-through.
 */
export const validateTerminalAppSessionRecoveryOperationDefinition =
  operatorStoreWrite({
    capability: "pos.terminal.manage",
    functionName:
      "pos/public/terminalAppSessions:validateTerminalAppSessionRecovery",
    operationId:
      "pos/public/terminalAppSessions.validateTerminalAppSessionRecovery",
    publicAccess: "admit",
  });

// --- pos/public/terminals --------------------------------------------------

export const acknowledgeRegisterLifecycleAuthorityOperationDefinition =
  terminalProofStoreWrite({
    capability: "pos.sync.write",
    functionName: "pos/public/terminals:acknowledgeRegisterLifecycleAuthority",
    operationId: "pos/public/terminals.acknowledgeRegisterLifecycleAuthority",
  });

export const submitTerminalRuntimeStatusOperationDefinition =
  terminalProofStoreWrite({
    capability: "pos.sync.write",
    functionName: "pos/public/terminals:submitTerminalRuntimeStatus",
    operationId: "pos/public/terminals.submitTerminalRuntimeStatus",
  });

export const claimTerminalRecoveryCommandOperationDefinition =
  terminalProofStoreWrite({
    capability: "pos.sync.write",
    functionName: "pos/public/terminals:claimTerminalRecoveryCommand",
    operationId: "pos/public/terminals.claimTerminalRecoveryCommand",
  });

export const acknowledgeTerminalRecoveryCommandOperationDefinition =
  terminalProofStoreWrite({
    capability: "pos.sync.write",
    functionName: "pos/public/terminals:acknowledgeTerminalRecoveryCommand",
    operationId: "pos/public/terminals.acknowledgeTerminalRecoveryCommand",
  });

export const disconnectRemoteAssistSessionOperationDefinition =
  operatorStoreWrite({
    capability: "pos.terminal.manage",
    functionName: "pos/public/terminals:disconnectRemoteAssistSession",
    operationId: "pos/public/terminals.disconnectRemoteAssistSession",
    publicAccess: "admit",
  });

export const updateTerminalOperationDefinition = operatorStoreWrite({
  capability: "pos.terminal.manage",
  functionName: "pos/public/terminals:updateTerminal",
  operationId: "pos/public/terminals.updateTerminal",
  scope: {
    kind: "store",
    resolve: async (ctx, operationArgs) => {
      const terminalId = operationArgs.terminalId;
      if (typeof terminalId !== "string") return {};
      const terminal = await ctx.db.get("posTerminal", terminalId as never);
      return terminal ? { storeId: terminal.storeId } : {};
    },
  },
});

export const deleteTerminalOperationDefinition = operatorStoreWrite({
  capability: "administration.destructive",
  functionName: "pos/public/terminals:deleteTerminal",
  operationId: "pos/public/terminals.deleteTerminal",
  scope: {
    kind: "store",
    resolve: async (ctx, operationArgs) => {
      const terminalId = operationArgs.terminalId;
      if (typeof terminalId !== "string") return {};
      const terminal = await ctx.db.get("posTerminal", terminalId as never);
      return terminal ? { storeId: terminal.storeId } : {};
    },
  },
});

export const resolveTerminalCloudRepairOperationDefinition = operatorStoreWrite(
  {
    capability: "pos.terminal.manage",
    functionName: "pos/public/terminals:resolveTerminalCloudRepair",
    operationId: "pos/public/terminals.resolveTerminalCloudRepair",
  },
);

export const issueTerminalRecoveryCommandOperationDefinition =
  operatorStoreWrite({
    capability: "pos.terminal.manage",
    functionName: "pos/public/terminals:issueTerminalRecoveryCommand",
    operationId: "pos/public/terminals.issueTerminalRecoveryCommand",
  });

// --- pos/public/transactions -----------------------------------------------

export const updatePosInventoryOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "pos/public/transactions:updateInventory",
  operationId: "pos/public/transactions.updateInventory",
  capability: "inventory.adjust",
  scope: {
    kind: "store",
    resolve: async (ctx, operationArgs) => {
      const skuId = operationArgs.skuId;
      if (typeof skuId !== "string") return {};
      const sku = await ctx.db.get("productSku", skuId as never);
      return sku ? { storeId: sku.storeId } : {};
    },
  },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
});

export const createTransactionFromSessionOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "pos/public/transactions:createTransactionFromSession",
  operationId: "pos/public/transactions.createTransactionFromSession",
  capability: "pos.sale.complete",
  scope: {
    kind: "store",
    resolve: async (ctx, operationArgs) => {
      const sessionId = operationArgs.sessionId;
      if (typeof sessionId !== "string") return {};
      const session = await ctx.db.get("posSession", sessionId as never);
      return session ? { storeId: session.storeId } : {};
    },
  },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
});

export const U2_POS_OPERATION_DEFINITIONS: readonly OperationDefinition[] = [
  createOrReusePendingCheckoutItemForSaleOperationDefinition,
  finalizePendingCheckoutTrustedInventoryFromProductPageOperationDefinition,
  resolvePendingCheckoutItemReviewOperationDefinition,
  createPosCustomerOperationDefinition,
  updatePosCustomerOperationDefinition,
  updatePosCustomerStatsOperationDefinition,
  resolvePosCustomerSelectionOperationDefinition,
  linkPosCustomerToStoreFrontUserOperationDefinition,
  linkPosCustomerToGuestOperationDefinition,
  resolvePosCustomerStoreFrontUserMatchOperationDefinition,
  resolvePosCustomerGuestMatchOperationDefinition,
  rotatePosRecoveryCodeOperationDefinition,
  revokePosRecoveryCodeOperationDefinition,
  unlockPosRecoveryCodeOperationDefinition,
  openRegisterDrawerOperationDefinition,
  resolveLocalSyncReviewOperationDefinition,
  recordPosClientEventsOperationDefinition,
  validateTerminalAppSessionRecoveryOperationDefinition,
  acknowledgeRegisterLifecycleAuthorityOperationDefinition,
  submitTerminalRuntimeStatusOperationDefinition,
  claimTerminalRecoveryCommandOperationDefinition,
  acknowledgeTerminalRecoveryCommandOperationDefinition,
  disconnectRemoteAssistSessionOperationDefinition,
  updateTerminalOperationDefinition,
  deleteTerminalOperationDefinition,
  resolveTerminalCloudRepairOperationDefinition,
  issueTerminalRecoveryCommandOperationDefinition,
  updatePosInventoryOperationDefinition,
  createTransactionFromSessionOperationDefinition,
];
