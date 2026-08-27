/**
 * Tests for convex-backend-dependency-check.ts
 *
 * Fixtures live in per-test ephemeral sandboxes (mkdtemp), never in the real
 * convex tree, so an interrupted run cannot pollute other sensors and the
 * contract's error-path scenarios are exercised against controlled graphs.
 */
import { describe, expect, it, beforeAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts/convex-backend-dependency-check.ts");
const REAL_BASELINE_PATH = path.join(
  REPO_ROOT,
  "scripts/convex-backend-dependency-baseline.json",
);

type CheckRun = { stdout: string; stderr: string; status: number };

type Sandbox = {
  rootDir: string;
  packageDir: string;
  convexDir: string;
  baselinePath: string;
};

function createSandbox(): Sandbox {
  const rootDir = mkdtempSync(path.join(tmpdir(), "athena-depguard-"));
  const packageDir = path.join(rootDir, "athena-webapp");
  const convexDir = path.join(packageDir, "convex");
  const baselinePath = path.join(rootDir, "baseline.json");
  mkdirSync(convexDir, { recursive: true });
  return { rootDir, packageDir, convexDir, baselinePath };
}

function writeConvex(sandbox: Sandbox, convexRelativePath: string, source: string) {
  const filePath = path.join(sandbox.convexDir, convexRelativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
}

function writeBaseline(
  sandbox: Sandbox,
  cycles: string[][],
  kernelViolations: string[],
) {
  writeFileSync(
    sandbox.baselinePath,
    JSON.stringify(
      { timestamp: "2026-01-01T00:00:00.000Z", cycles, kernelViolations },
      null,
      2,
    ),
  );
}

function runCheck(sandbox: Sandbox, args: string[] = []): CheckRun {
  const result = spawnSync(
    "bun",
    [
      SCRIPT_PATH,
      "--convex-dir",
      sandbox.convexDir,
      "--package-dir",
      sandbox.packageDir,
      "--baseline",
      sandbox.baselinePath,
      ...args,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 60000 },
  );
  return {
    stdout: result.stdout?.toString() || "",
    stderr: result.stderr?.toString() || "",
    status: result.status ?? 1,
  };
}

function jsonOf(run: CheckRun): any {
  return JSON.parse(run.stdout);
}

describe("convex backend dependency check", () => {
  beforeAll(() => {
    expect(existsSync(REAL_BASELINE_PATH)).toBe(true);
  });

  it("passes with the committed baseline (no new violations) on the real tree", () => {
    // Real-tree characterization: the committed baseline must match the
    // current backend graph exactly.
    const result = spawnSync("bun", [SCRIPT_PATH, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120000,
    });
    const output = JSON.parse(result.stdout || "{}");
    expect(result.status).toBe(0);
    expect(output.isClean).toBe(true);
    expect(output.violations).toHaveLength(0);
  });

  it("rejects an empty scan loudly instead of passing green", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    expect(output.isClean).toBe(false);
    expect(output.scanError).toMatch(/No Convex backend source files/);
    // Regeneration on an empty scan must also refuse.
    const update = runCheck(sandbox, ["--update-baseline", "--json"]);
    expect(update.status).toBe(1);
  });

  it("detects a new dependency cycle between extensionless modules and reports the exact members", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(sandbox, "scaleA/a.ts", `import { b } from "../scaleB/b";`);
    writeConvex(sandbox, "scaleB/b.ts", `import { a } from "../scaleA/a";`);

    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    expect(output.isClean).toBe(false);

    const cycleFinding = output.violations.find(
      (v: any) => v.type === "new-cycle",
    );
    expect(cycleFinding).toBeDefined();
    expect(cycleFinding.cycle.slice().sort()).toEqual(
      ["convex/scaleA/a.ts", "convex/scaleB/b.ts"].sort(),
    );
  });

  it("removing one known cycle while adding a different cycle still fails", () => {
    const sandbox = createSandbox();
    // Baseline captures the a<->b cycle. The current tree replaces it with
    // a brand-new c<->d cycle.
    writeBaseline(sandbox, [["convex/scaleA/a.ts", "convex/scaleB/b.ts"]], []);
    writeConvex(sandbox, "scaleC/c.ts", `import { d } from "../scaleD/d";`);
    writeConvex(sandbox, "scaleD/d.ts", `import { c } from "../scaleC/c";`);

    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    expect(output.isClean).toBe(false);

    const newCycle = output.violations.find(
      (v: any) => v.type === "new-cycle",
    );
    expect(newCycle).toBeDefined();
    expect(newCycle.cycle).toContain("convex/scaleC/c.ts");

    const drift = output.violations.find(
      (v: any) => v.type === "baseline-drift",
    );
    expect(drift).toBeDefined();
    expect(drift.resolved).toContain("scaleA");
  });

  it("removing a baselined kernel edge is drift; regeneration contracts it; reintroducing the edge then fails", () => {
    const sandbox = createSandbox();
    const fixtureRel = "inventoryLedger/violationFixture.ts";
    const fixturePath = path.join(sandbox.convexDir, fixtureRel);
    // The forbidden product-domain import is a kernel-forbidden edge.
    writeConvex(
      sandbox,
      fixtureRel,
      'import { access } from "../reports/access";\n',
    );

    // 1. Create the baseline from this state (characterization snapshot).
    const created = runCheck(sandbox, ["--update-baseline", "--json"]);
    expect(created.status).toBe(0);
    expect(created.stdout).not.toContain("scanError");
    const createdBaseline = JSON.parse(readFileSync(sandbox.baselinePath, "utf8"));
    expect(createdBaseline.kernelViolations).toHaveLength(1);
    expect(createdBaseline.kernelViolations[0]).toContain(
      "convex/inventoryLedger/violationFixture.ts",
    );

    // 2. Fix the violation (remove the edge): the stale baseline must be drift.
    writeFileSync(fixturePath, "export const ok = true;\n");
    const drifted = runCheck(sandbox, ["--json"]);
    expect(drifted.status).toBe(1);
    const driftedOutput = jsonOf(drifted);
    expect(driftedOutput.isClean).toBe(false);
    expect(
      driftedOutput.violations.some((v: any) => v.type === "baseline-drift"),
    ).toBe(true);

    // 3. Regenerate: the baseline may only shrink, and the check turns green.
    const contracted = runCheck(sandbox, ["--update-baseline", "--json"]);
    expect(contracted.status).toBe(0);
    const contractedBaseline = JSON.parse(
      readFileSync(sandbox.baselinePath, "utf8"),
    );
    expect(contractedBaseline.kernelViolations).toHaveLength(0);

    // 4. Reintroduce the exact same edge: no longer baselined, so it fails.
    writeConvex(
      sandbox,
      fixtureRel,
      'import { access } from "../reports/access";\n',
    );
    const reintroduced = runCheck(sandbox, ["--json"]);
    expect(reintroduced.status).toBe(1);
    const reintroducedOutput = jsonOf(reintroduced);
    expect(reintroducedOutput.isClean).toBe(false);
    const violation = reintroducedOutput.violations.find(
      (v: any) => v.type === "kernel-forbidden",
    );
    expect(violation).toBeDefined();
    expect(violation.file).toBe("convex/inventoryLedger/violationFixture.ts");
    expect(violation.resolved).toContain("convex/reports/access");
  });

  it("refuses --update-baseline when the graph would grow (never absorbs new violations)", () => {
    const sandbox = createSandbox();
    writeConvex(
      sandbox,
      "inventoryLedger/first.ts",
      'import { access } from "../reports/access";\n',
    );
    const created = runCheck(sandbox, ["--update-baseline", "--json"]);
    expect(created.status).toBe(0);
    const baselineBefore = readFileSync(sandbox.baselinePath, "utf8");

    // A second, unrelated new violation must not be grandfatherable.
    writeConvex(
      sandbox,
      "inventoryLedger/second.ts",
      'import { operatingPeriod } from "../storeTime/operatingPeriods";\n',
    );
    const refused = runCheck(sandbox, ["--update-baseline", "--json"]);
    expect(refused.status).toBe(1);
    const refusedOutput = jsonOf(refused);
    expect(refusedOutput.isClean).toBe(false);
    expect(refusedOutput.scanError).toMatch(/shrink-only/);

    // The baseline file must be untouched.
    expect(readFileSync(sandbox.baselinePath, "utf8")).toBe(baselineBefore);
  });

  it("leaf-to-facade imports fail while facade-preserving kernel-internal imports stay legal", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    // A kernel file importing its own (legal, facade-preserving) internal helper.
    writeConvex(
      sandbox,
      "inventoryLedger/kernelFacade.ts",
      'import { value } from "./valuation";\nimport { generated } from "./_generated/dataModel";\n',
    );
    // The helper itself only imports allowed leaf/platform modules.
    writeConvex(
      sandbox,
      "inventoryLedger/valuation.ts",
      'import { values } from "convex/values";\n',
    );
    // A helper that reaches INTO a product facade is a leaf-to-facade violation.
    writeConvex(
      sandbox,
      "inventoryLedger/leakyHelper.ts",
      'import { access } from "../reports/access";\n',
    );

    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    expect(output.isClean).toBe(false);

    // leakyHelper.ts (leaf) importing the reports facade must be flagged.
    expect(
      output.violations.some(
        (v: any) =>
          v.file === "convex/inventoryLedger/leakyHelper.ts" &&
          v.type === "kernel-forbidden",
      ),
    ).toBe(true);
    // kernelFacade.ts (facade) importing its own helper must NOT be flagged.
    expect(
      output.violations.some((v: any) => v.file === "convex/inventoryLedger/kernelFacade.ts"),
    ).toBe(false);
  });

  it("ignores imports quoted inside comments or string literals", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(
      sandbox,
      "inventoryLedger/docOnly.ts",
      [
        '// Legacy note: import { access } from "../reports/access";',
        '/*',
        'import { operatingPeriod } from "../storeTime/operatingPeriods";',
        "*/",
        'const docs = "from \\"../reports/access\\" is documented, not executed";',
        "export const ok = true;",
      ].join("\n"),
    );

    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(0);
    const output = jsonOf(result);
    expect(output.isClean).toBe(true);
    expect(output.violations).toHaveLength(0);
  });

  it("reports a new kernel violation with the exact resolved edge", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(
      sandbox,
      "operations/inventoryMovements.ts",
      "export const applyInventoryEffectWithCtx = () => {};\n",
    );
    writeConvex(
      sandbox,
      "inventoryLedger/hot.ts",
      'import { applyInventoryEffectWithCtx } from "../operations/inventoryMovements";\n',
    );

    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find((v: any) => v.type === "kernel-forbidden");
    expect(violation).toBeDefined();
    expect(violation.file).toBe("convex/inventoryLedger/hot.ts");
    expect(violation.resolved).toBe("convex/operations/inventoryMovements.ts");
  });
});