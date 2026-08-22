/**
 * Agent SDK drift gate.
 *
 * Regenerates the agent capability artifacts in memory from the registered
 * manifest sources and compares them byte for byte with what is committed.
 * Drift, a missing artifact, or any generation issue (collision, invalid
 * binding, orphan port, failed conformance, stale read-port implementation
 * version) exits non-zero and names the command that fixes it.
 *
 * This is the same gate `scripts/pre-commit-generated-artifacts.ts` runs
 * alongside the Convex `_generated` and graphify artifacts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_SDK_GENERATED_ARTIFACTS,
  AGENT_SDK_GENERATE_COMMAND,
  buildAgentSdkGeneration,
  formatGenerationIssues,
} from "./agent-sdk-generate";
import type { AgentContractIssue } from "../packages/athena-webapp/shared/agentHarness/values";

export type AgentSdkCheckOptions = {
  /** Read one committed artifact; `null` means it does not exist. */
  readArtifact?: (artifactPath: string) => Promise<string | null>;
};

export type AgentSdkCheckResult = {
  readonly ok: boolean;
  readonly stale: readonly string[];
  readonly missing: readonly string[];
  readonly issues: readonly AgentContractIssue[];
  readonly message: string;
};

async function readArtifactFrom(rootDir: string, artifactPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(rootDir, artifactPath), "utf8");
  } catch {
    return null;
  }
}

export async function checkAgentSdkArtifacts(
  rootDir: string,
  options: AgentSdkCheckOptions = {},
): Promise<AgentSdkCheckResult> {
  const readArtifact = options.readArtifact ?? ((artifactPath) => readArtifactFrom(rootDir, artifactPath));

  const committed: { [artifactPath: string]: string } = {};
  const missing: string[] = [];
  for (const artifactPath of AGENT_SDK_GENERATED_ARTIFACTS) {
    const contents = await readArtifact(artifactPath);
    if (contents === null) missing.push(artifactPath);
    else committed[artifactPath] = contents;
  }

  const generated = await buildAgentSdkGeneration(rootDir, { previousArtifacts: committed });
  if (!generated.ok) {
    return {
      ok: false,
      stale: [],
      missing,
      issues: generated.issues,
      message: formatGenerationIssues(generated.issues),
    };
  }

  const stale = generated.artifacts
    .filter((artifact) => committed[artifact.path] !== undefined && committed[artifact.path] !== artifact.contents)
    .map((artifact) => artifact.path);

  if (stale.length === 0 && missing.length === 0) {
    return {
      ok: true,
      stale,
      missing,
      issues: [],
      message: `[agent-sdk check] Generated agent capability artifacts are fresh (compatibility digest ${generated.registry.compatibilityDigest}).`,
    };
  }

  return {
    ok: false,
    stale,
    missing,
    issues: [],
    message: [
      "[agent-sdk check] Generated agent capability artifacts are out of date:",
      ...missing.map((artifactPath) => `  - ${artifactPath} (missing artifact)`),
      ...stale.map((artifactPath) => `  - ${artifactPath}`),
      `Run \`${AGENT_SDK_GENERATE_COMMAND}\` from the repo root and commit the result.`,
    ].join("\n"),
  };
}

if (import.meta.main) {
  checkAgentSdkArtifacts(process.cwd())
    .then((result) => {
      if (result.ok) {
        console.log(result.message);
        return;
      }
      console.error(result.message);
      process.exit(1);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
