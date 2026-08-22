/**
 * `cash.registerSessions` — register session state and closeouts (V26-1267).
 *
 * Authority boundary: declarations only; `registersPorts.ts` implements both
 * verbs against the register-session seams inside the kernel's port query.
 *
 * The resource is reachable by any operator who can see cash controls, because
 * "is a drawer still open?" is an operational question. Every cash FIGURE —
 * float, expected, counted, variance, deposits, reviewer evidence — sits behind
 * the `cashFinancials` projection and is structurally absent below full admin.
 *
 * `get({ sessionRef })` accepts only a reference this store's own `list` minted:
 * refs are masked with a store-derived keystream and bound by digest, so a
 * guessed or cross-store reference resolves to nothing and the read fails
 * closed.
 */
import { defineCapabilityManifest } from "../../../shared/agentHarness/manifest";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import type { AgentEvidenceExtractor } from "../../agentHarness/conformance";
import {
  AGENT_PAGE_COST,
  OPERATING_DATE_FILTER,
  OPERATING_WINDOW_FIELD,
} from "../../lib/agentCapabilityManifests";

export const CASH_PACKAGE_VERSION = "1.0.0";
export const REGISTER_SESSIONS_PORT_KEY = "cash.registerSessions";

export const REGISTER_SESSIONS_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_register_sessions",
  namespace: { package: "cash", resource: "registerSessions" },
  packageVersion: CASH_PACKAGE_VERSION,
  purpose: "Register (drawer) sessions for an operating day and the closeout state of each one.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page register sessions touching one operating date, open drawers first.",
      filters: {
        operatingDate: OPERATING_DATE_FILTER,
        status: {
          kind: "enum",
          required: false,
          values: ["open", "active", "closing", "closeout_rejected", "closed"],
          meaning: "Restrict to one session status partition.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
    },
    get: {
      purpose: "One register session snapshot, including its closeout history.",
      filters: {
        sessionRef: {
          kind: "opaqueRef",
          refKind: "resource",
          required: true,
          meaning: "Reference minted by this resource's `list`; a guessed reference resolves to nothing.",
        },
      },
      bounds: { kind: "snapshot", maxEmbeddedItems: 20 },
    },
  },
  result: {
    fields: {
      sessionRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque reference to the register session." },
      registerLabel: { kind: "string", meaning: "Register the drawer belongs to." },
      terminalLabel: { kind: "string", optional: true, meaning: "Terminal the register was opened on." },
      status: {
        kind: "enum",
        values: ["open", "active", "closing", "closeout_rejected", "closed"],
        meaning: "Current session status.",
      },
      openedOperatingDate: {
        kind: "operatingDate",
        optional: true,
        meaning: "Operating date the session was opened on.",
      },
      closeoutOperatingDate: {
        kind: "operatingDate",
        optional: true,
        meaning: "Operating date the session was closed out on.",
      },
      operatingWindow: OPERATING_WINDOW_FIELD,
      openedAt: { kind: "timestamp", meaning: "When the drawer was opened." },
      closedAt: { kind: "timestamp", optional: true, meaning: "When the drawer was closed." },
      hasPendingApproval: { kind: "boolean", meaning: "Whether a manager approval is outstanding for the session." },
      closeoutEventCount: { kind: "integer", meaning: "Number of recorded closeout or reopen events." },
      closeoutVersion: { kind: "string", meaning: "Version token of the current closeout state, for citation." },
      openingFloat: {
        kind: "money",
        meaning: "Cash the drawer opened with.",
        projection: "cashFinancials",
        valueState: true,
      },
      expectedCash: {
        kind: "money",
        meaning: "Cash the drawer should hold.",
        projection: "cashFinancials",
        valueState: true,
      },
      countedCash: {
        kind: "money",
        meaning: "Cash actually counted at closeout.",
        projection: "cashFinancials",
        valueState: true,
      },
      variance: {
        kind: "money",
        meaning: "Counted minus expected cash.",
        projection: "cashFinancials",
        valueState: true,
      },
      closeoutHistory: {
        kind: "array",
        maxItems: 20,
        meaning: "Recorded closeout and reopen events for the session.",
        projection: "cashFinancials",
        items: {
          kind: "object",
          meaning: "One closeout or reopen event.",
          fields: {
            kind: { kind: "enum", values: ["closed", "reopened"], meaning: "What happened." },
            occurredAt: { kind: "timestamp", meaning: "When it happened." },
            expectedCash: { kind: "money", meaning: "Expected cash at that moment." },
            countedCash: { kind: "money", optional: true, meaning: "Counted cash at that moment." },
            variance: { kind: "money", optional: true, meaning: "Variance recorded at that moment." },
            reason: { kind: "text", optional: true, meaning: "Reason recorded by the reviewer." },
          },
        },
      },
    },
  },
  projections: {
    cashFinancials: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Cash totals, variance, deposits, and reviewer evidence; omitted entirely below full admin.",
    },
  },
  freshness: { classes: ["live"], authority: "live_read", rule: "Live session state at capture time." },
  completeness: {
    rule: "Complete only after every status partition and every page has been consumed.",
    sourceKeys: ["partitions", "pages"],
  },
  citation: {
    rule: "Cite the session reference and its closeout version; never a raw identifier.",
    sourceRefKinds: ["register_session", "closeout"],
  },
  evidence: {
    mode: "extractor",
    extractorKey: "cash.registerSessions",
    extractorVersion: "1",
    claimShapes: ["status"],
  },
  cost: { worstCasePerCall: AGENT_PAGE_COST },
  egressClass: "operational",
  examples: [
    {
      title: "Which drawers are still open?",
      verb: "list",
      args: { operatingDate: "2026-08-21", status: "open" },
      description: "Open register sessions on the current operating day.",
    },
    {
      title: "One drawer's closeout",
      verb: "get",
      args: { sessionRef: "resource:register_session.4f2a.9b1c" },
      description: "Snapshot of a session previously returned by `list`.",
    },
  ],
  binding: {
    readIntents: ["cash_controls.view"],
    portKey: REGISTER_SESSIONS_PORT_KEY,
    implementationVersion: "1",
  },
});

/**
 * Substantiates a status claim from two already-authorized scalars. It never
 * reaches a cash figure, so the slice is safe to promote for a reader who was
 * never granted `cashFinancials`.
 */
export const REGISTER_SESSIONS_EXTRACTOR: AgentEvidenceExtractor = {
  extractorKey: "cash.registerSessions",
  extractorVersion: "1",
  claimShapes: ["status"],
  extract: (input) => {
    const rows = Array.isArray(input.data) ? input.data : input.data === null ? [] : [input.data];
    const claim: { registerLabel: string; status: string }[] = [];
    for (const row of rows) {
      const record = row as { readonly registerLabel?: unknown; readonly status?: unknown } | null;
      if (!record || typeof record.registerLabel !== "string" || typeof record.status !== "string") {
        return { unsupported: "session_status_not_present_in_result" };
      }
      claim.push({ registerLabel: record.registerLabel, status: record.status });
    }
    if (claim.length === 0) return { unsupported: "no_sessions_in_result" };
    return { claim };
  },
};

export const CASH_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    defineAgentReadPort({
      contractVersion: 1,
      portKey: REGISTER_SESSIONS_PORT_KEY,
      capabilityId: REGISTER_SESSIONS_MANIFEST.capabilityId,
      verbs: ["list", "get"],
      scopeKind: "store",
      readIntents: REGISTER_SESSIONS_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AGENT_PAGE_COST,
      handler: {
        kind: "internal_query",
        functionPath: "cashControls/agentCapabilities/registersPorts:readRegisterSessions",
      },
      projections: ["cashFinancials"],
      completenessSourceKeys: ["partitions", "pages"],
    }),
  ],
};
