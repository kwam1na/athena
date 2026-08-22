/**
 * Agent harness profile switch (plan U7 / U10): the one reversible enable.
 *
 *   bun run agent-harness:switch -- --profile daily_operations --enable --reason "smoke passed"
 *   bun run agent-harness:switch -- --profile daily_operations --disable --reason "incident"
 *   bun run agent-harness:switch -- --status
 *
 * Enable never widens beyond the published baseline (an unpublished profile
 * stays unpublished). Disable blocks new turns immediately, denies in-flight
 * dispatch/release/completion through the live overlay, and cancels active
 * runs of the profile in bounded passes. `--status` prints the durable epoch,
 * whether the deployed artifact's digest matches it, and every switch.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runConvex, WEBAPP_DIR } from "./agent-harness-fence";

export const SWITCH_FUNCTION = "agentHarness/deploymentState:setProfileEnablement";
export const STATUS_FUNCTION = "agentHarness/deploymentState:describeDeploymentState";

export type SwitchOptions =
  | { readonly mode: "status" }
  | { readonly mode: "set"; readonly profileId: string; readonly state: "enabled" | "disabled"; readonly reason: string; readonly actorRef?: string };

export function parseSwitchArgs(argv: readonly string[]): SwitchOptions | { error: string } {
  let profileId: string | undefined;
  let state: "enabled" | "disabled" | undefined;
  let reason: string | undefined;
  let actorRef: string | undefined;
  let status = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") profileId = argv[++index];
    else if (arg === "--enable") state = "enabled";
    else if (arg === "--disable") state = "disabled";
    else if (arg === "--reason") reason = argv[++index];
    else if (arg === "--actor") actorRef = argv[++index];
    else if (arg === "--status") status = true;
    else return { error: `Unknown argument: ${arg}` };
  }
  if (status) return { mode: "status" };
  if (!profileId) return { error: "--profile is required." };
  if (!state) return { error: "Pass exactly one of --enable or --disable." };
  if (!reason || reason.trim().length === 0) return { error: "--reason is required." };
  return { mode: "set", profileId, state, reason, actorRef };
}

export function buildSwitchCommand(options: SwitchOptions): readonly string[] {
  if (options.mode === "status") return ["bunx", "convex", "run", STATUS_FUNCTION, "{}"];
  return [
    "bunx",
    "convex",
    "run",
    SWITCH_FUNCTION,
    JSON.stringify({ profileId: options.profileId, state: options.state, reason: options.reason, ...(options.actorRef ? { actorRef: options.actorRef } : {}) }),
  ];
}

export async function main(argv: readonly string[], rootDir: string): Promise<number> {
  const options = parseSwitchArgs(argv);
  if ("error" in options) {
    console.error(options.error);
    return 2;
  }
  const command = buildSwitchCommand(options);
  console.log(command.slice(2).join(" "));
  const result = await runConvex(command, path.join(rootDir, WEBAPP_DIR));
  if (result.exitCode !== 0) {
    console.error(result.stderr || result.stdout);
    return 1;
  }
  console.log(result.stdout.trim());
  if (options.mode === "set" && result.stdout.includes('"unknown_profile"')) {
    console.error("The deployment does not know this profile.");
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  main(process.argv.slice(2), rootDir).then((code) => process.exit(code));
}
