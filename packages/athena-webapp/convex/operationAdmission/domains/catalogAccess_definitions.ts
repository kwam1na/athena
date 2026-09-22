import type { OperationDefinition } from "../types";
import { defineOperation } from "./_shapes";

/**
 * Catalogue access tokens — write operation definitions.
 *
 * Minting and revoking a store's external catalogue credential is an
 * integration change, not a catalogue change, so both carry
 * `integrations.manage`. That capability is outside
 * `SHARED_DEMO_ALLOWED_CAPABILITIES`, which is why the demo is denied here and
 * the demo-foundation guard is declared on the definition instead of the
 * handler. Neither operation touches a protected effect gateway.
 *
 * The store scope echoes `args.storeId`; it clamps which store the caller
 * claims to act on, not which row a mutation may reach. Revoke therefore loads
 * its target row and compares the row's own `storeId` against the admitted
 * constraint before writing.
 */

export const mintCatalogAccessTokenOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/catalogAccess:mint",
  operationId: "inventory.catalogAccess.mint",
  capability: "integrations.manage" as const,
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const revokeCatalogAccessTokenOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/catalogAccess:revoke",
  operationId: "inventory.catalogAccess.revoke",
  capability: "integrations.manage" as const,
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "deny" as const,
    public: "deny" as const,
  },
});

export const CATALOG_ACCESS_DEFINITIONS: readonly OperationDefinition[] = [
  mintCatalogAccessTokenOperationDefinition,
  revokeCatalogAccessTokenOperationDefinition,
];
