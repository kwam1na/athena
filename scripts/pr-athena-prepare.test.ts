import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  evaluatePrAthenaPreparationReceipt,
  runPrAthenaPreparation,
  type PrAthenaPreparationReceipt,
} from "./pr-athena-prepare";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

const roots: string[] = [];
const candidate = {
  schemaVersion: 1 as const,
  headSha: "head-a",
  treeSha: "tree-a",
  deliverableTreeSha: "deliverable-a",
  identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
  mode: "clean" as const,
  baseRef: "origin/main" as const,
  baseTipSha: "base-a",
  diffBaseSha: "merge-base-a",
  status: "",
  untrackedFiles: [] as string[],
};

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "athena-prepare-"));
  roots.push(root);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: { "pr:athena:prepare": "bun scripts/pr-athena-prepare.ts" },
    }),
  );
  for (const name of [
    "pr-athena-prepare.ts",
    "harness-candidate.ts",
    "bun-version-check.ts",
    "frontend-dependency-parity.ts",
    "pre-commit-generated-artifacts.ts",
    "pre-push-validation-proof.ts",
    "harness-mechanical-check.ts",
  ]) {
    await writeFile(path.join(root, "scripts", name), `// ${name}\n`);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("pr:athena preparation", () => {
  it("publishes a receipt only after every prerequisite succeeds", async () => {
    const root = await fixtureRoot();
    const calls: string[] = [];
    const result = await runPrAthenaPreparation(root, {
      runBunVersionCheck: async () => {
        calls.push("bun");
      },
      runDependencyCheck: async () => {
        calls.push("dependencies");
      },
      runGeneratedArtifacts: async () => {
        calls.push("generated");
      },
      assertProofReady: async () => {
        calls.push("readiness");
      },
      runMechanicalCheck: async () => {
        calls.push("mechanical");
        return { status: "pass" as const, ranCommands: [], failures: [] };
      },
      captureCandidate: async () => ({ ok: true, candidate }),
      resolveReceiptPath: async () => path.join(root, "receipt.json"),
      logger: { log() {} },
    });

    expect(calls).toEqual([
      "bun",
      "dependencies",
      "generated",
      "readiness",
      "mechanical",
    ]);
    expect(result).toMatchObject({
      prepared: true,
      receipt: { treeSha: "tree-a", baseTipSha: "base-a" },
    });
    expect(
      JSON.parse(await readFile(path.join(root, "receipt.json"), "utf8")),
    ).toMatchObject({ treeSha: "tree-a" });
  });

  it("does not publish a receipt when a prerequisite fails", async () => {
    const root = await fixtureRoot();
    await expect(
      runPrAthenaPreparation(root, {
        runBunVersionCheck: async () => {},
        runDependencyCheck: async () => {
          throw new Error("dependency failed");
        },
        runGeneratedArtifacts: async () => {
          throw new Error("must not run");
        },
        assertProofReady: async () => {},
        runMechanicalCheck: async () => {
          throw new Error("must not run");
        },
        captureCandidate: async () => ({ ok: true, candidate }),
        resolveReceiptPath: async () => path.join(root, "receipt.json"),
        logger: { log() {} },
      }),
    ).rejects.toThrow("dependency failed");
    await expect(
      readFile(path.join(root, "receipt.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("does not publish a receipt when a mechanical check fails", async () => {
    const root = await fixtureRoot();
    await expect(
      runPrAthenaPreparation(root, {
        runBunVersionCheck: async () => {},
        runDependencyCheck: async () => {},
        runGeneratedArtifacts: async () => {},
        assertProofReady: async () => {},
        runMechanicalCheck: async () => ({
          status: "fail" as const,
          ranCommands: [],
          failures: [
            {
              command: "@athena/webapp:lint:convex:changed",
              exitCode: 1,
              reason: "@athena/webapp:lint:convex:changed exited with code 1",
            },
          ],
        }),
        captureCandidate: async () => ({ ok: true, candidate }),
        resolveReceiptPath: async () => path.join(root, "receipt.json"),
        logger: { log() {} },
      }),
    ).rejects.toThrow(/lint:convex:changed/);
    await expect(
      readFile(path.join(root, "receipt.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("covers the mechanical gate in the preparation wiring fingerprint", async () => {
    const root = await fixtureRoot();
    const receiptPath = path.join(root, "receipt.json");
    const options = {
      runBunVersionCheck: async () => {},
      runDependencyCheck: async () => {},
      runGeneratedArtifacts: async () => {},
      assertProofReady: async () => {},
      runMechanicalCheck: async () => ({
        status: "pass" as const,
        ranCommands: [],
        failures: [],
      }),
      captureCandidate: async () => ({ ok: true as const, candidate }),
      resolveReceiptPath: async () => receiptPath,
      logger: { log() {} },
    };
    await runPrAthenaPreparation(root, options);
    await writeFile(
      path.join(root, "scripts", "harness-mechanical-check.ts"),
      "// mechanical gate changed\n",
    );

    await expect(
      evaluatePrAthenaPreparationReceipt(root, {
        captureCandidate: options.captureCandidate,
        resolveReceiptPath: options.resolveReceiptPath,
      }),
    ).resolves.toMatchObject({ prepared: false, status: "wiring_mismatch" });
  });

  it("accepts a receipt only for the same candidate, base, and wiring", async () => {
    const root = await fixtureRoot();
    const receiptPath = path.join(root, "receipt.json");
    const prepared = await runPrAthenaPreparation(root, {
      runBunVersionCheck: async () => {},
      runDependencyCheck: async () => {},
      runGeneratedArtifacts: async () => {},
      assertProofReady: async () => {},
      runMechanicalCheck: async () => ({
        status: "pass" as const,
        ranCommands: [],
        failures: [],
      }),
      captureCandidate: async () => ({ ok: true, candidate }),
      resolveReceiptPath: async () => receiptPath,
      logger: { log() {} },
    });
    expect(prepared.prepared).toBe(true);

    await expect(
      evaluatePrAthenaPreparationReceipt(root, {
        captureCandidate: async () => ({ ok: true, candidate }),
        resolveReceiptPath: async () => receiptPath,
      }),
    ).resolves.toMatchObject({ prepared: true });

    await expect(
      evaluatePrAthenaPreparationReceipt(root, {
        captureCandidate: async () => ({
          ok: true,
          candidate: {
            ...candidate,
            headSha: "head-after-commit",
            mode: "staged-index",
          },
        }),
        resolveReceiptPath: async () => receiptPath,
      }),
    ).resolves.toMatchObject({ prepared: true });

    await expect(
      evaluatePrAthenaPreparationReceipt(root, {
        captureCandidate: async () => ({
          ok: true,
          candidate: { ...candidate, treeSha: "tree-b" },
        }),
        resolveReceiptPath: async () => receiptPath,
      }),
    ).resolves.toMatchObject({
      prepared: false,
      status: "stale",
      remediation: "bun run pr:athena:prepare",
    });

    const stored = JSON.parse(
      await readFile(receiptPath, "utf8"),
    ) as PrAthenaPreparationReceipt;
    await writeFile(
      receiptPath,
      JSON.stringify({ ...stored, preparationFingerprint: "wrong" }),
    );
    await expect(
      evaluatePrAthenaPreparationReceipt(root, {
        captureCandidate: async () => ({ ok: true, candidate }),
        resolveReceiptPath: async () => receiptPath,
      }),
    ).resolves.toMatchObject({ prepared: false, status: "wiring_mismatch" });
  });

  it("blocks a clean direct invocation with no receipt", async () => {
    const root = await fixtureRoot();
    await expect(
      evaluatePrAthenaPreparationReceipt(root, {
        captureCandidate: async () => ({ ok: true, candidate }),
        resolveReceiptPath: async () => path.join(root, "missing.json"),
      }),
    ).resolves.toMatchObject({
      prepared: false,
      status: "missing",
      remediation: "bun run pr:athena:prepare",
    });
  });
});
