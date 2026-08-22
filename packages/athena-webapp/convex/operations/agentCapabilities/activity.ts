/**
 * `operations.activity` — the operational activity timeline (V26-1267).
 *
 * Authority boundary: declarations only; `activityPorts.ts` implements the read
 * against `listTimelineEvents`, the authoritative normalized timeline seam.
 *
 * The timeline crosses source families (operational events, register
 * closeouts, pending register counts) and carries financial and manager-review
 * detail, so the whole resource is bound to `workflow_traces.view` in addition
 * to `daily_operations.view`, exactly as the capability matrix specifies. The
 * matrix's role filter then lands on the manager/financial event detail inside
 * a row.
 */
import { defineCapabilityManifest } from "../../../shared/agentHarness/manifest";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import { AGENT_PAGE_COST, OPERATING_DATE_FILTER, OPERATING_WINDOW_FIELD } from "../../lib/agentCapabilityManifests";

export const ACTIVITY_PACKAGE_VERSION = "1.0.0";
export const ACTIVITY_PORT_KEY = "operations.activity";

export const ACTIVITY_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_activity",
  namespace: { package: "operations", resource: "activity" },
  packageVersion: ACTIVITY_PACKAGE_VERSION,
  purpose: "What happened on an operating day, newest first, normalized across operational source families.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page normalized timeline events for one operating date, newest first.",
      filters: {
        operatingDate: OPERATING_DATE_FILTER,
        before: {
          kind: "opaqueRef",
          refKind: "resource",
          required: false,
          meaning: "Only return events strictly older than this event reference.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 3 },
    },
  },
  result: {
    fields: {
      eventRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque reference to the timeline event." },
      operatingDate: { kind: "operatingDate", meaning: "Operating date the event falls in." },
      operatingWindow: OPERATING_WINDOW_FIELD,
      occurredAt: { kind: "timestamp", meaning: "When the event happened (event time, not capture time)." },
      family: {
        kind: "enum",
        values: ["operational_event", "register_closeout", "register_count"],
        meaning: "Source family the event was normalized from.",
      },
      eventKind: { kind: "string", meaning: "Normalized event type within its family." },
      summary: { kind: "text", meaning: "Operator-facing one-line description of the event." },
      subjectKind: { kind: "string", meaning: "Kind of record the event is about." },
      subjectLabel: { kind: "string", optional: true, meaning: "Readable label of that record." },
      financialDetail: {
        kind: "text",
        meaning: "Financial and manager-review detail carried by the event.",
        projection: "financialEvents",
      },
    },
  },
  projections: {
    financialEvents: {
      requires: { tier: "manager" },
      egressClass: "sensitive",
      meaning: "Manager review and financial event detail; omitted entirely below manager.",
    },
  },
  freshness: {
    classes: ["live"],
    authority: "live_read",
    rule: "Ordered by event time, but each source family is captured separately at read time.",
  },
  completeness: {
    rule: "Reflects both the page boundary and which source families the read covered.",
    sourceKeys: ["pages", "sourceFamilies"],
  },
  citation: {
    rule: "Cite the normalized event reference and the capture time of its source family.",
    sourceRefKinds: ["timeline_event"],
  },
  evidence: { mode: "provenance_only", reason: "Events are immutable references; the row itself is the evidence." },
  cost: { worstCasePerCall: AGENT_PAGE_COST },
  egressClass: "operational",
  examples: [
    {
      title: "What happened today?",
      verb: "list",
      args: { operatingDate: "2026-08-21" },
      description: "Newest page of normalized activity for the current operating day.",
    },
  ],
  binding: {
    readIntents: ["daily_operations.view", "workflow_traces.view"],
    portKey: ACTIVITY_PORT_KEY,
    implementationVersion: "1",
  },
});

export const ACTIVITY_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    defineAgentReadPort({
      contractVersion: 1,
      portKey: ACTIVITY_PORT_KEY,
      capabilityId: ACTIVITY_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "store",
      readIntents: ACTIVITY_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AGENT_PAGE_COST,
      handler: { kind: "internal_query", functionPath: "operations/agentCapabilities/activityPorts:listActivity" },
      projections: ["financialEvents"],
      completenessSourceKeys: ["pages", "sourceFamilies"],
    }),
  ],
};
