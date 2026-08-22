/**
 * `automation.dailyOperations` — automation run and policy evidence for a store
 * day (V26-1267).
 *
 * Authority boundary: declarations only; `evidencePorts.ts` reads the run
 * ledger and the policy rows inside the kernel's port query.
 *
 * The automation ledger is EVIDENCE, not domain truth. A run says what Athena
 * decided and under which policy version — never what the store day is. That
 * separation is why the resource cites policy versions and run idempotency
 * keys, and why its completeness reports scheduled windows that produced no run
 * at all rather than presenting an incomplete ledger as a complete one.
 */
import { defineCapabilityManifest } from "../../../shared/agentHarness/manifest";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import {
  AGENT_SMALL_PAGE_COST,
  OPERATING_DATE_FILTER,
  OPERATING_WINDOW_FIELD,
} from "../../lib/agentCapabilityManifests";

export const AUTOMATION_PACKAGE_VERSION = "1.0.0";
export const AUTOMATION_PORT_KEY = "automation.dailyOperations";

/** The Daily Operations automation actions the resource covers. */
export const AUTOMATION_ACTIONS = [
  "opening.auto_start",
  "eod.prepare",
  "eod.auto_complete",
] as const;

export const AUTOMATION_DOMAIN = "daily_operations";

export const AUTOMATION_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_automation",
  namespace: { package: "automation", resource: "dailyOperations" },
  packageVersion: AUTOMATION_PACKAGE_VERSION,
  purpose: "What Athena's Daily Operations automation did on an operating day, and under which policy.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Automation runs recorded for one operating date, newest first.",
      filters: {
        operatingDate: OPERATING_DATE_FILTER,
        action: {
          kind: "enum",
          required: false,
          values: ["opening.auto_start", "eod.prepare", "eod.auto_complete"],
          meaning: "Restrict to one automation action.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 50, maxPagesPerRun: 1 },
    },
  },
  result: {
    fields: {
      runRef: { kind: "opaqueRef", refKind: "source", meaning: "Opaque reference to the automation run record." },
      operatingDate: { kind: "operatingDate", meaning: "Operating date the run was scheduled for." },
      operatingWindow: OPERATING_WINDOW_FIELD,
      action: {
        kind: "enum",
        values: ["opening.auto_start", "eod.prepare", "eod.auto_complete"],
        meaning: "Automation action the run performed.",
      },
      lane: { kind: "enum", values: ["opening", "close"], meaning: "Which lane of the store day the action serves." },
      outcome: {
        kind: "enum",
        values: ["disabled", "dry_run", "skipped", "prepared", "eligible", "applied", "failed"],
        meaning: "What the run concluded.",
      },
      disposition: {
        kind: "enum",
        values: ["failed", "action_taken", "needs_review", "policy_skipped", "scheduled_later"],
        meaning: "How an operator should read the outcome.",
      },
      policyMode: {
        kind: "enum",
        values: ["disabled", "dry_run", "enabled"],
        meaning: "Mode the governing policy was in.",
      },
      policyVersion: { kind: "string", meaning: "Version of the policy the run applied." },
      idempotencyToken: { kind: "string", meaning: "Idempotency token of the run, for citation." },
      occurredAt: { kind: "timestamp", meaning: "When the run reached its outcome." },
      decisionReason: { kind: "string", optional: true, meaning: "Short reason recorded with the outcome." },
      failure: {
        kind: "object",
        optional: true,
        meaning: "Recorded failure, when the run failed.",
        fields: {
          code: { kind: "string", meaning: "Failure code." },
          message: { kind: "text", meaning: "Failure message." },
        },
      },
      policyEvidence: {
        kind: "object",
        meaning: "Policy thresholds and gate evidence behind the decision.",
        projection: "policyDetails",
        fields: {
          kind: { kind: "string", meaning: "Evidence kind." },
          eligible: { kind: "boolean", optional: true, meaning: "Whether the gate considered the run eligible." },
          gates: {
            kind: "array",
            maxItems: 20,
            meaning: "Individual gates the policy evaluated.",
            items: {
              kind: "object",
              meaning: "One gate.",
              fields: {
                key: { kind: "string", meaning: "Gate key." },
                passed: { kind: "boolean", meaning: "Whether the gate passed." },
                reason: { kind: "text", optional: true, meaning: "Why the gate failed." },
              },
            },
          },
        },
      },
    },
  },
  projections: {
    policyDetails: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Policy thresholds and review evidence; omitted entirely below full admin.",
    },
  },
  freshness: {
    classes: ["live"],
    authority: "live_read",
    rule: "The ledger is read live; it is evidence about automation, not the state of the store day.",
  },
  completeness: {
    rule: "Reports the scheduled windows that produced no run, so a silent gap is never read as a clean day.",
    sourceKeys: ["runs", "scheduledWindows"],
  },
  citation: {
    rule: "Cite the policy version and the run's idempotency and outcome references.",
    sourceRefKinds: ["automation_run", "automation_policy"],
  },
  evidence: { mode: "provenance_only", reason: "Ledger rows are immutable references; the row is the evidence." },
  cost: { worstCasePerCall: AGENT_SMALL_PAGE_COST },
  egressClass: "operational",
  examples: [
    {
      title: "Did automation open the store today?",
      verb: "list",
      args: { operatingDate: "2026-08-21", action: "opening.auto_start" },
      description: "Runs of the opening auto-start action on the current operating day.",
    },
  ],
  binding: {
    readIntents: ["daily_operations.view"],
    portKey: AUTOMATION_PORT_KEY,
    implementationVersion: "1",
  },
});

export const AUTOMATION_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    defineAgentReadPort({
      contractVersion: 1,
      portKey: AUTOMATION_PORT_KEY,
      capabilityId: AUTOMATION_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "store",
      readIntents: AUTOMATION_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AGENT_SMALL_PAGE_COST,
      handler: {
        kind: "internal_query",
        functionPath: "automation/agentCapabilities/evidencePorts:listAutomationEvidence",
      },
      projections: ["policyDetails"],
      completenessSourceKeys: ["runs", "scheduledWindows"],
    }),
  ],
};
