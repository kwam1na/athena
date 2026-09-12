import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { captureCoverageBinding, compareCoverageBindings, type CoverageCapture } from "./harness-review-coverage";

const successfulCapture: CoverageCapture = {
  binding: { identity: "prepared-tree/base/toolchain/dependencies", environment: "private execution inputs" },
};

describe("coverage binding admission", () => {
  it("never treats two identical unavailable captures as successful evidence", () => {
    const unavailable: CoverageCapture = { reason: "coverage-inputs-unavailable" };
    expect(compareCoverageBindings(unavailable, unavailable)).toBe("coverage-inputs-unavailable");
  });

  it("requires successful capture at both boundaries", () => {
    const unprepared: CoverageCapture = { reason: "source-not-prepared" };
    expect(compareCoverageBindings(unprepared, successfulCapture)).toBe("source-not-prepared");
    expect(compareCoverageBindings(successfulCapture, unprepared)).toBe("source-not-prepared");
  });

  it("rejects a different candidate even with the same private execution inputs", () => {
    const changed: CoverageCapture = { binding: { ...successfulCapture.binding, identity: "changed candidate" } };
    expect(compareCoverageBindings(successfulCapture, changed)).toBe("source-base-toolchain-or-dependencies-changed");
  });

  it("rejects changed private inputs without returning their values", () => {
    const changed: CoverageCapture = { binding: { ...successfulCapture.binding, environment: "SENTINEL_SECRET=not-for-output" } };
    const reason = compareCoverageBindings(successfulCapture, changed);
    expect(reason).toBe("execution-environment-changed");
    expect(reason).not.toContain("not-for-output");
  });

  it("admits independently captured equal inputs rather than requiring object identity", () => {
    const recaptured: CoverageCapture = { binding: { ...successfulCapture.binding } };
    expect(compareCoverageBindings(successfulCapture, recaptured)).toBeUndefined();
  });
});

it.each(["pretest", "posttest"])("qualifies %s before inspecting Git or dependencies", async hook => {
  const root = await mkdtemp(path.join(tmpdir(), "athena-coverage-qualification-"));
  const sourceRoot = path.resolve(import.meta.dir, "..");
  try {
    await mkdir(path.join(root, "packages/athena-webapp"), { recursive: true });
    for (const file of ["package.json", "packages/athena-webapp/package.json", "packages/athena-webapp/vitest.config.ts"]) {
      await writeFile(path.join(root, file), await readFile(path.join(sourceRoot, file)));
    }
    const appPath = path.join(root, "packages/athena-webapp/package.json");
    const app = JSON.parse(await readFile(appPath, "utf8"));
    delete app.scripts.pretest;
    delete app.scripts.posttest;
    await writeFile(appPath, JSON.stringify(app));
    let gitCalls = 0;
    const git = async () => { gitCalls++; return { exitCode: 1, stdout: "" }; };
    // This control proves the fixture passes the other profile conditions.
    expect(await captureCoverageBinding(root, "HEAD", git)).toEqual({ reason: "source-not-prepared" });
    expect(gitCalls).toBeGreaterThan(0);
    gitCalls = 0;
    app.scripts[hook] = "echo additional ordinary-suite obligation";
    await writeFile(appPath, JSON.stringify(app));
    expect(await captureCoverageBinding(root, "HEAD", git)).toEqual({ reason: "unqualified-coverage-profile" });
    expect(gitCalls).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
