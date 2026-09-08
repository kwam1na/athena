import { runHarnessCliBoundary, HarnessBlockedError, HarnessUsageError, createHarnessBlocker } from "./harness-blockers";
/** Sequence installed product commands; Athena owns only its durable export location. */
import { deliveryRecordPathFor } from "../.agent-skills/current/runtime/kernel.mjs";
import { importHarnessConfig, runDeliveryProduct, wireRepo } from "./delivery-product";
import { readCurrentDeliveryRunExport, recordDeliveryRunTelemetry } from "./delivery-run-telemetry";

export async function runPrAthenaDeliveryRun(rootDir: string): Promise<number> {
  const run = await readCurrentDeliveryRunExport(rootDir);
  const saved = run?.events.findLast(event => event.kind === "context.saved");
  if (!saved) {
    throw new HarnessBlockedError([createHarnessBlocker({ code: "delivery_context_missing", source: { kind: "command", id: "pr:athena:delivery-run" }, summary: "The product run has no saved accepted delivery contract.", remediations: [{ id: "save-accepted-contract", kind: "manual_action", summary: "Save the accepted delivery contract with the installed save-context command, then rerun pr:athena." }] })]);
  }
  let exitCode = await runDeliveryProduct(["save-context", "--json", JSON.stringify({ contract: saved.payload.contract, stage: "athena-gate" })], rootDir);
  if (exitCode !== 0) return exitCode;
  exitCode = await runDeliveryProduct(["gate"], rootDir);
  if (exitCode !== 0) return exitCode;

  const exported = await recordDeliveryRunTelemetry(rootDir);
  const stage = async (file: string) => {
    const child = Bun.spawn(["git", "add", "--", file], { cwd: rootDir, stdout: "inherit", stderr: "inherit" });
    return child.exited;
  };
  exitCode = await stage(exported.path);
  if (exitCode !== 0) return exitCode;
  exitCode = await runDeliveryProduct(["prepare", "--refresh-record-neutral"], rootDir);
  if (exitCode !== 0) return exitCode;

  const config = await importHarnessConfig(rootDir);
  const wiring = await wireRepo(rootDir, config);
  const capture = await wiring.captureCandidate();
  if (!capture.ok) {
    // Let the installed command render its own typed candidate failure.
    return runDeliveryProduct(["record"], rootDir);
  }
  const recordPath = deliveryRecordPathFor(config, capture.candidate.deliverable.digest);
  exitCode = await runDeliveryProduct(["record"], rootDir);
  if (exitCode !== 0) return exitCode;
  exitCode = await stage(recordPath);
  if (exitCode !== 0) return exitCode;
  exitCode = await runDeliveryProduct(["prepare", "--refresh-record-neutral"], rootDir);
  if (exitCode !== 0) return exitCode;
  return runDeliveryProduct(["verify"], rootDir);
}

async function runDeliveryCli() {
  if (Bun.argv.length > 2) throw new HarnessUsageError({ source: { kind: "command", id: "pr:athena:delivery-run" }, message: "pr:athena:delivery-run accepts no arguments; use the installed delivery commands for individual phases.", validFlags: [] });
  return runPrAthenaDeliveryRun(process.cwd());
}
if (import.meta.main) {
  process.exitCode = await runHarnessCliBoundary({ source: { kind: "command", id: "pr:athena:delivery-run" }, reproduce: ["bun", "run", "pr:athena"], run: runDeliveryCli });
}
