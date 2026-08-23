/**
 * Agent turn-trace export: what the model and the harness exchanged on one
 * driven turn, as JSONL, for refining the agent offline.
 *
 *   bun scripts/agent-trace-export.ts --binding <agentTurnBinding id>
 *   bun scripts/agent-trace-export.ts --run <intelligenceRun id> --out trace.jsonl
 *
 * Invoke it directly, as above. The `bun run agent-trace:export` alias works
 * too; both forms take single-token flag values.
 *
 * One JSON object per line, in sequence order: the runtime events with their
 * envelopes, the narrative deltas, each tool call's exact arguments and the
 * outcome the model read back, each provisional-flush outcome, and the turn's
 * own report. It reads the internal investigation query, so it needs the same
 * deployment credentials `bunx convex run` needs and it is not available to
 * anything on the public ingress rail.
 *
 * The trace holds the model's narrative and the arguments of every capability
 * call for one store. Treat an exported file as store content: it belongs
 * wherever that store's data belongs, and nowhere else.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runConvex, WEBAPP_DIR } from "./agent-harness-fence";

export const TRACE_FUNCTION = "agentHarness/evals/directHarness:listTurnTrace";
/** Rows per `convex run`; the query bounds it at 1000 either way. */
export const TRACE_PAGE_SIZE = 500;
/** Refuses to loop forever against a deployment that never reports `isDone`. */
export const TRACE_MAX_PAGES = 200;

export type TraceExportOptions = {
  readonly subject: { readonly kind: "binding"; readonly id: string } | { readonly kind: "run"; readonly id: string };
  readonly out?: string;
  readonly limit: number;
};

export function parseTraceExportArgs(argv: readonly string[]): TraceExportOptions | { error: string } {
  let bindingId: string | undefined;
  let runId: string | undefined;
  let out: string | undefined;
  let limit = TRACE_PAGE_SIZE;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--binding") bindingId = argv[++index];
    else if (arg === "--run") runId = argv[++index];
    else if (arg === "--out") out = argv[++index];
    else if (arg === "--limit") limit = Number(argv[++index]);
    else return { error: `Unknown argument: ${arg}` };
  }
  if ((bindingId === undefined) === (runId === undefined)) {
    return { error: "Pass exactly one of --binding <agentTurnBinding id> or --run <intelligenceRun id>." };
  }
  if (!Number.isFinite(limit) || limit < 1) return { error: "--limit must be a positive number." };
  return {
    subject: bindingId ? { kind: "binding", id: bindingId } : { kind: "run", id: runId! },
    out,
    limit: Math.min(1_000, Math.trunc(limit)),
  };
}

export function buildTraceCommand(options: TraceExportOptions, cursor: string | null): readonly string[] {
  const args = {
    ...(options.subject.kind === "binding" ? { bindingId: options.subject.id } : { runId: options.subject.id }),
    limit: options.limit,
    ...(cursor === null ? {} : { cursor }),
  };
  return ["bunx", "convex", "run", TRACE_FUNCTION, JSON.stringify(args)];
}

export type TracePage = {
  readonly kind: string;
  readonly bindingId?: string;
  readonly isDone?: boolean;
  readonly cursor?: string | null;
  readonly events?: readonly unknown[];
  readonly message?: string;
  readonly missing?: string;
};

/**
 * `convex run` prints its own progress lines before the JSON value, so the
 * value is taken from the first `{` onward rather than from the whole stream.
 */
export function parseTracePage(stdout: string): TracePage | null {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start)) as TracePage;
  } catch {
    return null;
  }
}

export async function main(argv: readonly string[], rootDir: string): Promise<number> {
  const options = parseTraceExportArgs(argv);
  if ("error" in options) {
    console.error(options.error);
    return 2;
  }
  const cwd = path.join(rootDir, WEBAPP_DIR);
  const lines: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < TRACE_MAX_PAGES; page += 1) {
    const result = await runConvex(buildTraceCommand(options, cursor), cwd);
    if (result.exitCode !== 0) {
      console.error(result.stderr || result.stdout);
      return 1;
    }
    const parsed = parseTracePage(result.stdout);
    if (!parsed) {
      console.error("The deployment returned no readable trace page.");
      return 1;
    }
    if (parsed.kind !== "trace") {
      console.error(parsed.message ?? `No trace: ${parsed.kind}${parsed.missing ? ` (${parsed.missing})` : ""}.`);
      return 1;
    }
    for (const event of parsed.events ?? []) lines.push(JSON.stringify(event));
    if (parsed.isDone || typeof parsed.cursor !== "string") break;
    cursor = parsed.cursor;
  }

  const payload = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  if (options.out) {
    await writeFile(path.resolve(rootDir, options.out), payload, "utf8");
    console.error(`Wrote ${lines.length} event(s) to ${options.out}.`);
  } else {
    process.stdout.write(payload);
  }
  return 0;
}

if (import.meta.main) {
  const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  main(process.argv.slice(2), rootDir).then((code) => process.exit(code));
}
