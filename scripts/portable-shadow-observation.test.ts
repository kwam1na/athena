import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isPortableShadowComparison,
  observePortableShadow,
  portableShadowComparisonSha256,
  runPortableShadowObservation,
  type PortableShadowEvaluator,
} from "./portable-shadow-observation";
import {
  createDeliveryRunLedger,
  readDeliveryRunLedger,
  writeDeliveryRunLedger,
} from "./harness-delivery-run-ledger";
import {
  collectChangedPathsForDiff,
  collectDeliverableDiffFingerprint,
} from "./delivery-diff-fingerprint";

const ROOT = path.resolve(import.meta.dirname, "..");
const CANDIDATE_FINGERPRINT = "f".repeat(64);
const tempRoots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "athena-portable-shadow-"));
  tempRoots.push(root);
  return root;
}

function git(rootDir: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
}

async function initializeFingerprintRoot(rootDir: string) {
  await writeFile(path.join(rootDir, "candidate.txt"), "gate candidate\n");
  git(rootDir, ["init", "-q"]);
  git(rootDir, ["add", "."]);
  git(rootDir, [
    "-c",
    "user.name=Athena Test",
    "-c",
    "user.email=athena@example.test",
    "commit",
    "-qm",
    "base",
  ]);
  return collectDeliverableDiffFingerprint(
    rootDir,
    "HEAD",
    collectChangedPathsForDiff(rootDir, "HEAD"),
  );
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("portable workflow shadow observation", () => {
  it("feeds one frozen input to independent Athena and exact portable evaluators", async () => {
    const result = await observePortableShadow(ROOT, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });

    expect(result).toMatchObject({
      status: "match",
      workflow: "compound-delivery-kernel",
      source: {
        releaseId: "core-v1",
        profile: "core",
        sourceCommitSha: "f0a058d7b40a38bbe43c007f8b11248ecd4bda6a",
        archiveSha256:
          "f8b39590bae786767cff1cfd849382884a0b66f12ef9978f752dbcb28c230f26",
        metadataSha256:
          "cd0094de0eba4077e05af0c12e10b2a692d93e30e58b7d6aa8495cb0a53899fe",
      },
      athena: {
        routing: { entryPoint: "deliver-work", workflow: "implement" },
        posture: "characterization-first",
        gate: {
          status: "blocked",
          blockers: ["required sensor failed: merge-ready authority"],
        },
        evidence: ["focused sensor passed"],
      },
      portable: {
        routing: { entryPoint: "deliver-work", workflow: "implement" },
        posture: "characterization-first",
        gate: {
          status: "blocked",
          blockers: ["required sensor failed: merge-ready authority"],
        },
        evidence: ["focused sensor passed"],
      },
      mismatches: [],
      authority: {
        authoritativePath: "athena",
        influencedAuthoritativeResult: false,
        authoritySwitchAllowed: false,
        portableCapabilities: {
          trackerMutation: false,
          merge: false,
          deploy: false,
          statusMutation: false,
        },
      },
    });
    expect(result.inputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.comparisonSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(isPortableShadowComparison(result)).toBe(true);
  });

  it.each(["routing", "posture", "gate", "evidence"] as const)(
    "records a %s mismatch without changing Athena's decision",
    async (field) => {
      const reference = await observePortableShadow(ROOT, {
        observedAt: "2026-08-28T18:00:00.000Z",
        candidateFingerprint: CANDIDATE_FINGERPRINT,
      });
      const evaluator: PortableShadowEvaluator = async () => ({
        decisions: {
          ...reference.portable!,
          [field]:
            field === "posture"
              ? "test-first"
              : field === "evidence"
                ? ["different evidence"]
                : field === "routing"
                  ? { entryPoint: "plan-work", workflow: "plan" }
                  : { status: "complete", blockers: [] },
        },
        mutationAttempts: [],
      });

      const result = await observePortableShadow(ROOT, {
        evaluator,
        observedAt: "2026-08-28T18:00:00.000Z",
        candidateFingerprint: CANDIDATE_FINGERPRINT,
      });

      expect(result.status).toBe("mismatch");
      expect(result.mismatches.map((mismatch) => mismatch.field)).toEqual([
        field,
      ]);
      expect(result.athena).toEqual(reference.athena);
      expect(result.authority.influencedAuthoritativeResult).toBe(false);
    },
  );

  it("fails closed when the portable evaluator reports a forbidden mutation attempt", async () => {
    const reference = await observePortableShadow(ROOT, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });
    const result = await observePortableShadow(ROOT, {
      evaluator: async () => ({
        decisions: reference.athena,
        mutationAttempts: ["update-status"],
      }),
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });

    expect(result.status).toBe("mismatch");
    expect(result.mismatches).toEqual([
      {
        field: "authority.mutationAttempts",
        athena: [],
        portable: ["update-status"],
        disposition: "unresolved",
      },
    ]);
    expect(result.authority.authoritySwitchAllowed).toBe(false);
    expect(isPortableShadowComparison(result)).toBe(true);
  });

  it("rejects a comparison whose pinned source identity was replaced", async () => {
    const result = await observePortableShadow(ROOT, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });
    const tampered = {
      ...result,
      source: { ...result.source, archiveSha256: "a".repeat(64) },
    };
    tampered.comparisonSha256 = portableShadowComparisonSha256(tampered);

    expect(isPortableShadowComparison(tampered)).toBe(false);
  });

  it("binds the claimed observation timestamp into the comparison digest", async () => {
    const result = await observePortableShadow(ROOT, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });
    const changedTimestamp = {
      ...result,
      observedAt: "2099-08-28T18:00:00.000Z",
    };

    expect(portableShadowComparisonSha256(changedTimestamp)).not.toBe(
      result.comparisonSha256,
    );
    expect(isPortableShadowComparison(changedTimestamp)).toBe(false);
  });

  it("rejects fields outside the redacted comparison schema", async () => {
    const result = await observePortableShadow(ROOT, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });
    const withUnknownField = {
      ...result,
      athena: { ...result.athena, unredactedSecret: "leak-me" },
    };
    withUnknownField.comparisonSha256 =
      portableShadowComparisonSha256(withUnknownField);

    expect(isPortableShadowComparison(withUnknownField)).toBe(false);
  });

  it("rejects a comparison whose pinned Athena baseline was replaced", async () => {
    const result = await observePortableShadow(ROOT, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });
    const tampered = {
      ...result,
      baseline: { ...result.baseline, sha256: "a".repeat(64) },
    };
    tampered.comparisonSha256 = portableShadowComparisonSha256(tampered);

    expect(isPortableShadowComparison(tampered)).toBe(false);
  });

  it("rejects a comparison whose frozen input identity was replaced", async () => {
    const result = await observePortableShadow(ROOT, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });
    const tampered = { ...result, inputSha256: "a".repeat(64) };
    tampered.comparisonSha256 = portableShadowComparisonSha256(tampered);

    expect(isPortableShadowComparison(tampered)).toBe(false);
  });

  it("rejects decision drift even when an attacker recomputes the comparison hash", async () => {
    const result = await observePortableShadow(ROOT, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });
    const tampered = {
      ...result,
      portable: {
        ...result.portable!,
        evidence: ["different evidence"],
      },
    };
    tampered.comparisonSha256 = portableShadowComparisonSha256(tampered);

    expect(isPortableShadowComparison(tampered)).toBe(false);
  });

  it("reports unavailable when the exact release cannot be verified", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, ".agents/portable/releases"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".agents/portable/releases/core-v1.zip"),
      "not the qualified release",
    );
    await writeFile(
      path.join(root, ".agents/portable/releases/core-v1.release.json"),
      "{}",
    );
    await mkdir(path.join(root, ".agents"), { recursive: true });
    await writeFile(
      path.join(root, ".agents/characterization-baseline.json"),
      await readFile(path.join(ROOT, ".agents/characterization-baseline.json")),
    );
    await mkdir(path.join(root, "scripts/portable-shadow-fixtures"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        root,
        "scripts/portable-shadow-fixtures/compound-delivery-kernel.json",
      ),
      await readFile(
        path.join(
          ROOT,
          "scripts/portable-shadow-fixtures/compound-delivery-kernel.json",
        ),
      ),
    );

    const result = await observePortableShadow(root, {
      observedAt: "2026-08-28T18:00:00.000Z",
      candidateFingerprint: CANDIDATE_FINGERPRINT,
    });

    expect(result.status).toBe("unavailable");
    expect(result.portable).toBeUndefined();
    expect(result.mismatches).toEqual([]);
    expect(result.unavailableReason).toContain("exact portable release");
  });

  it("writes a sibling shadow artifact without changing the authoritative ledger", async () => {
    const root = await tempRoot();
    const sentinelPath = path.join(root, "authoritative-result.txt");
    await writeFile(sentinelPath, "Athena remains authoritative\n");
    const currentFingerprint = await initializeFingerprintRoot(root);
    const ledgerPath = "artifacts/harness-delivery-runs/latest.json";
    const shadowPath = "artifacts/harness-delivery-runs/shadow-comparison.json";
    const ledger = createDeliveryRunLedger({
      generatedAt: "2026-08-28T18:00:00.000Z",
      status: "pass",
      proofState: "proof_recorded",
      commandSpans: [],
      gateDecisionEvents: [],
      deliverableDiffFingerprint: currentFingerprint,
    });
    await writeDeliveryRunLedger(root, ledger, { latestPath: ledgerPath });
    const before = await readFile(path.join(root, ledgerPath), "utf8");
    const sentinelBefore = await readFile(sentinelPath, "utf8");
    const comparison = await runPortableShadowObservation(root, {
      ledgerPath,
      shadowPath,
      baseRef: "HEAD",
      evaluator: async () => ({
        decisions: {
          routing: { entryPoint: "deliver-work", workflow: "implement" },
          posture: "characterization-first",
          gate: {
            status: "blocked",
            blockers: ["required sensor failed: merge-ready authority"],
          },
          evidence: ["focused sensor passed"],
        },
        mutationAttempts: [],
      }),
      observedAt: "2026-08-28T18:01:00.000Z",
      baselinePath: path.join(ROOT, ".agents/characterization-baseline.json"),
      inputPath: path.join(
        ROOT,
        "scripts/portable-shadow-fixtures/compound-delivery-kernel.json",
      ),
    });

    expect(comparison.status).toBe("match");
    const after = await readDeliveryRunLedger(root, ledgerPath);
    expect(after?.status).toBe(ledger.status);
    expect(after?.proofState).toBe(ledger.proofState);
    expect(after?.commandSpans).toEqual(ledger.commandSpans);
    expect(after?.gateDecisionEvents).toEqual(ledger.gateDecisionEvents);
    expect(await readFile(path.join(root, ledgerPath), "utf8")).toBe(before);
    expect(
      JSON.parse(await readFile(path.join(root, shadowPath), "utf8")),
    ).toEqual(comparison);
    expect(await readFile(sentinelPath, "utf8")).toBe(sentinelBefore);
  });

  it("refuses to observe after the candidate moves beyond a passing ledger", async () => {
    const root = await tempRoot();
    const ledgerPath = "artifacts/harness-delivery-runs/latest.json";
    const shadowPath = "artifacts/harness-delivery-runs/shadow-comparison.json";
    const passedFingerprint = await initializeFingerprintRoot(root);
    await writeDeliveryRunLedger(
      root,
      createDeliveryRunLedger({
        generatedAt: "2026-08-28T18:00:00.000Z",
        status: "pass",
        proofState: "proof_recorded",
        commandSpans: [],
        deliverableDiffFingerprint: passedFingerprint,
      }),
      { latestPath: ledgerPath },
    );
    await writeFile(path.join(root, "candidate.txt"), "changed after gate\n");

    await expect(
      runPortableShadowObservation(root, {
        baseRef: "HEAD",
        ledgerPath,
        shadowPath,
      }),
    ).rejects.toThrow("different deliverable");
    await expect(
      readFile(path.join(root, shadowPath), "utf8"),
    ).rejects.toThrow();
  });

  it("refuses to record before the authoritative gate passes", async () => {
    const root = await tempRoot();
    const ledgerPath = "artifacts/harness-delivery-runs/latest.json";
    const shadowPath = "artifacts/harness-delivery-runs/shadow-comparison.json";
    await writeDeliveryRunLedger(
      root,
      createDeliveryRunLedger({
        generatedAt: "2026-08-28T18:00:00.000Z",
        status: "blocked",
        proofState: "proof_not_recorded",
        commandSpans: [],
      }),
      { latestPath: ledgerPath },
    );
    const before = await readFile(path.join(root, ledgerPath), "utf8");

    await expect(
      runPortableShadowObservation(root, {
        ledgerPath,
        shadowPath,
        observedAt: "2026-08-28T18:01:00.000Z",
      }),
    ).rejects.toThrow("authoritative gate has not passed");
    expect(await readFile(path.join(root, ledgerPath), "utf8")).toBe(before);
    await expect(
      readFile(path.join(root, shadowPath), "utf8"),
    ).rejects.toThrow();
  });
});
