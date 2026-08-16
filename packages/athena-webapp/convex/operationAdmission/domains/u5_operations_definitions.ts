import type { OperationDefinition, OperationScopeResolver } from "../types";
import { defineOperation } from "./_shapes";

/**
 * U5 - operations, cash controls, stock ops, service ops, messaging, notifications - write/action/http operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `definitions.ts` never need to
 * change again: the owning unit fills this array and edits nothing else.
 *
 * Capability choices follow the closed classification already published in
 * `platform/capabilityCatalog.ts` (`EXACT_PUBLIC_WRITE_CAPABILITIES` first,
 * then `PUBLIC_WRITE_MODULE_CAPABILITIES`), so a migrated definition never
 * re-classifies a write that the catalog already named.
 *
 * `actors.sharedDemo` is derived, not chosen: it is `"admit"` exactly when the
 * capability is in `SHARED_DEMO_ALLOWED_CAPABILITIES` — which is what the
 * retired `requireSharedDemoCapability*` / `requireReadySharedDemoStoreCapabilityIfApplicable`
 * call sites computed at the same transaction boundary. Ungranted capabilities
 * (`service.*`, `appointments.manage`, `procurement.manage`, `staff.manage`,
 * `identity.manage`, `store.configure`, `reporting.*`, `administration.*`)
 * therefore become an explicit `"deny"`.
 */

/** storeId lives on the row this operation names, not in the arguments. */
function resolveStoreFromRow(
  table:
    | "purchaseOrder"
    | "serviceAppointment"
    | "serviceCatalog"
    | "serviceCase"
    | "staffProfile"
    | "posTransaction",
  idArg: string,
): OperationScopeResolver {
  return async (ctx, args) => {
    const id = args[idArg];
    if (typeof id !== "string") return {};
    const row = await ctx.db.get(table, id as never);
    return row ? { storeId: row.storeId } : {};
  };
}

/**
 * The manager-report actions accept `storeId` OR `storeSlug`, and the internal
 * payload query falls back to the `wigclub` slug when neither is supplied. The
 * scope resolver reproduces that resolution so admission clamps the SAME store
 * the body will read, rather than admitting unscoped.
 */
const resolveDailyManagerReportStore: OperationScopeResolver = async (
  ctx,
  args,
) => {
  const storeId = args.storeId;
  if (typeof storeId === "string") {
    const store = await ctx.db.get("store", storeId as never);
    return store ? { organizationId: store.organizationId, storeId: store._id } : {};
  }
  const slug = typeof args.storeSlug === "string" ? args.storeSlug : "wigclub";
  const stores = await ctx.db.query("store").take(100);
  const store = stores.find((candidate) => candidate.slug === slug);
  return store
    ? { organizationId: store.organizationId, storeId: store._id }
    : {};
};

function storeScopedWrite(args: {
  capability: OperationDefinition["capability"];
  effects?: OperationDefinition["effects"];
  functionName: string;
  kind?: "mutation" | "action";
  operationId: string;
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
      public: "deny" as const,
    },
  });
}

// --- operations/dailyClose ------------------------------------------------
// `daily_operations.write` is demo-granted and these handlers carried no
// handler-local demo gate, so the demo keeps exactly the reach it has today —
// now with the store clamp and restore fence the rail applies.

export const completeDailyCloseOperationDefinition = storeScopedWrite({
  capability: "daily_operations.write",
  functionName: "operations/dailyClose:completeDailyClose",
  operationId: "operations/dailyClose.completeDailyClose",
  sharedDemo: "admit",
});

export const resolveDailyCloseCarryForwardOperationDefinition = storeScopedWrite(
  {
    capability: "daily_operations.write",
    functionName: "operations/dailyClose:resolveDailyCloseCarryForward",
    operationId: "operations/dailyClose.resolveDailyCloseCarryForward",
    sharedDemo: "admit",
  },
);

export const reopenDailyCloseOperationDefinition = storeScopedWrite({
  capability: "daily_operations.write",
  functionName: "operations/dailyClose:reopenDailyClose",
  operationId: "operations/dailyClose.reopenDailyClose",
  sharedDemo: "admit",
});

// --- operations/dailyManagerReportEmail -----------------------------------
// Report delivery is a protected effect: the gateway is declared so the
// shared-demo adapter classifies it rather than the handler discovering the
// provider at send time. Demo is denied outright (`reporting.generate` is not
// granted), which is what keeps a demo visitor from reaching MailerSend.

export const sendMostRecentDailyManagerReportOperationDefinition =
  storeScopedWrite({
    capability: "reporting.generate",
    effects: { mode: "protected", gateways: ["order_notification.send"] },
    functionName:
      "operations/dailyManagerReportEmail:sendMostRecentDailyManagerReport",
    kind: "action",
    operationId:
      "operations/dailyManagerReportEmail.sendMostRecentDailyManagerReport",
    scope: { kind: "store", resolve: resolveDailyManagerReportStore },
  });

export const sendDailyManagerReportsForDateRangeOperationDefinition =
  storeScopedWrite({
    capability: "reporting.generate",
    effects: { mode: "protected", gateways: ["order_notification.send"] },
    functionName:
      "operations/dailyManagerReportEmail:sendDailyManagerReportsForDateRange",
    kind: "action",
    operationId:
      "operations/dailyManagerReportEmail.sendDailyManagerReportsForDateRange",
    scope: { kind: "store", resolve: resolveDailyManagerReportStore },
  });

// --- operations/dailyOperationsAutomation ---------------------------------
// Automation policy is store configuration: `store.configure` is not
// demo-granted, so demo edits to the automation policy are denied.

export const updateOpeningAutoStartPolicyOperationDefinition = storeScopedWrite({
  capability: "store.configure",
  functionName:
    "operations/dailyOperationsAutomation:updateOpeningAutoStartPolicy",
  operationId:
    "operations/dailyOperationsAutomation.updateOpeningAutoStartPolicy",
});

export const updateEodAutoCompletePolicyOperationDefinition = storeScopedWrite({
  capability: "store.configure",
  functionName:
    "operations/dailyOperationsAutomation:updateEodAutoCompletePolicy",
  operationId:
    "operations/dailyOperationsAutomation.updateEodAutoCompletePolicy",
});

export const updateRegisterCloseoutApprovalPolicyOperationDefinition =
  storeScopedWrite({
    capability: "store.configure",
    functionName:
      "operations/dailyOperationsAutomation:updateRegisterCloseoutApprovalPolicy",
    operationId:
      "operations/dailyOperationsAutomation.updateRegisterCloseoutApprovalPolicy",
  });

// --- operations/managerElevations -----------------------------------------
// `staff.authenticate` is demo-granted (the demo drives manager elevation at
// the POS), so these stay demo-admitted with the store clamp.

export const startManagerElevationOperationDefinition = storeScopedWrite({
  capability: "staff.authenticate",
  functionName: "operations/managerElevations:startManagerElevation",
  operationId: "operations/managerElevations.startManagerElevation",
  sharedDemo: "admit",
});

export const endManagerElevationOperationDefinition = storeScopedWrite({
  capability: "staff.authenticate",
  functionName: "operations/managerElevations:endManagerElevation",
  operationId: "operations/managerElevations.endManagerElevation",
  sharedDemo: "admit",
});

// --- operations/serviceIntake ---------------------------------------------
// Successor to `requireReadySharedDemoStoreCapabilityIfApplicable(ctx,
// "service.intake.write", args.storeId)` at serviceIntake.ts:219.

export const createServiceIntakeOperationDefinition = storeScopedWrite({
  capability: "service.intake.write",
  functionName: "operations/serviceIntake:createServiceIntake",
  operationId: "operations/serviceIntake.createServiceIntake",
});

// --- operations/staffCredentials ------------------------------------------
// Successor to `requireSharedDemoCapabilityIfApplicable(ctx, "identity.manage")`
// at staffCredentials.ts:1145. Scope is the ORGANIZATION because that is what
// `requireStaffCredentialManagementAccessWithCtx` authorizes against.

export const createStaffCredentialOperationDefinition = storeScopedWrite({
  capability: "identity.manage",
  functionName: "operations/staffCredentials:createStaffCredential",
  operationId: "operations/staffCredentials.createStaffCredential",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
});

export const updateStaffCredentialOperationDefinition = storeScopedWrite({
  capability: "identity.manage",
  functionName: "operations/staffCredentials:updateStaffCredential",
  operationId: "operations/staffCredentials.updateStaffCredential",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
});

// --- operations/staffProfiles ---------------------------------------------
// Successors to `requireSharedDemoCapabilityIfApplicable(ctx, "staff.manage")`
// at staffProfiles.ts:579 and :636. These two writes had NO identity check at
// all before the rail — admission now supplies one.

export const createStaffProfileOperationDefinition = storeScopedWrite({
  capability: "staff.manage",
  functionName: "operations/staffProfiles:createStaffProfile",
  operationId: "operations/staffProfiles.createStaffProfile",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
});

export const updateStaffProfileOperationDefinition = storeScopedWrite({
  capability: "staff.manage",
  functionName: "operations/staffProfiles:updateStaffProfile",
  operationId: "operations/staffProfiles.updateStaffProfile",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
});

// --- cashControls/closeouts -----------------------------------------------

export const finalizeRegisterSessionCloseoutOperationDefinition =
  storeScopedWrite({
    capability: "cash.control.write",
    functionName: "cashControls/closeouts:finalizeRegisterSessionCloseout",
    operationId: "cashControls/closeouts.finalizeRegisterSessionCloseout",
    sharedDemo: "admit",
  });

// --- stockOps/adjustments -------------------------------------------------
// A dev/ops cleanup mutation with no application caller. It hard-deletes
// productSku rows, so it is classified `administration.destructive` rather
// than inheriting the module's `inventory.adjust` (which IS demo-granted).

export const temporaryDeleteStockAdjustmentScopeSkusOperationDefinition =
  storeScopedWrite({
    capability: "administration.destructive",
    functionName:
      "stockOps/adjustments:temporaryDeleteStockAdjustmentScopeSkus",
    operationId:
      "stockOps/adjustments.temporaryDeleteStockAdjustmentScopeSkus",
  });

// --- stockOps/purchaseOrders ----------------------------------------------
// `procurement.manage` is not demo-granted. The `*Command` exports are the
// CommandResult form of the same core helper; both forms carry the same
// definition-level policy so the pair cannot drift.

export const createPurchaseOrderOperationDefinition = storeScopedWrite({
  capability: "procurement.manage",
  functionName: "stockOps/purchaseOrders:createPurchaseOrder",
  operationId: "stockOps/purchaseOrders.createPurchaseOrder",
});

export const createPurchaseOrderCommandOperationDefinition = storeScopedWrite({
  capability: "procurement.manage",
  functionName: "stockOps/purchaseOrders:createPurchaseOrderCommand",
  operationId: "stockOps/purchaseOrders.createPurchaseOrderCommand",
});

export const updatePurchaseOrderStatusOperationDefinition = storeScopedWrite({
  capability: "procurement.manage",
  functionName: "stockOps/purchaseOrders:updatePurchaseOrderStatus",
  operationId: "stockOps/purchaseOrders.updatePurchaseOrderStatus",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("purchaseOrder", "purchaseOrderId"),
  },
});

export const updatePurchaseOrderStatusCommandOperationDefinition =
  storeScopedWrite({
    capability: "procurement.manage",
    functionName: "stockOps/purchaseOrders:updatePurchaseOrderStatusCommand",
    operationId: "stockOps/purchaseOrders.updatePurchaseOrderStatusCommand",
    scope: {
      kind: "store",
      resolve: resolveStoreFromRow("purchaseOrder", "purchaseOrderId"),
    },
  });

export const advancePurchaseOrderToOrderedCommandOperationDefinition =
  storeScopedWrite({
    capability: "procurement.manage",
    functionName:
      "stockOps/purchaseOrders:advancePurchaseOrderToOrderedCommand",
    operationId:
      "stockOps/purchaseOrders.advancePurchaseOrderToOrderedCommand",
    scope: {
      kind: "store",
      resolve: resolveStoreFromRow("purchaseOrder", "purchaseOrderId"),
    },
  });

// --- stockOps/receiving ---------------------------------------------------

export const receivePurchaseOrderBatchOperationDefinition = storeScopedWrite({
  capability: "procurement.manage",
  functionName: "stockOps/receiving:receivePurchaseOrderBatch",
  operationId: "stockOps/receiving.receivePurchaseOrderBatch",
});

// --- stockOps/vendors -----------------------------------------------------
// Successor to `requireReadySharedDemoStoreCapabilityIfApplicable(ctx,
// "procurement.manage", args.storeId)` at vendors.ts:79 — reached by BOTH
// `createVendor` and `createVendorCommand` through `createVendorWithCtx`.

export const createVendorOperationDefinition = storeScopedWrite({
  capability: "procurement.manage",
  functionName: "stockOps/vendors:createVendor",
  operationId: "stockOps/vendors.createVendor",
});

export const createVendorCommandOperationDefinition = storeScopedWrite({
  capability: "procurement.manage",
  functionName: "stockOps/vendors:createVendorCommand",
  operationId: "stockOps/vendors.createVendorCommand",
});

// --- inventoryLedger/corrections ------------------------------------------
// The catalog classifies this module as `reporting.maintain`, which is not
// demo-granted. The handler reached it through the reports READ capability
// (`requireReportsStoreAccess`); the rail states the write capability instead.

export const correctSkuValuationOperationDefinition = storeScopedWrite({
  capability: "reporting.maintain",
  functionName: "inventoryLedger/corrections:correctSkuValuation",
  operationId: "inventoryLedger/corrections.correctSkuValuation",
});

// --- serviceOps/appointments ----------------------------------------------
// Successors to the four `requireReadySharedDemoStoreCapabilityIfApplicable(
// ctx, "appointments.manage", ...)` sites (appointments.ts:196, :290, :386,
// :479). `appointments.manage` is not demo-granted, so all four are denials.

export const createAppointmentOperationDefinition = storeScopedWrite({
  capability: "appointments.manage",
  functionName: "serviceOps/appointments:createAppointment",
  operationId: "serviceOps/appointments.createAppointment",
});

export const rescheduleAppointmentOperationDefinition = storeScopedWrite({
  capability: "appointments.manage",
  functionName: "serviceOps/appointments:rescheduleAppointment",
  operationId: "serviceOps/appointments.rescheduleAppointment",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceAppointment", "appointmentId"),
  },
});

export const cancelAppointmentOperationDefinition = storeScopedWrite({
  capability: "appointments.manage",
  functionName: "serviceOps/appointments:cancelAppointment",
  operationId: "serviceOps/appointments.cancelAppointment",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceAppointment", "appointmentId"),
  },
});

export const convertAppointmentToWalkInOperationDefinition = storeScopedWrite({
  capability: "appointments.manage",
  functionName: "serviceOps/appointments:convertAppointmentToWalkIn",
  operationId: "serviceOps/appointments.convertAppointmentToWalkIn",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceAppointment", "appointmentId"),
  },
});

// --- serviceOps/catalog ---------------------------------------------------
// Successors to `requireReadySharedDemoStoreCapabilityIfApplicable(ctx,
// "service.catalog.manage", ...)` at catalog.ts:348, :419, :512.

export const createServiceCatalogItemOperationDefinition = storeScopedWrite({
  capability: "service.catalog.manage",
  functionName: "serviceOps/catalog:createServiceCatalogItem",
  operationId: "serviceOps/catalog.createServiceCatalogItem",
});

export const updateServiceCatalogItemOperationDefinition = storeScopedWrite({
  capability: "service.catalog.manage",
  functionName: "serviceOps/catalog:updateServiceCatalogItem",
  operationId: "serviceOps/catalog.updateServiceCatalogItem",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceCatalog", "serviceCatalogId"),
  },
});

export const archiveServiceCatalogItemOperationDefinition = storeScopedWrite({
  capability: "service.catalog.manage",
  functionName: "serviceOps/catalog:archiveServiceCatalogItem",
  operationId: "serviceOps/catalog.archiveServiceCatalogItem",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceCatalog", "serviceCatalogId"),
  },
});

// --- serviceOps/serviceCases ----------------------------------------------
// Successors to the six demo gates at serviceCases.ts:440 (reached by both
// create paths), :679, :748, :928 (`billing.manage`), :1017, :1183.

export const createServiceCaseOperationDefinition = storeScopedWrite({
  capability: "service.cases.manage",
  functionName: "serviceOps/serviceCases:createServiceCase",
  operationId: "serviceOps/serviceCases.createServiceCase",
});

export const createWalkInServiceCaseOperationDefinition = storeScopedWrite({
  capability: "service.cases.manage",
  functionName: "serviceOps/serviceCases:createWalkInServiceCase",
  operationId: "serviceOps/serviceCases.createWalkInServiceCase",
});

export const addServiceCaseLineItemOperationDefinition = storeScopedWrite({
  capability: "service.cases.manage",
  functionName: "serviceOps/serviceCases:addServiceCaseLineItem",
  operationId: "serviceOps/serviceCases.addServiceCaseLineItem",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceCase", "serviceCaseId"),
  },
});

export const recordServiceInventoryUsageOperationDefinition = storeScopedWrite({
  capability: "service.cases.manage",
  functionName: "serviceOps/serviceCases:recordServiceInventoryUsage",
  operationId: "serviceOps/serviceCases.recordServiceInventoryUsage",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceCase", "serviceCaseId"),
  },
});

// `billing.manage` here, not `service.cases.manage`: the catalog names this
// exact function and the retired demo gate at :928 used the same capability.
export const recordServicePaymentOperationDefinition = storeScopedWrite({
  capability: "billing.manage",
  functionName: "serviceOps/serviceCases:recordServicePayment",
  operationId: "serviceOps/serviceCases.recordServicePayment",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceCase", "serviceCaseId"),
  },
});

export const updateServiceCaseStatusOperationDefinition = storeScopedWrite({
  capability: "service.cases.manage",
  functionName: "serviceOps/serviceCases:updateServiceCaseStatus",
  operationId: "serviceOps/serviceCases.updateServiceCaseStatus",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("serviceCase", "serviceCaseId"),
  },
});

// --- customerMessaging/public ---------------------------------------------
// The WhatsApp receipt send is a protected effect behind the
// `customer_message.send` gateway. Shared demo is denied at the definition, so
// a demo visitor can never reach the live WhatsApp Cloud API — the module has
// no handler-local demo short-circuit to fall back on.

export const sendPosReceiptLinkOperationDefinition = storeScopedWrite({
  capability: "customer.messaging.send",
  effects: { mode: "protected", gateways: ["customer_message.send"] },
  functionName: "customerMessaging/public:sendPosReceiptLink",
  kind: "action",
  operationId: "customerMessaging/public.sendPosReceiptLink",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("posTransaction", "transactionId"),
  },
});

export const U5_OPERATIONS_OPERATION_DEFINITIONS: readonly OperationDefinition[] =
  [
    completeDailyCloseOperationDefinition,
    resolveDailyCloseCarryForwardOperationDefinition,
    reopenDailyCloseOperationDefinition,
    sendMostRecentDailyManagerReportOperationDefinition,
    sendDailyManagerReportsForDateRangeOperationDefinition,
    updateOpeningAutoStartPolicyOperationDefinition,
    updateEodAutoCompletePolicyOperationDefinition,
    updateRegisterCloseoutApprovalPolicyOperationDefinition,
    startManagerElevationOperationDefinition,
    endManagerElevationOperationDefinition,
    createServiceIntakeOperationDefinition,
    createStaffCredentialOperationDefinition,
    updateStaffCredentialOperationDefinition,
    createStaffProfileOperationDefinition,
    updateStaffProfileOperationDefinition,
    finalizeRegisterSessionCloseoutOperationDefinition,
    temporaryDeleteStockAdjustmentScopeSkusOperationDefinition,
    createPurchaseOrderOperationDefinition,
    createPurchaseOrderCommandOperationDefinition,
    updatePurchaseOrderStatusOperationDefinition,
    updatePurchaseOrderStatusCommandOperationDefinition,
    advancePurchaseOrderToOrderedCommandOperationDefinition,
    receivePurchaseOrderBatchOperationDefinition,
    createVendorOperationDefinition,
    createVendorCommandOperationDefinition,
    correctSkuValuationOperationDefinition,
    createAppointmentOperationDefinition,
    rescheduleAppointmentOperationDefinition,
    cancelAppointmentOperationDefinition,
    convertAppointmentToWalkInOperationDefinition,
    createServiceCatalogItemOperationDefinition,
    updateServiceCatalogItemOperationDefinition,
    archiveServiceCatalogItemOperationDefinition,
    createServiceCaseOperationDefinition,
    createWalkInServiceCaseOperationDefinition,
    addServiceCaseLineItemOperationDefinition,
    recordServiceInventoryUsageOperationDefinition,
    recordServicePaymentOperationDefinition,
    updateServiceCaseStatusOperationDefinition,
    sendPosReceiptLinkOperationDefinition,
  ];
