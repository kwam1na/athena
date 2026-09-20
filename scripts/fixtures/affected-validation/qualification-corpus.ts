import type { CanonicalValidationRegistry } from "../../harness-app-registry";
import type { ValidationChange } from "../../harness-validation-plan";
import type { ValidationSnapshots } from "../../harness-validation-impact";

// Synthetic cross-step controls, not evidence of real Athena execution savings.
export const qualificationRoot = "packages/qualification";
export const qualificationFile = (name: string) =>
  `${qualificationRoot}/${name}`;
export const qualificationUnit = "qualification.unit";
export const qualificationReport = "docs/reports/first.html";

export type QualificationScenario = {
  name: string;
  registry: CanonicalValidationRegistry;
  changes: ValidationChange[];
  snapshots: ValidationSnapshots;
};

function fixture(): QualificationScenario {
  const f = qualificationFile;
  const base = {
    [f("package.json")]: '{"name":"qualification"}',
    [f("value.ts")]: "export const value = 1;",
    [f("other.ts")]: "export const other = 2;",
    [f("content.ts")]: "export const content = true;",
    [f("value.test.ts")]:
      'import {test,expect} from "bun:test"; import {value} from "./value"; test("value contract",()=>expect(value).toBe(1));',
    [f("other.test.ts")]:
      'import {test,expect} from "bun:test"; import {other} from "./other"; test("other contract",()=>expect(other).toBe(2));',
    [f("report.test.ts")]:
      'import {test,expect} from "bun:test"; import {content} from "./content"; test("publishing contract",()=>expect(content).toBe(true));',
    [qualificationReport]: "<article>First report</article>",
  };
  const check = (id: string, profile: string, membership: string[]) => ({
    id,
    profile,
    cwd: qualificationRoot,
    argv: ["bun", "test"],
    membership,
    inputs: [],
    absentInputs: [],
    prerequisites: [],
    supersedes: [],
  });
  return {
    name: "code",
    registry: {
      schemaVersion: "athena-validation-registry/1",
      alwaysRequired: [],
      checks: [
        check(qualificationUnit, `${qualificationRoot}:unit`, [
          f("value.test.ts"),
          f("other.test.ts"),
          f("report.test.ts"),
        ]),
        check("qualification.publish", "docs-publishing", []),
      ],
      surfaces: [
        {
          id: "package",
          pathPrefixes: [qualificationRoot],
          checks: [qualificationUnit],
          reason: "Qualification package",
        },
        {
          id: "reports",
          pathPrefixes: ["docs/reports"],
          checks: ["qualification.publish"],
          reason: "Report publishing",
        },
      ],
      impact: {
        packages: [
          {
            root: qualificationRoot,
            testPatterns: [`${qualificationRoot}/**/*.test.ts`],
            unitChecks: [qualificationUnit],
            fallbackChecks: [qualificationUnit],
          },
        ],
        relationships: [
          {
            id: "report-content",
            kind: "data",
            inputs: ["docs/reports"],
            consumers: [f("content.ts")],
            publishingChecks: ["qualification.publish"],
          },
        ],
      },
    },
    changes: [{ path: f("value.ts"), status: "modified" }],
    snapshots: {
      base,
      candidate: {
        ...base,
        [f("value.ts")]: "export const value = 1; // implementation edit",
      },
    },
  };
}

/** Same accumulated code diff; report modification and addition are separate steps. */
export function reportFollowupScenarios(): QualificationScenario[] {
  const code = fixture();
  const modified = structuredClone(code);
  modified.name = "code-and-modified-report";
  modified.changes.push({ path: qualificationReport, status: "modified" });
  modified.snapshots.candidate[qualificationReport] =
    "<article>Updated report</article>";
  const added = structuredClone(modified);
  added.name = "code-and-new-report";
  added.changes.push({ path: "docs/reports/second.html", status: "added" });
  added.snapshots.candidate["docs/reports/second.html"] =
    "<article>New report</article>";
  return [code, modified, added];
}

/** Rebase brings a new consumer into both snapshots without editing that test. */
export function baseMovementScenarios(): QualificationScenario[] {
  const initial = fixture();
  const moved = structuredClone(initial);
  moved.name = "base-added-consumer";
  const path = qualificationFile("base-consumer.test.ts");
  moved.snapshots.base[path] =
    'import {test,expect} from "bun:test"; import {value} from "./value"; test("base consumer contract",()=>expect(value).toBe(1));';
  moved.snapshots.candidate[path] = moved.snapshots.base[path];
  return [initial, moved];
}

export function reportOnlyScenario(): QualificationScenario {
  const scenario = fixture();
  scenario.name = "report-only";
  scenario.changes = [{ path: qualificationReport, status: "modified" }];
  scenario.snapshots.candidate = {
    ...scenario.snapshots.base,
    [qualificationReport]: "<article>Updated report</article>",
  };
  return scenario;
}
