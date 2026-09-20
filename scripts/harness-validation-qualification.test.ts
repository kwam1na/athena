import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildValidationPlan,
  type ValidationPlan,
} from "./harness-validation-plan";
import {
  baseMovementScenarios,
  reportFollowupScenarios,
  reportOnlyScenario,
  qualificationFile as file,
  qualificationUnit,
  qualificationReport,
  type QualificationScenario,
} from "./fixtures/affected-validation/qualification-corpus";

const plan = (scenario: QualificationScenario, full = false) =>
  buildValidationPlan(
    scenario.registry,
    full ? [] : scenario.changes,
    full ? "full-health" : "comparison",
    scenario.snapshots,
  );
const members = (value: ValidationPlan) =>
  value.checks.flatMap((check) => check.membership).sort();

function requireMembers(value: ValidationPlan, expected: string[]) {
  for (const member of expected)
    if (!members(value).includes(member))
      throw new Error(`Missing affected consumer: ${member}`);
}

async function executeFixture(
  scenario: QualificationScenario,
  selected: string[],
) {
  const root = await mkdtemp(join(tmpdir(), "athena-qualification-"));
  try {
    for (const [path, source] of Object.entries(scenario.snapshots.candidate)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }
    // These fixtures use bun:test. This does not execute Athena's Vitest suites.
    const child = Bun.spawn(
      [process.execPath, "test", ...selected.map((path) => `./${path}`)],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, output: stdout + stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("cross-step affected validation qualification", () => {
  it("keeps accumulated code obligations stable across modified and newly added reports", () => {
    const scenarios = reportFollowupScenarios();
    const plans = scenarios.map((scenario) => plan(scenario));
    const independent = plans.map((value) =>
      value.checks.find((check) => check.id === qualificationUnit)!,
    );
    expect(independent.map((check) => check.membership)).toEqual(
      Array(3).fill([file("value.test.ts")]),
    );
    for (const check of independent.slice(1)) {
      expect(check.identity).toBe(independent[0].identity);
      expect(check.inputs).toEqual(independent[0].inputs);
      expect(check.absentInputs).toEqual(independent[0].absentInputs);
      expect(check.profile).toBe(independent[0].profile);
    }
    expect(plans[0].checks.flatMap((check) => check.membership)).not.toContain(
      file("report.test.ts"),
    );
    for (const value of plans.slice(1)) {
      requireMembers(value, [file("report.test.ts")]);
      expect(
        value.checks.find((check) => check.id.endsWith(".publishing"))!.inputs,
      ).toContain(qualificationReport);
    }
    expect(
      plans[2].checks.find((check) => check.id.endsWith(".publishing"))!.inputs,
    ).toContain("docs/reports/second.html");
    for (const [index, value] of plans.entries()) {
      expect(value.authority).toBe("legacy-gate");
      expect(value.evidence).toBe("not-evaluated");
      expect(new Set(members(value)).size).toBe(members(value).length);
      expect(
        members(value).every((member) =>
          members(plan(scenarios[index], true)).includes(member),
        ),
      ).toBe(true);
    }
  });

  it("discovers a base-added consumer absent from the old registry and unchanged by the delivery", () => {
    const [initial, moved] = baseMovementScenarios();
    expect(moved.changes).toEqual(initial.changes);
    expect(moved.registry).toEqual(initial.registry);
    expect(members(plan(initial))).toEqual([file("value.test.ts")]);
    const expected = [file("base-consumer.test.ts"), file("value.test.ts")];
    expect(members(plan(moved))).toEqual(expected);
    // A stale pre-rebase plan cannot satisfy the new membership oracle.
    expect(() => requireMembers(plan(initial), expected)).toThrow(
      "Missing affected consumer",
    );
  });

  it("refuses a missing publishing contract despite a matching publishing surface", () => {
    const scenario = reportOnlyScenario();
    expect(members(plan(scenario))).toEqual([file("report.test.ts")]);
    const broken = structuredClone(scenario);
    broken.registry.impact!.relationships = [];
    expect(() => plan(broken)).toThrow("No proven containing suite");
  });

  it("executes matched selected/full synthetic controls and catches the same injected fault", async () => {
    const scenario = reportFollowupScenarios()[0];
    const selected = members(plan(scenario));
    const full = members(plan(scenario, true));
    expect(selected).toEqual([file("value.test.ts")]);
    expect(full).toEqual([
      file("other.test.ts"),
      file("report.test.ts"),
      file("value.test.ts"),
    ]);
    for (const membership of [selected, full]) {
      const clean = await executeFixture(scenario, membership);
      expect(clean.exitCode).toBe(0);
      expect(clean.output).toContain("value contract");
    }
    const faulty = structuredClone(scenario);
    faulty.snapshots.candidate[file("value.ts")] = "export const value = 99;";
    for (const membership of [
      members(plan(faulty)),
      members(plan(faulty, true)),
    ]) {
      const result = await executeFixture(faulty, membership);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("value contract");
      expect(result.output).toContain("Received: 99");
    }
  });
});
