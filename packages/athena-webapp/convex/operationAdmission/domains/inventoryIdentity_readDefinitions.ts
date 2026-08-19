import type { Id } from "../../_generated/dataModel";
import type {
  OperationReadDefinition,
  OperationScopeResolver,
} from "../types";
import { defineOrganizationRead, defineReadOperation } from "./_shapes";

/**
 * U4 - inventory sessions/stores/orgs/identity - read (query/http_read) operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `readDefinitions.ts` never need
 * to change again: the owning unit fills this array and edits nothing else.
 *
 * Demo read reach follows `SHARED_DEMO_ALLOWED_READ_INTENTS` exactly:
 * `organization.view` and `pos.view` are granted, so org/member/POS-session
 * reads admit the demo; `expenses.view` and `store.configuration.view` are not
 * granted, so expense and store-configuration reads deny it. Nothing here
 * widens either set.
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

function expenseSessionStoreScope() {
  return { kind: "store" as const, resolve: resolveExpenseSessionStore };
}

/* ---------------------------------------------------------------- expenses */

export const listStoreExpenseSessionsReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/expenseSessions:getStoreExpenseSessions",
  operationId: "inventory.expenseSessions.getStoreExpenseSessions.read",
  access: { kind: "read" as const, intent: "expenses.view" as const },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const getExpenseSessionByIdReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/expenseSessions:getExpenseSessionById",
  operationId: "inventory.expenseSessions.getExpenseSessionById.read",
  access: { kind: "read" as const, intent: "expenses.view" as const },
  scope: expenseSessionStoreScope(),
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const getActiveExpenseSessionReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/expenseSessions:getActiveExpenseSession",
  operationId: "inventory.expenseSessions.getActiveExpenseSession.read",
  access: { kind: "read" as const, intent: "expenses.view" as const },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const getExpenseSessionItemsReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/expenseSessionItems:getExpenseSessionItems",
  operationId: "inventory.expenseSessionItems.getExpenseSessionItems.read",
  access: { kind: "read" as const, intent: "expenses.view" as const },
  scope: expenseSessionStoreScope(),
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const listExpenseTransactionsReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/expenseTransactions:getExpenseTransactions",
  operationId: "inventory.expenseTransactions.getExpenseTransactions.read",
  access: { kind: "read" as const, intent: "expenses.view" as const },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const getExpenseTransactionByIdReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/expenseTransactions:getExpenseTransactionById",
  operationId: "inventory.expenseTransactions.getExpenseTransactionById.read",
  access: { kind: "read" as const, intent: "expenses.view" as const },
  scope: {
    kind: "store" as const,
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
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

/* ------------------------------------------------------------- POS session */

export const getPosSessionByIdReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/posSessions:getSessionById",
  operationId: "inventory.posSessions.getSessionById.read",
  access: { kind: "read" as const, intent: "pos.view" as const },
  scope: {
    kind: "store" as const,
    resolve: async (ctx, args) => {
      const sessionId = args.sessionId;
      if (typeof sessionId !== "string") return {};
      const session = await ctx.db.get(
        "posSession",
        sessionId as Id<"posSession">,
      );
      return session ? { storeId: session.storeId } : {};
    },
  },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "admit" as const,
    public: "deny" as const,
  },
});

/* ------------------------------------------------- organization + identity */

export const getOrganizationByIdReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/organizations:getById",
  operationId: "inventory.organizations.getById.read",
  access: { kind: "read" as const, intent: "organization.view" as const },
  scope: { kind: "organization" as const, organizationIdArg: "id" },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "admit" as const,
    public: "deny" as const,
  },
});

export const listOrganizationMembersReadDefinition = defineOrganizationRead(
  "inventory/organizationMembers:getAll",
  "inventory.organizationMembers.getAll.read",
);

export const getOrganizationMemberRoleReadDefinition = defineOrganizationRead(
  "inventory/organizationMembers:getUserRole",
  "inventory.organizationMembers.getUserRole.read",
);

export const getOrganizationMemberPermissionsReadDefinition =
  defineOrganizationRead(
    "inventory/organizationMembers:getUserPermissions",
    "inventory.organizationMembers.getUserPermissions.read",
  );

export const canAccessPosReadDefinition = defineOrganizationRead(
  "inventory/organizationMembers:canAccessPOS",
  "inventory.organizationMembers.canAccessPOS.read",
);

export const canAccessAdminReadDefinition = defineOrganizationRead(
  "inventory/organizationMembers:canAccessAdmin",
  "inventory.organizationMembers.canAccessAdmin.read",
);

/**
 * Invite codes carry recipient email addresses and drive membership grants, so
 * they stay off the demo read surface even though `organization.view` is a
 * demo-granted intent. The demo renders no invite surface today.
 */
export const listInviteCodesReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/inviteCode:getAll",
  operationId: "inventory.inviteCode.getAll.read",
  access: { kind: "read" as const, intent: "organization.view" as const },
  scope: {
    kind: "organization" as const,
    organizationIdArg: "organizationId",
  },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

/* ------------------------------------------------------ store configuration */

export const getStoreByIdReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/stores:getById",
  operationId: "inventory.stores.getById.read",
  access: {
    kind: "read" as const,
    intent: "store.configuration.view" as const,
  },
  scope: { kind: "store" as const, storeIdArg: "id" },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const getStoreImageAssetsReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/stores:getImageAssets",
  operationId: "inventory.stores.getImageAssets.read",
  access: {
    kind: "read" as const,
    intent: "store.configuration.view" as const,
  },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const calculateStoreTaxReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/stores:calculateTax",
  operationId: "inventory.stores.calculateTax.read",
  access: {
    kind: "read" as const,
    intent: "store.configuration.view" as const,
  },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const preflightStoreConfigKeysReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/stores:preflightConfigKeys",
  operationId: "inventory.stores.preflightConfigKeys.read",
  access: {
    kind: "read" as const,
    intent: "store.configuration.view" as const,
  },
  scope: { kind: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const INVENTORY_IDENTITY_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    listStoreExpenseSessionsReadDefinition,
    getExpenseSessionByIdReadDefinition,
    getActiveExpenseSessionReadDefinition,
    getExpenseSessionItemsReadDefinition,
    listExpenseTransactionsReadDefinition,
    getExpenseTransactionByIdReadDefinition,
    getPosSessionByIdReadDefinition,
    getOrganizationByIdReadDefinition,
    listOrganizationMembersReadDefinition,
    getOrganizationMemberRoleReadDefinition,
    getOrganizationMemberPermissionsReadDefinition,
    canAccessPosReadDefinition,
    canAccessAdminReadDefinition,
    listInviteCodesReadDefinition,
    getStoreByIdReadDefinition,
    getStoreImageAssetsReadDefinition,
    calculateStoreTaxReadDefinition,
    preflightStoreConfigKeysReadDefinition,
  ];
