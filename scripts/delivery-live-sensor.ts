/** Athena's live sensors speak the installed provider protocol; they grant no authority. */
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import {
  DELIVERY_PROVIDER_RAILS_VERSION,
  type ProviderRailNegotiation,
  type ProviderRailTerminal,
} from "../.agent-skills/current/runtime/kernel.mjs";

const sensors = {
  documentation: ["scripts/delivery-documentation-admission.ts", "--json"],
  telemetry: [
    "scripts/delivery-run-telemetry.ts",
    "check",
    "--base",
    "origin/main",
  ],
  "validation-health": ["scripts/harness-validation-local-health-check.ts"],
} as const;
const selected = Bun.argv[2] as keyof typeof sensors;
if (!Object.hasOwn(sensors, selected))
  throw new Error(
    "Expected documentation or telemetry sensor, or validation-health.",
  );
const write = (value: ProviderRailNegotiation | ProviderRailTerminal) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);
const input = createInterface({ input: process.stdin });
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once("SIGTERM", interrupt);
process.once("SIGINT", interrupt);
let negotiated = false;
for await (const line of input) {
  const message = JSON.parse(line);
  if (message.kind === "negotiate") {
    negotiated =
      Array.isArray(message.supportedVersions) &&
      message.supportedVersions.includes(DELIVERY_PROVIDER_RAILS_VERSION);
    write({
      kind: "negotiation",
      outcome: negotiated ? "supported" : "unsupported",
      selectedVersion: negotiated ? DELIVERY_PROVIDER_RAILS_VERSION : null,
      supportedVersions: [DELIVERY_PROVIDER_RAILS_VERSION],
    });
    continue;
  }
  if (
    !negotiated ||
    message.kind !== "request" ||
    message.version !== DELIVERY_PROVIDER_RAILS_VERSION ||
    typeof message.requestId !== "string"
  )
    throw new Error("Invalid live sensor request.");
  const terminal = {
    kind: "terminal" as const,
    version: DELIVERY_PROVIDER_RAILS_VERSION,
    requestId: message.requestId,
    sequence: 1,
  };
  try {
    const args: string[] = [...sensors[selected]];
    if (selected === "validation-health") {
      if (!Bun.argv[3] || Bun.argv.length !== 4)
        throw new Error("Expected original local health context.");
      args.push(Bun.argv[3], JSON.stringify(message.payload));
    }
    const result = await promisify(execFile)("bun", args, {
      cwd: process.cwd(),
      env: process.env,
      signal: controller.signal,
      timeout: selected === "validation-health" ? 540000 : 25000,
      maxBuffer: 1024 * 1024,
    });
    // The exact-candidate documentation check retains its full domain proof.
    // This invocation independently rechecks the current issuer and state.
    write({
      ...terminal,
      outcome: "success",
      summary: `${selected} live sensor passed`,
      result: { stdout: result.stdout, stderr: result.stderr },
    });
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    write({
      ...terminal,
      outcome: "failed",
      summary: `${selected} live sensor failed`,
      details: {
        message: failure.message,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
      },
    });
  }
  break;
}
input.close();
process.removeListener("SIGTERM", interrupt);
process.removeListener("SIGINT", interrupt);
