import type { AthenaCapability } from "../../platform/capabilityCatalog";
import type { AthenaReadIntent } from "../../platform/readIntentCatalog";
import type {
  OperationDefinition,
  OperationEffects,
  OperationReadDefinition,
} from "../types";

/**
 * Shared definition shapes for the domain modules.
 *
 * Domain modules import only `../types`, this file, the platform catalogs, and
 * `_generated/dataModel`. Scope/target resolvers use `ctx.db` directly.
 */

/**
 * Deep-freeze a definition at construction. The admission wrappers admit with
 * whatever definition object they are handed, and the checker proves that
 * object IS the registered instance — so the remaining way to run an ingress
 * under a policy the registry never declared is to MUTATE the registered
 * instance at import time (`(writeDefinition as any).actors.public = "admit"`
 * in some later-loaded module). Frozen definitions make that a TypeError in
 * strict-mode ESM instead of a silent policy change. Functions (resolvers,
 * guards, verifiers) are left as they are; only plain objects and arrays
 * reachable from the definition are frozen. A `Map` / `Set` / class-instance
 * field would NOT be frozen — no definition carries one, and none of the
 * shapes below produces one; keep it that way (a definition is plain data plus
 * resolver functions). Definition modules also read no environment: the
 * checker evaluates them in its own process and proves identity against what
 * it loaded (`definition-module-reads-environment`).
 */
function deepFreezeDefinition<T>(value: T): T {
  const seen = new Set<unknown>();
  const freeze = (input: unknown) => {
    if (input === null || typeof input !== "object" || seen.has(input)) return;
    seen.add(input);
    const prototype = Object.getPrototypeOf(input);
    if (
      prototype !== Object.prototype &&
      prototype !== Array.prototype &&
      prototype !== null
    ) {
      return;
    }
    Object.freeze(input);
    for (const key of Object.keys(input as Record<string, unknown>)) {
      freeze((input as Record<string, unknown>)[key]);
    }
  };
  freeze(value);
  return value;
}

export function defineOperation<T extends OperationDefinition>(
  definition: T,
): T {
  return deepFreezeDefinition(definition);
}

export function defineReadOperation<T extends OperationReadDefinition>(
  definition: T,
): T {
  return deepFreezeDefinition(definition);
}

export function storeWriteOperation(args: {
  capability: AthenaCapability;
  expectedEpochArg?: string;
  functionName: string;
  operationId: string;
}) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: {
      kind: "store_write" as const,
      expectedEpochArg: args.expectedEpochArg,
    },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "deny" as const,
    },
  });
}

export function transactionStoreWriteOperation(args: {
  capability: AthenaCapability;
  functionName: string;
  operationId: string;
}) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: {
      kind: "store" as const,
      resolve: async (ctx, operationArgs) => {
        const transactionId = operationArgs.transactionId;
        if (typeof transactionId !== "string") return {};
        const transaction = await ctx.db.get(
          "posTransaction",
          transactionId as never,
        );
        return transaction ? { storeId: transaction.storeId } : {};
      },
    },
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "deny" as const,
    },
  });
}

export function orderStoreWriteOperation(args: {
  capability: AthenaCapability;
  effects?: OperationEffects;
  functionName: string;
  kind?: "mutation" | "action";
  operationId: string;
  publicAccess?: "admit" | "deny";
  readiness?: OperationDefinition["readiness"];
}) {
  return defineOperation({
    kind: args.kind ?? ("mutation" as const),
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: {
      kind: "store" as const,
      resolve: async (ctx, operationArgs) => {
        const orderId = operationArgs.orderId;
        if (typeof orderId === "string") {
          const order = await ctx.db.get("onlineOrder", orderId as never);
          return order ? { storeId: order.storeId } : {};
        }
        const externalReference = operationArgs.externalReference;
        if (typeof externalReference === "string") {
          const order = await ctx.db
            .query("onlineOrder")
            .withIndex("by_externalReference", (q) =>
              q.eq("externalReference", externalReference),
            )
            .first();
          return order ? { storeId: order.storeId } : {};
        }
        return {};
      },
    },
    readiness: args.readiness ?? { kind: "store_write" as const },
    effects: args.effects ?? { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: args.publicAccess ?? ("deny" as const),
    },
  });
}

function defineStoreScopedRead(
  intent: AthenaReadIntent,
  functionName: string,
  operationId: string,
  publicAccess: "admit" | "deny" = "deny",
) {
  return defineReadOperation({
    kind: "query" as const,
    functionName,
    operationId,
    access: { kind: "read" as const, intent },
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: publicAccess,
    },
  });
}

export function defineDailyOperationsRead(
  functionName: string,
  operationId: string,
) {
  return defineStoreScopedRead(
    "daily_operations.view",
    functionName,
    operationId,
  );
}

export function defineOperationalWorkRead(
  functionName: string,
  operationId: string,
) {
  return defineStoreScopedRead(
    "operations.workItems.view",
    functionName,
    operationId,
  );
}

export function defineDailyCloseRead(
  functionName: string,
  operationId: string,
) {
  return defineStoreScopedRead("daily_close.view", functionName, operationId);
}

export function definePosRead(functionName: string, operationId: string) {
  return defineStoreScopedRead("pos.view", functionName, operationId);
}

export function defineCashControlsRead(
  functionName: string,
  operationId: string,
) {
  return defineStoreScopedRead("cash_controls.view", functionName, operationId);
}

export function defineStockAdjustmentsRead(
  functionName: string,
  operationId: string,
) {
  return defineStoreScopedRead(
    "stock_adjustments.view",
    functionName,
    operationId,
  );
}

export function defineInventoryCatalogRead(
  functionName: string,
  operationId: string,
  publicAccess: "admit" | "deny" = "deny",
) {
  return defineStoreScopedRead(
    "inventory.catalog.view",
    functionName,
    operationId,
    publicAccess,
  );
}

export function defineOnlineOrdersRead(
  functionName: string,
  operationId: string,
) {
  return defineStoreScopedRead("online_orders.view", functionName, operationId);
}

export function defineOrganizationRead(
  functionName: string,
  operationId: string,
) {
  return defineReadOperation({
    kind: "query" as const,
    functionName,
    operationId,
    access: { kind: "read" as const, intent: "organization.view" as const },
    scope: {
      kind: "organization" as const,
      organizationIdArg: "organizationId",
    },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "deny" as const,
    },
  });
}
