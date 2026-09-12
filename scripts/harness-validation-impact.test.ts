import { describe, expect, it } from "vitest";
import { buildValidationPlan } from "./harness-validation-plan";
import type { CanonicalValidationRegistry } from "./harness-app-registry";
import { collectCanonicalValidationRegistry } from "./harness-repo-validation";
import { runValidationPlanCli } from "./harness-validation-plan";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = "packages/example";
const file = (name: string) => `${root}/${name}`;
const unit = "example.unit";
const registry = (): CanonicalValidationRegistry => ({
  schemaVersion: "athena-validation-registry/1",
  alwaysRequired: [],
  checks: [
    {
      id: unit,
      profile: `${root}:unit`,
      cwd: root,
      argv: ["bun", "run", "test", "--"],
      membership: [file("one.test.ts"), file("two.test.ts")],
      inputs: [],
      absentInputs: [],
      prerequisites: [],
      supersedes: [],
    },
    {
      id: "example.types",
      profile: "types",
      cwd: root,
      argv: ["bun", "run", "typecheck"],
      membership: [],
      inputs: [],
      absentInputs: [],
      prerequisites: [],
      supersedes: [],
    },
  ],
  surfaces: [
    {
      id: "example",
      pathPrefixes: [root],
      checks: [unit, "example.types"],
      reason: "Example package",
    },
  ],
  impact: {
    packages: [
      {
        root,
        testPatterns: [`${root}/**/*.test.ts`],
        unitChecks: [unit],
        fallbackChecks: [unit, "example.types"],
      },
    ],
    relationships: [],
  },
});
const snapshot = () => ({
  [file("package.json")]: '{"name":"example"}',
  [file("leaf.ts")]: "export const value = 1;",
  [file("barrel.ts")]: 'export { value } from "./leaf";',
  [file("one.test.ts")]: 'import { value } from "./barrel";',
  [file("other.ts")]: "export const value = 2;",
  [file("two.test.ts")]: 'import { value } from "./other";',
});
const members = (plan: ReturnType<typeof buildValidationPlan>) =>
  plan.checks
    .filter((check) => check.profile.endsWith(":unit"))
    .flatMap((check) => check.membership);

describe("affected consumer qualification", () => {
  for (const reader of [
    'new Bun.Glob("*.ts").scanSync({cwd:"packages/example"})',
    'new Bun.Glob("*.ts").scan({cwd:"packages/example"})',
    'new Bun["Glob"]("*.ts").scanSync({cwd:"packages/example"})',
    '(() => { const Glob=Bun.Glob; return new Glob("*.ts").scanSync({cwd:"packages/example"}); })()',
  ])
    it(`retains a Bun directory reader across a rename: ${reader}`, () => {
      const base = {
        ...snapshot(),
        [file("two.test.ts")]: `const files=${reader};`,
      };
      const candidate: Record<string, string> = {
        ...base,
        [file("renamed.ts")]: base[file("leaf.ts")],
        [file("barrel.ts")]: 'export {value} from "./renamed";',
      };
      delete candidate[file("leaf.ts")];
      const plan = buildValidationPlan(
        registry(),
        [
          {
            path: file("renamed.ts"),
            oldPath: file("leaf.ts"),
            status: "renamed",
          },
          { path: file("barrel.ts"), status: "modified" },
        ],
        "comparison",
        { base, candidate },
      );
      expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
      expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
        "filesystem",
      );
    });

  for (const setting of ["setupFiles", "globalSetup"])
    it(`retains implicit runner members for computed ${setting} beside an inspector`, () => {
      const base = {
        ...snapshot(),
        [file("vitest.config.ts")]:
          `const setup='./setup.ts'; export default {test:{${setting}:setup}};`,
        [file("setup.ts")]: "globalThis.FLAG=true;",
        [file("one.test.ts")]: 'import "./vitest.config"; import "./setup";',
        [file("two.test.ts")]: "if (FLAG) throw Error('implicit setup');",
      };
      const plan = buildValidationPlan(
        registry(),
        [{ path: file("setup.ts"), status: "modified" }],
        "comparison",
        { base, candidate: base },
      );
      expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
      expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
        "unqualified-runner-configuration",
      );
    });

  it("retains implicit runner members when setup performs an unknown read", () => {
    const base = {
      ...snapshot(),
      [file("vitest.config.ts")]:
        'export default {test:{setupFiles:"./setup.ts"}};',
      [file("setup.ts")]:
        'import fs from "node:fs"; globalThis.FLAG=fs.readFileSync(getPath());',
      [file("data.json")]: "{}",
      [file("one.test.ts")]: 'import "./setup"; import "./data.json";',
      [file("two.test.ts")]: "if (FLAG) throw Error('implicit setup read');",
    };
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("data.json"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
    expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
      "filesystem",
    );
  });

  for (const [source, reason] of [
    ['await Bun.write(getPath(), "value");', "filesystem"],
    ["Bun.spawn(getCommand());", "process-or-module"],
    ["Bun.spawnSync(getCommand());", "process-or-module"],
    ["Bun.$`cat ${getPath()}`;", "process-or-module"],
  ])
    it(`retains conservative input scope for ${source}`, () => {
      const base = {
        ...snapshot(),
        [file("two.test.ts")]: source,
        "outside/input.txt": "input",
      };
      const plan = buildValidationPlan(
        registry(),
        [{ path: file("leaf.ts"), status: "modified" }],
        "comparison",
        { base, candidate: base },
      );
      expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
      expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
        reason,
      );
      expect(
        plan.checks.find((check) =>
          check.membership.includes(file("two.test.ts")),
        )!.inputs,
      ).toContain("outside/input.txt");
    });

  it("resolves baseUrl consumers alongside an already known relative consumer", () => {
    const base = {
      ...snapshot(),
      [file("tsconfig.json")]: '{"compilerOptions":{"baseUrl":"."}}',
      [file("two.test.ts")]: 'import { value } from "leaf";',
    };
    expect(
      members(
        buildValidationPlan(
          registry(),
          [{ path: file("leaf.ts"), status: "modified" }],
          "comparison",
          { base, candidate: base },
        ),
      ),
    ).toEqual([file("one.test.ts"), file("two.test.ts")]);
  });

  it("resolves aliases from the root tsconfig inventory path", () => {
    const r = registry();
    r.impact!.packages[0].root = ".";
    r.impact!.packages[0].testPatterns = ["**/*.test.ts"];
    r.checks[0].cwd = ".";
    const base: Record<string, string> = {
      ...snapshot(),
      "package.json": "{}",
      "tsconfig.json":
        '{"compilerOptions":{"paths":{"leafAlias":["./packages/example/leaf.ts"]}}}',
      [file("two.test.ts")]: 'import {value} from "leafAlias";',
    };
    delete base[file("package.json")];
    expect(
      members(
        buildValidationPlan(
          r,
          [{ path: file("leaf.ts"), status: "modified" }],
          "comparison",
          { base, candidate: base },
        ),
      ),
    ).toEqual([file("one.test.ts"), file("two.test.ts")]);
  });

  for (const source of [
    'await Bun.file("leaf.ts").text();',
    'const {file:read}=Bun; await read("leaf.ts").text();',
    'import {file as read} from "bun"; await read("leaf.ts").text();',
  ])
    it(`retains an unknown Bun reader: ${source}`, () => {
      const base = { ...snapshot(), [file("two.test.ts")]: source };
      const plan = buildValidationPlan(
        registry(),
        [{ path: file("leaf.ts"), status: "modified" }],
        "comparison",
        { base, candidate: base },
      );
      expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
      expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
        "filesystem",
      );
    });

  for (const changed of ["vitest.config.ts", "setup.ts", "config-helper.ts"])
    it(`retains implicit runner members for ${changed} beside a direct inspector`, () => {
      const base = {
        ...snapshot(),
        [file("vitest.config.ts")]:
          'import "./setup"; import "./config-helper"; export default {define:{FLAG:true}};',
        [file("setup.ts")]: "globalThis.FLAG=true;",
        [file("config-helper.ts")]: "export const config=true;",
        [file("one.test.ts")]: `import "./${changed}";`,
        [file("two.test.ts")]:
          "if (FLAG) throw Error('changed runner behavior');",
      };
      expect(
        members(
          buildValidationPlan(
            registry(),
            [{ path: file(changed), status: "modified" }],
            "comparison",
            { base, candidate: base },
          ),
        ),
      ).toEqual([file("one.test.ts"), file("two.test.ts")]);
    });

  it("retains genuine and unknown report readers on a report-only change", () => {
    const r = registry();
    r.checks.push({
      ...r.checks[1],
      id: "docs.build",
      profile: "docs-publishing",
    });
    r.impact!.relationships.push({
      id: "reports",
      kind: "data",
      inputs: ["docs/reports"],
      consumers: [file("docs.ts")],
      publishingChecks: ["docs.build"],
    });
    const base = {
      ...snapshot(),
      [file("docs.ts")]: "export const docs=[];",
      [file("one.test.ts")]: 'import {docs} from "./docs";',
      [file("two.test.ts")]:
        'import fs from "node:fs"; fs.readFileSync(getTarget());',
      "docs/reports/one.html": "hello",
    };
    const plan = buildValidationPlan(
      r,
      [{ path: "docs/reports/one.html", status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
    expect(plan.checks.map((check) => check.id)).toContain("docs.build");
  });

  it("retains implicit members when a literal runner setup file changes", () => {
    const base = {
      ...snapshot(),
      [file("vitest.config.ts")]:
        'export default {test:{setupFiles:"./setup.ts"}};',
      [file("setup.ts")]: "globalThis.FLAG=true;",
      [file("one.test.ts")]: 'import "./setup";',
      [file("two.test.ts")]: "if (FLAG) throw Error('setup changed');",
    };
    expect(
      members(
        buildValidationPlan(
          registry(),
          [{ path: file("setup.ts"), status: "modified" }],
          "comparison",
          { base, candidate: base },
        ),
      ),
    ).toEqual([file("one.test.ts"), file("two.test.ts")]);
  });

  it("pins the actual Storybook reader cross-root input declaration", () => {
    const reader =
      "packages/athena-webapp/src/stories/storybook-config.test.ts";
    const base = {
      "package.json": "{}",
      "packages/athena-webapp/package.json": "{}",
      [reader]: readFileSync(new URL(`../${reader}`, import.meta.url), "utf8"),
      "packages/athena-webapp/.storybook/vite-final.ts":
        "export const createAthenaStorybookViteConfig=()=>({});",
      ".storybook-athena/main.ts": "export default {reactDocgen:false};",
    };
    const r = collectCanonicalValidationRegistry(Object.keys(base));
    const plan = buildValidationPlan(
      r,
      [{ path: reader, status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    const selected = plan.checks.find((check) =>
      check.membership.includes(reader),
    );
    expect(selected).toBeDefined();
    expect(selected!.inputs).toContain(".storybook-athena/main.ts");
  });

  it("does not turn a selected raw-reader test into changed backend runtime input", () => {
    const r = registry(),
      reader = 'import fs from "node:fs"; fs.readFileSync(getPath());';
    const base = {
      ...snapshot(),
      [file("convex/inspect.test.ts")]: reader,
      [file("convex/schema.ts")]: "export default {};",
      [file("convex/unknown.test.ts")]:
        'import {convexTest} from "convex-test"; import schema from "./schema"; const modules=import.meta.glob("./**/*.ts",{eager:true}); convexTest(schema,modules);',
    };
    r.impact!.relationships.push({
      id: "inspect",
      kind: "data",
      inputs: [file("leaf.ts")],
      consumers: [file("convex/inspect.test.ts")],
      boundedConsumers: {
        [file("convex/inspect.test.ts")]: createHash("sha256")
          .update(reader)
          .digest("hex"),
      },
    });
    const plan = buildValidationPlan(
      r,
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([
      file("convex/inspect.test.ts"),
      file("one.test.ts"),
    ]);
    const backend = buildValidationPlan(
      r,
      [{ path: file("convex/schema.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(backend)).toContain(file("convex/unknown.test.ts"));
    const unknown = buildValidationPlan(
      r,
      [{ path: file("convex/unknown.test.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(unknown)).toContain(file("two.test.ts"));
  });

  it("never turns process execution into a data-only filesystem qualification", () => {
    const r = registry(),
      source =
        'import fs from "node:fs"; import {execSync} from "node:child_process"; fs.readFileSync(getPath()); execSync(getCommand());';
    const base = {
      ...snapshot(),
      [file("two.test.ts")]: source,
      "outside/data.json": "{}",
    };
    r.impact!.relationships.push({
      id: "read",
      kind: "data",
      inputs: [file("other.ts")],
      consumers: [file("two.test.ts")],
      boundedConsumers: {
        [file("two.test.ts")]: createHash("sha256")
          .update(source)
          .digest("hex"),
      },
    });
    const plan = buildValidationPlan(
      r,
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
    expect(plan.checks.find((check) => check.id === unit)!.inputs).toContain(
      "outside/data.json",
    );
  });

  it("retains transitive type inputs without treating type imports as runtime execution", () => {
    const r = registry();
    r.checks[1].profile = `${root}:package-types`;
    const base = {
      ...snapshot(),
      [file("leaf.ts")]:
        'import type {Value} from "../shared/types"; export const value = 1;',
      "packages/shared/types.ts": 'export type {Value} from "../other/types";',
      "packages/other/types.ts": "export type Value = string;",
    };
    const plan = buildValidationPlan(
      r,
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(
      plan.checks.find((check) => check.id === unit)!.inputs,
    ).not.toContain("packages/other/types.ts");
    expect(
      plan.checks.find((check) => check.id === "example.types")!.inputs,
    ).toContain("packages/other/types.ts");
  });

  it("partitions genuine publishing consumers from report-independent unit membership", () => {
    const r = registry();
    r.impact!.relationships.push({
      id: "publishing",
      kind: "data",
      inputs: ["docs/reports"],
      consumers: [file("content.ts")],
      publishingChecks: ["example.types"],
    });
    r.surfaces.push({
      id: "publishing",
      pathPrefixes: ["docs/reports"],
      checks: ["example.types"],
      reason: "Publishing",
    });
    const base = {
      ...snapshot(),
      [file("two.test.ts")]: 'import "./leaf"; import "./content";',
      [file("content.ts")]: "export const content = true;",
      "docs/reports/one.html": "one",
    };
    const code = { ...base, [file("leaf.ts")]: "export const value = 3;" };
    const changes = [{ path: file("leaf.ts"), status: "modified" as const }];
    const before = buildValidationPlan(r, changes, "comparison", {
      base,
      candidate: code,
    });
    const after = buildValidationPlan(
      r,
      [...changes, { path: "docs/reports/two.html", status: "added" }],
      "comparison",
      { base, candidate: { ...code, "docs/reports/two.html": "two" } },
    );
    expect(
      before.checks.find((check) => check.id === unit)!.membership,
    ).toEqual([file("one.test.ts")]);
    expect(after.checks.find((check) => check.id === unit)!.identity).toEqual(
      before.checks.find((check) => check.id === unit)!.identity,
    );
    expect(
      after.checks.find((check) => check.id === `${unit}.publishing`)!
        .membership,
    ).toEqual([file("two.test.ts")]);
    expect(
      after.checks.find((check) => check.id === `${unit}.publishing`)!.inputs,
    ).toContain("docs/reports/two.html");
  });

  it("activates a characterized lazy data producer only through its declared runtime consumer", () => {
    const r = registry(),
      producer =
        'import fs from "node:fs"; export function plugin(){ return {load(){ return fs.readFileSync(getPath()); }}; }';
    r.impact!.relationships.push({
      id: "lazy-docs",
      kind: "data",
      inputs: ["docs/reports"],
      consumers: [file("content.ts")],
      lazyProducers: {
        [file("plugin.ts")]: createHash("sha256")
          .update(producer)
          .digest("hex"),
      },
    });
    const base = {
      ...snapshot(),
      [file("plugin.ts")]: producer,
      [file("vitest.config.ts")]:
        'import {plugin} from "./plugin"; export default {plugins:[plugin()]};',
      [file("content.ts")]: 'import {index} from "virtual:docs";',
      "docs/reports/one.html": "one",
    };
    const plan = buildValidationPlan(
      r,
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(
      plan.checks.find((check) => check.id === unit)!.inputs,
    ).not.toContain("docs/reports/one.html");
    const changed = { ...base, [file("one.test.ts")]: 'import "./content";' };
    const contentPlan = buildValidationPlan(
      r,
      [{ path: file("one.test.ts"), status: "modified" }],
      "comparison",
      { base, candidate: changed },
    );
    expect(
      contentPlan.checks.find((check) => check.id === unit)!.inputs,
    ).toContain("docs/reports/one.html");
    const unqualified = {
      ...base,
      [file("plugin.ts")]: producer + "\nexport const changed = true;",
    };
    expect(
      buildValidationPlan(
        r,
        [{ path: file("leaf.ts"), status: "modified" }],
        "comparison",
        { base: unqualified, candidate: unqualified },
      ).checks.find((check) => check.id === unit)!.inputs,
    ).toContain("docs/reports/one.html");
  });

  it("invalidates a style data contract when its guarded configuration changes", () => {
    const r = registry();
    const css = "body { color: red; }",
      config = "export default {};";
    r.impact!.relationships.push({
      id: "style",
      kind: "data",
      inputs: [file("leaf.ts")],
      consumers: [file("style.css")],
      boundedConsumers: {
        [file("style.css")]: createHash("sha256").update(css).digest("hex"),
      },
      guards: {
        [file("tailwind.config.js")]: createHash("sha256")
          .update(config)
          .digest("hex"),
      },
    });
    const base = {
      ...snapshot(),
      [file("style.css")]: css,
      [file("tailwind.config.js")]: config,
    };
    const change = [{ path: file("leaf.ts"), status: "modified" as const }];
    expect(
      members(
        buildValidationPlan(r, change, "comparison", { base, candidate: base }),
      ),
    ).toEqual([file("one.test.ts")]);
    const changed = {
      ...base,
      [file("tailwind.config.js")]: "export default {plugins:[]};",
    };
    expect(
      members(
        buildValidationPlan(r, change, "comparison", {
          base: changed,
          candidate: changed,
        }),
      ),
    ).toEqual([file("one.test.ts"), file("two.test.ts")]);
  });

  it("binds characterized source-inspection reads as byte leaves rather than executing their imports", () => {
    const r = registry();
    const reader = 'import fs from "node:fs"; fs.readFileSync(getPath());';
    const base = {
      ...snapshot(),
      [file("one.test.ts")]: reader,
      [file("leaf.ts")]: 'import "../../docs/reports/one.html";',
      "docs/reports/one.html": "one",
    };
    r.impact!.relationships.push({
      id: "source-inspection",
      kind: "data",
      inputs: [file("leaf.ts")],
      consumers: [file("one.test.ts")],
      boundedConsumers: {
        [file("one.test.ts")]: createHash("sha256")
          .update(reader)
          .digest("hex"),
      },
    });
    const plan = buildValidationPlan(
      r,
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    const check = plan.checks.find((check) => check.id === unit)!;
    expect(check.inputs).toContain(file("leaf.ts"));
    expect(check.inputs).not.toContain("docs/reports/one.html");
    r.impact!.relationships.push({
      id: "publish",
      inputs: ["docs/reports"],
      consumers: [],
      publishingChecks: ["example.types"],
    });
    r.surfaces.push({
      id: "publish",
      pathPrefixes: ["docs/reports"],
      checks: ["example.types"],
      reason: "Publishing",
    });
    const followup = buildValidationPlan(
      r,
      [
        { path: file("other.ts"), status: "modified" },
        { path: "docs/reports/one.html", status: "modified" },
      ],
      "comparison",
      { base, candidate: base },
    );
    expect(members(followup)).toEqual([file("two.test.ts")]);
  });

  it("keeps static unit inputs stable across an accumulated code and report diff", () => {
    const r = registry();
    r.impact!.relationships.push({
      id: "publishing",
      inputs: ["docs/reports"],
      consumers: [file("docs.ts")],
      publishingChecks: ["example.types"],
    });
    r.surfaces.push({
      id: "publishing",
      pathPrefixes: ["docs/reports"],
      checks: ["example.types"],
      reason: "Publishing",
    });
    const base = snapshot();
    const code = { ...base, [file("leaf.ts")]: "export const value = 9;" };
    const changes = [{ path: file("leaf.ts"), status: "modified" as const }];
    const first = buildValidationPlan(r, changes, "comparison", {
      base,
      candidate: code,
    });
    const second = buildValidationPlan(
      r,
      [...changes, { path: "docs/reports/new.html", status: "added" }],
      "comparison",
      { base, candidate: { ...code, "docs/reports/new.html": "report" } },
    );
    expect(second.checks.find((check) => check.id === unit)!.inputs).toEqual(
      first.checks.find((check) => check.id === unit)!.inputs,
    );
    expect(members(second)).toEqual(members(first));
  });

  it("treats a directory URL as an unknown reader rather than imports of every descendant", () => {
    const base = {
      ...snapshot(),
      [file("location.ts")]:
        'export const root = new URL("./", import.meta.url);',
    };
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
      "directory-url",
    );
  });

  it("retains former alias consumers when candidate configuration redirects the edge", () => {
    const base = {
      ...snapshot(),
      [file("tsconfig.json")]:
        '{"compilerOptions":{"paths":{"@value":["./leaf.ts"]}}}',
      [file("one.test.ts")]: 'import {value} from "@value";',
      [file("two.test.ts")]: 'import config from "./tsconfig.json";',
    };
    const candidate = {
      ...base,
      [file("tsconfig.json")]:
        '{"compilerOptions":{"paths":{"@value":["./other.ts"]}}}',
      [file("leaf.ts")]: "export const value = 3;",
    };
    const plan = buildValidationPlan(
      registry(),
      [
        { path: file("leaf.ts"), status: "modified" },
        { path: file("tsconfig.json"), status: "modified" },
      ],
      "comparison",
      { base, candidate },
    );
    expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
    expect(
      plan.checks.flatMap((check) => check.reasons).join(" "),
    ).not.toContain("unresolved-test-consumers");
  });

  it("binds ambiguous workspace export inputs conservatively", () => {
    const base = {
      ...snapshot(),
      [file("barrel.ts")]: 'export {value} from "@shared/value";',
      "packages/first/package.json":
        '{"name":"@shared/value","exports":"./value.ts"}',
      "packages/first/value.ts": "export const value = 1;",
      "packages/second/package.json":
        '{"name":"@shared/value","exports":"./value.ts"}',
      "packages/second/value.ts": "export const value = 2;",
    };
    const plan = buildValidationPlan(
      registry(),
      [{ path: "packages/first/value.ts", status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(plan.checks.find((check) => check.id === unit)!.inputs).toContain(
      "packages/second/value.ts",
    );
  });

  it("binds unknown consumer inputs conservatively beyond its package", () => {
    const base = {
      ...snapshot(),
      [file("two.test.ts")]:
        'import fs from "node:fs"; fs.readFileSync(getTarget());',
      "another-package/data.json": "{}",
    };
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(plan.checks.find((check) => check.id === unit)!.inputs).toContain(
      "another-package/data.json",
    );
  });

  it("falls back when an unsupported loader hides the changed source consumer", () => {
    const base = {
      ...snapshot(),
      [file("one.test.ts")]: 'import Widget from "./Widget.vue";',
      [file("Widget.vue")]: '<script>import {value} from "./leaf";</script>',
    };
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
    expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
      "unresolved-test-consumers",
    );
  });

  it("retains an unknown loader consumer even when another direct consumer is resolved", () => {
    const base = {
      ...snapshot(),
      [file("two.test.ts")]: 'import Widget from "./Widget.vue";',
      [file("Widget.vue")]: '<script>import {value} from "./leaf";</script>',
    };
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
  });

  it("binds complete package inputs when snapshots accompany full-health planning", () => {
    const base = snapshot();
    const plan = buildValidationPlan(registry(), [], "full-health", {
      base,
      candidate: base,
    });
    expect(
      plan.checks.every((check) => check.inputs.includes(file("other.ts"))),
    ).toBe(true);
  });

  it("keeps publishing data out of package typecheck input declarations", () => {
    const r = registry();
    r.checks[1].profile = `${root}:package-types`;
    const base = {
      ...snapshot(),
      [file("other.ts")]:
        'export const docs = import.meta.glob("../../docs/reports/*.html");',
      "docs/reports/one.html": "one",
    };
    const plan = buildValidationPlan(
      r,
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(
      plan.checks.find((check) => check.id === "example.types")!.inputs,
    ).not.toContain("docs/reports/one.html");
  });

  it("rejects omitted changed source paths and inconsistent semantic statuses", () => {
    const base = snapshot(),
      candidate = { ...base, [file("barrel.ts")]: "export const value = 9;" };
    expect(() =>
      buildValidationPlan(
        registry(),
        [{ path: file("leaf.ts"), status: "modified" }],
        "comparison",
        { base, candidate },
      ),
    ).toThrow("undeclared");
    expect(() =>
      buildValidationPlan(
        registry(),
        [{ path: file("leaf.ts"), status: "deleted" }],
        "comparison",
        { base, candidate: base },
      ),
    ).toThrow("status");
  });

  it("keeps deleted tests from silently removing the containing test obligation", () => {
    const base = snapshot(),
      candidate = { ...base };
    delete candidate[file("one.test.ts")];
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("one.test.ts"), status: "deleted" }],
      "comparison",
      { base, candidate },
    );
    expect(members(plan)).toEqual([file("two.test.ts")]);
    expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
      "removed-test",
    );
  });

  it("resolves assets expressed with new URL relative to the importing module", () => {
    const base = {
      ...snapshot(),
      [file("one.test.ts")]:
        'const asset = new URL("./picture.svg", import.meta.url);',
      [file("picture.svg")]: "<svg/>",
    };
    expect(
      members(
        buildValidationPlan(
          registry(),
          [{ path: file("picture.svg"), status: "modified" }],
          "comparison",
          { base, candidate: base },
        ),
      ),
    ).toEqual([file("one.test.ts")]);
  });

  it("qualifies bounded filesystem consumers against the exact characterized source", () => {
    const r = registry(),
      source =
        'import fs from "node:fs"; export const docs = () => fs.readFileSync(getDocPath());';
    r.impact!.relationships.push({
      id: "docs-reader",
      inputs: ["docs/reports"],
      consumers: [file("docs.ts")],
      boundedConsumers: {
        [file("docs.ts")]: createHash("sha256").update(source).digest("hex"),
      },
    });
    const base = { ...snapshot(), [file("docs.ts")]: source };
    const changes = [{ path: file("leaf.ts"), status: "modified" as const }];
    expect(
      members(
        buildValidationPlan(r, changes, "comparison", {
          base,
          candidate: base,
        }),
      ),
    ).toEqual([file("one.test.ts")]);
    const changedSource = {
      ...base,
      [file("docs.ts")]: `${source}\nexport const changed = true;`,
    };
    expect(
      members(
        buildValidationPlan(r, changes, "comparison", {
          base: changedSource,
          candidate: changedSource,
        }),
      ),
    ).toEqual([file("one.test.ts"), file("two.test.ts")]);
  });

  it("uses declared package ownership rather than cwd for package input scope", () => {
    const r = registry();
    r.checks[1].cwd = ".";
    r.checks[1].profile = `${root}:package-types`;
    const base = { ...snapshot(), "docs/reports/unrelated.html": "report" };
    const plan = buildValidationPlan(
      r,
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    const inputs = plan.checks.find(
      (check) => check.id === "example.types",
    )!.inputs;
    expect(inputs).toContain(file("other.ts"));
    expect(inputs).not.toContain("docs/reports/unrelated.html");
  });

  it("binds publishing checks to the corpus and publishing implementation", () => {
    const r = registry();
    r.checks.push({
      ...r.checks[1],
      id: "docs.build",
      profile: "docs-publishing",
    });
    r.impact!.relationships.push({
      id: "docs-publishing",
      inputs: ["docs/reports"],
      consumers: [file("docs.ts")],
      publishingChecks: ["docs.build"],
    });
    const base = {
      ...snapshot(),
      [file("docs.ts")]: "export const docs = [];",
      "docs/reports/one.html": "one",
      "docs/reports/two.html": "two",
    };
    const plan = buildValidationPlan(
      r,
      [{ path: "docs/reports/one.html", status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(plan.checks[0].inputs).toEqual(
      expect.arrayContaining([
        file("docs.ts"),
        "docs/reports/one.html",
        "docs/reports/two.html",
      ]),
    );
  });

  it("retains prerequisite definitions outside directly affected surfaces", () => {
    const r = registry();
    r.checks[0].prerequisites = ["setup"];
    r.checks.push({ ...r.checks[1], id: "setup", profile: "setup" });
    const base = snapshot();
    const plan = buildValidationPlan(
      r,
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(plan.checks.map((check) => check.id)).toContain("setup");
  });

  it("retains package-wide source inputs for package-wide checks", () => {
    const base = snapshot();
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(
      plan.checks.find((check) => check.id === "example.types")?.inputs,
    ).toContain(file("other.ts"));
  });

  it("blocks malformed snapshot values before dependency parsing", () => {
    const base = snapshot();
    expect(() =>
      buildValidationPlan(
        registry(),
        [{ path: file("leaf.ts"), status: "modified" }],
        "comparison",
        {
          base,
          candidate: { ...base, [file("other.ts")]: 123 } as unknown as Record<
            string,
            string
          >,
        },
      ),
    ).toThrow("snapshot");
  });

  it("rejects corrupt impact policy even in full-health mode", () => {
    const r = registry();
    r.impact!.packages[0].fallbackChecks = ["missing"];
    expect(() => buildValidationPlan(r, [], "full-health")).toThrow("fallback");
  });

  it("declares Athena publishing, generated routes and Convex runtime contracts", () => {
    const r = collectCanonicalValidationRegistry([]);
    expect(r.impact?.relationships.map((contract) => contract.id)).toEqual(
      expect.arrayContaining([
        "docs-publishing",
        "route-registration",
        "convex-schema-tables",
        "convex-function-admission",
        "convex-generated-api",
      ]),
    );
    expect(r.impact?.packages.map((pkg) => pkg.root)).toContain(
      "packages/athena-webapp",
    );
  });

  it("accepts snapshots through the existing read-only CLI and emits the canonical plan", async () => {
    const temp = await mkdtemp(join(tmpdir(), "athena-impact-cli-"));
    try {
      const base = snapshot(),
        logs: string[] = [];
      const path = join(temp, "request.json");
      await writeFile(
        path,
        JSON.stringify({
          mode: "comparison",
          changes: [{ path: file("leaf.ts"), status: "modified" }],
          inventory: Object.keys(base),
          registry: registry(),
          snapshots: { base, candidate: base },
        }),
      );
      await runValidationPlanCli(["--input", path, "--json"], (line) =>
        logs.push(line),
      );
      const plan = JSON.parse(logs[0]);
      expect(members(plan)).toEqual([file("one.test.ts")]);
      expect(plan.schemaVersion).toBe("athena-validation-plan/1");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  const convexFixture = (
    glob = 'import.meta.glob("./convex/**/*.ts")',
    reference = "api.leaf.read",
  ) => ({
    ...snapshot(),
    [file("package.json")]:
      '{"name":"example","devDependencies":{"convex-test":"1"}}',
    [file("one.test.ts")]:
      `import { convexTest } from "convex-test"; import { api } from "./convex/_generated/api"; import schema from "./convex/schema"; const modules = ${glob}; const t = convexTest(schema, modules); await t.query(${reference});`,
    [file("two.test.ts")]:
      'import { convexTest } from "convex-test"; import { api } from "./convex/_generated/api"; import schema from "./convex/schema"; const modules = import.meta.glob("./convex/**/*.ts"); const t = convexTest(schema, modules); await t.query(api.other.read);',
    [file("convex/_generated/api.ts")]: "export const api = {};",
    [file("convex/schema.ts")]: "export default {};",
    [file("convex/leaf.ts")]: "export const read = 1;",
    [file("convex/other.ts")]: "export const read = 2;",
  });

  for (const declaration of [
    "function build(convexTest)",
    "function build(api)",
  ])
    it(`does not qualify shadowed Convex import bindings: ${declaration}`, () => {
      const base = convexFixture();
      base[file("one.test.ts")] =
        `import {convexTest} from "convex-test"; import {api} from "./convex/_generated/api"; import schema from "./convex/schema"; ${declaration} { const modules=import.meta.glob("./convex/**/*.ts"); const t=convexTest(schema,modules); return t.query(api.leaf.read); }`;
      const plan = buildValidationPlan(
        registry(),
        [{ path: file("convex/other.ts"), status: "modified" }],
        "comparison",
        { base, candidate: base },
      );
      expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
      expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
        "unqualified-convex",
      );
    });

  it("characterizes a lazy Convex registry with literal function references", () => {
    const base = convexFixture();
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("convex/leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts")]);
    expect(plan.checks.find((check) => check.id === unit)?.inputs).toContain(
      file("convex/leaf.ts"),
    );
  });

  it("does not qualify arbitrary context callbacks beside a literal Convex reference", () => {
    const base = convexFixture();
    base[file("one.test.ts")] += " await t.run(ctx => invokeUnknown(ctx));";
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("convex/other.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
    expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
      "unqualified-convex-call",
    );
  });

  for (const [name, glob, reference] of [
    [
      "eager",
      'import.meta.glob("./convex/**/*.ts", {eager:true})',
      "api.leaf.read",
    ],
    [
      "wrapped",
      'Object.fromEntries(Object.entries(import.meta.glob("./convex/**/*.ts")))',
      "api.leaf.read",
    ],
    [
      "computed",
      'import.meta.glob("./convex/**/*.ts")',
      "api[dynamicName].read",
    ],
  ])
    it(`falls back for ${name} Convex dependencies`, () => {
      const base = convexFixture(glob, reference);
      const plan = buildValidationPlan(
        registry(),
        [{ path: file("convex/leaf.ts"), status: "modified" }],
        "comparison",
        { base, candidate: base },
      );
      expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
      expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
        "Fallback",
      );
    });

  it("selects a newly added test absent from the previous registered membership", () => {
    const base = snapshot(),
      candidate = {
        ...base,
        [file("new.test.ts")]: 'import { value } from "./leaf";',
      };
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("new.test.ts"), status: "added" }],
      "comparison",
      { base, candidate },
    );
    expect(members(plan)).toEqual([file("new.test.ts")]);
  });

  it("resolves literal dynamic imports and imported assets", () => {
    const base = {
      ...snapshot(),
      [file("one.test.ts")]: 'await import("./lazy");',
      [file("lazy.ts")]: 'import text from "./text.txt?raw";',
      [file("text.txt")]: "hello",
    };
    expect(
      members(
        buildValidationPlan(
          registry(),
          [{ path: file("text.txt"), status: "modified" }],
          "comparison",
          { base, candidate: base },
        ),
      ),
    ).toEqual([file("one.test.ts")]);
  });

  it("retains an unknown report consumer while excluding a proven unrelated test", () => {
    const r = registry();
    r.checks.push({
      ...r.checks[1],
      id: "docs.build",
      profile: "docs-publishing",
    });
    r.impact!.relationships.push({
      id: "docs-publishing",
      inputs: ["docs/reports"],
      consumers: [file("docs.ts")],
      publishingChecks: ["docs.build"],
    });
    const base = {
      ...snapshot(),
      [file("two.test.ts")]: "await import(getTarget());",
      [file("docs.ts")]:
        'export const docs = import.meta.glob("../../docs/reports/*.html");',
      "docs/reports/example.html": "hello",
    };
    const plan = buildValidationPlan(
      r,
      [{ path: "docs/reports/example.html", status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("two.test.ts")]);
    expect(plan.checks.map((check) => check.id)).toContain("docs.build");
  });

  it("blocks unsupported input without a containing surface even beside covered input", () => {
    const base = { ...snapshot(), "unrelated.bin": "binary" };
    expect(() =>
      buildValidationPlan(
        registry(),
        [
          { path: file("leaf.ts"), status: "modified" },
          { path: "unrelated.bin", status: "modified" },
        ],
        "comparison",
        { base, candidate: base },
      ),
    ).toThrow("unrelated.bin");
  });

  it("resolves workspace exports and JSONC aliases in each snapshot", () => {
    const base = {
      ...snapshot(),
      [file("tsconfig.json")]:
        '{/* alias */ "compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}',
      [file("one.test.ts")]: 'import { value } from "@/barrel";',
      [file("barrel.ts")]: 'export { value } from "@example/shared/value";',
      "packages/shared/package.json":
        '{"name":"@example/shared","exports":{"./value":"./value.ts"}}',
      "packages/shared/value.ts": "export const value = 1;",
    };
    const plan = buildValidationPlan(
      registry(),
      [{ path: "packages/shared/value.ts", status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts")]);
  });

  it("broadens computed dependencies to the declared containing suite", () => {
    const base = {
      ...snapshot(),
      [file("two.test.ts")]:
        "const target = getTarget(); await import(target);",
    };
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts"), file("two.test.ts")]);
    expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
      "computed-import",
    );
  });

  it("blocks a changed input absent from both snapshots even beside a covered input", () => {
    const base = snapshot();
    expect(() =>
      buildValidationPlan(
        registry(),
        [
          { path: file("leaf.ts"), status: "modified" },
          { path: "unknown.bin", status: "added" },
        ],
        "comparison",
        { base, candidate: base },
      ),
    ).toThrow("snapshot");
  });

  it("rejects a corrupt fallback declaration before selecting tests", () => {
    const r = registry();
    r.impact!.packages[0].fallbackChecks = ["missing.check"];
    const base = snapshot();
    expect(() =>
      buildValidationPlan(
        r,
        [{ path: file("leaf.ts"), status: "modified" }],
        "comparison",
        { base, candidate: base },
      ),
    ).toThrow("fallback");
  });

  it("traverses explicit producer-consumer contracts", () => {
    const r = registry();
    r.impact!.relationships = [
      {
        id: "generated",
        inputs: ["generated/input.json"],
        consumers: [file("barrel.ts")],
      },
    ];
    const base = { ...snapshot(), "generated/input.json": "{}" };
    const plan = buildValidationPlan(
      r,
      [{ path: "generated/input.json", status: "modified" }],
      "comparison",
      { base, candidate: base },
    );
    expect(members(plan)).toEqual([file("one.test.ts")]);
    expect(plan.checks.flatMap((check) => check.reasons).join(" ")).toContain(
      "generated",
    );
  });

  it("selects reverse re-export consumers and retains package-wide typechecking", () => {
    const base = snapshot(),
      candidate = { ...base, [file("leaf.ts")]: "export const value = 3;" };
    const plan = buildValidationPlan(
      registry(),
      [{ path: file("leaf.ts"), status: "modified" }],
      "comparison",
      { base, candidate },
    );
    expect(members(plan)).toEqual([file("one.test.ts")]);
    expect(plan.checks.some((check) => check.id === "example.types")).toBe(
      true,
    );
    expect(plan.checks.find((check) => check.id === unit)?.inputs).toContain(
      file("barrel.ts"),
    );
    expect(plan.authority).toBe("legacy-gate");
    expect(plan.evidence).toBe("not-evaluated");
  });

  it("retains former consumers when the candidate removes the dependency edge", () => {
    const base = snapshot(),
      candidate = { ...base, [file("barrel.ts")]: "export const value = 0;" };
    const plan = buildValidationPlan(
      registry(),
      [
        { path: file("leaf.ts"), status: "modified" },
        { path: file("barrel.ts"), status: "modified" },
      ],
      "comparison",
      { base, candidate },
    );
    expect(members(plan)).toEqual([file("one.test.ts")]);
  });

  it("retains both rename paths and records the deleted implementation as absent", () => {
    const base = snapshot(),
      candidate = {
        ...base,
        [file("renamed.ts")]: base[file("leaf.ts")],
        [file("barrel.ts")]: 'export { value } from "./renamed";',
      };
    delete candidate[file("leaf.ts")];
    const plan = buildValidationPlan(
      registry(),
      [
        {
          path: file("renamed.ts"),
          oldPath: file("leaf.ts"),
          status: "renamed",
        },
        { path: file("barrel.ts"), status: "modified" },
      ],
      "comparison",
      { base, candidate },
    );
    expect(members(plan)).toEqual([file("one.test.ts")]);
    expect(
      plan.checks.find((check) => check.id === unit)?.absentInputs,
    ).toContain(file("leaf.ts"));
    expect(
      plan.changes.find((change) => change.status === "renamed")?.oldPath,
    ).toBe(file("leaf.ts"));
  });

  it("does not narrow full-health membership", () => {
    const base = snapshot();
    expect(
      members(
        buildValidationPlan(registry(), [], "full-health", {
          base,
          candidate: base,
        }),
      ),
    ).toEqual([file("one.test.ts"), file("two.test.ts")]);
  });
});
