import { describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const modules = dirname(dirname(require.resolve("vitest/package.json")));
const runner = resolve(import.meta.dir, "harness-vitest-membership.mjs");

async function fixture(run: (root: string) => Promise<void>) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "athena-vitest-membership-")),
  );
  try {
    await symlink(modules, join(root, "node_modules"), "dir");
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      join(root, "vitest.config.ts"),
      `
      import { defineConfig } from 'vitest/config';
      import { writeFileSync } from 'node:fs';
      export default defineConfig({
        cacheDir: './.cache',
        plugins: [{name:'membership-control',resolveId(id){if(id==='virtual:control')return '\\0control'},load(id){if(id==='\\0control')return 'export default 17'}}],
        test: {include:['src/**/*.test.ts','nested/**/*.test.ts'],setupFiles:['./setup.ts'],maxWorkers:1,provide:{configured:true},reporters:['json',{onInit(ctx){writeFileSync('worker.json',JSON.stringify({maxWorkers:ctx.config.maxWorkers}))}}],outputFile:'./result.json'}
      });
    `,
    );
    await writeFile(join(root, "setup.ts"), "globalThis.membershipSetup = 23;");
    for (const path of [
      "src/a.test.ts",
      "src/a.test.ts.extra.test.ts",
      "nested/src/a.test.ts",
    ]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(
        join(root, path),
        `
        import {test,expect,inject} from 'vitest';
        import value from 'virtual:control';
        test(${JSON.stringify(path)},()=>{expect(value).toBe(17);expect(globalThis.membershipSetup).toBe(23);expect(inject('configured')).toBe(true)});
      `,
      );
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function execute(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  executable = runner,
) {
  // Match Vitest's Node shebang, not Bun's direct interpreter.
  const child = Bun.spawn(["node", executable, ...args], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: stdout + stderr };
}

describe("exact Vitest membership", () => {
  it("keeps result caching private to the fixture instead of shared dependencies", async () =>
    fixture(async (root) => {
      const results =
        "vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json";
      const shared = join(modules, ".vite", results);
      const before = await Bun.file(shared).exists()
        ? await readFile(shared, "utf8")
        : null;
      const result = await execute(root, ["--test-file", "src/a.test.ts"]);
      expect(result.code, result.output).toBe(0);
      const after = await Bun.file(shared).exists()
        ? await readFile(shared, "utf8")
        : null;
      expect(after).toBe(before);
      expect(await Bun.file(join(root, ".cache", results)).exists()).toBe(true);
    }));

  for (const nodeEnv of [undefined, "production", ""]) {
    it(
      `matches CLI bootstrap before config and in workers with NODE_ENV=${JSON.stringify(nodeEnv)}`,
      async () =>
        fixture(async (root) => {
          const env: NodeJS.ProcessEnv = {
            ...process.env,
            TEST: "false",
            VITEST: "0",
          };
          if (nodeEnv === undefined) {
            delete env.TEST;
            delete env.VITEST;
          }
          delete env.NODE_ENV;
          if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
          await writeFile(
            join(root, "vitest.config.ts"),
            `import {defineConfig} from 'vitest/config';
          import {writeFileSync} from 'node:fs';
          writeFileSync('bootstrap.json',JSON.stringify({TEST:process.env.TEST,VITEST:process.env.VITEST,NODE_ENV:process.env.NODE_ENV}));
          export default defineConfig({cacheDir:'./.cache',test:{include:['src/a.test.ts'],maxWorkers:1}});`,
          );
          await writeFile(
            join(root, "src/a.test.ts"),
            `import {test} from 'vitest';import {writeFileSync} from 'node:fs';
          test('environment',()=>writeFileSync('environment.json',JSON.stringify({TEST:process.env.TEST,VITEST:process.env.VITEST,NODE_ENV:process.env.NODE_ENV,DEV:import.meta.env.DEV,PROD:import.meta.env.PROD,MODE:import.meta.env.MODE})));`,
          );
          const cli = await execute(
            root,
            ["run", "src/a.test.ts"],
            env,
            join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
          );
          expect(cli.code, cli.output).toBe(0);
          const cliBootstrap = JSON.parse(
            await readFile(join(root, "bootstrap.json"), "utf8"),
          );
          const cliEnvironment = JSON.parse(
            await readFile(join(root, "environment.json"), "utf8"),
          );
          expect(cliBootstrap.TEST).toBe("true");
          expect(cliBootstrap.VITEST).toBe("true");
          if (nodeEnv !== "")
            expect(cliBootstrap.NODE_ENV).toBe(nodeEnv ?? "test");
          await rm(join(root, "bootstrap.json"));
          await rm(join(root, "environment.json"));
          const actual = await execute(
            root,
            ["--test-file", "src/a.test.ts"],
            env,
          );
          expect(actual.code, actual.output).toBe(0);
          expect(
            JSON.parse(await readFile(join(root, "bootstrap.json"), "utf8")),
          ).toEqual(cliBootstrap);
          expect(
            JSON.parse(await readFile(join(root, "environment.json"), "utf8")),
          ).toEqual(cliEnvironment);
        }),
      15000,
    );
  }

  for (const workers of [[], ["--max-workers", "4"]]) {
    it(`executes only the exact file with configuration and worker override ${workers.join(" ") || "inherited"}`, async () =>
      fixture(async (root) => {
        const result = await execute(root, [
          "--test-file",
          "src/a.test.ts",
          ...workers,
        ]);
        expect(result.code).toBe(0);
        const report = JSON.parse(
          await readFile(join(root, "result.json"), "utf8"),
        );
        expect(report.numTotalTests).toBe(1);
        expect(
          report.testResults.map((test: { name: string }) => test.name),
        ).toEqual([join(root, "src/a.test.ts")]);
        expect(report.success).toBe(true);
        expect(
          JSON.parse(await readFile(join(root, "worker.json"), "utf8"))
            .maxWorkers,
        ).toBe(workers.length ? 4 : 1);
      }));
  }

  it("propagates a selected assertion failure", async () =>
    fixture(async (root) => {
      await writeFile(
        join(root, "src/a.test.ts"),
        "import {test,expect} from 'vitest';test('injected fault',()=>expect(99).toBe(1));",
      );
      const result = await execute(root, ["--test-file", "src/a.test.ts"]);
      expect(result.code).toBe(1);
      const report = JSON.parse(
        await readFile(join(root, "result.json"), "utf8"),
      );
      expect(report.numFailedTests).toBe(1);
    }));

  it("executes every requested member once without a colliding unselected path", async () =>
    fixture(async (root) => {
      const selected = ["src/a.test.ts", "src/a.test.ts.extra.test.ts"];
      const result = await execute(
        root,
        selected.flatMap((path) => ["--test-file", path]),
      );
      expect(result.code).toBe(0);
      const report = JSON.parse(
        await readFile(join(root, "result.json"), "utf8"),
      );
      expect(report.numTotalTests).toBe(2);
      expect(
        report.testResults.map((test: { name: string }) => test.name).sort(),
      ).toEqual(selected.map((path) => join(root, path)).sort());
    }));

  for (const args of [
    [],
    ["--test-file", "src/missing.test.ts"],
    ["--test-file", "../outside.test.ts"],
    ["--test-file", "src"],
    ["--test-file", "src/a.test.ts", "--test-file", "./src/a.test.ts"],
    ["--test-file", "src/a.test.ts", "--max-workers", "0"],
  ]) {
    it(`refuses invalid membership before execution: ${JSON.stringify(args)}`, async () =>
      fixture(async (root) => {
        const result = await execute(root, args);
        expect(result.code).toBe(1);
        const diagnostic = result.output
          .split("\n")
          .find((line) => line.startsWith('{"schemaVersion":1'));
        const blocker = JSON.parse(diagnostic!).blockers[0];
        expect(blocker.code).toBe("vitest_membership_failed");
        expect(blocker.source).toEqual({
          kind: "command",
          id: "harness:vitest-membership",
        });
        expect(blocker.remediations[0].kind).toBe("code_change");
        expect(await Bun.file(join(root, "result.json")).exists()).toBe(false);
      }));
  }

  it("respects config exclusion and refuses mismatched membership", async () =>
    fixture(async (root) => {
      const path = join(root, "vitest.config.ts");
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace(
          "test: {include",
          "test: {exclude:['src/a.test.ts'],include",
        ),
      );
      const result = await execute(root, ["--test-file", "src/a.test.ts"]);
      expect(result.code).toBe(1);
      expect(result.output).toContain("found 0");
      expect(await Bun.file(join(root, "result.json")).exists()).toBe(false);
    }));

  it("refuses a symlink alias rather than executing outside captured membership", async () =>
    fixture(async (root) => {
      await symlink(
        join(root, "src/a.test.ts"),
        join(root, "src/link.test.ts"),
      );
      const result = await execute(root, ["--test-file", "src/link.test.ts"]);
      expect(result.code).toBe(1);
      expect(result.output).toContain("without symlink aliases");
    }));

  it("refuses ambiguous duplicate project specifications", async () =>
    fixture(async (root) => {
      await writeFile(
        join(root, "vitest.config.ts"),
        `import {defineConfig} from 'vitest/config';export default defineConfig({cacheDir:'./.cache',test:{projects:[{test:{name:'one',include:['src/a.test.ts']}},{test:{name:'two',include:['src/a.test.ts']}}]}});`,
      );
      const result = await execute(root, ["--test-file", "src/a.test.ts"]);
      expect(result.code).toBe(1);
      expect(result.output).toContain("found 2");
      expect(await Bun.file(join(root, "result.json")).exists()).toBe(false);
    }));

  it("propagates startup errors without a successful test result", async () =>
    fixture(async (root) => {
      await writeFile(
        join(root, "vitest.config.ts"),
        "throw new Error('configuration control failure');",
      );
      const result = await execute(root, ["--test-file", "src/a.test.ts"]);
      expect(result.code).toBe(1);
      expect(result.output).toContain("configuration control failure");
      expect(await Bun.file(join(root, "result.json")).exists()).toBe(false);
    }));

  it(
    "does not turn cancellation into success",
    async () =>
      fixture(async (root) => {
        await writeFile(
          join(root, "src/a.test.ts"),
          `import {test} from 'vitest';import {writeFileSync} from 'node:fs';test('pending',async()=>{writeFileSync('started','yes');await new Promise(resolve=>setTimeout(resolve,30000))},60000);`,
        );
        const child = Bun.spawn(
          ["node", runner, "--test-file", "src/a.test.ts"],
          { cwd: root, stdout: "ignore", stderr: "ignore" },
        );
        try {
          const deadline = Date.now() + 10000;
          while (
            !(await Bun.file(join(root, "started")).exists()) &&
            Date.now() < deadline
          )
            await Bun.sleep(20);
          expect(await Bun.file(join(root, "started")).exists()).toBe(true);
          child.kill("SIGTERM");
          expect(await child.exited).not.toBe(0);
        } finally {
          if (child.exitCode === null) child.kill("SIGKILL");
          await child.exited;
        }
      }),
    15000,
  );
});
