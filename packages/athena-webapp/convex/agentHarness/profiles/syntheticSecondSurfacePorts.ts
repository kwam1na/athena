/**
 * Read ports of the synthetic second surface (`organization_overview`).
 *
 * Placeholders: each port is defined through the composition root's
 * `defineAgentReadPortQuery`, so it is reauthorized, scope-bound, and
 * envelope-checked like every other port, but its handler answers a typed
 * `unavailable` until U10 implements the real reads. Replacing a handler body
 * is a behavioral change: bump `implementationVersion` on the manifest binding
 * and the port definition, then run `bun run agent-sdk:generate`.
 */
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";

const NOT_IMPLEMENTED = "synthetic_port_not_implemented";

export const listStores = defineAgentReadPortQuery({
  portKey: "fleet.stores",
  handler: async () => ({ kind: "unavailable", reason: NOT_IMPLEMENTED, retryable: false, sourceKey: "pages" }),
});

export const getStoreHealth = defineAgentReadPortQuery({
  portKey: "fleet.storeHealth",
  handler: async () => ({ kind: "unavailable", reason: NOT_IMPLEMENTED, retryable: false, sourceKey: "samples" }),
});

export const listTeams = defineAgentReadPortQuery({
  portKey: "directory.teams",
  handler: async () => ({ kind: "unavailable", reason: NOT_IMPLEMENTED, retryable: false, sourceKey: "pages" }),
});
