/**
 * `inventory.positions` and `inventory.replenishment` — the stock resources of
 * the Daily Operations package (V26-1267).
 *
 * Authority boundary: declarations only; `inventoryPorts.ts` implements the
 * reads against the stock snapshot and replenishment seams.
 *
 * Two different authority shapes on purpose:
 *
 * - `inventory.positions` is reachable by anyone who may see stock, but unit
 *   cost and stock value sit behind a projection that requires the
 *   `inventory.cost_overlay.view` read intent as well as membership. An
 *   operator without the overlay gets positions with those fields ABSENT — the
 *   escalation fails closed rather than returning a zero cost.
 * - `inventory.replenishment` is a procurement surface: the resource itself is
 *   bound to `procurement.view`, and supplier commercial terms are a further
 *   full-admin projection on top.
 */
import { defineCapabilityManifest } from "../../../shared/agentHarness/manifest";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import type { AgentEvidenceExtractor } from "../../agentHarness/conformance";
import { AGENT_PAGE_COST } from "../../lib/agentCapabilityManifests";

export const INVENTORY_PACKAGE_VERSION = "1.0.0";
export const POSITIONS_PORT_KEY = "inventory.positions";
export const REPLENISHMENT_PORT_KEY = "inventory.replenishment";

export const POSITIONS_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_inventory_positions",
  namespace: { package: "inventory", resource: "positions" },
  packageVersion: INVENTORY_PACKAGE_VERSION,
  purpose: "Live stock position for the store's sellable SKUs.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page stock positions for the store.",
      filters: {
        category: { kind: "string", required: false, meaning: "Restrict to one catalogue category name." },
        stockState: {
          kind: "enum",
          required: false,
          values: ["in_stock", "low", "out"],
          meaning: "Restrict to a stock-pressure band.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 3 },
    },
    get: {
      purpose: "One SKU's stock position.",
      filters: {
        skuRef: {
          kind: "opaqueRef",
          refKind: "resource",
          required: true,
          meaning: "Reference minted by this resource's `list`; a guessed reference resolves to nothing.",
        },
      },
      bounds: { kind: "snapshot", maxEmbeddedItems: 10 },
    },
  },
  result: {
    fields: {
      skuRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque reference to the SKU." },
      skuCode: { kind: "string", optional: true, meaning: "Business code of the SKU." },
      displayName: { kind: "string", meaning: "Catalogue name of the item." },
      variantLabel: { kind: "string", optional: true, meaning: "Variant (size, colour) label." },
      category: { kind: "string", optional: true, meaning: "Catalogue category." },
      subcategory: { kind: "string", optional: true, meaning: "Catalogue subcategory." },
      onHand: { kind: "quantity", meaning: "Units physically on hand." },
      available: { kind: "quantity", meaning: "Units sellable right now." },
      reserved: { kind: "quantity", meaning: "Units held by open carts or checkouts." },
      stockState: {
        kind: "enum",
        values: ["in_stock", "low", "out"],
        meaning: "Stock-pressure band derived from the available quantity.",
      },
      adjustmentBlockedReason: {
        kind: "string",
        optional: true,
        meaning: "Why stock adjustments are currently blocked for this SKU.",
      },
      unitCost: {
        kind: "money",
        meaning: "Cost basis per unit.",
        projection: "costOverlay",
        valueState: true,
      },
      stockValue: {
        kind: "money",
        meaning: "On-hand units valued at cost.",
        projection: "costOverlay",
        valueState: true,
      },
    },
  },
  projections: {
    costOverlay: {
      requires: { tier: "member", readIntents: ["inventory.cost_overlay.view"] },
      egressClass: "sensitive",
      meaning:
        "Unit cost and stock value. Requires the cost-overlay read intent; without it the fields are absent, never zero.",
    },
  },
  freshness: { classes: ["live"], authority: "live_read", rule: "Live stock position at capture time." },
  completeness: {
    rule: "Page exhaustion determines collection completeness; a partial read says so.",
    sourceKeys: ["positions"],
  },
  citation: {
    rule: "Cite the SKU snapshot reference and the capture time.",
    sourceRefKinds: ["sku_snapshot"],
  },
  evidence: {
    mode: "extractor",
    extractorKey: "inventory.positions",
    extractorVersion: "1",
    claimShapes: ["onHand"],
  },
  cost: { worstCasePerCall: AGENT_PAGE_COST },
  egressClass: "operational",
  examples: [
    {
      title: "What is running low?",
      verb: "list",
      args: { stockState: "low" },
      description: "Positions under stock pressure.",
    },
    {
      title: "One SKU's position",
      verb: "get",
      args: { skuRef: "resource:product_sku.7c1d.a20f" },
      description: "Stock position for a SKU previously returned by `list`.",
    },
  ],
  binding: {
    readIntents: ["inventory.stock.view"],
    portKey: POSITIONS_PORT_KEY,
    implementationVersion: "1",
  },
});

/**
 * Substantiates an on-hand claim from quantities the reader already held. It
 * never touches the cost overlay, so the slice is authorized for every reader
 * who could have made the claim.
 */
export const POSITIONS_EXTRACTOR: AgentEvidenceExtractor = {
  extractorKey: "inventory.positions",
  extractorVersion: "1",
  claimShapes: ["onHand"],
  extract: (input) => {
    const rows = Array.isArray(input.data) ? input.data : input.data === null ? [] : [input.data];
    const claim: { displayName: string; onHand: number }[] = [];
    for (const row of rows) {
      const record = row as
        | { readonly displayName?: unknown; readonly onHand?: { readonly value?: unknown } }
        | null;
      const onHand = record?.onHand;
      if (
        !record ||
        typeof record.displayName !== "string" ||
        onHand === null ||
        typeof onHand !== "object" ||
        typeof onHand.value !== "number"
      ) {
        return { unsupported: "on_hand_not_present_in_result" };
      }
      claim.push({ displayName: record.displayName, onHand: onHand.value });
    }
    if (claim.length === 0) return { unsupported: "no_positions_in_result" };
    return { claim };
  },
};

export const REPLENISHMENT_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_replenishment",
  namespace: { package: "inventory", resource: "replenishment" },
  packageVersion: INVENTORY_PACKAGE_VERSION,
  purpose: "Replenishment recommendations derived from stock pressure and purchase-order coverage.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page replenishment recommendations, most exposed first.",
      filters: {
        continuityStatus: {
          kind: "enum",
          required: false,
          values: [
            "exposed",
            "partially_covered",
            "planned",
            "inbound",
            "vendor_missing",
            "stale_planned_action",
            "late_inbound",
            "short_receipt",
            "cancelled_cover",
          ],
          meaning: "Restrict to one continuity status.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
    },
  },
  result: {
    fields: {
      recommendationRef: {
        kind: "opaqueRef",
        refKind: "resource",
        meaning: "Opaque reference to the recommendation.",
      },
      skuRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque reference to the SKU it concerns." },
      skuCode: { kind: "string", optional: true, meaning: "Business code of the SKU." },
      displayName: { kind: "string", meaning: "Catalogue name of the item." },
      continuityStatus: {
        kind: "enum",
        values: [
          "exposed",
          "partially_covered",
          "planned",
          "inbound",
          "vendor_missing",
          "stale_planned_action",
          "late_inbound",
          "short_receipt",
          "cancelled_cover",
        ],
        meaning: "How exposed the SKU is to running out.",
      },
      needsAction: { kind: "boolean", meaning: "Whether the recommendation asks an operator to act." },
      onHand: { kind: "quantity", meaning: "Units on hand." },
      available: { kind: "quantity", meaning: "Units sellable right now." },
      suggestedOrderQuantity: { kind: "quantity", meaning: "Units the recommendation suggests ordering." },
      inboundQuantity: { kind: "quantity", meaning: "Units already inbound on purchase orders." },
      plannedQuantity: { kind: "quantity", meaning: "Units planned but not yet ordered." },
      guidance: { kind: "text", meaning: "Operator-facing guidance for the recommendation." },
      derivationVersion: { kind: "string", meaning: "Version of the derivation that produced the recommendation." },
      inputFreshness: {
        kind: "enum",
        values: ["live", "stale"],
        meaning: "Freshness of the stock and procurement inputs behind the recommendation.",
      },
      nextExpectedAt: {
        kind: "timestamp",
        optional: true,
        meaning: "When the next inbound receipt is expected.",
      },
      supplierCommitment: {
        kind: "object",
        meaning: "Supplier commercial commitment behind the recommendation.",
        projection: "supplierCommercial",
        fields: {
          hasActiveVendor: { kind: "boolean", meaning: "Whether an active vendor can supply the SKU." },
          openPurchaseOrderCount: { kind: "integer", meaning: "Open purchase orders covering the SKU." },
          cancelledPurchaseOrderCount: { kind: "integer", meaning: "Cancelled purchase orders for the SKU." },
          supplierCost: { kind: "money", optional: true, meaning: "Last known supplier unit cost." },
        },
      },
    },
  },
  projections: {
    supplierCommercial: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Supplier cost and commitment detail; omitted entirely below full admin.",
    },
  },
  freshness: {
    classes: ["derived", "live"],
    authority: "derived",
    rule: "Re-derived on every read from stock and procurement inputs; the input freshness is reported per row.",
  },
  completeness: {
    rule: "Page exhaustion plus coverage of the procurement inputs the derivation needed.",
    sourceKeys: ["recommendations", "inputs"],
  },
  citation: {
    rule: "Cite the recommendation reference plus the constituent SKU snapshot reference.",
    sourceRefKinds: ["replenishment_recommendation", "sku_snapshot"],
  },
  evidence: { mode: "provenance_only", reason: "Recommendations are re-derived; a stored slice would not reproduce." },
  cost: { worstCasePerCall: AGENT_PAGE_COST },
  egressClass: "operational",
  examples: [
    {
      title: "What is exposed to running out?",
      verb: "list",
      args: { continuityStatus: "exposed" },
      description: "SKUs with no cover at all.",
    },
  ],
  binding: {
    readIntents: ["procurement.view", "inventory.stock.view"],
    portKey: REPLENISHMENT_PORT_KEY,
    implementationVersion: "1",
  },
});

export const INVENTORY_MANIFESTS = [POSITIONS_MANIFEST, REPLENISHMENT_MANIFEST] as const;

export const INVENTORY_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    defineAgentReadPort({
      contractVersion: 1,
      portKey: POSITIONS_PORT_KEY,
      capabilityId: POSITIONS_MANIFEST.capabilityId,
      verbs: ["list", "get"],
      scopeKind: "store",
      readIntents: POSITIONS_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AGENT_PAGE_COST,
      handler: { kind: "internal_query", functionPath: "stockOps/agentCapabilities/inventoryPorts:readPositions" },
      projections: ["costOverlay"],
      completenessSourceKeys: ["positions"],
    }),
    defineAgentReadPort({
      contractVersion: 1,
      portKey: REPLENISHMENT_PORT_KEY,
      capabilityId: REPLENISHMENT_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "store",
      readIntents: REPLENISHMENT_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AGENT_PAGE_COST,
      handler: { kind: "internal_query", functionPath: "stockOps/agentCapabilities/inventoryPorts:listReplenishment" },
      projections: ["supplierCommercial"],
      completenessSourceKeys: ["recommendations", "inputs"],
    }),
  ],
};
