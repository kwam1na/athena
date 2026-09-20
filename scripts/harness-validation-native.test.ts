import { describe, expect, it } from "vitest";
import {
  mkdtemp,
  writeFile,
  rm,
  readFile,
  realpath,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  defineHarnessConfig,
  GATE_STRUCTURAL_FINDING_CODES,
  type HarnessConfig,
} from "../.agent-skills/current/runtime/kernel.mjs";
import {
  runNativeValidation,
  verifyNativeValidation,
} from "./harness-validation-native";

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

describe("public native validation lifecycle", () => {
  it(
    "actually prepares, gates, records and verifies a tiny Git candidate",
    async () =>
      fixture(async (input) => {
        const messages: string[] = [];
        const result = await runNativeValidation({
          ...input,
          stderr: (text) => messages.push(text),
          stdout: (text) => messages.push(text),
        });
        if (result.status !== "verified")
          throw new Error(JSON.stringify({ result, messages }));
        expect(result.status).toBe("verified");
        expect(result.candidate?.headSha).toBe(input.binding.headSha);
        expect(result.candidate?.base.tipSha).toBe(input.binding.baseSha);
        expect(result.candidate?.treeSha).toBe(
          result.observations.providers[0].attempts.at(-1)?.origin.candidate
            .treeSha,
        );
        expect(result.phases.map((p) => p.phase)).toEqual([
          "prepare",
          "gate",
          "record",
          "verify",
        ]);
        expect(result.observations.providers[0].attempts.at(-1)?.status).toBe(
          "passed",
        );
        expect(
          JSON.parse(await readFile(result.recordRef, "utf8")),
        ).toBeDefined();
      }),
    20000,
  );
  it(
    "retains command failure despite a fake passed JSON log",
    async () =>
      fixture(async (input) => {
        const result = await runNativeValidation(input);
        expect(result.status).toBe("failed");
        expect(result).not.toHaveProperty("recordRef");
        expect(result.candidate?.headSha).toBe(input.binding.headSha);
        expect(result.candidate?.deliverable.digest).toBe(
          result.observations.providers[0].attempts.at(-1)?.origin.candidate
            .deliverableDigest,
        );
        expect(result.observations.providers[0].attempts.at(-1)?.status).toBe(
          "failed",
        );
        expect(result.phases.some((p) => p.phase === "record")).toBe(false);
      }, 9),
    20000,
  );
  it(
    "does not record a partial gate with one passing and one failing provider",
    async () =>
      fixture(
        async (input) => {
          const result = await runNativeValidation(input);
          expect(result.status).toBe("failed");
          expect(
            result.observations.providers.map((p) => p.attempts.at(-1)?.status),
          ).toEqual(["passed", "failed"]);
          expect(result).not.toHaveProperty("recordRef");
        },
        0,
        true,
      ),
    20000,
  );
  it("rejects a partial provider mapping before executing", async () =>
    fixture(async (input) => {
      await expect(
        runNativeValidation({ ...input, checkIdToProviderId: {} }),
      ).rejects.toThrow("mapping");
    }));
});

it(
  "cold-verifies only the native portable record in a fresh clone with no attempt store",
  async () =>
    fixture(async (input) => {
      const built = await runNativeValidation(input);
      if (built.status !== "verified") throw new Error(JSON.stringify(built));
      const cold = await realpath(
        await mkdtemp(join(tmpdir(), "athena-native-cold-")),
      );
      try {
        execFileSync("git", ["clone", "-q", input.rootDir, cold]);
        await mkdir(join(cold, "artifacts/validation-ci"), { recursive: true });
        const recordRef = join(
          cold,
          "artifacts/validation-ci",
          basename(built.recordRef),
        );
        await copyFile(built.recordRef, recordRef);
        const result = await verifyNativeValidation({
          ...input,
          rootDir: cold,
        });
        if (result.status !== "verified")
          throw new Error(JSON.stringify(result));
        expect(result.phases).toEqual([{ phase: "verify", exitCode: 0 }]);
        expect(
          result.observations.providers.every((p) => p.attempts.length === 0),
        ).toBe(true);
        expect(result.selectedAttempts).toEqual(built.selectedAttempts);
        expect(
          result.selectedAttempts[0].observation.flags
            .ATHENA_VALIDATION_INVOCATION,
        ).toBe(input.env.ATHENA_VALIDATION_INVOCATION);
        const tampered = JSON.parse(await readFile(recordRef, "utf8"));
        tampered.claims = [];
        await writeFile(recordRef, JSON.stringify(tampered));
        const rejected = await verifyNativeValidation({
          ...input,
          rootDir: cold,
        });
        expect(rejected.status).toBe("failed");
        expect(rejected).not.toHaveProperty("recordRef");
      } finally {
        await rm(cold, { recursive: true, force: true });
      }
    }),
  20000,
);

it(
  "returns the verified selected attempt rather than newer unrelated failed history",
  async () =>
    fixture(async (input) => {
      const first = await runNativeValidation(input);
      if (first.status !== "verified") throw new Error(JSON.stringify(first));
      const git = (...args: string[]) =>
        execFileSync("git", args, {
          cwd: input.rootDir,
          encoding: "utf8",
        }).trim();
      await writeFile(join(input.rootDir, "check.sh"), "#!/bin/sh\nexit 8\n");
      git("add", "check.sh");
      git("commit", "-qm", "different failing inputs");
      const failed = await runNativeValidation({
        ...input,
        binding: { ...input.binding, headSha: git("rev-parse", "HEAD") },
      });
      expect(failed.status).toBe("failed");
      git("reset", "--hard", input.binding.headSha);
      const restored = await runNativeValidation(input);
      if (restored.status !== "verified")
        throw new Error(JSON.stringify(restored));
      expect(restored.observations.providers[0].attempts.at(-1)?.status).toBe(
        "failed",
      );
      expect(restored.selectedAttempts[0].attempt.attemptId).toBe(
        first.selectedAttempts[0].attempt.attemptId,
      );
    }),
  30000,
);

it(
  "refuses bytes swapped after the native verify command",
  async () =>
    fixture(async (input) => {
      const built = await runNativeValidation(input);
      if (built.status !== "verified") throw new Error(JSON.stringify(built));
      const result = await verifyNativeValidation({
        ...input,
        stdout: (text) => {
          if (text.startsWith("verified "))
            writeFileSync(built.recordRef, "{}");
        },
      });
      expect(result.status).toBe("failed");
      expect(result).toMatchObject({
        phase: "verify",
        error: "Native record changed during verification",
      });
      expect(result).not.toHaveProperty("recordRef");
    }),
  20000,
);

it(
  "a declared invocation flag forces a fresh native attempt without resetting history",
  async () =>
    fixture(async (input) => {
      const first = await runNativeValidation(input);
      if (first.status !== "verified") throw new Error(JSON.stringify(first));
      const nextInvocation = "owner/repo:11:1:full-health:next";
      const next = await runNativeValidation({
        ...input,
        env: { ...input.env, ATHENA_VALIDATION_INVOCATION: nextInvocation },
      });
      if (next.status !== "verified") throw new Error(JSON.stringify(next));
      expect(next.beforeObservations.providers[0].attempts).toHaveLength(1);
      expect(next.observations.providers[0].attempts).toHaveLength(2);
      expect(next.selectedAttempts[0].attempt.attemptId).not.toBe(
        first.selectedAttempts[0].attempt.attemptId,
      );
      expect(
        next.selectedAttempts[0].observation.flags.ATHENA_VALIDATION_INVOCATION,
      ).toBe(nextInvocation);
    }),
  25000,
);
