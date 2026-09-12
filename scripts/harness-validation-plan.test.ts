import { describe, expect, it } from "vitest";
import { runHarnessReview } from "./harness-review";
import characterization from "./fixtures/affected-validation/planner/characterization.json";

describe("affected validation characterization before cutover", () => {
  for (const fixture of characterization.cases.slice(0, 2)) {
    it(`captures ${fixture.name} broad selection without executing checks`, async () => {
      const commands: string[] = [];
      await runHarnessReview(process.cwd(), {
        getChangedFiles: async () => fixture.changedFiles,
        runHarnessCheck: async () => {},
        runRawCommand: async (command) => {
          commands.push(command);
        },
        runPackageScript: async (workspace, script) => {
          commands.push(`${workspace}:${script}`);
        },
        logger: { log() {}, error() {} },
      });
      expect(commands).toContain("bun run test:coverage");
      expect(commands).toContain("@athena/webapp:audit:convex");
    });
  }
});

import {
  buildValidationPlan,
  ValidationPlanError,
} from "./harness-validation-plan";
import type {
  CanonicalValidationCheck,
  CanonicalValidationRegistry,
} from "./harness-app-registry";
const check = (
  id: string,
  membership: string[] = [],
  profile = "unit",
): CanonicalValidationCheck => ({
  id,
  profile,
  argv: ["bun", "test"],
  cwd: ".",
  membership,
  inputs: ["package.json"],
  absentInputs: [],
  prerequisites: [],
  supersedes: [],
});
const registry = (
  checks: CanonicalValidationCheck[],
): CanonicalValidationRegistry => ({
  schemaVersion: "athena-validation-registry/1",
  checks,
  alwaysRequired: [],
  surfaces: checks.map((c) => ({
    id: c.id,
    pathPrefixes: [`src/${c.id}`],
    checks: [c.id],
    reason: "Changed behavior",
  })),
});
const change = (path: string) => ({ path, status: "modified" as const });

describe("canonical qualification plan", () => {
  it("unions overlapping membership once and preserves reasons independent of input order", () => {
    const r = registry([
      check("a", ["one.test.ts", "shared.test.ts"]),
      check("b", ["two.test.ts", "shared.test.ts"]),
    ]);
    const p = buildValidationPlan(r, [change("src/b"), change("src/a")]);
    expect(p).toEqual(
      buildValidationPlan(
        {
          ...r,
          checks: [...r.checks].reverse(),
          surfaces: [...r.surfaces].reverse(),
        },
        [change("src/a"), change("src/b")],
      ),
    );
    expect(p.checks).toHaveLength(1);
    expect(p.checks[0].membership).toEqual([
      "one.test.ts",
      "shared.test.ts",
      "two.test.ts",
    ]);
    expect(p.checks[0].reasons).toHaveLength(2);
    expect(p.authority).toBe("legacy-gate");
    expect(p.evidence).toBe("not-evaluated");
  });
  it("keeps coverage, browser and timer profiles distinct", () => {
    const p = buildValidationPlan(
      registry([
        check("a", ["same.test.ts"]),
        check("b", ["same.test.ts"], "coverage"),
        check("c", ["same.test.ts"], "timer"),
        check("d", ["same.test.ts"], "browser"),
      ]),
      [],
      "full-health",
    );
    expect(p.checks).toHaveLength(4);
  });
  it("changes identity for inventory additions and absence assertions", () => {
    const r = registry([check("a", ["one.test.ts"])]);
    const first = buildValidationPlan(r, [], "full-health").checks[0].identity;
    r.checks[0].membership.push("two.test.ts");
    expect(
      buildValidationPlan(r, [], "full-health").checks[0].identity,
    ).not.toBe(first);
    r.checks[0].membership.pop();
    r.checks[0].absentInputs.push("deleted.ts");
    expect(
      buildValidationPlan(r, [], "full-health").checks[0].identity,
    ).not.toBe(first);
  });
  it("blocks an uncovered deletion even beside a covered file", () => {
    expect(() =>
      buildValidationPlan(registry([check("a")]), [
        change("src/a"),
        { path: "unknown.ts", status: "deleted" },
      ]),
    ).toThrow("No obligation covers deleted input unknown.ts");
  });
  it("checks both sides of a rename", () => {
    expect(() =>
      buildValidationPlan(registry([check("a")]), [
        { path: "src/a", oldPath: "old.ts", status: "renamed" },
      ]),
    ).toThrow("old.ts");
  });
  it("blocks unknown checks and cyclic prerequisites before selection", () => {
    const r = registry([check("a"), check("b")]);
    r.checks[0].prerequisites = ["missing"];
    expect(() => buildValidationPlan(r, [], "full-health")).toThrow(
      "Unknown check",
    );
    r.checks[0].prerequisites = ["b"];
    r.checks[1].prerequisites = ["a"];
    expect(() => buildValidationPlan(r, [], "full-health")).toThrow("cycle");
  });
  it("rejects malformed maps and unjustified empty plans", () => {
    expect(() =>
      buildValidationPlan({} as CanonicalValidationRegistry, []),
    ).toThrow(ValidationPlanError);
    expect(() => buildValidationPlan(registry([]), [])).toThrow("empty plan");
  });
  it("requires explicit matching-profile supersession", () => {
    const a = check("a", ["one.test.ts", "two.test.ts"]),
      b = check("b", ["one.test.ts"]);
    b.argv = ["bun", "run", "test"];
    const r = registry([a, b]);
    expect(buildValidationPlan(r, [], "full-health").checks).toHaveLength(2);
    a.supersedes = [
      {
        checkId: "b",
        profile: "unit",
        reason: "Declared full suite contains targeted unit membership",
      },
    ];
    expect(buildValidationPlan(r, [], "full-health").checks).toHaveLength(1);
    b.profile = "timer";
    expect(() => buildValidationPlan(r, [], "full-health")).toThrow(
      "equivalent profile",
    );
  });
});

import { readFile } from "node:fs/promises";
import { runValidationPlanCli } from "./harness-validation-plan";

describe("read-only planning interface", () => {
  it("reproduces the published report fixture exactly", async () => {
    const output: string[] = [];
    await runValidationPlanCli(["--input","scripts/fixtures/affected-validation/planner/report-request.json","--json"],text=>output.push(text));
    expect(JSON.parse(output[0])).toEqual(JSON.parse(await readFile("scripts/fixtures/affected-validation/planner/report-plan.json","utf8")));
  });
  it("rejects missing and unknown CLI options before any execution", async () => {
    await expect(runValidationPlanCli([])).rejects.toMatchObject({code:"malformed-map"});
    await expect(runValidationPlanCli(["--input","request.json","--execute"])).rejects.toMatchObject({code:"malformed-map"});
  });
  it("validates unused malformed definitions before selecting an otherwise valid surface", () => {
    const r=registry([check("a"),check("b")]);
    (r.checks[1] as unknown as {profile:unknown}).profile=42;
    expect(()=>buildValidationPlan(r,[change("src/a")])).toThrow("Invalid or duplicate check");
  });
  it("does not let input object property order change the plan", () => {
    const r=registry([check("a")]);
    expect(buildValidationPlan(r,[{status:"modified",path:"src/a"}])).toEqual(buildValidationPlan(r,[{path:"src/a",status:"modified"}]));
  });
  it("retains prerequisites with reasons and refuses chained supersession", () => {
    const a=check("a"),b=check("b"),c=check("c");
    a.prerequisites=["b"];
    const plan=buildValidationPlan(registry([a,b,c]),[change("src/a")]);
    expect(plan.checks.flatMap(check=>check.reasons)).toContain("Prerequisite of a");
    a.supersedes=[{checkId:"b",profile:"unit",reason:"equivalent"}];
    b.supersedes=[{checkId:"c",profile:"unit",reason:"equivalent"}];
    expect(()=>buildValidationPlan(registry([a,b,c]),[],"full-health")).toThrow("Supersession");
  });
});
