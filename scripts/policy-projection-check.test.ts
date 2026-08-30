import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectDeliveryRunTelemetryFindings,
  DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD,
} from "./delivery-run-telemetry";
import {
  EMITTABLE_BLOCKED_FINDING_CODES,
  WAIVABLE_FINDING_CODES,
} from "./harness-gate-admission";
import { selectMechanicalCommands } from "./harness-mechanical-check";
import {
  computePrAthenaPreparationFingerprint,
  evaluatePrAthenaPreparationReceipt,
} from "./pr-athena-prepare";
import {
  POLICY_PROJECTION_DIR,
  PRE_CUTOVER_ORACLE_DIGEST,
  formatMechanicalSelection,
  runPolicyProjectionCheck,
} from "./policy-projection-check";

const rootDir = path.resolve(import.meta.dirname, "..");
const policyDir = path.join(rootDir, POLICY_PROJECTION_DIR);

async function policyDirCopy() {
  const copyDir = await mkdtemp(path.join(tmpdir(), "athena-policy-projection-"));
  await cp(policyDir, copyDir, { recursive: true });
  return copyDir;
}

async function readPolicyJson(dir: string, file: string) {
  return JSON.parse(await readFile(path.join(dir, file), "utf8"));
}

async function writePolicyJson(dir: string, file: string, value: unknown) {
  await writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`);
}

function findingCodes(result: Awaited<ReturnType<typeof runPolicyProjectionCheck>>) {
  return result.findings.map((finding) => finding.code);
}

describe("policy projection comparison", () => {
  test("the tracked policy projection passes the read-only comparison", async () => {
    const result = await runPolicyProjectionCheck(rootDir);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
  });

  test("the pre-cutover oracle bytes match the pinned digest", async () => {
    const bytes = await readFile(path.join(policyDir, "pre-cutover-oracle.json"));
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(PRE_CUTOVER_ORACLE_DIGEST);
  });

  test("an edited oracle is a digest mismatch, not a silent recharacterization", async () => {
    const copyDir = await policyDirCopy();
    const oracle = await readPolicyJson(copyDir, "pre-cutover-oracle.json");
    oracle.phaseVector.orderedPhases.pop();
    await writePolicyJson(copyDir, "pre-cutover-oracle.json", oracle);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("oracle_digest_mismatch");
  });

  test("a document edit without recompilation goes stale against the recorded snapshot", async () => {
    const copyDir = await policyDirCopy();
    const document = await readPolicyJson(copyDir, "repository-policy.json");
    document.obligations.push({ obligationId: "obligation.added-by-hand" });
    await writePolicyJson(copyDir, "repository-policy.json", document);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("snapshot_input_stale");
    expect(findingCodes(result)).toContain("report_input_stale");
  });

  test("granting merge in a candidate copy is an authority drift finding", async () => {
    const copyDir = await policyDirCopy();
    const document = await readPolicyJson(copyDir, "repository-policy.json");
    document.grantedAuthority = ["pr-creation", "merge"];
    document.forbiddenAuthority = ["deploy"];
    await writePolicyJson(copyDir, "repository-policy.json", document);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("authority_drift");
  });

  test("a leaf mapped twice or unmapped is a leaf mapping defect", async () => {
    const doubled = await policyDirCopy();
    const doubledOracle = await readPolicyJson(doubled, "pre-cutover-oracle.json");
    doubledOracle.leafMappings.push(doubledOracle.leafMappings[0]);
    await writePolicyJson(doubled, "pre-cutover-oracle.json", doubledOracle);
    const doubledResult = await runPolicyProjectionCheck(rootDir, { policyDir: doubled });
    expect(findingCodes(doubledResult)).toContain("leaf_mapping_defect");

    const dropped = await policyDirCopy();
    const droppedOracle = await readPolicyJson(dropped, "pre-cutover-oracle.json");
    droppedOracle.leafMappings = droppedOracle.leafMappings.filter(
      (mapping: { capabilityId: string }) => mapping.capabilityId !== "sensor.graphify",
    );
    await writePolicyJson(dropped, "pre-cutover-oracle.json", droppedOracle);
    const droppedResult = await runPolicyProjectionCheck(rootDir, { policyDir: dropped });
    expect(findingCodes(droppedResult)).toContain("leaf_mapping_defect");
  });

  test("registering the aggregate entrypoint as a leaf is rejected", async () => {
    const copyDir = await policyDirCopy();
    const oracle = await readPolicyJson(copyDir, "pre-cutover-oracle.json");
    const adapters = await readPolicyJson(copyDir, "adapters.json");
    adapters.push({
      spec: "adapter-capability/1",
      capabilityId: "sensor.pr-athena",
      kind: "sensor",
      version: "1",
      resultSpec: "sensor-result/1",
    });
    oracle.leafMappings.push({
      leaf: "pr-athena-aggregate",
      capabilityId: "sensor.pr-athena",
      kind: "sensor",
      authority: ["bun run pr:athena"],
    });
    await writePolicyJson(copyDir, "adapters.json", adapters);
    await writePolicyJson(copyDir, "pre-cutover-oracle.json", oracle);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("aggregate_registered_as_leaf");
  });

  test("a comparison-report adjudication without a disposition blocks", async () => {
    const copyDir = await policyDirCopy();
    const report = await readPolicyJson(copyDir, "comparison-report.json");
    delete report.adjudications[0].disposition;
    await writePolicyJson(copyDir, "comparison-report.json", report);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("adjudication_incomplete");
  });
});

describe("pre-cutover oracle blocker parity with the live authority", () => {
  test("every obligation-scoped seeded candidate names a code the live gate can emit, with matching waivability", async () => {
    const oracle = await readPolicyJson(policyDir, "pre-cutover-oracle.json");
    const seeded: {
      obligation?: keyof typeof EMITTABLE_BLOCKED_FINDING_CODES;
      expectedFindingCode?: string;
      humanWaivable?: boolean;
    }[] = oracle.blockerVector.seededFailingCandidates;

    const obligationScoped = seeded.filter((entry) => entry.obligation !== undefined);
    expect(obligationScoped.length).toBeGreaterThanOrEqual(6);
    for (const entry of obligationScoped) {
      const emittable = EMITTABLE_BLOCKED_FINDING_CODES[entry.obligation!];
      expect(emittable).toContain(entry.expectedFindingCode!);
      const waivable = WAIVABLE_FINDING_CODES[entry.obligation!] as readonly string[];
      expect(waivable.includes(entry.expectedFindingCode!)).toBe(entry.humanWaivable);
    }
  });

  test("a substantial candidate without a telemetry record fails exactly as the oracle says", () => {
    const findings = collectDeliveryRunTelemetryFindings({
      changedPaths: ["packages/athena-webapp/src/components/orders/OrdersView.tsx"],
      sourceLineTotal: DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD,
      changedRecordContents: new Map(),
      trackedPaths: new Set(),
      deliverableDiffFingerprint: "fingerprint-current",
      localLedgerFingerprint: "fingerprint-current",
      ciMode: false,
    });
    expect(findings.map((finding) => finding.code)).toEqual(["telemetry_record_missing"]);
  });

  test("below the threshold, a missing telemetry record does not block", () => {
    const findings = collectDeliveryRunTelemetryFindings({
      changedPaths: ["docs/solutions/example-fix.md"],
      sourceLineTotal: DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD - 1,
      changedRecordContents: new Map(),
      trackedPaths: new Set(),
      deliverableDiffFingerprint: "fingerprint-current",
      localLedgerFingerprint: "fingerprint-current",
      ciMode: true,
    });
    expect(findings).toEqual([]);
  });

  test("a hand-edited telemetry record is malformed and never waivable", () => {
    const recordPath = "telemetry/delivery-runs/2026-08-30-example.json";
    const findings = collectDeliveryRunTelemetryFindings({
      changedPaths: [recordPath],
      sourceLineTotal: 0,
      changedRecordContents: new Map([[recordPath, { edited: "by hand" }]]),
      trackedPaths: new Set([recordPath]),
      deliverableDiffFingerprint: "fingerprint-current",
      localLedgerFingerprint: null,
      ciMode: false,
    });
    expect(findings.map((finding) => finding.code)).toEqual(["telemetry_record_malformed"]);
    expect(WAIVABLE_FINDING_CODES["telemetry.recorded"]).not.toContain(
      "telemetry_record_malformed",
    );
  });

  test("preparation blockers carry the oracle's preparation codes", async () => {
    const missingDir = await mkdtemp(path.join(tmpdir(), "athena-policy-receipt-"));
    const missingReceiptPath = path.join(missingDir, "receipt.json");
    const fingerprint = await computePrAthenaPreparationFingerprint(rootDir);
    const candidate = {
      schemaVersion: 1,
      headSha: "b".repeat(40),
      treeSha: "c".repeat(40),
      deliverableTreeSha: "d".repeat(40),
      identityVersion: "deliverable-tree/v2",
      mode: "clean",
      baseRef: "origin/main",
      baseTipSha: "e".repeat(40),
      diffBaseSha: "f".repeat(40),
    };
    const captureCandidate = async () => ({ ok: true as const, candidate: candidate as never });

    const missing = await evaluatePrAthenaPreparationReceipt(rootDir, {
      resolveReceiptPath: async () => missingReceiptPath,
      captureCandidate,
    });
    expect(missing.prepared).toBe(false);
    if (!missing.prepared) expect(missing.blocker.code).toBe("preparation_missing");

    const receipt = {
      schemaVersion: 1,
      preparedAt: new Date().toISOString(),
      treeSha: candidate.treeSha,
      headSha: candidate.headSha,
      mode: candidate.mode,
      baseRef: candidate.baseRef,
      baseTipSha: candidate.baseTipSha,
      diffBaseSha: candidate.diffBaseSha,
      preparationFingerprint: fingerprint,
    };

    const staleReceiptPath = path.join(missingDir, "stale-receipt.json");
    await writeFile(
      staleReceiptPath,
      JSON.stringify({ ...receipt, treeSha: "1".repeat(40) }),
    );
    const stale = await evaluatePrAthenaPreparationReceipt(rootDir, {
      resolveReceiptPath: async () => staleReceiptPath,
      captureCandidate,
    });
    expect(stale.prepared).toBe(false);
    if (!stale.prepared) expect(stale.blocker.code).toBe("preparation_stale");

    const movedBaseReceiptPath = path.join(missingDir, "moved-base-receipt.json");
    await writeFile(
      movedBaseReceiptPath,
      JSON.stringify({ ...receipt, baseTipSha: "2".repeat(40) }),
    );
    const movedBase = await evaluatePrAthenaPreparationReceipt(rootDir, {
      resolveReceiptPath: async () => movedBaseReceiptPath,
      captureCandidate,
    });
    expect(movedBase.prepared).toBe(false);
    if (!movedBase.prepared) {
      expect(movedBase.blocker.code).toBe("preparation_base_changed");
    }

    const rewiredReceiptPath = path.join(missingDir, "rewired-receipt.json");
    await writeFile(
      rewiredReceiptPath,
      JSON.stringify({ ...receipt, preparationFingerprint: "0".repeat(64) }),
    );
    const rewired = await evaluatePrAthenaPreparationReceipt(rootDir, {
      resolveReceiptPath: async () => rewiredReceiptPath,
      captureCandidate,
    });
    expect(rewired.prepared).toBe(false);
    if (!rewired.prepared) {
      expect(rewired.blocker.code).toBe("preparation_wiring_mismatch");
    }
  });

  test("ordinary candidate classes select the mechanical commands the oracle froze", async () => {
    const oracle = await readPolicyJson(policyDir, "pre-cutover-oracle.json");
    const probes: Record<string, string[]> = oracle.activationVector.mechanicalSelectionProbes;
    const frozen: Record<string, string[]> = oracle.activationVector.mechanicalSelection;
    expect(Object.keys(probes).sort()).toEqual(Object.keys(frozen).sort());
    for (const [scenario, changedFiles] of Object.entries(probes)) {
      expect(formatMechanicalSelection(selectMechanicalCommands(changedFiles))).toEqual(
        frozen[scenario],
      );
    }
  });
});
