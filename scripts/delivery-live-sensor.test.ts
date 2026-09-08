import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { invokeProviderRail, openProviderRailProcess } from "../.agent-skills/current/runtime/kernel.mjs";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const adapter = path.join(import.meta.dirname, "delivery-live-sensor.ts");

it("uses the product protocol and rechecks current sensor output on every invocation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "athena-live-sensor-"));
  roots.push(root);
  await mkdir(path.join(root, "scripts"));
  const sensor = path.join(root, "scripts/delivery-documentation-admission.ts");
  const invoke = () => invokeProviderRail({ providerId: "athena.documentation", requestId: "live-test", idempotencyKey: "live-test", payload: {}, requiresEvidence: false }, {
    open: () => openProviderRailProcess({ command: ["bun", adapter, "documentation"], cwd: root, env: process.env }),
    deadlineMs: 5000,
  });
  await writeFile(sensor, 'console.log(JSON.stringify({ proof: "current-report-bytes" }));\n');
  const passing = await invoke();
  expect(passing.kind).toBe("success");
  if (passing.kind !== "success") throw new Error("Expected a successful live result");
  expect(passing.events).toContainEqual(expect.objectContaining({ kind: "terminal", outcome: "success", result: expect.objectContaining({ stdout: expect.stringContaining("current-report-bytes") }) }));
  await writeFile(sensor, 'console.error("issuer approval revoked"); process.exit(1);\n');
  const revoked = await invoke();
  expect(revoked.kind).toBe("blocked");
  expect(revoked.status).toBe("failed");
});

it("cannot select an arbitrary command through the sensor argument", async () => {
  const child = Bun.spawn(["bun", adapter, "arbitrary-command"], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code).not.toBe(0);
  expect(stderr).toContain("Expected documentation or telemetry sensor");
});
