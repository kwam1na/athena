import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateHarnessConfig } from "../.agent-skills/current/runtime/kernel.mjs";

/** Caller owns root provenance (pinned controller in CI). Never evaluates the
 * candidate/default entrypoint or falls back to it when base policy is absent. */
export async function loadHarnessBaseConfig(rootDir: string) {
  if (!path.isAbsolute(rootDir))
    throw new Error("Base policy requires an absolute root");
  const root = await realpath(rootDir);
  const file = path.join(root, "scripts/harness-base-config.ts");
  if (!(await lstat(file)).isFile() || (await realpath(file)) !== file)
    throw new Error("Base policy must be a regular file in its declared root");
  const loaded = await import(pathToFileURL(file).href);
  const validated = validateHarnessConfig(loaded.default);
  if (!validated.ok) throw new Error("Invalid declared base policy");
  if (validated.config.scopedExecution)
    throw new Error(
      "Trusted controller must supply the legacy policy explicitly",
    );
  return validated.config;
}
