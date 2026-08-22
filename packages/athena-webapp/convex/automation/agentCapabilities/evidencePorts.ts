/**
 * Read port for `automation.dailyOperations` (V26-1267).
 *
 * Authority boundary: the kernel's port query reauthorizes, scopes, and strips
 * the `policyDetails` projection for anyone below full admin. This handler
 * reads the run ledger for the store day, one indexed range per action, and
 * reports the actions that produced no run at all as a missing scheduled
 * window — so a silent automation gap is never read as a clean day.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import {
  mintAgentSourceRef,
  pageOf,
  resolveAgentOperatingWindowWithCtx,
} from "../../lib/agentCapabilitySupport";
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";
import type { AgentReadPortHandler, AgentReadPortHandlerOutput } from "../../agentHarness/readPorts";
import type { AgentSourceCompleteness, AgentWarning } from "../../../shared/agentHarness/results";
import { listAutomationRunsForStoreDayActionWithCtx } from "../runLedger";
import { AUTOMATION_ACTIONS, AUTOMATION_DOMAIN, AUTOMATION_PORT_KEY } from "./evidence";

type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

const LANE_BY_ACTION: Record<AutomationAction, "opening" | "close"> = {
  "opening.auto_start": "opening",
  "eod.prepare": "close",
  "eod.auto_complete": "close",
};

/**
 * How an operator should read the outcome. Mirrors the disposition the Daily
 * Operations surface derives, so the agent answer and the screen agree.
 */
function dispositionOf(
  run: Doc<"automationRun">,
): "failed" | "action_taken" | "needs_review" | "policy_skipped" | "scheduled_later" {
  if (run.outcome === "failed") return "failed";
  if (run.outcome === "applied") return "action_taken";
  const classification = run.decisionEvidence?.classification;
  if (classification === "outside_completion_window") return "scheduled_later";
  if (run.outcome === "prepared" || classification === "blocked") return "needs_review";
  return "policy_skipped";
}

function policyEvidenceOf(run: Doc<"automationRun">) {
  const evidence = run.decisionEvidence;
  return {
    kind: evidence?.kind ?? "none",
    eligible: evidence?.eligible,
    gates: (evidence?.gates ?? []).slice(0, 20).map((gate) => ({
      key: gate.key,
      passed: gate.passed,
      reason: gate.reason,
    })),
  };
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const listAutomationEvidenceHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId as Id<"store"> | undefined;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "runs" };
  }
  const operatingDate = String(input.args.operatingDate);
  const window = await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "runs" };
  }

  const requested = input.args.action as AutomationAction | undefined;
  const actions = requested ? [requested] : [...AUTOMATION_ACTIONS];
  const byAction = await Promise.all(
    actions.map(async (action) => ({
      action,
      runs: await listAutomationRunsForStoreDayActionWithCtx(ctx, {
        action,
        domain: AUTOMATION_DOMAIN,
        operatingDate,
        storeId,
      }),
    })),
  );

  const rows = byAction
    .flatMap(({ action, runs }) => runs.map((run) => ({ action, run })))
    .sort(
      (left, right) => (right.run.appliedAt ?? right.run.updatedAt) - (left.run.appliedAt ?? left.run.updatedAt),
    );
  const missingWindows = byAction.filter((entry) => entry.runs.length === 0).map((entry) => entry.action);
  const page = pageOf(rows, input.pageIndex * input.pageSize, input.pageSize);
  const warnings: AgentWarning[] = [];
  if (window.derivation === "utc_fallback") {
    warnings.push({
      code: "operating_window_fallback",
      message: "No store schedule governed this date, so the calendar day was used for the window.",
      sourceKey: "runs",
    });
  }

  const sources: AgentSourceCompleteness[] = [
    {
      sourceKey: "runs",
      status: page.hasMore ? "partial" : "complete",
      reason: page.hasMore ? "more_pages_available" : undefined,
      capturedAt: input.now,
    },
    {
      sourceKey: "scheduledWindows",
      status: missingWindows.length === 0 ? "complete" : "partial",
      reason: missingWindows.length === 0 ? undefined : "no_run_recorded_for_scheduled_window",
      missing: missingWindows.length === 0 ? undefined : missingWindows,
      capturedAt: input.now,
    },
  ];

  return {
    kind: "data",
    data: page.items.map(({ action, run }) => ({
      runRef: mintAgentSourceRef("automation_run", storeId, String(run._id)),
      operatingDate,
      operatingWindow: { derivation: window.derivation, timezone: window.timezone },
      action,
      lane: LANE_BY_ACTION[action],
      outcome: run.outcome,
      disposition: dispositionOf(run),
      policyMode: run.policyMode,
      policyVersion: run.policyVersion,
      idempotencyToken: run.idempotencyKey,
      occurredAt: run.appliedAt ?? run.updatedAt,
      decisionReason: run.decisionReason,
      failure: run.error ? { code: run.error.code, message: run.error.message } : undefined,
      policyEvidence: policyEvidenceOf(run),
    })),
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources,
    warnings,
    sourceRefs: page.items.flatMap(({ action, run }) => [
      {
        ref: mintAgentSourceRef("automation_run", storeId, String(run._id)),
        kind: "automation_run",
        label: action,
        version: run.idempotencyKey,
        capturedAt: input.now,
      },
      {
        ref: mintAgentSourceRef("automation_policy", storeId, `${AUTOMATION_DOMAIN}:${action}`),
        kind: "automation_policy",
        label: action,
        version: run.policyVersion,
        capturedAt: input.now,
      },
    ]),
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

export const listAutomationEvidence = defineAgentReadPortQuery({ portKey: AUTOMATION_PORT_KEY, handler: listAutomationEvidenceHandler });
