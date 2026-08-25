/**
 * Agent harness scorecard: the "is the agent getting better" command.
 *
 *   bun scripts/agent-scorecard.ts [--turns 100] [--json]
 *
 * Runs the bounded internal aggregation
 * (`agentHarness/scorecardQuery:describeHarnessScorecard`) on the
 * deployment `bunx convex run` is credentialed for, and prints the rates the
 * harness is tuned by: turn outcomes, completion latency, completeRun retry
 * and denial codes, per-capability partial/denial rates, program-attempt
 * rejections, and budget utilization. Run it before and after a refinement;
 * the diff is the evidence.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runConvex, WEBAPP_DIR } from "./agent-harness-fence";

export const SCORECARD_FUNCTION = "agentHarness/scorecardQuery:describeHarnessScorecard";

export type ScorecardOptions = { readonly turns: number; readonly json: boolean };

export function parseScorecardArgs(argv: readonly string[]): ScorecardOptions | { readonly error: string } {
  let turns = 100;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--turns") {
      turns = Number(argv[++index]);
      if (!Number.isFinite(turns) || turns < 1) return { error: "--turns must be a positive number." };
    } else if (arg === "--json") json = true;
    else return { error: `Unknown argument: ${arg}` };
  }
  return { turns, json };
}

type ScorecardShape = {
  readonly window: { readonly from?: string; readonly to?: string; readonly turns: number };
  readonly outcomes: Readonly<Record<string, number>>;
  readonly latencyMs: {
    readonly completion: { readonly p50?: number; readonly p90?: number; readonly max?: number };
    readonly firstDelta: { readonly p50?: number; readonly p90?: number; readonly max?: number };
  };
  readonly completeRun: { readonly turnsWithRetry: number; readonly denialsByCode: Readonly<Record<string, number>> };
  readonly capabilities: Readonly<
    Record<string, { readonly reads: number; readonly succeeded: number; readonly partial: number; readonly denied: number }>
  >;
  readonly callDenialsByCode: Readonly<Record<string, number>>;
  readonly attempts: Readonly<Record<string, number>>;
  readonly budget: Readonly<Record<string, { readonly p50: number; readonly p90: number; readonly max: number; readonly limit?: number }>>;
  readonly profiles: Readonly<Record<string, { readonly turns: number; readonly outcomes: Readonly<Record<string, number>>; readonly turnsWithRetry: number }>>;
};

const seconds = (ms?: number) => (ms === undefined ? "?" : `${(ms / 1000).toFixed(1)}s`);
const counts = (record: Readonly<Record<string, number>>) =>
  Object.entries(record)
    .sort(([, left], [, right]) => right - left)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

export function formatScorecard(scorecard: ScorecardShape): string {
  if (scorecard.window.turns === 0) {
    return "Harness scorecard: no turns in the readable window — drive some evals first (bun scripts/agent-eval-drive.ts).";
  }
  const lines: string[] = [];
  lines.push(`Harness scorecard — ${scorecard.window.turns} turns (${scorecard.window.from ?? "?"} → ${scorecard.window.to ?? "?"})`);
  lines.push(`  outcomes    ${counts(scorecard.outcomes)}`);
  for (const [profileKey, row] of Object.entries(scorecard.profiles).sort(([, left], [, right]) => right.turns - left.turns)) {
    lines.push(`    ${profileKey}  ${row.turns} turns — ${counts(row.outcomes)}${row.turnsWithRetry ? `, ${row.turnsWithRetry} with retries` : ""}`);
  }
  lines.push(
    `  completion  p50 ${seconds(scorecard.latencyMs.completion.p50)}, p90 ${seconds(scorecard.latencyMs.completion.p90)}, max ${seconds(scorecard.latencyMs.completion.max)}` +
      ` | first delta p50 ${seconds(scorecard.latencyMs.firstDelta.p50)}`,
  );
  const denials = counts(scorecard.completeRun.denialsByCode);
  lines.push(`  completeRun retry: ${scorecard.completeRun.turnsWithRetry}/${scorecard.window.turns} turns${denials ? ` (${denials})` : ""}`);
  lines.push("  capabilities");
  for (const [capabilityId, row] of Object.entries(scorecard.capabilities).sort(([, left], [, right]) => right.reads - left.reads)) {
    const partialShare = row.reads === 0 ? 0 : Math.round((row.partial / row.reads) * 100);
    lines.push(
      `    ${capabilityId}  ${row.reads} reads — ${partialShare}% partial, ${row.denied} denied`,
    );
  }
  const callDenials = counts(scorecard.callDenialsByCode);
  if (callDenials) lines.push(`  call denials  ${callDenials}`);
  lines.push(`  attempts    ${counts(scorecard.attempts) || "none"}`);
  for (const [dimension, row] of Object.entries(scorecard.budget)) {
    lines.push(`  budget      ${dimension} p90 ${row.p90}${row.limit !== undefined ? `/${row.limit}` : ""} (max ${row.max})`);
  }
  return lines.join("\n");
}

export async function main(argv: readonly string[], rootDir: string): Promise<number> {
  const options = parseScorecardArgs(argv);
  if ("error" in options) {
    console.error(options.error);
    return 2;
  }
  const cwd = path.join(rootDir, WEBAPP_DIR);
  const result = await runConvex(["bunx", "convex", "run", SCORECARD_FUNCTION, JSON.stringify({ turns: options.turns })], cwd);
  if (result.exitCode !== 0) {
    console.error(result.stderr || result.stdout);
    return 1;
  }
  const trimmed = result.stdout.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) {
    console.error("The deployment returned no readable scorecard.");
    return 1;
  }
  const scorecard = JSON.parse(trimmed.slice(start)) as ScorecardShape;
  console.log(options.json ? JSON.stringify(scorecard, null, 2) : formatScorecard(scorecard));
  return 0;
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
