import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  invokeProviderRail,
  openProviderRailProcess,
} from "../.agent-skills/current/runtime/kernel.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const adapter = path.join(import.meta.dirname, "delivery-live-sensor.ts");

it("uses the product protocol and rechecks current sensor output on every invocation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "athena-live-sensor-"));
  roots.push(root);
  await mkdir(path.join(root, "scripts"));
  const sensor = path.join(root, "scripts/delivery-documentation-admission.ts");
  const invoke = () =>
    invokeProviderRail(
      {
        providerId: "athena.documentation",
        requestId: "live-test",
        idempotencyKey: "live-test",
        payload: {},
        requiresEvidence: false,
      },
      {
        open: () =>
          openProviderRailProcess({
            command: ["bun", adapter, "documentation"],
            cwd: root,
            env: process.env,
          }),
        deadlineMs: 5000,
      },
    );
  await writeFile(
    sensor,
    'console.log(JSON.stringify({ proof: "current-report-bytes" }));\n',
  );
  const passing = await invoke();
  expect(passing.kind).toBe("success");
  if (passing.kind !== "success")
    throw new Error("Expected a successful live result");
  expect(passing.events).toContainEqual(
    expect.objectContaining({
      kind: "terminal",
      outcome: "success",
      result: expect.objectContaining({
        stdout: expect.stringContaining("current-report-bytes"),
      }),
    }),
  );
  await writeFile(
    sensor,
    'console.error("issuer approval revoked"); process.exit(1);\n',
  );
  const revoked = await invoke();
  expect(revoked.kind).toBe("blocked");
  expect(revoked.status).toBe("failed");
});

it("cannot select an arbitrary command through the sensor argument", async () => {
  const child = Bun.spawn(["bun", adapter, "arbitrary-command"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  expect(code).not.toBe(0);
  expect(stderr).toContain("Expected documentation or telemetry sensor");
});

it("forwards the original health context and native request without treating them as commands", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "athena-live-health-"));
  roots.push(root);
  await mkdir(path.join(root, "scripts"));
  const context = {
    schemaVersion: "athena-local-health-context/1",
    healthRevision: "original",
  };
  const payload = {
    candidate: { treeSha: "expected-tree" },
    providerId: "athena.local-health",
  };
  const checker = path.join(
    root,
    "scripts/harness-validation-local-health-check.ts",
  );
  await writeFile(
    checker,
    `const context = JSON.parse(Bun.argv[2]); const request = JSON.parse(Bun.argv[3]);
if(context.healthRevision !== "original" || request.candidate.treeSha !== "expected-tree") process.exit(1);
console.log("health-request-bound");`,
  );
  const invoke = () =>
    invokeProviderRail(
      {
        providerId: "athena.local-health",
        requestId: "health-test",
        idempotencyKey: "health-test",
        payload,
        requiresEvidence: false,
      },
      {
        open: () =>
          openProviderRailProcess({
            command: [
              "bun",
              adapter,
              "validation-health",
              JSON.stringify(context),
            ],
            cwd: root,
            env: process.env,
          }),
        deadlineMs: 5000,
      },
    );
  expect((await invoke()).kind).toBe("success");
  await writeFile(
    checker,
    'console.error("health revision changed"); process.exit(1);',
  );
  const changed = await invoke();
  expect(changed.kind).toBe("blocked");
  expect(changed.status).toBe("failed");
});
