/** Athena command aliases use only the installed, verified product runtime. */
import path from "node:path";
import { runCli, type CliRuntime } from "../.agent-skills/current/runtime/cli-api.mjs";
export { importHarnessConfig, wireRepo } from "../.agent-skills/current/runtime/cli-api.mjs";
export type { CliRuntime } from "../.agent-skills/current/runtime/cli-api.mjs";

export function installDeliveryProductSigquitHandler(
  platform: NodeJS.Platform,
  handler: () => void,
  on: (signal: NodeJS.Signals, listener: () => void) => void,
  remove: (signal: NodeJS.Signals, listener: () => void) => void,
): () => void {
  if (platform === "win32") return () => {};
  on("SIGQUIT", handler);
  return () => remove("SIGQUIT", handler);
}

export async function runDeliveryProduct(
  argv: readonly string[],
  rootDir = process.cwd(),
  overrides: Partial<CliRuntime> = {},
): Promise<number> {
  // Ordinary commands retain the product's native terminal prompt and host runtime.
  // Explicit capture/test overrides use the published embedding API instead.
  if (Object.keys(overrides).length === 0) {
    const child = Bun.spawn(["python3", "-B", path.join(rootDir, ".agent-skills/current"), "--root", rootDir, "harness", ...argv], {
      cwd: rootDir, env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    let interrupted: number | undefined;
    const interrupt = () => { interrupted ??= 130; child.kill("SIGINT"); };
    const terminate = () => { interrupted ??= 143; child.kill("SIGTERM"); };
    const hangup = () => { interrupted ??= 129; child.kill("SIGHUP"); };
    const quit = () => { interrupted ??= 131; child.kill("SIGQUIT"); };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    process.on("SIGHUP", hangup);
    const removeQuit = installDeliveryProductSigquitHandler(
      process.platform,
      quit,
      (signal, listener) => { process.on(signal, listener); },
      (signal, listener) => { process.removeListener(signal, listener); },
    );
    try { const code = await child.exited; return interrupted ?? code; }
    finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
      process.removeListener("SIGHUP", hangup);
      removeQuit();
    }
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    return await runCli(argv, {
      cwd: rootDir,
      env: process.env,
      stdinIsTTY: Boolean(process.stdin.isTTY),
      stdoutIsTTY: Boolean(process.stdout.isTTY),
      stdout: text => process.stdout.write(`${text}\n`),
      stderr: text => process.stderr.write(`${text}\n`),
      readStdin: () => Bun.stdin.text(),
      signal: controller.signal,
      ...overrides,
    });
  } finally { process.removeListener("SIGINT", interrupt); }
}

if (import.meta.main) process.exitCode = await runDeliveryProduct(Bun.argv.slice(2));
