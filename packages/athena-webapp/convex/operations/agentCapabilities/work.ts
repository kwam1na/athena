/**
 * `operations.attention` and `operations.approvals` — the operational work
 * resources of the Daily Operations package (V26-1267).
 *
 * Authority boundary: declarations only. `workPorts.ts` implements both reads
 * against the authoritative seams (`buildDailyOperationsSnapshotWithCtx` for
 * the attention lanes, `listPendingApprovalRequestsSnapshot` for the approval
 * queue) inside the kernel's port query.
 *
 * Both are cursor-bounded collections with page budgets, because the honest
 * answer to "what needs me?" is a page plus an explicit statement of what was
 * not read — never a truncated list that looks complete.
 */
import { defineCapabilityManifest } from "../../../shared/agentHarness/manifest";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import { AGENT_PAGE_COST, OPERATING_DATE_FILTER, OPERATING_WINDOW_FIELD } from "../../lib/agentCapabilityManifests";

export const WORK_PACKAGE_VERSION = "1.0.0";
export const ATTENTION_PORT_KEY = "operations.attention";
export const APPROVALS_PORT_KEY = "operations.approvals";

export const ATTENTION_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_attention",
  namespace: { package: "operations", resource: "attention" },
  packageVersion: WORK_PACKAGE_VERSION,
  purpose: "Items on an operating day that need an operator, with the lane each one came from.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page the attention queue for one operating date, most severe first.",
      filters: {
        operatingDate: OPERATING_DATE_FILTER,
        status: {
          kind: "enum",
          required: false,
          values: ["blocking", "review", "informational"],
          meaning: "Partition the queue by how strongly the item holds up the day.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
    },
  },
  result: {
    fields: {
      itemRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque reference to the attention item." },
      operatingDate: { kind: "operatingDate", meaning: "Operating date the item belongs to." },
      operatingWindow: OPERATING_WINDOW_FIELD,
      lane: {
        kind: "enum",
        values: ["daily_opening", "daily_close", "operations_queue"],
        meaning: "Which contributing lane raised the item.",
      },
      status: {
        kind: "enum",
        values: ["blocking", "review", "informational"],
        meaning: "How strongly the item holds up the store day.",
      },
      title: { kind: "string", meaning: "Short operator-facing title." },
      subjectKind: { kind: "string", meaning: "Kind of record the item is about (register session, work item, …)." },
      subjectLabel: { kind: "string", optional: true, meaning: "Readable label of that record." },
      registerLabel: {
        kind: "string",
        optional: true,
        meaning: "Register the item is about, when it concerns a drawer.",
      },
      managerReason: {
        kind: "text",
        meaning: "Manager-facing reason and evidence behind the item.",
        projection: "managerReasons",
      },
    },
  },
  projections: {
    managerReasons: {
      requires: { tier: "manager" },
      egressClass: "sensitive",
      meaning: "Manager-only reasons and review evidence attached to an attention item.",
    },
  },
  freshness: { classes: ["live"], authority: "live_read", rule: "Live queue snapshot at capture time." },
  completeness: {
    rule: "Derived from every contributing lane and from page exhaustion, never from a single boolean.",
    sourceKeys: ["lanes", "pages"],
  },
  citation: {
    rule: "Cite the work-item and approval-request references plus the capture time.",
    sourceRefKinds: ["work_item", "approval_request", "store_day_record"],
  },
  evidence: { mode: "provenance_only", reason: "Queue membership is transient; a slice would age out of truth." },
  cost: { worstCasePerCall: AGENT_PAGE_COST },
  egressClass: "operational",
  examples: [
    {
      title: "What is blocking the close?",
      verb: "list",
      args: { operatingDate: "2026-08-21", status: "blocking" },
      description: "Only the items that hold up the end-of-day close.",
    },
  ],
  binding: {
    readIntents: ["daily_operations.view", "operations.workItems.view"],
    portKey: ATTENTION_PORT_KEY,
    implementationVersion: "2",
  },
});

export const APPROVALS_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_approvals",
  namespace: { package: "operations", resource: "approvals" },
  packageVersion: WORK_PACKAGE_VERSION,
  purpose: "Approval requests still awaiting a decision on an operating day.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page pending approval requests for one operating date, newest first.",
      filters: {
        operatingDate: OPERATING_DATE_FILTER,
        state: {
          kind: "enum",
          required: true,
          values: ["pending"],
          meaning: "Only pending requests are listable in v1; decided requests are audit history.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
    },
  },
  result: {
    fields: {
      requestRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque reference to the approval request." },
      operatingDate: { kind: "operatingDate", meaning: "Operating date the request belongs to." },
      requestKind: { kind: "string", meaning: "What is being approved (variance review, void, …)." },
      subjectKind: { kind: "string", meaning: "Kind of record the request is about." },
      state: { kind: "enum", values: ["pending"], meaning: "Current state of the request." },
      stateVersion: { kind: "string", meaning: "Version token of the current state, for citation." },
      raisedAt: { kind: "timestamp", meaning: "When the request was raised." },
      reason: { kind: "text", optional: true, meaning: "Reason recorded when the request was raised." },
      approvalProof: {
        kind: "text",
        meaning: "Reviewer identity and approval proof attached to the request.",
        projection: "approvalProof",
      },
    },
  },
  projections: {
    approvalProof: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Approval proof and reviewer details; omitted entirely below full admin.",
    },
  },
  freshness: { classes: ["live"], authority: "live_read", rule: "Live queue state at capture time." },
  completeness: {
    rule: "Complete only when every page of the pending partition has been consumed.",
    sourceKeys: ["pages"],
  },
  citation: {
    rule: "Cite the request reference and its current state version.",
    sourceRefKinds: ["approval_request"],
  },
  evidence: { mode: "provenance_only", reason: "Pending state changes as soon as a reviewer acts." },
  cost: { worstCasePerCall: AGENT_PAGE_COST },
  egressClass: "operational",
  examples: [
    {
      title: "Pending approvals today",
      verb: "list",
      args: { operatingDate: "2026-08-21", state: "pending" },
      description: "First page of approvals still awaiting a decision.",
    },
  ],
  binding: {
    readIntents: ["daily_operations.view", "operations.workItems.view"],
    portKey: APPROVALS_PORT_KEY,
    implementationVersion: "2",
  },
});

export const WORK_MANIFESTS = [ATTENTION_MANIFEST, APPROVALS_MANIFEST] as const;

export const WORK_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    defineAgentReadPort({
      contractVersion: 1,
      portKey: ATTENTION_PORT_KEY,
      capabilityId: ATTENTION_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "store",
      readIntents: ATTENTION_MANIFEST.binding.readIntents,
      implementationVersion: "2",
      declaredCost: AGENT_PAGE_COST,
      handler: { kind: "internal_query", functionPath: "operations/agentCapabilities/workPorts:listAttention" },
      projections: ["managerReasons"],
      completenessSourceKeys: ["lanes", "pages"],
    }),
    defineAgentReadPort({
      contractVersion: 1,
      portKey: APPROVALS_PORT_KEY,
      capabilityId: APPROVALS_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "store",
      readIntents: APPROVALS_MANIFEST.binding.readIntents,
      implementationVersion: "2",
      declaredCost: AGENT_PAGE_COST,
      handler: { kind: "internal_query", functionPath: "operations/agentCapabilities/workPorts:listApprovals" },
      projections: ["approvalProof"],
      completenessSourceKeys: ["pages"],
    }),
  ],
};
