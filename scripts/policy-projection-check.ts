/** The installed product owns policy compilation and current-generation readiness. */
import path from "node:path";
import { createHarnessBlocker, HarnessBlockedError, runHarnessCliBoundary } from "./harness-blockers";

export async function checkPolicyProjection(rootDir = process.cwd()) {
  const child = Bun.spawn(["python3", "-B", path.join(rootDir, ".agent-skills/current"), "--root", rootDir, "--product", "status"], { cwd: rootDir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  let status;
  try { status = JSON.parse(stdout); } catch { /* A failed lifecycle process may not emit JSON. */ }
  if (code !== 0 || status?.productReady !== true || status?.lifecycle !== "current" || !Array.isArray(status?.blockers) || status.blockers.length !== 0) {
    throw new HarnessBlockedError([createHarnessBlocker({ code: "delivery_product_not_current", source: { kind: "command", id: "policy:check" }, summary: "The installed delivery product or compiled Athena policy is not current.", details: stderr || stdout, remediations: [{ id: "reconcile-installed-product", kind: "manual_action", summary: "Use the installed product lifecycle to reconcile the selected release and policy, then retry." }] })]);
  }
  return status;
}

if (import.meta.main) process.exitCode = await runHarnessCliBoundary({
  source: { kind: "command", id: "policy:check" },
  reproduce: ["bun", "run", "policy:check"],
  run: async () => {
    const status = await checkPolicyProjection();
    console.log(`Delivery product current: ${status.active.releaseId}`);
  },
});
