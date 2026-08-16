import type { AthenaReadIntent } from "../../platform/readIntentCatalog";
import type {
  OperationReadDefinition,
  OperationScopeResolver,
} from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * U5 - operations, cash controls, stock ops, service ops, messaging, notifications - read (query/http_read) operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `readDefinitions.ts` never need
 * to change again: the owning unit fills this array and edits nothing else.
 *
 * `actors.sharedDemo` follows `SHARED_DEMO_ALLOWED_READ_INTENTS` exactly
 * (`convex/sharedDemo/policy.ts`), which `readIntentGrants.test.ts` asserts in
 * both directions. Intents outside that closed set — `service_ops.view`,
 * `staff.view`, `procurement.view`, `customer_messaging.view` — are demo
 * denials here rather than additions to the grant set: widening demo read
 * reach is a deliberate policy change, not a migration side effect.
 */

/** storeId lives on the row this read names, not in the arguments. */
function resolveStoreFromRow(
  table: "purchaseOrder" | "serviceCase" | "staffProfile",
  idArg: string,
): OperationScopeResolver {
  return async (ctx, args) => {
    const id = args[idArg];
    if (typeof id !== "string") return {};
    const row = await ctx.db.get(table, id as never);
    return row ? { storeId: row.storeId } : {};
  };
}

function storeScopedRead(args: {
  functionName: string;
  intent: AthenaReadIntent;
  operationId: string;
  scope?: OperationReadDefinition["scope"];
  sharedDemo?: "admit" | "deny";
}) {
  return defineReadOperation({
    kind: "query" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    access: { kind: "read" as const, intent: args.intent },
    scope: args.scope ?? { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: args.sharedDemo ?? ("deny" as const),
      public: "deny" as const,
    },
  });
}

// --- operations -----------------------------------------------------------

export const getDailyCloseOpeningContextReadDefinition = storeScopedRead({
  functionName: "operations/dailyClose:getDailyCloseOpeningContext",
  intent: "daily_close.view",
  operationId: "operations.dailyClose.getDailyCloseOpeningContext.read",
  sharedDemo: "admit",
});

export const getActiveManagerElevationReadDefinition = storeScopedRead({
  functionName: "operations/managerElevations:getActiveManagerElevation",
  intent: "pos.view",
  operationId: "operations.managerElevations.getActiveManagerElevation.read",
  sharedDemo: "admit",
});

export const listProductOperationalTimelineReadDefinition = storeScopedRead({
  functionName: "operations/operationalEvents:listProductOperationalTimeline",
  intent: "operations.workItems.view",
  operationId:
    "operations.operationalEvents.listProductOperationalTimeline.read",
  sharedDemo: "admit",
});

export const searchServiceIntakeCustomersReadDefinition = storeScopedRead({
  functionName: "operations/serviceIntake:searchCustomers",
  intent: "service_ops.view",
  operationId: "operations.serviceIntake.searchCustomers.read",
});

export const listAssignableStaffReadDefinition = storeScopedRead({
  functionName: "operations/serviceIntake:listAssignableStaff",
  intent: "service_ops.view",
  operationId: "operations.serviceIntake.listAssignableStaff.read",
});

export const getStaffCredentialUsernameAvailabilityReadDefinition =
  storeScopedRead({
    functionName:
      "operations/staffCredentials:getStaffCredentialUsernameAvailability",
    intent: "staff.view",
    operationId:
      "operations.staffCredentials.getStaffCredentialUsernameAvailability.read",
  });

export const listStaffCredentialsByStoreReadDefinition = storeScopedRead({
  functionName: "operations/staffCredentials:listStaffCredentialsByStore",
  intent: "staff.view",
  operationId: "operations.staffCredentials.listStaffCredentialsByStore.read",
});

export const getStaffProfileByIdReadDefinition = storeScopedRead({
  functionName: "operations/staffProfiles:getStaffProfileById",
  intent: "staff.view",
  operationId: "operations.staffProfiles.getStaffProfileById.read",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("staffProfile", "staffProfileId"),
  },
});

// --- cashControls ---------------------------------------------------------

export const getCloseoutSnapshotReadDefinition = storeScopedRead({
  functionName: "cashControls/closeouts:getCloseoutSnapshot",
  intent: "cash_controls.view",
  operationId: "cashControls.closeouts.getCloseoutSnapshot.read",
  sharedDemo: "admit",
});

// --- stockOps -------------------------------------------------------------

export const listPurchaseOrdersReadDefinition = storeScopedRead({
  functionName: "stockOps/purchaseOrders:listPurchaseOrders",
  intent: "procurement.view",
  operationId: "stockOps.purchaseOrders.listPurchaseOrders.read",
});

export const getPurchaseOrderReadDefinition = storeScopedRead({
  functionName: "stockOps/purchaseOrders:getPurchaseOrder",
  intent: "procurement.view",
  operationId: "stockOps.purchaseOrders.getPurchaseOrder.read",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("purchaseOrder", "purchaseOrderId"),
  },
});

export const listReplenishmentRecommendationsReadDefinition = storeScopedRead({
  functionName: "stockOps/replenishment:listReplenishmentRecommendations",
  intent: "procurement.view",
  operationId: "stockOps.replenishment.listReplenishmentRecommendations.read",
});

export const listVendorsReadDefinition = storeScopedRead({
  functionName: "stockOps/vendors:listVendors",
  intent: "procurement.view",
  operationId: "stockOps.vendors.listVendors.read",
});

// --- serviceOps -----------------------------------------------------------

export const listAppointmentsReadDefinition = storeScopedRead({
  functionName: "serviceOps/appointments:listAppointments",
  intent: "service_ops.view",
  operationId: "serviceOps.appointments.listAppointments.read",
});

export const listServiceCatalogItemsReadDefinition = storeScopedRead({
  functionName: "serviceOps/catalog:listServiceCatalogItems",
  intent: "service_ops.view",
  operationId: "serviceOps.catalog.listServiceCatalogItems.read",
});

export const listActiveServiceCasesReadDefinition = storeScopedRead({
  functionName: "serviceOps/serviceCases:listActiveServiceCases",
  intent: "service_ops.view",
  operationId: "serviceOps.serviceCases.listActiveServiceCases.read",
});

export const getServiceCaseDetailsReadDefinition = storeScopedRead({
  functionName: "serviceOps/serviceCases:getServiceCaseDetails",
  intent: "service_ops.view",
  operationId: "serviceOps.serviceCases.getServiceCaseDetails.read",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceCase", "serviceCaseId"),
  },
});

// --- customerMessaging ----------------------------------------------------
// The receipt share link is opened by a shopper holding the token and nothing
// else, so this read stays genuinely anonymous (`public: "admit"`). The token
// row IS the authorization: an unknown or expired token resolves to null. It
// carries no store argument, so there is nothing to clamp — hence `scope:
// none` rather than a store scope that would always resolve empty.

export const getReceiptByShareTokenReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "customerMessaging/public:getReceiptByShareToken",
  operationId: "customerMessaging.public.getReceiptByShareToken.read",
  access: { kind: "read" as const, intent: "customer_messaging.view" },
  scope: { kind: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "admit" as const,
  },
});

export const U5_OPERATIONS_READ_OPERATION_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    getDailyCloseOpeningContextReadDefinition,
    getActiveManagerElevationReadDefinition,
    listProductOperationalTimelineReadDefinition,
    searchServiceIntakeCustomersReadDefinition,
    listAssignableStaffReadDefinition,
    getStaffCredentialUsernameAvailabilityReadDefinition,
    listStaffCredentialsByStoreReadDefinition,
    getStaffProfileByIdReadDefinition,
    getCloseoutSnapshotReadDefinition,
    listPurchaseOrdersReadDefinition,
    getPurchaseOrderReadDefinition,
    listReplenishmentRecommendationsReadDefinition,
    listVendorsReadDefinition,
    listAppointmentsReadDefinition,
    listServiceCatalogItemsReadDefinition,
    listActiveServiceCasesReadDefinition,
    getServiceCaseDetailsReadDefinition,
    getReceiptByShareTokenReadDefinition,
  ];
