import type { Id } from "../../_generated/dataModel";
import type {
  OperationDefinition,
  OperationScopeResolver,
} from "../types";
import { defineOperation } from "./_shapes";

/**
 * U6 - storeFront customer modules - write/action/http operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `definitions.ts` never need to
 * change again: the owning unit fills this array and edits nothing else.
 *
 * Three rules decide every row here, so none of them is a per-function
 * judgement call:
 *
 * 1. **Capability** comes from the closed classification already published in
 *    `platform/capabilityCatalog.ts` (`EXACT_PUBLIC_WRITE_CAPABILITIES` first,
 *    then `PUBLIC_WRITE_MODULE_CAPABILITIES`). A migration never re-classifies
 *    a write the catalog already named.
 * 2. **`actors.sharedDemo`** is derived, not chosen: `"admit"` exactly when the
 *    capability is in `SHARED_DEMO_ALLOWED_CAPABILITIES` — EXCEPT where the
 *    handler carried an explicit demo denial (`requireAuthenticatedNonDemoEffect`,
 *    `denySharedDemoEffectIfApplicable`), which stays a denial. Never widen.
 * 3. **`actors.storefrontCustomer`** is absent everywhere. A shopper's cookie is
 *    a claim boundary only at HTTP ingress; a plain Convex argument is not, and
 *    the rail rejects the actor on `mutation`/`query`/`action` kinds. Storefront
 *    shoppers reach these modules exclusively through the `http`/`http_read`
 *    definitions U10 owns, which propagate the admitted identity to the internal
 *    siblings declared in `convex/storeFront/**` as an `owner` parameter.
 *
 * `actors.public: "admit"` appears only on the two pre-auth OTP operations
 * (`storeFront/auth`), matching the `inventory/auth` precedent: a caller who is
 * proving an email cannot already be authenticated.
 */

/** storeId lives on the row this operation names, not in the arguments. */
function resolveStoreFromRow(
  table: "bag" | "checkoutSession" | "guest" | "onlineOrder" | "savedBag",
  idArg: string,
): OperationScopeResolver {
  return async (ctx, args) => {
    const id = args[idArg];
    if (typeof id !== "string") return {};
    const row = await ctx.db.get(table, id as never);
    if (!row) return {};
    return row.storeId ? { storeId: row.storeId } : {};
  };
}

/** onlineOrder resolved by its Paystack transaction id (refund path). */
const resolveStoreFromExternalTransaction: OperationScopeResolver = async (
  ctx,
  args,
) => {
  const externalTransactionId = args.externalTransactionId;
  if (typeof externalTransactionId !== "string") return {};
  const order = await ctx.db
    .query("onlineOrder")
    .withIndex("by_externalTransactionId", (q) =>
      q.eq("externalTransactionId", externalTransactionId),
    )
    .first();
  return order ? { storeId: order.storeId as Id<"store"> } : {};
};

function storefrontWrite(args: {
  capability: OperationDefinition["capability"];
  effects?: OperationDefinition["effects"];
  functionName: string;
  kind?: "mutation" | "action";
  operationId: string;
  publicAccess?: "admit" | "deny";
  readiness?: OperationDefinition["readiness"];
  scope?: OperationDefinition["scope"];
  sharedDemo?: "admit" | "deny";
}) {
  const sharedDemo = args.sharedDemo ?? "deny";
  const kind = args.kind ?? ("mutation" as const);
  return defineOperation({
    kind,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: args.scope ?? { kind: "store" as const, storeIdArg: "storeId" },
    readiness:
      args.readiness ??
      (sharedDemo === "admit"
        ? kind === "mutation"
          ? { kind: "store_write" as const }
          : { kind: "store_ready" as const }
        : { kind: "none" as const }),
    effects: args.effects ?? { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo,
      public: args.publicAccess ?? ("deny" as const),
    },
  });
}

// --- storeFront/bag -------------------------------------------------------

export const deleteBagOperationDefinition = storefrontWrite({
  capability: "storefront.session.manage",
  functionName: "storeFront/bag:deleteBag",
  operationId: "storeFront/bag.deleteBag",
  scope: { kind: "store", resolve: resolveStoreFromRow("bag", "id") },
});

// --- storeFront/guest -----------------------------------------------------

export const deleteGuestOperationDefinition = storefrontWrite({
  capability: "storefront.session.manage",
  functionName: "storeFront/guest:deleteGuest",
  operationId: "storeFront/guest.deleteGuest",
  scope: { kind: "store", resolve: resolveStoreFromRow("guest", "id") },
});

// --- storeFront/payment ---------------------------------------------------
// Every payment action declares its provider gateway, which is what the
// retired `enforceSharedDemoActionCapability` call sites were standing in for.
// `payment.collect` is classified `denied` for the demo and `billing.manage` is
// not demo-granted, so collection paths deny; `payment.refund` is `simulated`
// and `payments.refund` IS granted, so the refund path keeps its demo reach —
// now with the store clamp and the `store_ready` restore fence the ad-hoc call
// never applied.

const PAYMENT_COLLECT_EFFECTS = {
  mode: "protected" as const,
  gateways: ["payment.collect"] as const,
};

export const refundPaymentOperationDefinition = storefrontWrite({
  capability: "payments.refund",
  effects: { mode: "protected", gateways: ["payment.refund"] },
  functionName: "storeFront/payment:refundPayment",
  kind: "action",
  operationId: "storeFront/payment.refundPayment",
  scope: { kind: "store", resolve: resolveStoreFromExternalTransaction },
  sharedDemo: "admit",
});

// --- storeFront/paystackActions -------------------------------------------
// All three carried `requireAuthenticatedNonDemoEffect`: identity required,
// demo refused. They read the live Paystack ledger and take no store argument,
// so the scope is honestly `none` and the gateway is what carries the demo
// contract.

function paystackLedgerAction(functionName: string, operationId: string) {
  return storefrontWrite({
    capability: "billing.manage",
    effects: PAYMENT_COLLECT_EFFECTS,
    functionName,
    kind: "action",
    operationId,
    scope: { kind: "none" },
  });
}

export const getAllTransactionsOperationDefinition = paystackLedgerAction(
  "storeFront/paystackActions:getAllTransactions",
  "storeFront/paystackActions.getAllTransactions",
);

export const checkTransactionStatusOperationDefinition = paystackLedgerAction(
  "storeFront/paystackActions:checkTransactionStatus",
  "storeFront/paystackActions.checkTransactionStatus",
);

export const findOrderTransactionsOperationDefinition = paystackLedgerAction(
  "storeFront/paystackActions:findOrderTransactions",
  "storeFront/paystackActions.findOrderTransactions",
);

// --- storeFront/rewards ---------------------------------------------------

export const createRewardTierOperationDefinition = storefrontWrite({
  capability: "rewards.manage",
  functionName: "storeFront/rewards:createRewardTier",
  operationId: "storeFront/rewards.createRewardTier",
});

// --- storeFront/savedBag --------------------------------------------------

export const deleteSavedBagOperationDefinition = storefrontWrite({
  capability: "storefront.session.manage",
  functionName: "storeFront/savedBag:deleteSavedBag",
  operationId: "storeFront/savedBag.deleteSavedBag",
  scope: { kind: "store", resolve: resolveStoreFromRow("savedBag", "id") },
});

// --- storeFront/supportTicket ---------------------------------------------
// `customer.messaging.send` is demo-granted, so the demo keeps the reach it
// has today — with the store clamp and restore fence it never had.

export const createSupportTicketOperationDefinition = storefrontWrite({
  capability: "customer.messaging.send",
  functionName: "storeFront/supportTicket:create",
  operationId: "storeFront/supportTicket.create",
  sharedDemo: "admit",
});

export const U6_STOREFRONT_CUSTOMER_OPERATION_DEFINITIONS: readonly OperationDefinition[] =
  [
    deleteBagOperationDefinition,
    deleteGuestOperationDefinition,
    refundPaymentOperationDefinition,
    getAllTransactionsOperationDefinition,
    checkTransactionStatusOperationDefinition,
    findOrderTransactionsOperationDefinition,
    createRewardTierOperationDefinition,
    deleteSavedBagOperationDefinition,
    createSupportTicketOperationDefinition,
  ];
