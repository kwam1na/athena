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
  // Every protected kernel root must be present in a scan or the guard refuses
  // loudly (it only ever evaluates the full backend). Seed both so every test
  // sandbox is a legitimate full-backend scan; the seeds are import-free.
  for (const kernelRoot of ["inventoryLedger", "agentHarness"]) {
    const seedPath = path.join(convexDir, kernelRoot, "seed.ts");
    mkdirSync(path.dirname(seedPath), { recursive: true });
    writeFileSync(
      seedPath,
      "/* depguard seed */\nexport const __depguardSeed = true;\n",
    );
  }
  return { rootDir, packageDir, convexDir, baselinePath };
}

function wipeKernels(sandbox: Sandbox) {
  rmSync(path.join(sandbox.convexDir, "inventoryLedger"), {
    recursive: true,
    force: true,
  });
  rmSync(path.join(sandbox.convexDir, "agentHarness"), {
    recursive: true,
    force: true,
  });
}

function writeConvex(sandbox: Sandbox, convexRelativePath: string, source: string) {
  const filePath = path.join(sandbox.convexDir, convexRelativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
}

/** Write a file at the package root (not under convex), e.g. src/ or shared/. */
function writePackageFile(sandbox: Sandbox, relativePath: string, source: string) {
  const filePath = path.join(sandbox.packageDir, relativePath);
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
    // createSandbox seeds both protected kernel roots; wipe them so the scan
    // is genuinely empty rather than a seeded full backend.
    wipeKernels(sandbox);
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    expect(output.isClean).toBe(false);
    expect(output.scanError).toMatch(/No Convex backend source files/);
    // Regeneration on an empty scan must also refuse.
    const update = runCheck(sandbox, ["--update-baseline", "--json"]);
    expect(update.status).toBe(1);
  });

  it("surfaces a corrupt baseline even when the scan is empty", () => {
    const sandbox = createSandbox();
    wipeKernels(sandbox);
    writeFileSync(sandbox.baselinePath, "{ not json");
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    expect(jsonOf(result).scanError).toMatch(/corrupt/);
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
    // The Convex runtime facade lives at the exact top-level convex/_generated
    // directory (skipped by the scan but present on disk, so kernel imports of
    // `../_generated/dataModel` resolve to the real facade and stay legal).
    writeConvex(
      sandbox,
      "_generated/dataModel.ts",
      "export const generated = {};\n",
    );
    // A kernel file importing its own (legal, facade-preserving) internal helper.
    writeConvex(
      sandbox,
      "inventoryLedger/kernelFacade.ts",
      'import { value } from "./valuation";\nimport { generated } from "../_generated/dataModel";\n',
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

  it("fails loudly when a kernel subtree hides an undeclared nested _generated directory", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(sandbox, "inventoryLedger/kernel.ts", "export const ok = true;\n");
    // A nested _generated dir under a kernel, declared in no excludedPaths.
    writeConvex(
      sandbox,
      "inventoryLedger/_generated/evil.ts",
      'import { access } from "../../reports/access";\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    expect(output.isClean).toBe(false);
    expect(output.scanError).toMatch(/nested "_generated"/);
  });

  it("accepts a nested _generated directory declared in a kernel's excludedPaths", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(
      sandbox,
      "agentHarness/_generated/registry.ts",
      "export const AGENT_GENERATED_REGISTRY = {};\n",
    );
    writeConvex(sandbox, "agentHarness/registry.ts", "export const ok = true;\n");
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(0);
    const output = jsonOf(result);
    expect(output.isClean).toBe(true);
    expect(output.scanError).toBeUndefined();
  });

  it("does not mistake member calls or regex literals for imports", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(
      sandbox,
      "inventoryLedger/wouldBeFalsePositive.ts",
      [
        'const a = data.from("../reports/access");',
        'const b = selection.import("../reports/access");',
        'const re = /from "..\\/reports\\/access" matched inside a regex/;',
        "export const ok = a && b && re;",
      ].join("\n"),
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(0);
    const output = jsonOf(result);
    expect(output.isClean).toBe(true);
    expect(output.violations).toHaveLength(0);
  });

  it("catches backtick (template-literal) imports", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(sandbox, "reports/access.ts", "export const access = 1;\n");
    writeConvex(
      sandbox,
      "inventoryLedger/hot.ts",
      "import { access } from `../reports/access`;\n",
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-forbidden",
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("convex/reports/access.ts");
  });

  it("reports a self-loop import as a single-node cycle", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(
      sandbox,
      "selfLoop.ts",
      'import { same } from "./selfLoop";\nexport const same = 1;\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const cycle = output.violations.find((v: any) => v.type === "new-cycle");
    expect(cycle).toBeDefined();
    expect(cycle.cycle).toEqual(["convex/selfLoop.ts"]);
  });

  it("types an unknown-domain kernel import as kernel-not-allowed, not kernel-forbidden", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(
      sandbox,
      "operationAdmission/domains/operations_definitions.ts",
      "export const x = 1;\n",
    );
    writeConvex(
      sandbox,
      "inventoryLedger/notAllowed.ts",
      'import { x } from "../operationAdmission/domains/operations_definitions";\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find((v: any) =>
      v.file.endsWith("notAllowed.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.type).toBe("kernel-not-allowed");
    expect(violation.type).not.toBe("kernel-forbidden");
    expect(violation.resolved).toBe(
      "convex/operationAdmission/domains/operations_definitions.ts",
    );
  });

  it("expands tsconfig path aliases that address the convex backend", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeFileSync(
      path.join(sandbox.packageDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { paths: { "@cvx/*": ["./convex/*"] } },
      }),
    );
    writeConvex(sandbox, "reports/access.ts", "export const access = 1;\n");
    writeConvex(
      sandbox,
      "inventoryLedger/aliasHot.ts",
      'import { access } from "@cvx/reports/access";\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-forbidden" && v.file.endsWith("aliasHot.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("convex/reports/access.ts");
  });

  it("allows kernel imports of the bare convex runtime modules", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(
      sandbox,
      "inventoryLedger/viaRuntime.ts",
      'import { v } from "convex/values";\nimport type { MutationCtx } from "convex/server";\nexport const ok = v;\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(0);
    const output = jsonOf(result);
    expect(output.isClean).toBe(true);
  });

  it("fails loudly on a corrupt baseline and never regenerates it", () => {
    const sandbox = createSandbox();
    writeConvex(sandbox, "inventoryLedger/k.ts", "export const ok = true;\n");
    writeFileSync(sandbox.baselinePath, "{ not json");
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    expect(jsonOf(result).scanError).toMatch(/corrupt/);

    const before = readFileSync(sandbox.baselinePath, "utf8");
    const update = runCheck(sandbox, ["--update-baseline", "--json"]);
    expect(update.status).toBe(1);
    expect(jsonOf(update).scanError).toMatch(/corrupt/);
    expect(readFileSync(sandbox.baselinePath, "utf8")).toBe(before);

    // Shape-invalid JSON (well-formed but missing required fields) is corrupt too.
    writeFileSync(
      sandbox.baselinePath,
      JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z" }),
    );
    const shape = runCheck(sandbox, ["--json"]);
    expect(shape.status).toBe(1);
    expect(jsonOf(shape).scanError).toMatch(/corrupt/);
  });

  it("rejects value flags that swallow their value and unknown flags", () => {
    const sandbox = createSandbox();
    writeConvex(sandbox, "inventoryLedger/k.ts", "export const ok = true;\n");
    const missingValue = spawnSync(
      "bun",
      [
        SCRIPT_PATH,
        "--convex-dir",
        sandbox.convexDir,
        "--package-dir",
        sandbox.packageDir,
        "--baseline",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(missingValue.status).toBe(2);
    expect(missingValue.stderr).toMatch(/requires a value/);

    const unknown = spawnSync("bun", [SCRIPT_PATH, "--nope"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toMatch(/Unknown flag/);
  });

  it("allows a baselined cycle to contract on --update-baseline, then fails on reintroduction", () => {
    const sandbox = createSandbox();
    writeBaseline(
      sandbox,
      [
        [
          "convex/scaleA/a.ts",
          "convex/scaleB/b.ts",
          "convex/scaleC/c.ts",
        ],
      ],
      [],
    );
    // Current tree keeps only the a<->b pair; c is now an orphan.
    writeConvex(sandbox, "scaleA/a.ts", 'import { b } from "../scaleB/b";');
    writeConvex(sandbox, "scaleB/b.ts", 'import { a } from "../scaleA/a";');
    writeConvex(sandbox, "scaleC/c.ts", "export const orphan = true;\n");

    // The normal check reports the surviving subset as a CONTRACTION (safe to
    // regenerate), never as an unabsorbable new-cycle, plus the removed member
    // as baseline drift. The repairHint must point at shrink-only regeneration,
    // matching what --update-baseline would actually accept.
    const drifted = runCheck(sandbox, ["--json"]);
    expect(drifted.status).toBe(1);
    const driftedOutput = jsonOf(drifted);
    expect(
      driftedOutput.violations.some((v: any) => v.type === "cycle-contraction"),
    ).toBe(true);
    expect(
      driftedOutput.violations.some((v: any) => v.type === "baseline-drift"),
    ).toBe(true);
    expect(driftedOutput.repairHint).toMatch(/Regenerate with --update-baseline/);

    // Regeneration accepts the strict contraction of a baselined cycle and
    // marks the persisted baseline explicitly for JSON consumers.
    const contracted = runCheck(sandbox, ["--update-baseline", "--json"]);
    expect(contracted.status).toBe(0);
    expect(jsonOf(contracted).baselineUpdated).toBe(true);

    // Reintroducing the removed member grows the cycle again: not baselined.
    writeConvex(
      sandbox,
      "scaleB/b.ts",
      'import { a } from "../scaleA/a";\nimport { c } from "../scaleC/c";',
    );
    writeConvex(sandbox, "scaleC/c.ts", 'import { a } from "../scaleA/a";');
    const reintroduced = runCheck(sandbox, ["--json"]);
    expect(reintroduced.status).toBe(1);
    expect(
      jsonOf(reintroduced).violations.some((v: any) => v.type === "new-cycle"),
    ).toBe(true);
  });

  it("pins excluded-subtree boundaries: cycles detected, kernel violations not", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(sandbox, "reports/access.ts", "export const access = 1;\n");
    writeConvex(
      sandbox,
      "agentHarness/kernelTop.ts",
      'import { profiled } from "./profiles/offKernel";',
    );
    // A forbidden import INSIDE an excluded subtree is deliberately not a
    // kernel violation (the subtree is not kernel surface)...
    writeConvex(
      sandbox,
      "agentHarness/profiles/offKernel.ts",
      'import { kernelTop } from "../kernelTop";\nimport { access } from "../../../reports/access";\nexport const profiled = access ?? kernelTop;\n',
    );

    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    // ...but a cycle THROUGH the same excluded subtree is still detected.
    expect(
      output.violations.some((v: any) => v.type === "new-cycle"),
    ).toBe(true);
    expect(
      output.violations.some(
        (v: any) =>
          v.type === "kernel-forbidden" && v.file.includes("profiles/offKernel"),
      ),
    ).toBe(false);
  });

  it("types cycles as cycle-not-in-baseline when no baseline exists yet", () => {
    const sandbox = createSandbox();
    // Deliberately NO writeBaseline: a missing baseline is not corrupt, and a
    // normal run must type every cycle as not-in-baseline and hint at creation.
    writeConvex(sandbox, "scaleA/a.ts", 'import { b } from "../scaleB/b";');
    writeConvex(sandbox, "scaleB/b.ts", 'import { a } from "../scaleA/a";');
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const cycle = output.violations.find(
      (v: any) => v.type === "cycle-not-in-baseline",
    );
    expect(cycle).toBeDefined();
    expect(cycle.cycle).toContain("convex/scaleA/a.ts");
    expect(cycle.cycle).toContain("convex/scaleB/b.ts");
    expect(output.repairHint).toMatch(/create it with --update-baseline/);
  });

  it("flags a bare convex/<domain> import that is not a runtime facade", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(
      sandbox,
      "operations/inventoryMovements.ts",
      "export const applyInventoryEffectWithCtx = () => {};\n",
    );
    writeConvex(
      sandbox,
      "inventoryLedger/bareHot.ts",
      'import { applyInventoryEffectWithCtx } from "convex/operations/inventoryMovements";\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-forbidden" && v.file.endsWith("bareHot.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("convex/operations/inventoryMovements.ts");
  });

  it("classifies a src/-scoped tsconfig alias as backend surface, so a kernel cannot import product code through it", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writePackageFile(
      sandbox,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    // src/ lives at the package root, outside the convex scan.
    writePackageFile(sandbox, "src/lib/hot.ts", "export const hot = 1;\n");
    writeConvex(
      sandbox,
      "inventoryLedger/srcAliasHot.ts",
      'import { hot } from "@/lib/hot";\nexport const ok = hot;\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-forbidden" && v.file.endsWith("srcAliasHot.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("src/lib/hot.ts");
  });

  it("classifies a shared/-scoped tsconfig alias and respects kernel allowed domains", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writePackageFile(
      sandbox,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } } }),
    );
    writePackageFile(
      sandbox,
      "shared/agentHarness/util.ts",
      "export const util = 1;\n",
    );
    // agentHarness may import its shared/agentHarness dependency via the alias.
    writeConvex(
      sandbox,
      "agentHarness/viaTilde.ts",
      'import { util } from "~/shared/agentHarness/util";\nexport const ok = util;\n',
    );
    const allowed = runCheck(sandbox, ["--json"]);
    expect(allowed.status).toBe(0);
    expect(jsonOf(allowed).isClean).toBe(true);

    // inventoryLedger has no shared/ allowance — the same alias is not allowed there.
    writeConvex(
      sandbox,
      "inventoryLedger/viaTilde.ts",
      'import { util } from "~/shared/agentHarness/util";\nexport const ok = util;\n',
    );
    const blocked = runCheck(sandbox, ["--json"]);
    expect(blocked.status).toBe(1);
    const output = jsonOf(blocked);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-not-allowed" && v.file.endsWith("viaTilde.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("shared/agentHarness/util.ts");
  });

  it("refuses a scan that cannot see every protected kernel root (wrong --convex-dir)", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    const foreignDir = path.join(sandbox.rootDir, "notconvex");
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(path.join(foreignDir, "stray.ts"), "const x = 1;\n");
    const result = spawnSync(
      "bun",
      [
        SCRIPT_PATH,
        "--convex-dir",
        foreignDir,
        "--package-dir",
        sandbox.packageDir,
        "--baseline",
        sandbox.baselinePath,
        "--json",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60000 },
    );
    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout || "{}");
    expect(output.scanError).toMatch(/Protected kernel surface not found/);
  });

  it("does not let an allowed-prefix lookalike smuggle product imports into a kernel", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writeConvex(sandbox, "reports/access.ts", "export const access = 1;\n");
    // `convex/valuesBridge.ts` is one character past the allowed `convex/values`
    // runtime module; it is NOT the facade and must not inherit its allowance.
    writeConvex(
      sandbox,
      "valuesBridge.ts",
      'import { access } from "./reports/access";\nexport const bridge = access;\n',
    );
    writeConvex(
      sandbox,
      "inventoryLedger/viaBridge.ts",
      'import { bridge } from "../valuesBridge";\nexport const ok = bridge;\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-not-allowed" && v.file.endsWith("viaBridge.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("convex/valuesBridge.ts");
  });

  it("parses comment-bearing (JSONC) tsconfig files so aliases are never silently lost", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writePackageFile(
      sandbox,
      "tsconfig.json",
      [
        "{",
        '  "compilerOptions": {',
        '    // Real tsconfigs carry comments; JSON.parse alone would reject this.',
        '    "paths": { "@cvx/*": ["./convex/*"] },',
        "  }",
        "}",
      ].join("\n"),
    );
    writeConvex(sandbox, "reports/access.ts", "export const access = 1;\n");
    writeConvex(
      sandbox,
      "inventoryLedger/aliasHot.ts",
      'import { access } from "@cvx/reports/access";\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-forbidden" && v.file.endsWith("aliasHot.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("convex/reports/access.ts");
  });

  it("resolves overlapping aliases by longest prefix, exactly like TypeScript", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    // `@cvx/values/*` is narrow and must win over the broader `@cvx/*`
    // regardless of insertion order — TypeScript maps by longest prefix, so a
    // kernel importing `@cvx/values/access` reaches the FORBIDDEN reports/ dir,
    // never the allowed values/ dir the broad alias would have routed it to.
    writePackageFile(
      sandbox,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          paths: {
            "@cvx/*": ["./convex/values/*"],
            "@cvx/values/*": ["./convex/reports/*"],
          },
        },
      }),
    );
    writeConvex(sandbox, "reports/access.ts", "export const access = 1;\n");
    writeConvex(sandbox, "values/access.ts", "export const access = 1;\n");
    writeConvex(
      sandbox,
      "inventoryLedger/longestPrefix.ts",
      'import { access } from "@cvx/values/access";\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-forbidden" && v.file.endsWith("longestPrefix.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("convex/reports/access.ts");
  });

  it("classifies a non-star alias that maps to the bare backend root", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    writePackageFile(
      sandbox,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "@cvx": ["./convex"] } },
      }),
    );
    writeConvex(
      sandbox,
      "index.ts",
      'import { access } from "./reports/access";\nexport const index = access;\n',
    );
    writeConvex(sandbox, "reports/access.ts", "export const access = 1;\n");
    // `import "@cvx"` resolves to convex/index.ts — the bare root is not a
    // runtime facade and must not be silently treated as an external package.
    writeConvex(
      sandbox,
      "inventoryLedger/bareRootAlias.ts",
      'import { index } from "@cvx";\nexport const ok = index;\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    const output = jsonOf(result);
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-not-allowed" && v.file.endsWith("bareRootAlias.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("convex/index.ts");
  });

  it("refuses a kernel root that contains only excluded-subtree files", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    // Remove the agentHarness kernel module seed; leave only a file inside an
    // excluded subtree (profiles/). A root with zero kernel modules fences
    // nothing and must not satisfy the presence check.
    rmSync(path.join(sandbox.convexDir, "agentHarness", "seed.ts"));
    writeConvex(
      sandbox,
      "agentHarness/profiles/offKernel.ts",
      "export const offKernel = 1;\n",
    );
    const result = runCheck(sandbox, ["--json"]);
    expect(result.status).toBe(1);
    expect(jsonOf(result).scanError).toMatch(/Protected kernel surface not found/);
    expect(jsonOf(result).scanError).toMatch(/agentHarness/);
  });

  it("refuses dotted-child lookalikes of an allowed module but keeps the exact module", () => {
    const sandbox = createSandbox();
    writeBaseline(sandbox, [], []);
    // `convex/values.ts` is the exact allowed module; `convex/values.deep.ts`
    // is a dotted-child lookalike that must not inherit the allowance.
    writeConvex(
      sandbox,
      "values.ts",
      'export const values = "values";\n',
    );
    writeConvex(
      sandbox,
      "values.deep.ts",
      'import { access } from "./reports/access";\nexport const deep = access;\n',
    );
    writeConvex(sandbox, "reports/access.ts", "export const access = 1;\n");
    writeConvex(
      sandbox,
      "inventoryLedger/exactModule.ts",
      'import { values } from "../values";\n',
    );
    writeConvex(
      sandbox,
      "inventoryLedger/dottedSmuggler.ts",
      'import { deep } from "../values.deep";\n',
    );
    const result = runCheck(sandbox, ["--json"]);
    const output = jsonOf(result);
    // The exact module import stays legal...
    expect(
      output.violations.some(
        (v: any) => v.type === "kernel-not-allowed" && v.file.endsWith("exactModule.ts"),
      ),
    ).toBe(false);
    // ...while the dotted-child smuggler is caught.
    const violation = output.violations.find(
      (v: any) => v.type === "kernel-not-allowed" && v.file.endsWith("dottedSmuggler.ts"),
    );
    expect(violation).toBeDefined();
    expect(violation.resolved).toBe("convex/values.deep.ts");
  });
});