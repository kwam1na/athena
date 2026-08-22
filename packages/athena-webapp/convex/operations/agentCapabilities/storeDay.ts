/**
 * `operations.storeDay` — the store-day lifecycle resource (V26-1267).
 *
 * Authority boundary: this file declares WHAT the resource means, what an
 * operator must hold to read each part of it, and how a claim about it is
 * substantiated. It holds no database access; `storeDayPorts.ts` implements the
 * read against `buildDailyOperationsSnapshotWithCtx`, the authoritative
 * store-day seam, inside the kernel's port query.
 *
 * Semantic, not screen-shaped: the resource answers "what state is this store
 * day in, what is holding it up, and which accepted records prove it" — not
 * "what does the Daily Operations header render". Money never appears here;
 * it belongs to `reports.daySales`. Manager review evidence is the one
 * sensitive projection, exactly as the capability matrix specifies.
 */
import { defineCapabilityManifest } from "../../../shared/agentHarness/manifest";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import type { AgentEvidenceExtractor } from "../../agentHarness/conformance";
import {
  AGENT_SNAPSHOT_COST,
  OPERATING_DATE_FILTER,
  OPERATING_WINDOW_FIELD,
} from "../../lib/agentCapabilityManifests";

export const STORE_DAY_PACKAGE_VERSION = "1.0.0";
export const STORE_DAY_PORT_KEY = "operations.storeDay";

export const STORE_DAY_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_store_day",
  namespace: { package: "operations", resource: "storeDay" },
  packageVersion: STORE_DAY_PACKAGE_VERSION,
  purpose:
    "Store-day lifecycle, readiness, and close state for one operating date, with the accepted opening and close records that prove it.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    get: {
      purpose: "One store-day snapshot: lifecycle stage, readiness counts, and record provenance.",
      filters: { operatingDate: OPERATING_DATE_FILTER },
      bounds: { kind: "snapshot", maxEmbeddedItems: 24 },
    },
  },
  result: {
    fields: {
      operatingDate: { kind: "operatingDate", meaning: "Operating date this snapshot describes." },
      operatingWindow: OPERATING_WINDOW_FIELD,
      lifecycleStage: {
        kind: "enum",
        values: ["not_opened", "operating", "close_blocked", "ready_to_close", "reopened", "closed"],
        meaning: "Where the store day sits in the opening → operating → close lifecycle.",
      },
      lifecycleSummary: { kind: "string", meaning: "One-line operator-facing description of the stage." },
      openingStatus: {
        kind: "enum",
        values: ["not_started", "started"],
        meaning: "Whether the opening handoff was started for this day.",
      },
      openingReadiness: {
        kind: "object",
        meaning: "Counts of opening items by disposition.",
        fields: {
          blockerCount: { kind: "integer", meaning: "Opening items blocking the day." },
          reviewCount: { kind: "integer", meaning: "Opening items awaiting review." },
          carryForwardCount: { kind: "integer", meaning: "Items carried in from the prior day." },
          readyCount: { kind: "integer", meaning: "Opening items already satisfied." },
        },
      },
      closeStatus: {
        kind: "enum",
        values: ["not_started", "open", "completed", "reopened"],
        meaning: "State of the end-of-day close record.",
      },
      closeReadiness: {
        kind: "object",
        meaning: "Counts of close items by disposition.",
        fields: {
          blockerCount: { kind: "integer", meaning: "Close items blocking completion." },
          reviewCount: { kind: "integer", meaning: "Close items awaiting review." },
          carryForwardCount: { kind: "integer", meaning: "Items that will carry into the next day." },
          readyCount: { kind: "integer", meaning: "Close items already satisfied." },
        },
      },
      attentionCount: { kind: "integer", meaning: "Items currently needing an operator on this day." },
      openWorkItemCount: { kind: "integer", meaning: "Open operational work items." },
      pendingApprovalCount: { kind: "integer", meaning: "Approval requests still pending." },
      registerBlockerCount: { kind: "integer", meaning: "Register sessions currently blocking the close." },
      transactionCount: { kind: "integer", meaning: "Completed point-of-sale transactions on this day." },
      completedCloseAt: {
        kind: "timestamp",
        optional: true,
        meaning: "When the close record was completed, if it has been.",
      },
      completedCloseActor: {
        kind: "enum",
        optional: true,
        values: ["human", "automation"],
        meaning: "Whether a person or Athena automation completed the close.",
      },
      openingRecordRef: {
        kind: "opaqueRef",
        refKind: "source",
        optional: true,
        meaning: "Accepted opening record backing this snapshot.",
      },
      closeRecordRef: {
        kind: "opaqueRef",
        refKind: "source",
        optional: true,
        meaning: "Accepted close record backing this snapshot.",
      },
      managerReviewEvidence: {
        kind: "array",
        maxItems: 20,
        meaning: "Manager review evidence recorded against the opening handoff.",
        projection: "managerReview",
        items: {
          kind: "object",
          meaning: "One review-evidence entry.",
          fields: {
            key: { kind: "string", meaning: "Stable key of the evidence entry." },
            severity: {
              kind: "enum",
              values: ["blocker", "review", "carry_forward"],
              meaning: "How the entry was classified.",
            },
            title: { kind: "string", meaning: "Short title of the entry." },
            message: { kind: "text", meaning: "Reviewer-facing explanation." },
          },
        },
      },
    },
  },
  projections: {
    managerReview: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Manager review evidence recorded against the store day; omitted entirely below full admin.",
    },
  },
  freshness: {
    classes: ["live", "accepted"],
    authority: "authoritative_record",
    rule: "Live while the day is open; the accepted close record is authoritative once the day is completed.",
  },
  completeness: {
    rule: "Complete only when both the lifecycle read and the close-record read covered their sources.",
    sourceKeys: ["lifecycle", "closeRecords"],
  },
  citation: {
    rule: "Cite the opening and close record versions plus the capture time of the lifecycle read.",
    sourceRefKinds: ["store_day_record", "close_record"],
  },
  evidence: {
    mode: "extractor",
    extractorKey: "operations.storeDay",
    extractorVersion: "1",
    claimShapes: ["lifecycleStage"],
  },
  cost: { worstCasePerCall: AGENT_SNAPSHOT_COST },
  egressClass: "operational",
  examples: [
    {
      title: "Is today ready to close?",
      verb: "get",
      args: { operatingDate: "2026-08-21" },
      description: "Lifecycle stage and readiness counts for the current operating day.",
    },
  ],
  binding: {
    readIntents: ["daily_operations.view", "daily_close.view"],
    portKey: STORE_DAY_PORT_KEY,
    implementationVersion: "1",
  },
});

/**
 * Deterministic, field-minimizing claim support: it copies the two already
 * authorized scalars that substantiate a lifecycle claim and nothing else. An
 * arbitrary transform it cannot substantiate returns `unsupported`, which
 * downgrades the citation to provenance-only rather than inventing evidence.
 */
export const STORE_DAY_EXTRACTOR: AgentEvidenceExtractor = {
  extractorKey: "operations.storeDay",
  extractorVersion: "1",
  claimShapes: ["lifecycleStage"],
  extract: (input) => {
    const data = input.data as { readonly operatingDate?: unknown; readonly lifecycleStage?: unknown } | null;
    if (!data || typeof data.operatingDate !== "string" || typeof data.lifecycleStage !== "string") {
      return { unsupported: "lifecycle_stage_not_present_in_result" };
    }
    return { claim: { operatingDate: data.operatingDate, lifecycleStage: data.lifecycleStage } };
  },
};

export const STORE_DAY_READ_PORT = defineAgentReadPort({
  contractVersion: 1,
  portKey: STORE_DAY_PORT_KEY,
  capabilityId: STORE_DAY_MANIFEST.capabilityId,
  verbs: ["get"],
  scopeKind: "store",
  readIntents: STORE_DAY_MANIFEST.binding.readIntents,
  implementationVersion: "1",
  declaredCost: AGENT_SNAPSHOT_COST,
  handler: { kind: "internal_query", functionPath: "operations/agentCapabilities/storeDayPorts:getStoreDay" },
  projections: ["managerReview"],
  completenessSourceKeys: ["lifecycle", "closeRecords"],
});

export const STORE_DAY_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [STORE_DAY_READ_PORT],
};
