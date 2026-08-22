/**
 * Agent harness pre-deploy fence (plan decision 4).
 *
 * ONE command, run BEFORE deploying incompatible harness code, against the
 * deployment about to be replaced:
 *
 *   bun scripts/agent-harness-fence.ts --reason "deploy v2" [--profile daily_operations ...] [--dry-run]
 *
 * Invoke it directly, as above. The `bun run agent-harness:fence` alias works
 * only for single-token flag values: `bun run <script> -- --reason "a b c"`
 * re-splits the quoted value into three arguments.
 *
 * It reads the compatibility digest of the LOCAL generated registry (the code
 * about to deploy) and runs `agentHarness/deploymentState:fenceForDeploy` on
 * the deployment, which in one transaction disables the named profiles
 * (default: every registered profile) and advances the durable epoch when the
 * digest changed. Every dispatch/release/completion checkpoint then denies
 * old-epoch work and the repair sweep terminalizes idle old-epoch runs.
 *
 * The command exits non-zero when the fence cannot be applied, so a deploy
 * script that chains it aborts. Nothing here re-enables a profile: after the
 * deploy and smoke, `bun scripts/agent-harness-switch.ts --profile <id> --enable`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_GENERATED_COMPATIBILITY_DIGEST, AGENT_GENERATED_REGISTRY } from "../packages/athena-webapp/convex/agentHarness/_generated/registry";

export const FENCE_FUNCTION = "agentHarness/deploymentState:fenceForDeploy";
export const WEBAPP_DIR = path.join("packages", "athena-webapp");

export type FenceOptions = {
  readonly reason: string;
  readonly profileIds: readonly string[];
  readonly dryRun: boolean;
  readonly actorRef?: string;
};

export function parseFenceArgs(argv: readonly string[]): FenceOptions | { error: string } {
  let reason: string | undefined;
  const profileIds: string[] = [];
  let dryRun = false;
  let actorRef: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reason") reason = argv[++index];
    else if (arg === "--profile") profileIds.push(argv[++index] ?? "");
    else if (arg === "--actor") actorRef = argv[++index];
    else if (arg === "--dry-run") dryRun = true;
    else return { error: `Unknown argument: ${arg}` };
  }
  if (!reason || reason.trim().length === 0) return { error: "--reason is required (what is being deployed)." };
  if (profileIds.some((profileId) => profileId.length === 0)) return { error: "--profile needs a profile id." };
  return { reason, profileIds, dryRun, actorRef };
}

export function buildFenceInvocation(options: FenceOptions, digest: string = AGENT_GENERATED_COMPATIBILITY_DIGEST, registeredProfiles: readonly string[] = Object.keys(AGENT_GENERATED_REGISTRY.profiles)) {
  const unknown = options.profileIds.filter((profileId) => !registeredProfiles.includes(profileId));
  if (unknown.length > 0) return { error: `Unknown profile(s) in the local registry: ${unknown.join(", ")}` };
  const profileIds = options.profileIds.length > 0 ? [...options.profileIds] : [...registeredProfiles];
  return {
    command: ["bunx", "convex", "run", FENCE_FUNCTION, JSON.stringify({ nextDigest: digest, profileIds, reason: options.reason, ...(options.actorRef ? { actorRef: options.actorRef } : {}) })],
    args: { nextDigest: digest, profileIds, reason: options.reason },
  };
}

export function evaluateFenceResult(result: unknown): { ok: boolean; summary: string } {
  const parsed = result as { epoch?: { outcome?: string; epoch?: number; digest?: string; reason?: string }; disabledProfiles?: string[]; canceledRuns?: number } | null;
  if (!parsed || !parsed.epoch) return { ok: false, summary: "Fence returned no epoch result." };
  if (parsed.epoch.outcome === "rejected") return { ok: false, summary: `Fence rejected: ${parsed.epoch.reason ?? "unknown"}.` };
  return {
    ok: true,
    summary: `epoch ${parsed.epoch.outcome} (epoch ${parsed.epoch.epoch}, digest ${parsed.epoch.digest}); disabled ${parsed.disabledProfiles?.length ?? 0} profile(s) [${(parsed.disabledProfiles ?? []).join(", ")}]; canceled ${parsed.canceledRuns ?? 0} active run(s).`,
  };
}

export async function runConvex(command: readonly string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

function parseConvexRunOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
}

export async function main(argv: readonly string[], rootDir: string): Promise<number> {
  const options = parseFenceArgs(argv);
  if ("error" in options) {
    console.error(options.error);
    return 2;
  }
  const invocation = buildFenceInvocation(options);
  if ("error" in invocation) {
    console.error(invocation.error);
    return 2;
  }
  console.log(`Fence: ${FENCE_FUNCTION} ${JSON.stringify(invocation.args)}`);
  if (options.dryRun) return 0;
  const result = await runConvex(invocation.command, path.join(rootDir, WEBAPP_DIR));
  if (result.exitCode !== 0) {
    console.error(result.stderr || result.stdout);
    console.error("Fence failed: abort the deploy.");
    return 1;
  }
  const evaluated = evaluateFenceResult(parseConvexRunOutput(result.stdout));
  console.log(evaluated.summary);
  if (!evaluated.ok) console.error("Fence not applied: abort the deploy.");
  return evaluated.ok ? 0 : 1;
}

if (import.meta.main) {
  const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  main(process.argv.slice(2), rootDir).then((code) => process.exit(code));
}
