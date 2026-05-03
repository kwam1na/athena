import { readdirSync } from "node:fs";
import path from "node:path";

export function collectRootScriptTestFiles(rootDir: string) {
  const scriptsDir = path.join(rootDir, "scripts");

  return readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(scriptsDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export async function runRootScriptsCoverage(rootDir: string) {
  const testFiles = collectRootScriptTestFiles(rootDir);

  if (testFiles.length === 0) {
    throw new Error("No root script test files found in scripts/.");
  }

  const proc = Bun.spawn(
    [
      "bun",
      "test",
      "--coverage",
      "--coverage-reporter=lcov",
      "--coverage-dir=coverage/root-scripts",
      ...testFiles,
    ],
    {
      cwd: rootDir,
      stdout: "inherit",
      stderr: "inherit",
    }
  );

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Root script coverage failed with exit code ${exitCode}.`);
  }
}

if (import.meta.main) {
  try {
    await runRootScriptsCoverage(path.resolve(import.meta.dirname, ".."));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
