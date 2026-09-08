import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkPolicyProjection } from "./policy-projection-check";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function lifecycle(program: string) {
  const root = await mkdtemp(path.join(tmpdir(), "athena-policy-boundary-"));
  roots.push(root);
  await mkdir(path.join(root, ".agent-skills/current"), { recursive: true });
  await writeFile(path.join(root, ".agent-skills/current/__main__.py"), program);
  return root;
}

it("preserves lifecycle failure as a domain blocker even without JSON", async () => {
  const root = await lifecycle('import sys\nsys.stderr.write("generation verification failed")\nsys.exit(1)\n');
  await expect(checkPolicyProjection(root)).rejects.toMatchObject({
    blockers: [expect.objectContaining({ code: "delivery_product_not_current" })],
  });
});

it("rejects a nonzero exit even when stdout claims readiness", async () => {
  const root = await lifecycle('import json, sys\nprint(json.dumps({"productReady": True, "lifecycle": "current", "blockers": []}))\nsys.exit(1)\n');
  await expect(checkPolicyProjection(root)).rejects.toMatchObject({
    blockers: [expect.objectContaining({ code: "delivery_product_not_current" })],
  });
});

it("rejects incomplete readiness output", async () => {
  const root = await lifecycle('print(\'{"productReady":true,"lifecycle":"current"}\')\n');
  await expect(checkPolicyProjection(root)).rejects.toMatchObject({
    blockers: [expect.objectContaining({ code: "delivery_product_not_current" })],
  });
});


it("accepts a current product installation and preserves its release identity", async () => {
  const status = { productReady: true, lifecycle: "current", blockers: [], active: { releaseId: "product-fixture", generation: "fixture-generation" } };
  const root = await lifecycle(`print(${JSON.stringify(JSON.stringify(status))})\n`);
  await expect(checkPolicyProjection(root)).resolves.toEqual(status);
});

it("accepts the actual current installed product", async () => {
  const status = await checkPolicyProjection(path.resolve(import.meta.dirname, ".."));
  expect(status.productReady).toBe(true);
  expect(status.active.releaseId).toEqual(expect.any(String));
});
