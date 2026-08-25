/**
 * Agent eval drive: run the Daily Operations evaluation scenarios as REAL
 * operator turns — real model, real admission, real ports — against a
 * deployment, and judge each answer with machine-checkable assertions.
 *
 *   bun scripts/agent-eval-drive.ts --org wigclub --store wigclub --operator you@example.com
 *   bun scripts/agent-eval-drive.ts ... --scenario deep_week_variance --scenario ambiguous_referent
 *   bun scripts/agent-eval-drive.ts ... --date 2026-08-24 --out eval-report.json
 *
 * This is the surviving form of the live regression phases (see
 * docs/reports/2026-08-24-agent-harness-gap-closures-report.html): the
 * methodology those phases had to learn the hard way is built in —
 * the deployment digest is asserted at preflight and after every turn (a
 * concurrent deploy aborts the drive instead of contaminating it), every turn
 * uses a fresh idempotency key (startOperatorTurn dedupes on the key, so a
 * reused tag silently replays an old binding), and the operating date is
 * pinned per drive. It needs the same deployment credentials `bunx convex
 * run` needs; it is not reachable from any public ingress.
 *
 * Checks are structural and behavioral, never value-exact: they must hold on
 * any store with whatever data it has. `hard` failures fail the drive;
 * `soft` findings are reported for trend-watching (the scorecard's job).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_GENERATED_COMPATIBILITY_DIGEST } from "../packages/athena-webapp/convex/agentHarness/_generated/registry";
import { runConvex, WEBAPP_DIR } from "./agent-harness-fence";

export const DRIVER_FUNCTIONS = {
  deploymentState: "agentHarness/deploymentState:describeDeploymentState",
  startTurn: "agentHarness/evals/directHarness:startOperatorTurn",
  readTurn: "agentHarness/evals/directHarness:readOperatorTurn",
  diagnostics: "agentHarness/evals/directHarness:describeRunDiagnostics",
  trace: "agentHarness/evals/directHarness:listTurnTrace",
  inspectCitation: "agentHarness/evals/directHarness:inspectOperatorCitation",
} as const;

export const PROFILE_ID = "daily_operations";
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TURN_TIMEOUT_MS = 150_000;

/** Matches shared/agentHarness/productLexicon.ts OPAQUE_HEX_RUN_PATTERN. */
const OPAQUE_HEX_RUN = /(?=[0-9a-f]*[a-f])[0-9a-f]{16,}/;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

// ---------------------------------------------------------------------------
// What a finished scenario turn looks like to a check
// ---------------------------------------------------------------------------

export type EvalAnswer = {
  readonly outcome?: string;
  readonly narrative?: string;
  readonly confidence?: number;
  readonly limitedEvidence?: boolean;
  readonly citations?: readonly { readonly citationRef: string; readonly namespace?: string }[];
};

export type EvalCallRow = { readonly capability: string; readonly status: string };
export type EvalAttemptRow = { readonly sequence: number; readonly status: string };

export type EvalTurnContext = {
  readonly answer: EvalAnswer | null;
  readonly calls: readonly EvalCallRow[];
  readonly attempts: readonly EvalAttemptRow[];
  readonly toneDenials: number;
  readonly completeRunCalls: number;
  readonly completionMs?: number;
  readonly firstDeltaMs?: number;
  /** Set by the driver when the follow-up citation inspection ran. */
  readonly citationResolved?: boolean;
  /** The host's pre-execution record for a starter-intent turn, from the trace. */
  readonly preexec?: { readonly outcome: string; readonly attemptRef?: string; readonly citations?: readonly string[] };
};

export type EvalIssue = { readonly severity: "hard" | "soft"; readonly message: string };

export type EvalScenario = {
  readonly id: string;
  readonly prompt: string;
  /** Profile scenarios keep their profile id; extras are the deep suite. */
  /** The driver resolves the first citation of the answer when set. */
  readonly inspectFirstCitation?: boolean;
  /** Sent with startTurn: the turn opts into this intent's curated pre-read. */
  readonly starterIntentId?: string;
  readonly check: (context: EvalTurnContext) => readonly EvalIssue[];
};

const hard = (message: string): EvalIssue => ({ severity: "hard", message });
const soft = (message: string): EvalIssue => ({ severity: "soft", message });

function commonIssues(context: EvalTurnContext): EvalIssue[] {
  const issues: EvalIssue[] = [];
  if (!context.answer) {
    issues.push(hard("the turn produced no readable answer"));
    return issues;
  }
  const narrative = context.answer.narrative ?? "";
  if (narrative.trim().length === 0) issues.push(hard("the answer narrative is empty"));
  if (OPAQUE_HEX_RUN.test(narrative)) issues.push(hard("an opaque identifier leaked into the narrative"));
  if (context.answer.outcome === "answer" && (context.answer.citations?.length ?? 0) === 0) {
    issues.push(hard("an answer committed without citations"));
  }
  const succeededReads = context.calls.filter((call) => call.status === "succeeded" || call.status === "partial").length;
  if (context.answer.outcome === "no_usable_sources" && succeededReads > 0) {
    issues.push(hard(`no_usable_sources despite ${succeededReads} released read(s) — the capitulation shape`));
  }
  if (context.toneDenials > 1) issues.push(soft(`${context.toneDenials} tone denials in one turn`));
  return issues;
}

export const EVAL_SCENARIOS: readonly EvalScenario[] = [
  {
    id: "cross_package_readiness",
    prompt:
      "Is this store day ready to close? Cover the readiness lanes, open registers, the work queue, today's sales, what automation did, and any stock that needs ordering.",
    check: (context) => {
      const issues = commonIssues(context);
      if (!context.answer) return issues;
      if (context.answer.outcome !== "answer") issues.push(hard(`expected an answer, got ${context.answer.outcome}`));
      const capabilities = new Set(context.calls.map((call) => call.capability));
      if (capabilities.size < 4) issues.push(hard(`a readiness answer read only ${capabilities.size} capabilities`));
      return issues;
    },
  },
  {
    id: "partial_no_data_day",
    prompt: "How did the store trade on 2025-12-25?",
    check: (context) => {
      const issues = commonIssues(context);
      if (!context.answer) return issues;
      const narrative = (context.answer.narrative ?? "").toLowerCase();
      const admitsAbsence = /\bno\b|\bnot\b|closed|unavailable|absent/.test(narrative);
      if (context.answer.outcome === "answer" && !admitsAbsence) {
        issues.push(hard("an empty day's answer never says anything was absent — fabrication risk"));
      }
      return issues;
    },
  },
  {
    id: "citation_resolution",
    prompt: "Which register had a variance today, and what proves it?",
    inspectFirstCitation: true,
    check: (context) => {
      const issues = commonIssues(context);
      if (!context.answer) return issues;
      if ((context.answer.citations?.length ?? 0) > 0 && context.citationResolved === false) {
        issues.push(hard("the answer's first citation did not resolve to evidence"));
      }
      return issues;
    },
  },
  {
    id: "ambiguous_referent",
    prompt: "How did we do on Wednesday?",
    check: (context) => {
      const issues = commonIssues(context);
      if (!context.answer) return issues;
      if (context.answer.outcome === "answer" && !ISO_DATE.test(context.answer.narrative ?? "")) {
        issues.push(hard("answered an ambiguous date question without naming the operating date it reports"));
      }
      if (context.answer.outcome !== "needs_clarification") {
        issues.push(soft(`took outcome ${context.answer.outcome} instead of needs_clarification`));
      }
      return issues;
    },
  },
  {
    id: "role_restricted_financials",
    prompt: "What did the store take today, and how does that compare with the rest of the week?",
    check: (context) => {
      // Full-role half only: a full admin must reach the reports package. The
      // pos-only half needs a second operator; drive it with --operator set to
      // one and compare by hand until the suite grows a second-role mode.
      const issues = commonIssues(context);
      if (!context.answer) return issues;
      if (!context.calls.some((call) => call.capability.includes("day_sales") || call.capability.includes("week"))) {
        issues.push(hard("a takings question read no reports capability"));
      }
      return issues;
    },
  },
  {
    id: "deep_census",
    prompt:
      "How many register sessions exist for this store across all statuses over the last 30 days? Give the count per status, and tell me exactly how many sessions you actually read versus how many exist.",
    check: (context) => {
      const issues = commonIssues(context);
      if (!context.answer) return issues;
      if (context.answer.outcome !== "answer") issues.push(hard(`expected an answer, got ${context.answer.outcome}`));
      if (context.calls.length < 20) issues.push(hard(`a 30-day census made only ${context.calls.length} reads`));
      const rejected = context.attempts.filter((attempt) => attempt.status === "rejected").length;
      if (rejected > 0) issues.push(soft(`${rejected} program attempt(s) rejected by static validation`));
      return issues;
    },
  },
  {
    id: "deep_week_variance",
    prompt:
      "Which register session had the largest cash variance at closeout this past week, and on which day? Say how many closed sessions you compared.",
    check: (context) => {
      const issues = commonIssues(context);
      if (!context.answer) return issues;
      if (context.answer.outcome !== "answer") issues.push(hard(`expected an answer, got ${context.answer.outcome}`));
      const registerReads = context.calls.filter((call) => call.capability === "cap_dailyops_register_sessions");
      const partial = registerReads.filter((call) => call.status === "partial").length;
      // Soft, not hard: a status-filtered read is HONESTLY partial
      // (single_status_partition_requested), so all-partial is a trend signal
      // here; the date-keyed behavior is pinned deterministically in
      // dailyOperations.ports.test.ts.
      if (registerReads.length > 0 && partial === registerReads.length) {
        issues.push(soft(`all ${registerReads.length} register reads were partial — check the reasons if this trends`));
      }
      return issues;
    },
  },
  ...(["close_readiness", "open_drawers", "stock_pressure", "automation_today"] as const).map(
    (intentId): EvalScenario => ({
      id: `starter_${intentId}`,
      starterIntentId: intentId,
      // The prompt is a placeholder: the server substitutes the pinned
      // intent's canonical prompt when the id is present.
      prompt: "starter intent tap",
      check: (context) => {
        const issues = commonIssues(context);
        if (!context.answer) return issues;
        if (!context.preexec || context.preexec.outcome !== "seeded") {
          issues.push(hard(`the curated pre-read did not seed (${context.preexec?.outcome ?? "no trace"})`));
          return issues;
        }
        if (context.answer.outcome !== "answer") issues.push(hard(`expected an answer, got ${context.answer.outcome}`));
        const preexecCitations = new Set(context.preexec.citations ?? []);
        const cited = (context.answer.citations ?? []).map((citation) => citation.citationRef);
        if (!cited.some((ref) => preexecCitations.has(ref))) {
          issues.push(hard("the committed answer cites nothing from the pre-executed read"));
        }
        if (context.attempts.length > 1) {
          issues.push(soft(`the model re-read after the pre-executed exchange (${context.attempts.length} attempts)`));
        }
        return issues;
      },
    }),
  ),
];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export type DriveOptions = {
  readonly organizationSlug: string;
  readonly storeSlug: string;
  readonly operatorEmail: string;
  readonly operatingDate: string;
  readonly scenarioIds: readonly string[];
  readonly tag: string;
  readonly out?: string;
  readonly turnTimeoutMs: number;
};

export function parseDriveArgs(argv: readonly string[], now: number): DriveOptions | { readonly error: string } {
  let organizationSlug: string | undefined;
  let storeSlug: string | undefined;
  let operatorEmail: string | undefined;
  let operatingDate: string | undefined;
  let tag: string | undefined;
  let out: string | undefined;
  let turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS;
  const scenarioIds: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--org") organizationSlug = argv[++index];
    else if (arg === "--store") storeSlug = argv[++index];
    else if (arg === "--operator") operatorEmail = argv[++index];
    else if (arg === "--date") operatingDate = argv[++index];
    else if (arg === "--scenario") scenarioIds.push(argv[++index]);
    else if (arg === "--tag") tag = argv[++index];
    else if (arg === "--out") out = argv[++index];
    else if (arg === "--timeout-s") turnTimeoutMs = Number(argv[++index]) * 1000;
    else return { error: `Unknown argument: ${arg}` };
  }
  if (!organizationSlug || !storeSlug || !operatorEmail) {
    return { error: "Pass --org <slug> --store <slug> --operator <email> (and optionally --date, --scenario, --tag, --out, --timeout-s)." };
  }
  if (!Number.isFinite(turnTimeoutMs) || turnTimeoutMs < 10_000) return { error: "--timeout-s must be at least 10." };
  const known = new Set(EVAL_SCENARIOS.map((scenario) => scenario.id));
  for (const id of scenarioIds) {
    if (!known.has(id)) return { error: `Unknown scenario "${id}". Known: ${[...known].join(", ")}.` };
  }
  return {
    organizationSlug,
    storeSlug,
    operatorEmail,
    operatingDate: operatingDate ?? new Date(now).toISOString().slice(0, 10),
    scenarioIds: scenarioIds.length > 0 ? scenarioIds : EVAL_SCENARIOS.map((scenario) => scenario.id),
    tag: tag ?? `eval-${now.toString(36)}`,
    out,
    turnTimeoutMs,
  };
}

// ---------------------------------------------------------------------------
// Trace and diagnostics digestion (pure, tested)
// ---------------------------------------------------------------------------

export function summarizeTrace(events: readonly Record<string, unknown>[]): {
  toneDenials: number;
  completeRunCalls: number;
  completionMs?: number;
  firstDeltaMs?: number;
  preexec?: { outcome: string; attemptRef?: string; citations?: readonly string[] };
} {
  let toneDenials = 0;
  let completeRunCalls = 0;
  let completionMs: number | undefined;
  let firstDeltaMs: number | undefined;
  let preexec: { outcome: string; attemptRef?: string; citations?: readonly string[] } | undefined;
  for (const event of events) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.kind === "tool_call_completed" && payload.toolId === "athena.completeRun") {
      completeRunCalls += 1;
      const outcome = payload.outcome as Record<string, unknown> | undefined;
      const denial = outcome?.denial as Record<string, unknown> | undefined;
      if (denial?.code === "tone") toneDenials += 1;
    }
    if (event.kind === "turn_report") {
      if (typeof payload.completionMs === "number") completionMs = payload.completionMs;
      if (typeof payload.firstDeltaMs === "number") firstDeltaMs = payload.firstDeltaMs;
    }
    if (event.kind === "starter_intent_preexec" || event.kind === "starter_intent_preexec_skipped") {
      preexec = {
        outcome: String(payload.outcome ?? "unknown"),
        ...(typeof payload.attemptRef === "string" ? { attemptRef: payload.attemptRef } : {}),
        ...(Array.isArray(payload.citations) ? { citations: payload.citations.map(String) } : {}),
      };
    }
  }
  return { toneDenials, completeRunCalls, completionMs, firstDeltaMs, ...(preexec ? { preexec } : {}) };
}

export function evaluateScenario(scenario: EvalScenario, context: EvalTurnContext) {
  const issues = scenario.check(context);
  return {
    id: scenario.id,
    pass: issues.every((issue) => issue.severity !== "hard"),
    issues,
  };
}

// ---------------------------------------------------------------------------
// Driver (deployment I/O)
// ---------------------------------------------------------------------------

function parseJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const CALL_RETRIES = 2;
const CALL_RETRY_DELAY_MS = 4_000;

async function callFunction(cwd: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  let lastError = "";
  for (let attempt = 0; attempt <= CALL_RETRIES; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, CALL_RETRY_DELAY_MS));
    const result = await runConvex(["bunx", "convex", "run", name, JSON.stringify(args)], cwd);
    if (result.exitCode === 0) {
      const parsed = parseJson(result.stdout);
      if (parsed) return parsed;
      lastError = `${name} returned no readable JSON.`;
      continue;
    }
    lastError = `${name} failed: ${result.stderr || result.stdout}`;
    // Transient deployment hiccups (post-deploy warmup) surface as
    // InternalServerError; anything argument-shaped will fail identically on
    // retry and the final throw carries it.
  }
  throw new Error(lastError);
}

async function assertDigest(cwd: string, moment: string): Promise<void> {
  const state = await callFunction(cwd, DRIVER_FUNCTIONS.deploymentState, {});
  if (state.deployedDigest !== AGENT_GENERATED_COMPATIBILITY_DIGEST) {
    throw new Error(
      `Deployment digest mismatch ${moment}: deployment has ${String(state.deployedDigest)}, local registry is ${AGENT_GENERATED_COMPATIBILITY_DIGEST}. ` +
        "Deploy the local code (or pull the deployed code) before driving evals — a mid-drive deploy contaminates results.",
    );
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function main(argv: readonly string[], rootDir: string): Promise<number> {
  const options = parseDriveArgs(argv, Date.now());
  if ("error" in options) {
    console.error(options.error);
    return 2;
  }
  const cwd = path.join(rootDir, WEBAPP_DIR);
  const base = {
    organizationSlug: options.organizationSlug,
    storeSlug: options.storeSlug,
    operatorEmail: options.operatorEmail,
  };
  await assertDigest(cwd, "at preflight");

  const results: Record<string, unknown>[] = [];
  let hardFailures = 0;
  for (const scenario of EVAL_SCENARIOS.filter((candidate) => options.scenarioIds.includes(candidate.id))) {
    const nonce = `${options.tag}-${scenario.id}-${Date.now().toString(36)}`;
    const started = await callFunction(cwd, DRIVER_FUNCTIONS.startTurn, {
      ...base,
      profileId: PROFILE_ID,
      threadKey: `${PROFILE_ID}:eval:${nonce}`.slice(0, 128),
      turnIdempotencyKey: `turn-${nonce}`.slice(0, 128),
      prompt: scenario.prompt,
      context: { operatingDate: options.operatingDate, storeName: options.storeSlug },
      ...(scenario.starterIntentId ? { starterIntentId: scenario.starterIntentId } : {}),
    });
    if (started.outcome !== "started" && started.outcome !== "resumed") {
      console.error(`[${scenario.id}] turn refused: ${JSON.stringify(started)}`);
      hardFailures += 1;
      results.push({ id: scenario.id, pass: false, issues: [{ severity: "hard", message: `turn refused: ${String(started.outcome ?? started.kind)}` }] });
      continue;
    }
    const bindingId = started.bindingId as string;
    const runId = started.runId as string;

    let answer: EvalAnswer | null = null;
    const deadline = Date.now() + options.turnTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const view = await callFunction(cwd, DRIVER_FUNCTIONS.readTurn, { ...base, bindingId, include: "answer" });
      const answerView = view.answer as Record<string, unknown> | undefined;
      if (answerView && answerView.kind === "answer") {
        answer = answerView as EvalAnswer;
        break;
      }
      const inner = (view.view ?? view) as Record<string, unknown>;
      if (typeof inner.state === "string" && /failed|canceled|denied/.test(inner.state)) break;
    }

    const diagnostics = await callFunction(cwd, DRIVER_FUNCTIONS.diagnostics, { runId });
    const trace = await callFunction(cwd, DRIVER_FUNCTIONS.trace, { runId, limit: 1000 });
    const traceSummary = summarizeTrace((trace.events as Record<string, unknown>[]) ?? []);

    let citationResolved: boolean | undefined;
    if (scenario.inspectFirstCitation && answer?.citations && answer.citations.length > 0) {
      const inspected = await callFunction(cwd, DRIVER_FUNCTIONS.inspectCitation, {
        ...base,
        bindingId,
        citationRef: answer.citations[0].citationRef,
      });
      citationResolved = inspected.kind !== "not_found" && inspected.kind !== "unavailable";
    }

    const context: EvalTurnContext = {
      answer,
      calls: ((diagnostics.calls as EvalCallRow[]) ?? []).map((call) => ({ capability: call.capability, status: call.status })),
      attempts: ((diagnostics.attempts as EvalAttemptRow[]) ?? []).map((attempt) => ({ sequence: attempt.sequence, status: attempt.status })),
      ...traceSummary,
      ...(citationResolved === undefined ? {} : { citationResolved }),
    };
    const verdict = evaluateScenario(scenario, context);
    if (!verdict.pass) hardFailures += 1;
    const flag = verdict.pass ? "PASS" : "FAIL";
    console.log(
      `[${flag}] ${scenario.id} — outcome=${answer?.outcome ?? "none"} calls=${context.calls.length} tone=${context.toneDenials} completion=${context.completionMs ?? "?"}ms`,
    );
    for (const issue of verdict.issues) console.log(`       ${issue.severity}: ${issue.message}`);
    results.push({ ...verdict, runId, bindingId, outcome: answer?.outcome, calls: context.calls.length, completeRunCalls: context.completeRunCalls, completionMs: context.completionMs, firstDeltaMs: context.firstDeltaMs, toneDenials: context.toneDenials });

    await assertDigest(cwd, `after ${scenario.id}`);
  }

  const report = {
    tag: options.tag,
    operatingDate: options.operatingDate,
    digest: AGENT_GENERATED_COMPATIBILITY_DIGEST,
    scenarios: results,
    hardFailures,
  };
  if (options.out) {
    await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Report written to ${options.out}`);
  }
  console.log(`${results.length - hardFailures}/${results.length} scenarios passed.`);
  return hardFailures > 0 ? 1 : 0;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  main(process.argv.slice(2), rootDir).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
