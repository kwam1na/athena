import { fileURLToPath } from "node:url";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validationCheckCommand } from "./harness-validation-command";
import { characterizedRootTypecheckWorkspace } from "./harness-repo-validation";
import { assertLandedChangeReportCheck } from "./landed-change-report-check";
import type { CanonicalValidationCheck } from "./harness-app-registry";

const check = (
  fields: Partial<CanonicalValidationCheck>,
): CanonicalValidationCheck => ({
  id: "test",
  profile: "command",
  argv: ["bun", "run", "audit"],
  cwd: ".",
  membership: [],
  inputs: [],
  absentInputs: [],
  prerequisites: [],
  supersedes: [],
  ...fields,
});

describe("canonical validation command projection", () => {
  it("runs real base-aware checks when only the private pinned base exists", () => {
    const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
    const root = mkdtempSync(join(tmpdir(), "athena-private-base-"));
    const env = {
      ...process.env,
      CONVEX_LINT_BASE_REF: "",
      FRONTEND_LINT_BASE_REF: "",
      DELIVERY_CHECK_BASE_REF: "refs/delivery/base",
      HARNESS_INFERENTIAL_SEMANTIC_MODE: "off",
    };
    const run = (argv: string[]) => Bun.spawnSync(argv, { cwd: root, env });
    const git = (...args: string[]) => {
      const result = run(["git", ...args]);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      return result.stdout.toString().trim();
    };
    try {
      const packageRoot = join(root, "packages/athena-webapp");
      mkdirSync(join(packageRoot, "scripts"), { recursive: true });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ private: true, workspaces: ["packages/*"] }),
      );
      const scripts: Record<string, string> = {};
      for (const kind of ["convex", "frontend"]) {
        const file = `${kind}-lint-changed.sh`;
        copyFileSync(
          join(sourceRoot, "packages/athena-webapp/scripts", file),
          join(packageRoot, "scripts", file),
        );
        scripts[`lint:${kind}:changed`] = `bash ./scripts/${file}`;
      }
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({ name: "@athena/webapp", scripts }),
      );
      git("init", "-q", "--initial-branch=fixture");
      git("add", ".");
      const tree = git("write-tree");
      const head = git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit-tree",
        tree,
        "-m",
        "fixture",
      );
      git("update-ref", "HEAD", head);
      git("update-ref", "refs/delivery/base", head);
      expect(
        run(["git", "rev-parse", "--verify", "origin/main"]).exitCode,
      ).not.toBe(0);
      for (const kind of ["convex", "frontend"]) {
        const argv = [
          "/bin/sh",
          "-c",
          `bun run --filter '@athena/webapp' lint:${kind}:changed`,
        ];
        expect(run(argv).exitCode).not.toBe(0);
        const projected = run(validationCheckCommand(check({ argv })));
        expect(projected.exitCode, projected.stderr.toString()).toBe(0);
        expect(projected.stdout.toString()).toContain("refs/delivery/base");
      }
      expect(() => assertLandedChangeReportCheck(root)).toThrow("origin/main");
      expect(() =>
        assertLandedChangeReportCheck(root, { baseRef: "refs/delivery/base" }),
      ).not.toThrow();
      for (const file of ["harness-inferential-review.ts"]) {
        const argv = ["bun", join(sourceRoot, "scripts", file)];
        expect(run(argv).exitCode).not.toBe(0);
        const pinned = run([
          ...argv,
          "--base",
          "origin/main",
          "--base",
          "refs/delivery/base",
        ]);
        expect(pinned.exitCode, pinned.stderr.toString()).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("pins base-aware root scripts to the private snapshot base", () => {
    for (const [name, script] of [
      [
        "landed-report:check",
        "bun scripts/landed-change-report-check.ts --base origin/main",
      ],
      [
        "harness:inferential-review",
        "bun scripts/harness-inferential-review.ts",
      ],
    ]) {
      for (const argv of [
        ["bun", "run", name],
        ["/bin/sh", "-c", `bun run ${name}`],
      ]) {
        expect(
          validationCheckCommand(check({ argv }), {
            packageScripts: { [name]: script },
          }),
        ).toEqual(["bun", "run", name, "--base", "refs/delivery/base"]);
        expect(() =>
          validationCheckCommand(check({ argv }), {
            packageScripts: { [name]: `${script} --base other` },
          }),
        ).toThrow("Uncharacterized");
      }
    }
  });
  it("pins changed-file lint to the private base without changing the authored script", () => {
    for (const [script, variable] of [
      ["lint:convex:changed", "CONVEX_LINT_BASE_REF"],
      ["lint:frontend:changed", "FRONTEND_LINT_BASE_REF"],
    ]) {
      const command = `bun run --filter '@athena/webapp' ${script}`;
      expect(
        validationCheckCommand(check({ argv: ["/bin/sh", "-c", command] })),
      ).toEqual(["/bin/sh", "-c", `${variable}=refs/delivery/base ${command}`]);
      const extra = ["/bin/sh", "-c", `${command} --other`];
      expect(validationCheckCommand(check({ argv: extra }))).toEqual(extra);
    }
  });
  it("makes root membership explicit instead of executing an implicit suite", () => {
    expect(
      validationCheckCommand(
        check({
          argv: ["/bin/sh", "-c", "bun run harness:test"],
          membership: ["scripts/b.test.ts", "scripts/a.test.ts"],
        }),
      ),
    ).toEqual([
      "bun",
      "run",
      "harness:test",
      "--test-file",
      "scripts/a.test.ts",
      "--test-file",
      "scripts/b.test.ts",
    ]);
  });
  it("uses package-relative exact files for characterized unit commands", () => {
    expect(
      validationCheckCommand(
        check({
          argv: ["bun", "run", "test", "--"],
          cwd: "packages/athena-webapp",
          profile: "packages/athena-webapp:unit",
          membership: ["packages/athena-webapp/src/a.test.ts"],
        }),
        { packageScripts: { test: "vitest run --maxWorkers=4" } },
      ),
    ).toEqual([
      "node",
      "../../scripts/harness-vitest-membership.mjs",
      "--test-file",
      "src/a.test.ts",
      "--max-workers",
      "4",
    ]);
  });
  it("retains storefront worker defaults while selecting exact members", () => {
    expect(
      validationCheckCommand(
        check({
          argv: ["bun", "run", "test", "--"],
          cwd: "packages/storefront-webapp",
          profile: "packages/storefront-webapp:unit",
          membership: ["packages/storefront-webapp/src/a.test.ts"],
        }),
        { packageScripts: { test: "vitest run" } },
      ),
    ).toEqual([
      "node",
      "../../scripts/harness-vitest-membership.mjs",
      "--test-file",
      "src/a.test.ts",
    ]);
  });
  it("refuses changed or unavailable authored scripts rather than dropping their semantics", () => {
    for (const packageTestCommand of [
      undefined,
      "vitest run --coverage",
      "vitest run --maxWorkers=2",
    ]) {
      expect(() =>
        validationCheckCommand(
          check({
            argv: ["bun", "run", "test", "--"],
            cwd: "packages/athena-webapp",
            profile: "packages/athena-webapp:unit",
            membership: ["packages/athena-webapp/src/a.test.ts"],
          }),
          { packageScripts: { test: packageTestCommand } },
        ),
      ).toThrow("Uncharacterized");
    }
  });
  it("refuses unit lifecycle hooks that exact execution would bypass", () => {
    for (const hook of ["pretest", "posttest"]) {
      expect(() =>
        validationCheckCommand(
          check({
            argv: ["bun", "run", "test", "--"],
            cwd: "packages/athena-webapp",
            profile: "packages/athena-webapp:unit",
            membership: ["packages/athena-webapp/src/a.test.ts"],
          }),
          {
            packageScripts: {
              test: "vitest run --maxWorkers=4",
              [hook]: "bun scripts/setup.ts",
            },
          },
        ),
      ).toThrow("Uncharacterized");
    }
  });
  it("refuses empty unit membership rather than letting the runner discover all tests", () => {
    expect(() =>
      validationCheckCommand(
        check({
          argv: ["bun", "run", "test", "--"],
          cwd: "packages/athena-webapp",
          profile: "packages/athena-webapp:unit",
        }),
      ),
    ).toThrow("membership");
  });
  it("refuses a unit member outside its declared package", () => {
    expect(() =>
      validationCheckCommand(
        check({
          argv: ["bun", "run", "test", "--"],
          cwd: "packages/athena-webapp",
          profile: "packages/athena-webapp:unit",
          membership: ["packages/storefront-webapp/src/a.test.ts"],
        }),
        { packageScripts: { test: "vitest run" } },
      ),
    ).toThrow("membership");
  });
  it("preserves opaque commands and coverage semantics", () => {
    const argv = ["/bin/sh", "-c", "bun run test:coverage"];
    expect(
      validationCheckCommand(
        check({
          argv,
          membership: ["scripts/a.test.ts"],
          profile: ".:aggregate-coverage",
        }),
      ),
    ).toEqual(argv);
  });
});

describe("guarded package build pipeline", () => {
  const scripts = {
    build: "vite build && tsc --noEmit",
    "build:assets": "vite build",
    typecheck: "tsc --noEmit",
  };
  for (const cwd of ["packages/athena-webapp", "packages/storefront-webapp"]) {
    for (const [profile, script] of [
      ["package-build", "build:assets"],
      ["package-types", "typecheck"],
    ]) {
      const pipeline = check({
        cwd,
        profile: `${cwd}:${profile}`,
        argv: ["bun", "run", script],
      });
      it(`projects ${cwd} ${script} only with exact captured pipeline semantics`, () => {
        const manifest = JSON.parse(
          readFileSync(
            new URL(`../${cwd}/package.json`, import.meta.url),
            "utf8",
          ),
        );
        expect(
          validationCheckCommand(pipeline, {
            packageScripts: manifest.scripts,
          }),
        ).toEqual(pipeline.argv);
        expect(() =>
          validationCheckCommand(
            { ...pipeline, argv: ["bun", "run", "build"] },
            { packageScripts: scripts },
          ),
        ).toThrow("Uncharacterized");
        expect(
          validationCheckCommand(pipeline, { packageScripts: scripts }),
        ).toEqual(pipeline.argv);
        for (const packageScripts of [
          undefined,
          {},
          { ...scripts, build: "vite build && tsc" },
          { ...scripts, "build:assets": "vite build --mode custom" },
          { ...scripts, typecheck: "tsc --noEmit --skipLibCheck" },
          { ...scripts, pretypecheck: "prepare-types" },
          { ...scripts, "postbuild:assets": "extra-check" },
        ]) {
          expect(() =>
            validationCheckCommand(pipeline, { packageScripts }),
          ).toThrow("Uncharacterized");
        }
      });
    }
  }
  it("does not decompose an opaque legacy combined build", () => {
    const legacy = check({
      argv: ["/bin/sh", "-c", "bun run --filter @athena/webapp build"],
    });
    expect(validationCheckCommand(legacy)).toEqual(legacy.argv);
  });
});

describe("exact root typecheck characterization", () => {
  for (const [app, workspace] of [
    ["athena-webapp", "@athena/webapp"],
    ["storefront-webapp", "@athena/storefront-webapp"],
  ]) {
    const raw = `bunx tsc --noEmit -p packages/${app}/tsconfig.json`;
    it(`shares only the exact ${app} config invocation`, () => {
      expect(characterizedRootTypecheckWorkspace(raw)).toBe(workspace);
      for (const other of [
        raw + " --skipLibCheck",
        raw + " --noEmit false",
        raw + " && echo passed",
        raw + " || true",
        raw.replace("--noEmit", "--build"),
        raw.replace("tsconfig.json", "tsconfig.node.json"),
        `cd packages/${app} && bunx tsc --noEmit`,
        "bunx tsc --noEmit -p packages/unknown/tsconfig.json",
      ]) {
        expect(characterizedRootTypecheckWorkspace(other)).toBeUndefined();
        const opaque = check({ argv: ["/bin/sh", "-c", other] });
        expect(validationCheckCommand(opaque)).toEqual(opaque.argv);
      }
    });
    it(`resolves the same effective compiler config for root -p and ${app} cwd`, () => {
      const root = fileURLToPath(new URL("../", import.meta.url));
      const explicit = Bun.spawnSync(
        [
          "bun",
          "x",
          "--no-install",
          "tsc",
          "--noEmit",
          "-p",
          `packages/${app}/tsconfig.json`,
          "--showConfig",
        ],
        { cwd: root },
      );
      const implicit = Bun.spawnSync(
        ["bun", "run", "typecheck", "--showConfig"],
        { cwd: `${root}packages/${app}` },
      );
      expect(explicit.exitCode).toBe(0);
      expect(implicit.exitCode).toBe(0);
      expect(JSON.parse(implicit.stdout.toString())).toEqual(
        JSON.parse(explicit.stdout.toString()),
      );
    });
  }
});

it("recognizes exact canonical preparation checks without accepting extra shell behavior", async () => {
  const { isMechanicalValidationCheck } =
    await import("./harness-validation-command");
  const declared = {
    id: "mechanical",
    cwd: ".",
    profile: "command",
    argv: [
      "/bin/sh",
      "-c",
      "bun run --filter '@athena/webapp' lint:convex:changed",
    ],
    membership: [],
    inputs: [],
    absentInputs: [],
    prerequisites: [],
    supersedes: [],
  };
  expect(isMechanicalValidationCheck(declared)).toBe(true);
  expect(
    isMechanicalValidationCheck({
      ...declared,
      argv: [...declared.argv.slice(0, 2), declared.argv[2] + " || true"],
    }),
  ).toBe(false);
  expect(
    isMechanicalValidationCheck({
      ...declared,
      cwd: "packages/storefront-webapp",
      profile: "packages/storefront-webapp:package-types",
      argv: ["bun", "run", "typecheck"],
    }),
  ).toBe(true);
  expect(
    isMechanicalValidationCheck({
      ...declared,
      argv: [
        "/bin/sh",
        "-c",
        "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
      ],
    }),
  ).toBe(true);
});
