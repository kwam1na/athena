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

export const OPERATION_ADMISSION_DEFINITIONS = [
  resolveSyncedSaleInventoryReviewGroupOperationDefinition,
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
      errors.push("Organization scope must declare organizationIdArg or resolve.");
    }
  }
  if (
    definition.actors.sharedDemo === "admit" &&
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
