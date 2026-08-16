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

/**
 * The storefront identity columns are a union of two tables, so the store has
 * to be derived by normalizing the id rather than by guessing a table. An id
 * that belongs to neither resolves to "no constraint" — admission then denies
 * on the actor rather than admitting an unclamped write.
 */
function resolveStoreFromStorefrontActor(
  idArg: string,
): OperationScopeResolver {
  return async (ctx, args) => {
    const id = args[idArg];
    if (typeof id !== "string") return {};

    const storeFrontUserId = ctx.db.normalizeId("storeFrontUser", id);
    if (storeFrontUserId) {
      const user = await ctx.db.get("storeFrontUser", storeFrontUserId);
      return user?.storeId ? { storeId: user.storeId } : {};
    }

    const guestId = ctx.db.normalizeId("guest", id);
    if (!guestId) return {};
    const guest = await ctx.db.get("guest", guestId);
    // A guest row with no store cannot clamp anything. It is left unresolved
    // rather than defaulted — the same contract the storefront adapter applies
    // to a claim cookie, and the reason the U6 backfill never invents a store.
    return guest?.storeId ? { storeId: guest.storeId } : {};
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

/** onlineOrder resolved by its Paystack reference (verification path). */
const resolveStoreFromExternalReference: OperationScopeResolver = async (
  ctx,
  args,
) => {
  const externalReference = args.externalReference;
  if (typeof externalReference !== "string") return {};
  const order = await ctx.db
    .query("onlineOrder")
    .withIndex("by_externalReference", (q) =>
      q.eq("externalReference", externalReference),
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

// --- storeFront/auth ------------------------------------------------------
// Pre-auth email OTP. `identity.authenticate` is not demo-granted, and
// `sendVerificationCodeViaProvider` carried
// `denySharedDemoEffectIfApplicable` outright — both become the same explicit
// `sharedDemo: "deny"`, now enforced before the provider call rather than
// inside it.

export const verifyCodeOperationDefinition = storefrontWrite({
  capability: "identity.authenticate",
  functionName: "storeFront/auth:verifyCode",
  operationId: "storeFront/auth.verifyCode",
  publicAccess: "admit",
});

export const sendVerificationCodeViaProviderOperationDefinition =
  storefrontWrite({
    capability: "identity.authenticate",
    functionName: "storeFront/auth:sendVerificationCodeViaProvider",
    kind: "action",
    operationId: "storeFront/auth.sendVerificationCodeViaProvider",
    publicAccess: "admit",
  });

// --- storeFront/bag -------------------------------------------------------

export const deleteBagOperationDefinition = storefrontWrite({
  capability: "storefront.session.manage",
  functionName: "storeFront/bag:deleteBag",
  operationId: "storeFront/bag.deleteBag",
  scope: { kind: "store", resolve: resolveStoreFromRow("bag", "id") },
});

// --- storeFront/checkoutSession -------------------------------------------

export const createCheckoutSessionOperationDefinition = storefrontWrite({
  capability: "orders.create",
  functionName: "storeFront/checkoutSession:create",
  operationId: "storeFront/checkoutSession.create",
});

/**
 * `cancelOrder` ran `requireAuthenticatedNonDemoEffect` as its first statement:
 * an identity was required and a demo principal was refused. The successor is
 * `normalUser: "admit"` + `public: "deny"` (identity required) and
 * `sharedDemo: "deny"` (demo refused) — evaluated before the action body, so
 * the refusal now lands before any session read.
 */
export const cancelOrderOperationDefinition = storefrontWrite({
  capability: "orders.manage",
  functionName: "storeFront/checkoutSession:cancelOrder",
  kind: "action",
  operationId: "storeFront/checkoutSession.cancelOrder",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("checkoutSession", "id"),
  },
});

// --- storeFront/guest -----------------------------------------------------

export const deleteGuestOperationDefinition = storefrontWrite({
  capability: "storefront.session.manage",
  functionName: "storeFront/guest:deleteGuest",
  operationId: "storeFront/guest.deleteGuest",
  scope: { kind: "store", resolve: resolveStoreFromRow("guest", "id") },
});

// --- storeFront/offers ----------------------------------------------------

export const createOfferOperationDefinition = storefrontWrite({
  capability: "storefront.content.manage",
  functionName: "storeFront/offers:create",
  operationId: "storeFront/offers.create",
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

export const createTransactionOperationDefinition = storefrontWrite({
  capability: "billing.manage",
  effects: PAYMENT_COLLECT_EFFECTS,
  functionName: "storeFront/payment:createTransaction",
  kind: "action",
  operationId: "storeFront/payment.createTransaction",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("checkoutSession", "checkoutSessionId"),
  },
});

export const createPODOrderOperationDefinition = storefrontWrite({
  capability: "billing.manage",
  effects: PAYMENT_COLLECT_EFFECTS,
  functionName: "storeFront/payment:createPODOrder",
  kind: "action",
  operationId: "storeFront/payment.createPODOrder",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("checkoutSession", "checkoutSessionId"),
  },
});

export const verifyPaymentOperationDefinition = storefrontWrite({
  capability: "billing.manage",
  effects: PAYMENT_COLLECT_EFFECTS,
  functionName: "storeFront/payment:verifyPayment",
  kind: "action",
  operationId: "storeFront/payment.verifyPayment",
  scope: { kind: "store", resolve: resolveStoreFromExternalReference },
});

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

export const redeemPointsOperationDefinition = storefrontWrite({
  capability: "rewards.manage",
  functionName: "storeFront/rewards:redeemPoints",
  operationId: "storeFront/rewards.redeemPoints",
});

export const createRewardTierOperationDefinition = storefrontWrite({
  capability: "rewards.manage",
  functionName: "storeFront/rewards:createRewardTier",
  operationId: "storeFront/rewards.createRewardTier",
});

export const awardPointsForPastOrderOperationDefinition = storefrontWrite({
  capability: "rewards.manage",
  functionName: "storeFront/rewards:awardPointsForPastOrder",
  operationId: "storeFront/rewards.awardPointsForPastOrder",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("onlineOrder", "orderId"),
  },
});

export const awardPointsForGuestOrdersOperationDefinition = storefrontWrite({
  capability: "rewards.manage",
  functionName: "storeFront/rewards:awardPointsForGuestOrders",
  operationId: "storeFront/rewards.awardPointsForGuestOrders",
  scope: {
    kind: "store",
    resolve: resolveStoreFromStorefrontActor("storeFrontUserId"),
  },
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
    verifyCodeOperationDefinition,
    sendVerificationCodeViaProviderOperationDefinition,
    deleteBagOperationDefinition,
    createCheckoutSessionOperationDefinition,
    cancelOrderOperationDefinition,
    deleteGuestOperationDefinition,
    createOfferOperationDefinition,
    createTransactionOperationDefinition,
    createPODOrderOperationDefinition,
    verifyPaymentOperationDefinition,
    refundPaymentOperationDefinition,
    getAllTransactionsOperationDefinition,
    checkTransactionStatusOperationDefinition,
    findOrderTransactionsOperationDefinition,
    redeemPointsOperationDefinition,
    createRewardTierOperationDefinition,
    awardPointsForPastOrderOperationDefinition,
    awardPointsForGuestOrdersOperationDefinition,
    deleteSavedBagOperationDefinition,
    createSupportTicketOperationDefinition,
  ];
