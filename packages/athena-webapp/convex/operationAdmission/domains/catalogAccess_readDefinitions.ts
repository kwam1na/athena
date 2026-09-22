import type { OperationReadDefinition } from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * Catalogue access tokens — read operation definition.
 *
 * The listing is part of store configuration, so it reads under
 * `store.configuration.view`. That intent is outside
 * `SHARED_DEMO_ALLOWED_READ_INTENTS`, so the demo is denied. The store scope
 * clamps the claimed store; the handler still resolves the store's own
 * organization and requires a `full_admin` membership there, which is what
 * stops another organization's full admin from reading the list.
 */

export const listCatalogAccessTokensReadDefinition = defineReadOperation({
  kind: "query" as const,
  functionName: "inventory/catalogAccess:list",
  operationId: "inventory.catalogAccess.list.read",
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

export const CATALOG_ACCESS_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [listCatalogAccessTokensReadDefinition];
