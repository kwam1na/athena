import type { Id } from "../../_generated/dataModel";
import type {
  OperationDefinition,
  OperationScope,
  OperationScopeResolver,
} from "../types";
import { defineOperation } from "./_shapes";

/**
 * U4 - inventory sessions/stores/orgs/identity - write/action/http operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `definitions.ts` never need to
 * change again: the owning unit fills this array and edits nothing else.
 *
 * Three policy facts drive the shapes below:
 *
 * - Pre-auth identity flows (`inventory/auth:verifyCode`,
 *   `:syncAuthenticatedAthenaUser`, `:sendVerificationCodeViaProvider`,
 *   `inventory/inviteCode:redeem`) declare `public: "admit"`. They are the
 *   entry points a caller uses BEFORE they have an Athena identity, so
 *   requiring one would make signing in impossible.
 * - `pos.session.manage`, `store.configure`, `integrations.manage`,
 *   `organization.manage`, `permissions.manage`, `identity.authenticate`, and
 *   `administration.destructive` are NOT in
 *   `SHARED_DEMO_ALLOWED_CAPABILITIES`, so every operation carrying one
 *   declares `sharedDemo: "deny"`. `expense.manage` IS granted, so the expense
 *   session/transaction writes admit the demo with `store_write` readiness.
 *   `posStoreReadAccessCoverage.test.ts` independently asserts that these POS
 *   session modules never opt into the demo-granted `pos.sale.complete`.
 * - Every `requireNonDemoFoundationMutation` call site retired from a handler
 *   is re-expressed as a bound `target.protectDemoFoundation`, so the guard
 *   still runs for EVERY actor — including a normal full admin.
 */

const resolveExpenseSessionStore: OperationScopeResolver = async (ctx, args) => {
  const sessionId = args.sessionId;
  if (typeof sessionId !== "string") return {};
  const session = await ctx.db.get(
    "expenseSession",
    sessionId as Id<"expenseSession">,
  );
  return session ? { storeId: session.storeId } : {};
};

const resolvePosSessionStore: OperationScopeResolver = async (ctx, args) => {
  const sessionId = args.sessionId;
  if (typeof sessionId !== "string") return {};
  const session = await ctx.db.get("posSession", sessionId as Id<"posSession">);
  return session ? { storeId: session.storeId } : {};
};

const expenseSessionScope: OperationScope = {
  kind: "store",
  resolve: resolveExpenseSessionStore,
};

const posSessionScope: OperationScope = {
  kind: "store",
  resolve: resolvePosSessionStore,
};

/**
 * `expense.manage` is demo-granted, so these admit the demo and therefore must
 * declare the `store_write` restore fence.
 */
function expenseWriteOperation(args: {
  functionName: string;
  operationId: string;
  scope: OperationScope;
}) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: "expense.manage" as const,
    scope: args.scope,
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "deny" as const,
    },
  });
}

/**
 * `pos.session.manage` is not demo-granted, so the demo is denied here and no
 * restore fence applies.
 */
function posSessionWriteOperation(args: {
  functionName: string;
  operationId: string;
  scope: OperationScope;
}) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: "pos.session.manage" as const,
    scope: args.scope,
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

/* --------------------------------------------------------------- identity */

export const verifyCodeOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/auth:verifyCode",
  operationId: "inventory.auth.verifyCode",
  capability: "identity.authenticate" as const,
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    // Pre-auth: the caller is proving an emailed code, so they have no Athena
    // identity yet by construction.
    public: "admit" as const,
  },
});

export const syncAuthenticatedAthenaUserOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/auth:syncAuthenticatedAthenaUser",
  operationId: "inventory.auth.syncAuthenticatedAthenaUser",
  capability: "identity.authenticate" as const,
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    // Pre-auth: this is the mutation that MATERIALIZES the Athena user row
    // from the auth session, so it runs before a normal-user identity exists.
    // The handler still resolves the auth session itself and returns a typed
    // `authentication_failed` when there is none.
    public: "admit" as const,
  },
});

export const sendVerificationCodeViaProviderOperationDefinition =
  defineOperation({
    kind: "action" as const,
    functionName: "inventory/auth:sendVerificationCodeViaProvider",
    operationId: "inventory.auth.sendVerificationCodeViaProvider",
    capability: "identity.authenticate" as const,
    scope: { kind: "none" as const },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      // Successor to the handler-local
      // `sharedDemo.actor.denySharedDemoEffectIfApplicable` runQuery.
      sharedDemo: "deny" as const,
      public: "admit" as const,
    },
  });

/* ----------------------------------------------------------- invite codes */

export const redeemInviteCodeOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/inviteCode:redeem",
  operationId: "inventory.inviteCode.redeem",
  capability: "permissions.manage" as const,
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    // Pre-auth: an invitee redeems the code on the join-team screen before
    // they belong to the organization.
    public: "admit" as const,
  },
});

export const createInviteCodeOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/inviteCode:create",
  operationId: "inventory.inviteCode.create",
  capability: "permissions.manage" as const,
  scope: {
    kind: "organization" as const,
    organizationIdArg: "organizationId",
  },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  // Successor to the retired
  // `requireNonDemoFoundationMutation({ athenaUserId, organizationId })`.
  target: {
    protectDemoFoundation: {
      athenaUserIdArg: "createdByUserId",
      organizationIdArg: "organizationId",
    },
  },
  actors: {
    normalUser: "admit" as const,
    // Successor to the retired
    // `requireSharedDemoCapabilityIfApplicable(ctx, "permissions.manage")`:
    // `permissions.manage` is not in `SHARED_DEMO_ALLOWED_CAPABILITIES`.
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

/* ---------------------------------------------------------- organizations */

export const createOrganizationOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/organizations:create",
  operationId: "inventory.organizations.create",
  capability: "organization.manage" as const,
  // No organization exists yet, so there is nothing to clamp to.
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: {
    protectDemoFoundation: { athenaUserIdArg: "createdByUserId" },
  },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const updateOrganizationOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/organizations:update",
  operationId: "inventory.organizations.update",
  capability: "organization.manage" as const,
  scope: { kind: "organization" as const, organizationIdArg: "id" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { organizationIdArg: "id" } },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const removeOrganizationOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/organizations:remove",
  operationId: "inventory.organizations.remove",
  // Exact classification in `capabilityCatalog.ts`.
  capability: "administration.destructive" as const,
  scope: { kind: "organization" as const, organizationIdArg: "id" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { organizationIdArg: "id" } },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

/* --------------------------------------------------------------- expenses */

export const createExpenseSessionOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseSessions:createExpenseSession",
  operationId: "inventory.expenseSessions.createExpenseSession",
  scope: { kind: "store", storeIdArg: "storeId" },
});

export const bindExpenseSessionToRegisterSessionOperationDefinition =
  expenseWriteOperation({
    functionName: "inventory/expenseSessions:bindExpenseSessionToRegisterSession",
    operationId:
      "inventory.expenseSessions.bindExpenseSessionToRegisterSession",
    scope: expenseSessionScope,
  });

export const updateExpenseSessionOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseSessions:updateExpenseSession",
  operationId: "inventory.expenseSessions.updateExpenseSession",
  scope: expenseSessionScope,
});

export const holdExpenseSessionOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseSessions:holdExpenseSession",
  operationId: "inventory.expenseSessions.holdExpenseSession",
  scope: expenseSessionScope,
});

export const resumeExpenseSessionOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseSessions:resumeExpenseSession",
  operationId: "inventory.expenseSessions.resumeExpenseSession",
  scope: expenseSessionScope,
});

export const completeExpenseSessionOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseSessions:completeExpenseSession",
  operationId: "inventory.expenseSessions.completeExpenseSession",
  scope: expenseSessionScope,
});

export const voidExpenseSessionOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseSessions:voidExpenseSession",
  operationId: "inventory.expenseSessions.voidExpenseSession",
  scope: expenseSessionScope,
});

export const releaseExpenseSessionItemsOperationDefinition =
  expenseWriteOperation({
    functionName:
      "inventory/expenseSessions:releaseExpenseSessionInventoryHoldsAndDeleteItems",
    operationId:
      "inventory.expenseSessions.releaseExpenseSessionInventoryHoldsAndDeleteItems",
    scope: expenseSessionScope,
  });

export const addOrUpdateExpenseItemOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseSessionItems:addOrUpdateExpenseItem",
  operationId: "inventory.expenseSessionItems.addOrUpdateExpenseItem",
  scope: expenseSessionScope,
});

export const removeExpenseItemOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseSessionItems:removeExpenseItem",
  operationId: "inventory.expenseSessionItems.removeExpenseItem",
  scope: expenseSessionScope,
});

export const voidExpenseTransactionOperationDefinition = expenseWriteOperation({
  functionName: "inventory/expenseTransactions:voidExpenseTransaction",
  operationId: "inventory.expenseTransactions.voidExpenseTransaction",
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const transactionId = args.transactionId;
      if (typeof transactionId !== "string") return {};
      const transaction = await ctx.db.get(
        "expenseTransaction",
        transactionId as Id<"expenseTransaction">,
      );
      return transaction ? { storeId: transaction.storeId } : {};
    },
  },
});

/* ----------------------------------------------------------- POS sessions */

export const createPosSessionOperationDefinition = posSessionWriteOperation({
  functionName: "inventory/posSessions:createSession",
  operationId: "inventory.posSessions.createSession",
  scope: { kind: "store", storeIdArg: "storeId" },
});

export const bindPosSessionToRegisterSessionOperationDefinition =
  posSessionWriteOperation({
    functionName: "inventory/posSessions:bindSessionToRegisterSession",
    operationId: "inventory.posSessions.bindSessionToRegisterSession",
    scope: posSessionScope,
  });

export const updatePosSessionOperationDefinition = posSessionWriteOperation({
  functionName: "inventory/posSessions:updateSession",
  operationId: "inventory.posSessions.updateSession",
  scope: posSessionScope,
});

export const holdPosSessionOperationDefinition = posSessionWriteOperation({
  functionName: "inventory/posSessions:holdSession",
  operationId: "inventory.posSessions.holdSession",
  scope: posSessionScope,
});

export const resumePosSessionOperationDefinition = posSessionWriteOperation({
  functionName: "inventory/posSessions:resumeSession",
  operationId: "inventory.posSessions.resumeSession",
  scope: posSessionScope,
});

export const completePosSessionOperationDefinition = posSessionWriteOperation({
  functionName: "inventory/posSessions:completeSession",
  operationId: "inventory.posSessions.completeSession",
  scope: posSessionScope,
});

export const voidPosSessionOperationDefinition = posSessionWriteOperation({
  functionName: "inventory/posSessions:voidSession",
  operationId: "inventory.posSessions.voidSession",
  scope: posSessionScope,
});

export const releasePosSessionItemsOperationDefinition =
  posSessionWriteOperation({
    functionName:
      "inventory/posSessions:releaseSessionInventoryHoldsAndDeleteItems",
    operationId:
      "inventory.posSessions.releaseSessionInventoryHoldsAndDeleteItems",
    scope: posSessionScope,
  });

export const syncPosSessionCheckoutStateOperationDefinition =
  posSessionWriteOperation({
    functionName: "inventory/posSessions:syncSessionCheckoutState",
    operationId: "inventory.posSessions.syncSessionCheckoutState",
    scope: posSessionScope,
  });

export const expirePosSessionFromOperationsOperationDefinition =
  posSessionWriteOperation({
    functionName: "inventory/posSessions:expireSessionFromOperations",
    operationId: "inventory.posSessions.expireSessionFromOperations",
    scope: { kind: "store", storeIdArg: "storeId" },
  });

export const cleanupOldPosSessionsOperationDefinition = posSessionWriteOperation(
  {
    functionName: "inventory/posSessions:cleanupOldSessions",
    operationId: "inventory.posSessions.cleanupOldSessions",
    scope: { kind: "store", storeIdArg: "storeId" },
  },
);

export const expireAllPosSessionsForStaffOperationDefinition =
  posSessionWriteOperation({
    functionName: "inventory/posSessions:expireAllSessionsForStaff",
    operationId: "inventory.posSessions.expireAllSessionsForStaff",
    scope: {
      kind: "store",
      resolve: async (ctx, args) => {
        const terminalId = args.terminalId;
        if (typeof terminalId !== "string") return {};
        const terminal = await ctx.db.get(
          "posTerminal",
          terminalId as Id<"posTerminal">,
        );
        return terminal ? { storeId: terminal.storeId } : {};
      },
    },
  });

export const addOrUpdatePosSessionItemOperationDefinition =
  posSessionWriteOperation({
    functionName: "inventory/posSessionItems:addOrUpdateItem",
    operationId: "inventory.posSessionItems.addOrUpdateItem",
    scope: posSessionScope,
  });

export const removePosSessionItemOperationDefinition = posSessionWriteOperation({
  functionName: "inventory/posSessionItems:removeItem",
  operationId: "inventory.posSessionItems.removeItem",
  scope: posSessionScope,
});

/* ----------------------------------------------------------------- stores */

export const createStoreOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/stores:create",
  operationId: "inventory.stores.create",
  capability: "store.configure" as const,
  scope: {
    kind: "organization" as const,
    organizationIdArg: "organizationId",
  },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: {
    protectDemoFoundation: { organizationIdArg: "organizationId" },
  },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const updateStoreOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/stores:update",
  operationId: "inventory.stores.update",
  capability: "store.configure" as const,
  scope: { kind: "store" as const, storeIdArg: "id" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "id" } },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const removeStoreOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/stores:remove",
  operationId: "inventory.stores.remove",
  // Exact classification in `capabilityCatalog.ts`; successor to the retired
  // `requireSharedDemoCapabilityIfApplicable(ctx, "administration.destructive")`.
  capability: "administration.destructive" as const,
  scope: { kind: "store" as const, storeIdArg: "id" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "id" } },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const patchStoreConfigV2OperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/stores:patchConfigV2",
  operationId: "inventory.stores.patchConfigV2",
  capability: "store.configure" as const,
  scope: { kind: "store" as const, storeIdArg: "id" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "id" } },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const patchStoreConfigV2CommandOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/stores:patchConfigV2Command",
  operationId: "inventory.stores.patchConfigV2Command",
  // Exact classification in `capabilityCatalog.ts`; successor to the retired
  // `requireSharedDemoCapabilityIfApplicable(ctx, "integrations.manage")`.
  capability: "integrations.manage" as const,
  scope: { kind: "store" as const, storeIdArg: "id" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "id" } },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const migrateStoreConfigToV2PageOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/stores:migrateConfigToV2Page",
  operationId: "inventory.stores.migrateConfigToV2Page",
  capability: "store.configure" as const,
  // A maintenance sweep across every store: there is no single store or
  // organization to clamp it to, so the boundary is the actor policy below.
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: {
    // Successor to the retired handler-local
    // `requireAuthenticatedAthenaUserWithCtx(ctx)`.
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const cleanupLegacyStoreConfigKeysPageOperationDefinition =
  defineOperation({
    kind: "mutation" as const,
    functionName: "inventory/stores:cleanupLegacyConfigKeysPage",
    operationId: "inventory.stores.cleanupLegacyConfigKeysPage",
    capability: "store.configure" as const,
    scope: { kind: "none" as const },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });

/**
 * The four store provider actions all retired the same pair of handler-local
 * checks: `sharedDemo.actor.requireAuthenticatedNonDemoEffect` (an
 * authenticated, non-demo caller) and `requireNonDemoFoundationMutation` on the
 * store or organization id. The successor is `normalUser: "admit"` +
 * `sharedDemo: "deny"` + `public: "deny"` plus a bound `target` guard.
 */
function storeProviderAction(args: {
  functionName: string;
  operationId: string;
  scope: OperationScope;
  target: OperationDefinition["target"];
}) {
  return defineOperation({
    kind: "action" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: "store.configure" as const,
    scope: args.scope,
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    target: args.target,
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const listStoresByOrganizationOperationDefinition = storeProviderAction({
  functionName: "inventory/stores:getAllByOrganization",
  operationId: "inventory.stores.getAllByOrganization",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
  target: {
    protectDemoFoundation: { organizationIdArg: "organizationId" },
  },
});

export const uploadStoreImageAssetsOperationDefinition = storeProviderAction({
  functionName: "inventory/stores:uploadImageAssets",
  operationId: "inventory.stores.uploadImageAssets",
  scope: { kind: "store", storeIdArg: "storeId" },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
});

export const updateStoreLandingPageReelOperationDefinition =
  storeProviderAction({
    functionName: "inventory/stores:updateLandingPageReel",
    operationId: "inventory.stores.updateLandingPageReel",
    scope: { kind: "store", storeIdArg: "storeId" },
    target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  });

export const getStoreReelVersionsOperationDefinition = storeProviderAction({
  functionName: "inventory/stores:getReelVersions",
  operationId: "inventory.stores.getReelVersions",
  scope: { kind: "store", storeIdArg: "storeId" },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
});

export const U4_INVENTORY_IDENTITY_OPERATION_DEFINITIONS: readonly OperationDefinition[] =
  [
    verifyCodeOperationDefinition,
    syncAuthenticatedAthenaUserOperationDefinition,
    sendVerificationCodeViaProviderOperationDefinition,
    redeemInviteCodeOperationDefinition,
    createInviteCodeOperationDefinition,
    createOrganizationOperationDefinition,
    updateOrganizationOperationDefinition,
    removeOrganizationOperationDefinition,
    createExpenseSessionOperationDefinition,
    bindExpenseSessionToRegisterSessionOperationDefinition,
    updateExpenseSessionOperationDefinition,
    holdExpenseSessionOperationDefinition,
    resumeExpenseSessionOperationDefinition,
    completeExpenseSessionOperationDefinition,
    voidExpenseSessionOperationDefinition,
    releaseExpenseSessionItemsOperationDefinition,
    addOrUpdateExpenseItemOperationDefinition,
    removeExpenseItemOperationDefinition,
    voidExpenseTransactionOperationDefinition,
    createPosSessionOperationDefinition,
    bindPosSessionToRegisterSessionOperationDefinition,
    updatePosSessionOperationDefinition,
    holdPosSessionOperationDefinition,
    resumePosSessionOperationDefinition,
    completePosSessionOperationDefinition,
    voidPosSessionOperationDefinition,
    releasePosSessionItemsOperationDefinition,
    syncPosSessionCheckoutStateOperationDefinition,
    expirePosSessionFromOperationsOperationDefinition,
    cleanupOldPosSessionsOperationDefinition,
    expireAllPosSessionsForStaffOperationDefinition,
    addOrUpdatePosSessionItemOperationDefinition,
    removePosSessionItemOperationDefinition,
    createStoreOperationDefinition,
    updateStoreOperationDefinition,
    removeStoreOperationDefinition,
    patchStoreConfigV2OperationDefinition,
    patchStoreConfigV2CommandOperationDefinition,
    migrateStoreConfigToV2PageOperationDefinition,
    cleanupLegacyStoreConfigKeysPageOperationDefinition,
    listStoresByOrganizationOperationDefinition,
    uploadStoreImageAssetsOperationDefinition,
    updateStoreLandingPageReelOperationDefinition,
    getStoreReelVersionsOperationDefinition,
  ];
