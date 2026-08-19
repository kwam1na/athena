import type { OperationReadDefinition } from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * U8 - reports and the auth bridge retirement - read (query/http_read) operation definitions.
 *
 * Every reports query used to open with `requireReportsStoreAccess`, which ran
 * `requireSharedDemoStoreCapabilityIfApplicable(ctx, "reports.read", storeId)`
 * and then the `reports.read` branch of the generic Athena-user auth bridge.
 * Both halves are retired here:
 *
 *  - the demo capability check + server-owned store clamp become
 *    `actors.sharedDemo: "admit"` on a `reports.view` definition with a store
 *    scope, which the shared-demo read adapter clamps to the demo's own store
 *    (a foreign `storeId` is a recognized `scope_denied`, exactly as the old
 *    `denySharedDemoAction()` was);
 *  - the demo identity bridge becomes `ctx.operationAdmission.actor`, which
 *    `requireAuthenticatedAthenaUserWithCtx` now reads for every actor kind.
 *
 * `reports.view` is already in `SHARED_DEMO_ALLOWED_READ_INTENTS`, so demo
 * reach is unchanged: the Reports surface a demo visitor can see today is
 * exactly the surface these definitions admit.
 *
 * The reports gate itself (a SINGLE `full_admin` `organizationMember` row for
 * the store's owning organization, behind one opaque message) is NOT actor
 * policy and is not expressible as a definition field, so it stays in
 * `reports/access.ts` and still runs inside every handler.
 */

/** Store-scoped reporting read: the shape every reports query shares. */
function defineReportsRead(functionName: string, operationId: string) {
  return defineReadOperation({
    kind: "query" as const,
    functionName,
    operationId,
    access: { kind: "read" as const, intent: "reports.view" as const },
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "deny" as const,
    },
  });
}

// --------------------------------------------------------------- reports/liveDay

export const getLiveOperatingDayReadDefinition = defineReportsRead(
  "reports/liveDay:getLiveOperatingDay",
  "reports/liveDay.getLiveOperatingDay",
);

export const listLiveSkuStockReadDefinition = defineReportsRead(
  "reports/liveDay:listLiveSkuStock",
  "reports/liveDay.listLiveSkuStock",
);

// --------------------------------------------------------------- reports/queries

export const getOverviewReadDefinition = defineReportsRead(
  "reports/queries:getOverview",
  "reports/queries.getOverview",
);

export const getActiveWeeklyBriefingReadDefinition = defineReportsRead(
  "reports/queries:getActiveWeeklyBriefing",
  "reports/queries.getActiveWeeklyBriefing",
);

export const listAcceptedWeeklyHistoryReadDefinition = defineReportsRead(
  "reports/queries:listAcceptedWeeklyHistory",
  "reports/queries.listAcceptedWeeklyHistory",
);

export const getAcceptedWeeklyDetailReadDefinition = defineReportsRead(
  "reports/queries:getAcceptedWeeklyDetail",
  "reports/queries.getAcceptedWeeklyDetail",
);

export const listDaysReadDefinition = defineReportsRead(
  "reports/queries:listDays",
  "reports/queries.listDays",
);

export const listRangeSkuMixReadDefinition = defineReportsRead(
  "reports/queries:listRangeSkuMix",
  "reports/queries.listRangeSkuMix",
);

export const listRangeSkuMovementReadDefinition = defineReportsRead(
  "reports/queries:listRangeSkuMovement",
  "reports/queries.listRangeSkuMovement",
);

export const listPeriodSkusReadDefinition = defineReportsRead(
  "reports/queries:listPeriodSkus",
  "reports/queries.listPeriodSkus",
);

export const getSkuDetailReadDefinition = defineReportsRead(
  "reports/queries:getSkuDetail",
  "reports/queries.getSkuDetail",
);

export const listSkuDayTransactionsReadDefinition = defineReportsRead(
  "reports/queries:listSkuDayTransactions",
  "reports/queries.listSkuDayTransactions",
);

export const getRangeResultReadDefinition = defineReportsRead(
  "reports/queries:getRangeResult",
  "reports/queries.getRangeResult",
);

// ---------------------------------------------------------- reports/skuMixRange

export const getMixRangeReadDefinition = defineReportsRead(
  "reports/skuMixRange:getMixRange",
  "reports/skuMixRange.getMixRange",
);

export const getMixRangeVisibleReadDefinition = defineReportsRead(
  "reports/skuMixRange:getMixRangeVisible",
  "reports/skuMixRange.getMixRangeVisible",
);

// ----------------------------------------------------- reports/skuMovementRange

export const getMovementRangeReadDefinition = defineReportsRead(
  "reports/skuMovementRange:getMovementRange",
  "reports/skuMovementRange.getMovementRange",
);

export const getMovementRangePageReadDefinition = defineReportsRead(
  "reports/skuMovementRange:getMovementRangePage",
  "reports/skuMovementRange.getMovementRangePage",
);

// ------------------------------------------------------- inventory/athenaUser

/**
 * "Who am I?" — the identity probe every operator surface mounts through
 * `useAuth`.
 *
 * `public: "admit"` keeps its pre-auth contract: a caller with a Convex auth
 * session but no `athenaUser` row yet (the window between sign-in and
 * `inventory/auth:syncAuthenticatedAthenaUser`) must read as "nobody", not as
 * a denial, or the sign-in handoff cannot complete. It discloses nothing to an
 * anonymous caller — with no identity the handler returns `null`.
 *
 * `sharedDemo: "admit"` is the successor to the retired
 * `getAuthenticatedAthenaUserWithCtx(ctx, { sharedDemoCapability:
 * "reports.read" })` bridge: the demo principal's Athena identity now arrives
 * as `ctx.operationAdmission.actor`, so the demo workspace resolves its own
 * user exactly as before.
 */
export const getAuthenticatedUserReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/athenaUser:getAuthenticatedUser",
  operationId: "inventory/athenaUser.getAuthenticatedUser",
  access: { kind: "read" as const, intent: "identity.view" as const },
  scope: { kind: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "admit" as const,
    public: "admit" as const,
  },
});

/**
 * Athena user lookup by id. It had no gate at all before this migration and no
 * caller anywhere in the repo, so requiring an authenticated Athena user is a
 * narrowing: nothing that works today stops working, and an anonymous caller
 * can no longer read an identity row.
 */
export const getUserByIdReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/athenaUser:getUserById",
  operationId: "inventory/athenaUser.getUserById",
  access: { kind: "read" as const, intent: "identity.view" as const },
  scope: { kind: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const REPORTS_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    getLiveOperatingDayReadDefinition,
    listLiveSkuStockReadDefinition,
    getOverviewReadDefinition,
    getActiveWeeklyBriefingReadDefinition,
    listAcceptedWeeklyHistoryReadDefinition,
    getAcceptedWeeklyDetailReadDefinition,
    listDaysReadDefinition,
    listRangeSkuMixReadDefinition,
    listRangeSkuMovementReadDefinition,
    listPeriodSkusReadDefinition,
    getSkuDetailReadDefinition,
    listSkuDayTransactionsReadDefinition,
    getRangeResultReadDefinition,
    getMixRangeReadDefinition,
    getMixRangeVisibleReadDefinition,
    getMovementRangeReadDefinition,
    getMovementRangePageReadDefinition,
    getAuthenticatedUserReadDefinition,
    getUserByIdReadDefinition,
  ];
