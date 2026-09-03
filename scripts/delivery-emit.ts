/**
 * Athena's run-event command: appends one delivery run event through the pinned
 * `@agent-delivery-harness/cli`.
 *
 * The payload arrives in `DELIVERY_EVENT` rather than on the command line
 * because `bun run <script> -- <args>` concatenates trailing arguments into a
 * `bash -c` string: a JSON object written there is brace-expanded into several
 * words before the CLI ever parses it. The CLI also accepts a payload on stdin,
 * but reading stdin under bun fails with `EBADF` inside the run store, so this
 * wrapper hands the payload to `--json` through an argv array, where no shell
 * can touch it.
 */
import path from "node:path";

export const PAYLOAD_ENV_VAR = "DELIVERY_EVENT";

export const HARNESS_CLI_ENTRY =
  "node_modules/@agent-delivery-harness/cli/src/main.ts";

export function buildEmitArgs(
  argv: readonly string[],
  payload: string | undefined
): readonly string[] {
  if (argv.length === 0) {
    throw new Error(
      `Usage: ${PAYLOAD_ENV_VAR}='<json>' bun run delivery:emit -- <kind> [--run <id>] [--force]`
    );
  }

  // The wrapper supplies `--json` itself and the CLI's parser is last-wins, so
  // a caller's own `--json` would be silently replaced rather than honoured.
  if (argv.includes("--json")) {
    throw new Error(
      `The payload travels in ${PAYLOAD_ENV_VAR}, not in --json.`
    );
  }

  const text = payload?.trim();
  if (text) {
    try {
      JSON.parse(text);
    } catch {
      throw new Error(`${PAYLOAD_ENV_VAR} is not valid JSON.`);
    }
  }

  return ["emit", ...argv, "--json", text || "{}"];
}

if (import.meta.main) {
  const repoRoot = path.resolve(import.meta.dirname, "..");

  try {
    const args = buildEmitArgs(Bun.argv.slice(2), Bun.env[PAYLOAD_ENV_VAR]);
    const proc = Bun.spawn(
      ["bun", path.join(repoRoot, HARNESS_CLI_ENTRY), ...args],
      { cwd: repoRoot, stdin: "ignore", stdout: "inherit", stderr: "inherit" }
    );
    process.exit(await proc.exited);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    // The CLI's own exit policy reserves 2 for a usage error and 1 for a
    // refused event; a bad invocation here is the former.
    process.exit(2);
  }
}
