import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm, realpath, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defineHarnessConfig,
  GATE_STRUCTURAL_FINDING_CODES,
  type HarnessConfig,
} from "../.agent-skills/current/runtime/kernel.mjs";
import { runNativeValidation } from "./harness-validation-native";

async function fixture(
  run: (input: {
    rootDir: string;
    config: HarnessConfig;
    env: NodeJS.ProcessEnv;
    binding: { headSha: string; baseSha: string };
    checkIdToProviderId: Record<string, string>;
  }) => Promise<void>,
  exitCode = 0,
  second = false,
) {
  const rootDir = await realpath(
    await mkdtemp(join(tmpdir(), "athena-native-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    // Exercise the actual adopter transport policy rather than a permissive fixture.
    await copyFile(
      new URL("../.gitignore", import.meta.url),
      join(rootDir, ".gitignore"),
    );
    await writeFile(
      join(rootDir, "check.sh"),
      `#!/bin/sh\necho '{"status":"passed","verified":true}'\nexit ${exitCode}\n`,
    );
    git("add", ".");
    git("commit", "-qm", "fixture");
    const sha = git("rev-parse", "HEAD");
    const ids = second ? ["native.first", "native.second"] : ["native.first"];
    const config = defineHarnessConfig({
      gateId: "fixture.validation-ci",
      baseRef: sha,
      storageNamespace: "native-ci-fixture/",
      acceptedEnvelopeSpecs: ["delivery-evidence/1"],
      identityVersions: ["fixture-validation-ci/v1"],
      computingIdentityVersion: "fixture-validation-ci/v1",
      reviewNeutral: [{ prefix: "artifacts/validation-ci/", suffix: ".json" }],
      recordNeutral: [{ prefix: "artifacts/validation-ci/", suffix: ".json" }],
      pathClassification: { generated: [], test: [], lockfile: [] },
      sensitivePaths: [],
      activationThreshold: 1,
      agentEnvSignals: [],
      ciPolicies: [],
      ciPolicyEnvKey: "FIXTURE_CI_POLICY",
      preparationWiringPaths: [],
      preparationCommands: [],
      scopedExecution: {
        version: "scoped-execution/1",
        profiles: [
          {
            id: "plain",
            dependencyInputs: [],
            mutableOutputs: [],
            credentialIdentities: {},
            gitContext: "none",
          },
        ],
        mechanicalProviders: [],
      },
      providers: ids.map((id, index) => ({
        id,
        findingCodes: [],
        check: {
          command:
            index === 0 ? ["/bin/sh", "check.sh"] : ["/bin/sh", "-c", "exit 7"],
          timeoutMs: 10000,
          scope: {
            version: "scoped-check/1",
            files: ["check.sh"],
            memberships: [],
            tests: [],
            cwd: ".",
            profile: "plain",
            environment: [
              { name: "ATHENA_VALIDATION_INVOCATION", kind: "flag" },
            ],
          },
        },
      })),
      obligations: ids.map((id) => ({
        id: `${id}.passed`,
        activation: { kind: "always" },
        freshness: "exact_candidate",
        providers: [id],
        acceptedPayloadSpecs: ["checks.passed/1"],
        allowedResolutionKinds: ["satisfied_evidence"],
        humanWaiverAllowed: false,
        minimumAttestationLevel: "self",
        ciDelegationPolicyIds: [],
        waivableCodes: [],
        nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES],
        remediation: {
          default: [
            { id: "repair", kind: "manual_action", summary: "Fix check" },
          ],
        },
      })),
      deliveryRecordPath: "artifacts/validation-ci/record.json",
      deliveryRecordVerification: { baseMovement: "stale" },
    });
    await run({
      rootDir,
      config,
      env: {
        PATH: process.env.PATH,
        ATHENA_VALIDATION_INVOCATION: "owner/repo:10:1:full-health:fixture",
      },
      binding: { headSha: sha, baseSha: sha },
      checkIdToProviderId: Object.fromEntries(ids.map((id) => [id, id])),
    });
  } catch (error) {
    if (error && typeof error === "object" && "blockers" in error)
      throw new Error(JSON.stringify(error.blockers));
    throw error;
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

// Bounded official-release integration only: no application/controller qualification.
import { readScopedCheckDiagnostics } from "../.agent-skills/current/runtime/cli-api.mjs";

it(
  "official verified native result retains exact public capture and diagnostics",
  async () =>
    fixture(async (input) => {
      const result = await runNativeValidation(input);
      expect(result.status).toBe("verified");
      if (result.status !== "verified" || !result.candidate)
        throw Error("Verified capture missing");
      const attempt = result.observations.providers[0].attempts.at(-1)!;
      expect(result.candidate.headSha).toBe(input.binding.headSha);
      expect(attempt.origin.candidate.treeSha).toBe(result.candidate.treeSha);
      expect(attempt.origin.candidate.deliverableDigest).toBe(
        result.candidate.deliverable.digest,
      );
      expect(attempt.origin.candidate.workspaceId).toBe(
        result.candidate.workspaceId,
      );
      const diagnostics = await readScopedCheckDiagnostics({
        rootDir: input.rootDir,
        config: input.config,
        attemptIds: [attempt.attemptId],
      });
      expect(diagnostics.unavailableAttemptIds).toEqual([]);
      const detail = diagnostics.providers.flatMap((p) => p.attempts)[0]
        .diagnostic;
      expect(detail.availability).toBe("available");
      if (detail.availability === "available")
        expect(detail.failure).toEqual({ unavailable: "not-failed" });
    }),
  20000,
);

it(
  "official failed native result retains capture and actual failure exit",
  async () =>
    fixture(async (input) => {
      const result = await runNativeValidation(input);
      expect(result.status).toBe("failed");
      expect(result.candidate).toBeDefined();
      const attempt = result.observations.providers[0].attempts.at(-1)!;
      expect(attempt.origin.candidate.deliverableDigest).toBe(
        result.candidate?.deliverable.digest,
      );
      expect(attempt.origin.candidate.identityToken).toBe(
        result.candidate?.deliverable.identity,
      );
      const diagnostics = await readScopedCheckDiagnostics({
        rootDir: input.rootDir,
        config: input.config,
        attemptIds: [attempt.attemptId],
      });
      const detail = diagnostics.providers.flatMap((p) => p.attempts)[0]
        .diagnostic;
      expect(detail.availability).toBe("available");
      if (detail.availability !== "available")
        throw Error("Missing failed diagnostic");
      expect(detail.failure).toEqual({ code: "check_command_failed" });
      expect("exitCode" in detail.command && detail.command.exitCode).toBe(9);
      expect(result).not.toHaveProperty("recordRef");
    }, 9),
  20000,
);

it(
  "public capture refusal before allocation does not invent a native candidate",
  async () =>
    fixture(async (input) => {
      const result = await runNativeValidation({
        ...input,
        binding: { ...input.binding, headSha: "f".repeat(40) },
      });
      expect(result.status).toBe("failed");
      if (result.status !== "failed") throw Error("Unexpected success");
      expect(result.phase).toBe("capture");
      expect(result.candidate).toBeUndefined();
      expect(result.observations.providers.flatMap((p) => p.attempts)).toEqual(
        [],
      );
    }),
  20000,
);
