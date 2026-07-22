import {
  ATHENA_CAPABILITY_CATALOG,
  type AthenaCapability,
} from "../platform/capabilityCatalog";
import type { OperationDefinition } from "./types";

const KNOWN_CAPABILITIES = new Set<AthenaCapability>(
  ATHENA_CAPABILITY_CATALOG.map(({ id }) => id),
);

export function defineOperation<T extends OperationDefinition>(
  definition: T,
): T {
  return definition;
}

export const resolveSyncedSaleInventoryReviewGroupOperationDefinition =
  defineOperation({
    functionName:
      "operations/openWorkInventoryReviews:resolveSyncedSaleInventoryReviewGroup",
    operationId:
      "operations/openWorkInventoryReviews.resolveSyncedSaleInventoryReviewGroup",
    capability: "daily_operations.write",
    scope: { kind: "store", storeIdArg: "storeId" },
    readiness: {
      kind: "store_write",
      expectedEpochArg: "expectedDemoRestoreEpoch",
    },
    effects: { mode: "none" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });

export const decideApprovalRequestOperationDefinition = defineOperation({
  functionName: "operations/approvalRequests:decideApprovalRequest",
  operationId: "operations/approvalRequests.decideApprovalRequest",
  capability: "approvals.manage",
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const approvalRequestId = args.approvalRequestId;
      if (typeof approvalRequestId !== "string") return {};
      const approvalRequest = await ctx.db.get(
        "approvalRequest",
        approvalRequestId as never,
      );
      if (!approvalRequest) return {};
      return {
        organizationId: approvalRequest.organizationId,
        storeId: approvalRequest.storeId,
      };
    },
  },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const requestManualRestoreOperationDefinition = defineOperation({
  functionName: "sharedDemo/public:requestManualRestore",
  operationId: "sharedDemo/public.requestManualRestore",
  capability: "demo.lifecycle",
  scope: { kind: "none" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: { normalUser: "deny", sharedDemo: "admit" },
});

export const resetBrowserExperienceOperationDefinition = defineOperation({
  functionName: "sharedDemo/public:resetBrowserExperience",
  operationId: "sharedDemo/public.resetBrowserExperience",
  capability: "demo.lifecycle",
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const terminalId = args.terminalId;
      if (typeof terminalId !== "string") return {};
      const terminal = await ctx.db.get("posTerminal", terminalId as never);
      return terminal ? { storeId: terminal.storeId } : {};
    },
  },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: { normalUser: "deny", sharedDemo: "admit" },
});

export const bindRegisterBaselineToTerminalOperationDefinition =
  defineOperation({
    functionName: "sharedDemo/public:bindRegisterBaselineToTerminal",
    operationId: "sharedDemo/public.bindRegisterBaselineToTerminal",
    capability: "demo.lifecycle",
    scope: {
      kind: "store",
      resolve: async (ctx, args) => {
        const terminalId = args.terminalId;
        if (typeof terminalId !== "string") return {};
        const terminal = await ctx.db.get("posTerminal", terminalId as never);
        return terminal ? { storeId: terminal.storeId } : {};
      },
    },
    readiness: {
      kind: "store_write",
      expectedEpochArg: "expectedEpoch",
    },
    effects: { mode: "none" },
    actors: { normalUser: "deny", sharedDemo: "admit" },
  });

export const OPERATION_ADMISSION_DEFINITIONS = [
  resolveSyncedSaleInventoryReviewGroupOperationDefinition,
  decideApprovalRequestOperationDefinition,
  requestManualRestoreOperationDefinition,
  resetBrowserExperienceOperationDefinition,
  bindRegisterBaselineToTerminalOperationDefinition,
] as const satisfies readonly OperationDefinition[];

export function validateOperationDefinition(
  definition: OperationDefinition,
): string[] {
  const errors: string[] = [];

  if (!definition.operationId.trim()) {
    errors.push("Operation id is required.");
  }
  if (!KNOWN_CAPABILITIES.has(definition.capability)) {
    errors.push(`Unknown operation capability: ${definition.capability}`);
  }
  if (definition.scope.kind === "store") {
    if (!definition.scope.storeIdArg && !definition.scope.resolve) {
      errors.push("Store scope must declare storeIdArg or resolve.");
    }
  }
  if (definition.scope.kind === "organization") {
    if (!definition.scope.organizationIdArg && !definition.scope.resolve) {
      errors.push(
        "Organization scope must declare organizationIdArg or resolve.",
      );
    }
  }
  if (
    definition.actors.sharedDemo === "admit" &&
    definition.capability !== "demo.lifecycle" &&
    definition.readiness.kind !== "store_write"
  ) {
    errors.push(
      "Shared-demo writable operations must declare store_write readiness.",
    );
  }
  if (
    definition.effects.mode === "protected" &&
    definition.effects.gateways.length === 0
  ) {
    errors.push("Protected effects must declare at least one gateway.");
  }

  return errors;
}
