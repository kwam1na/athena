import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  rm,
  mkdir,
  readFile,
  writeFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import base, { resolveAthenaValidationMode } from "./harness-base-config";

test("mode selection keeps legacy today and supports a deliberate future default with explicit rollback", () => {
  expect(resolveAthenaValidationMode(undefined)).toBe("legacy");
  expect(resolveAthenaValidationMode("")).toBe("legacy");
  expect(resolveAthenaValidationMode(undefined, "comparison")).toBe(
    "comparison",
  );
  expect(resolveAthenaValidationMode("", "comparison")).toBe("comparison");
  expect(resolveAthenaValidationMode("legacy", "comparison")).toBe("legacy");
  expect(resolveAthenaValidationMode("full-health", "comparison")).toBe(
    "full-health",
  );
  expect(() => resolveAthenaValidationMode("invalid", "comparison")).toThrow(
    "must be",
  );
  expect(base.scopedExecution).toBeUndefined();
  expect(base.preparationWiringPaths).toContain(
    "scripts/harness-base-config.ts",
  );
});

test("pure policy imports under Node and Bun from an unrelated cwd despite active mode", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "base-policy-"));
  try {
    const file = pathToFileURL(
      join(import.meta.dir, "harness-base-config.ts"),
    ).href;
    const script = `import cp from 'node:child_process'; import mod from 'node:module';
      for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=()=>{throw Error('UNEXPECTED_PROCESS')};mod.syncBuiltinESMExports?.();
      if(globalThis.Bun)Bun.spawn=Bun.spawnSync=()=>{throw Error('UNEXPECTED_BUN_PROCESS')};
      globalThis.fetch=()=>{throw Error('UNEXPECTED_NETWORK')};
      const m=await import(${JSON.stringify(file)}); console.log(JSON.stringify(m.default));`;
    for (const command of ["bun", "node"]) {
      const child = spawnSync(
        command,
        [
          ...(command === "node"
            ? ["--experimental-strip-types", "--input-type=module"]
            : []),
          "-e",
          script,
        ],
        {
          cwd,
          env: { ...process.env, ATHENA_VALIDATION_MODE: "comparison" },
          encoding: "utf8",
          timeout: 5000,
        },
      );
      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual(base);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("dynamic entrypoint anchors active admission to its module root and retains explicit legacy", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "entrypoint-root-")),
  );
  const cwd = await mkdtemp(join(tmpdir(), "entrypoint-cwd-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(
      join(root, "harness.config.ts"),
      await readFile(new URL("../harness.config.ts", import.meta.url), "utf8"),
    );
    await writeFile(
      join(root, "scripts/harness-base-config.ts"),
      `export * from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "harness-base-config.ts")).href)};`,
    );
    await writeFile(
      join(root, "scripts/harness-validation-local-runtime.ts"),
      `export async function configureLocalScopedValidation(root,base,mode){return {root,mode,config:base}}`,
    );
    const script = `const m=await import(${JSON.stringify(pathToFileURL(join(root, "harness.config.ts")).href)});console.log(JSON.stringify({gate:m.default.gateId,active:m.ATHENA_LOCAL_VALIDATION?{root:m.ATHENA_LOCAL_VALIDATION.root,mode:m.ATHENA_LOCAL_VALIDATION.mode}:null}));`;
    for (const mode of [
      undefined,
      "legacy",
      "comparison",
      "full-health",
      "invalid",
    ]) {
      const env = { ...process.env };
      delete env.ATHENA_VALIDATION_MODE;
      if (mode !== undefined) env.ATHENA_VALIDATION_MODE = mode;
      const child = spawnSync(
        "node",
        ["--experimental-strip-types", "--input-type=module", "-e", script],
        { cwd, env, encoding: "utf8", timeout: 5000 },
      );
      if (mode === "invalid") {
        expect(child.status).not.toBe(0);
        expect(child.stderr).toContain("must be legacy");
        continue;
      }
      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({
        gate: base.gateId,
        active: mode === undefined || mode === "legacy" ? null : { root, mode },
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
