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
    // Inlined rather than compared to the sensor's export, so recharacterizing
    // the oracle is a three-place edit this test independently witnesses.
    expect(digest).toBe(
      "76b3e7d79294ff910984435609e44c7fc80f0d52e7f1d2b9419df28488d29564",
    );
    expect(digest).toBe(PRE_CUTOVER_ORACLE_DIGEST);
  });

  test("a hand-edited compiled snapshot goes stale against the recorded report", async () => {
    const copyDir = await policyDirCopy();
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    for (const grant of snapshot.compiled.checkpointGrants) {
      grant.grant.forbiddenOperations = [];
    }
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("report_input_stale");
  });

  test("an emptied adjudication record blocks", async () => {
    const copyDir = await policyDirCopy();
    const report = await readPolicyJson(copyDir, "comparison-report.json");
    report.adjudications = [];
    await writePolicyJson(copyDir, "comparison-report.json", report);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("adjudication_incomplete");
  });

  test("valid JSON with the wrong shape fails typed instead of throwing", async () => {
    const copyDir = await policyDirCopy();
    await writePolicyJson(copyDir, "adapters.json", {});

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("artifact_unreadable");
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
  // Every mutation below re-stamps the recorded input digests before running
  // the sensor. Without that, the digest pins fail on any edit at all and a
  // lens defect would be credited to a check that never read a lens. The
  // control test directly below proves the re-stamp itself returns green, so a
  // red result in the mutations is attributable to the lens block alone.
  async function restampPolicyDigests(dir: string) {
    const digestOf = async (file: string) =>
      createHash("sha256").update(await readFile(path.join(dir, file))).digest("hex");
    const documentDigest = await digestOf("repository-policy.json");
    const adaptersDigest = await digestOf("adapters.json");
    const oracleDigest = await digestOf("pre-cutover-oracle.json");

    const snapshot = await readPolicyJson(dir, "compiled-snapshot.json");
    snapshot.inputDigests["repository-policy.json"] = documentDigest;
    snapshot.inputDigests["adapters.json"] = adaptersDigest;
    await writePolicyJson(dir, "compiled-snapshot.json", snapshot);

    const report = await readPolicyJson(dir, "comparison-report.json");
    report.inputs["repository-policy.json"] = documentDigest;
    report.inputs["adapters.json"] = adaptersDigest;
    report.inputs["pre-cutover-oracle.json"] = oracleDigest;
    report.inputs["compiled-snapshot.json"] = await digestOf("compiled-snapshot.json");
    report.inputs["compiledDigest"] = snapshot.compiled.compiledDigest;
    await writePolicyJson(dir, "comparison-report.json", report);
  }

  test("re-stamping the recorded digests without mutating anything stays green", async () => {
    const copyDir = await policyDirCopy();
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
  });

  test("a lens that names no reviewer charter is caught after re-stamping", async () => {
    const copyDir = await policyDirCopy();
    const document = await readPolicyJson(copyDir, "repository-policy.json");
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    // Dropped from BOTH sides, which is what a genuine recompile of a
    // charterless lens produces. Dropping it from the document alone would
    // leave the two sides disagreeing, and the red would come from the
    // agreement rule below rather than from the rule this test names.
    delete document.reviewLenses[0].personaId;
    delete snapshot.compiled.snapshot.reviewLenses[0].personaId;
    await writePolicyJson(copyDir, "repository-policy.json", document);
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
    // Attributable: the digest pins are satisfied, so nothing else fired.
    expect(findingCodes(result)).not.toContain("snapshot_input_stale");
    expect(findingCodes(result)).not.toContain("report_input_stale");
  });

  test("an added lens carrying no reviewer charter is caught even when the counts agree", async () => {
    const copyDir = await policyDirCopy();
    const document = await readPolicyJson(copyDir, "repository-policy.json");
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    // Added to both sides, so the count comparison is satisfied and only the
    // per-member enumeration can catch it.
    document.reviewLenses.push({ lensId: "lens.additional", category: "additional" });
    snapshot.compiled.snapshot.reviewLenses.push({
      lensId: "lens.additional",
      category: "additional",
      // Well-formed on every other axis, so the only thing wrong with the
      // added lens is the charter it does not name.
      personaDigest: "b".repeat(64),
    });
    await writePolicyJson(copyDir, "repository-policy.json", document);
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
    expect(findingCodes(result)).not.toContain("snapshot_input_stale");
    expect(findingCodes(result)).not.toContain("report_input_stale");
  });

  test("a compiled snapshot carrying a lens the document never declared is caught", async () => {
    const copyDir = await policyDirCopy();
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    // Added to the snapshot alone. Enumerating the document's lenses walks
    // only its own two, so nothing but the count comparison reaches this.
    snapshot.compiled.snapshot.reviewLenses.push({
      lensId: "lens.ghost",
      category: "testing-policy",
      personaId: "persona.simplicity",
      personaDigest: "c".repeat(64),
    });
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
    expect(findingCodes(result)).not.toContain("report_input_stale");

    // The other direction: a snapshot short of a lens the document declares,
    // which is the ordinary shape of a stale recompile. Without the count
    // comparison the per-member walk dereferences a missing compiled lens and
    // the sensor degrades from the lens verdict to an untyped shape error.
    const short = await policyDirCopy();
    const shortSnapshot = await readPolicyJson(short, "compiled-snapshot.json");
    shortSnapshot.compiled.snapshot.reviewLenses.pop();
    await writePolicyJson(short, "compiled-snapshot.json", shortSnapshot);
    await restampPolicyDigests(short);

    const shortResult = await runPolicyProjectionCheck(rootDir, { policyDir: short });
    expect(shortResult.status).toBe("fail");
    expect(findingCodes(shortResult)).toContain("lens_persona_defect");
    expect(findingCodes(shortResult)).not.toContain("artifact_unreadable");

    // A snapshot with no lens list at all, rather than a short one. Kept as
    // its own fixture: replacing the short one with this would stop witnessing
    // the count comparison, and replacing this one with the short would stop
    // witnessing the shape guard.
    const absent = await policyDirCopy();
    const absentSnapshot = await readPolicyJson(absent, "compiled-snapshot.json");
    delete absentSnapshot.compiled.snapshot.reviewLenses;
    await writePolicyJson(absent, "compiled-snapshot.json", absentSnapshot);
    await restampPolicyDigests(absent);

    const absentResult = await runPolicyProjectionCheck(rootDir, { policyDir: absent });
    expect(absentResult.status).toBe("fail");
    expect(findingCodes(absentResult)).toContain("lens_persona_defect");
    expect(findingCodes(absentResult)).not.toContain("artifact_unreadable");
  });

  test("a document with no review lenses cannot satisfy the per-lens charter claim by emptiness", async () => {
    const copyDir = await policyDirCopy();
    const document = await readPolicyJson(copyDir, "repository-policy.json");
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    document.reviewLenses = [];
    snapshot.compiled.snapshot.reviewLenses = [];
    await writePolicyJson(copyDir, "repository-policy.json", document);
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");

    // A document carrying no lens list at all, rather than an empty one. The
    // emptied fixture above cannot witness the shape guard, because an empty
    // array satisfies it.
    const absent = await policyDirCopy();
    const absentDocument = await readPolicyJson(absent, "repository-policy.json");
    const absentSnapshot = await readPolicyJson(absent, "compiled-snapshot.json");
    delete absentDocument.reviewLenses;
    delete absentSnapshot.compiled.snapshot.reviewLenses;
    await writePolicyJson(absent, "repository-policy.json", absentDocument);
    await writePolicyJson(absent, "compiled-snapshot.json", absentSnapshot);
    await restampPolicyDigests(absent);

    const absentResult = await runPolicyProjectionCheck(rootDir, { policyDir: absent });
    expect(absentResult.status).toBe("fail");
    expect(findingCodes(absentResult)).toContain("lens_persona_defect");
    expect(findingCodes(absentResult)).not.toContain("artifact_unreadable");
  });

  test("a compiled lens that lost its resolved charter digest is caught", async () => {
    const copyDir = await policyDirCopy();
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    delete snapshot.compiled.snapshot.reviewLenses[1].personaDigest;
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
    expect(findingCodes(result)).not.toContain("report_input_stale");
  });

  test("a document that pins charter bytes is caught, because Athena owns no charter", async () => {
    const copyDir = await policyDirCopy();
    const document = await readPolicyJson(copyDir, "repository-policy.json");
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    // The digest is the one compilation actually resolved, so this is the
    // plausible mistake: correct bytes, wrong reference form.
    document.reviewLenses[0].personaDigest =
      snapshot.compiled.snapshot.reviewLenses[0].personaDigest;
    await writePolicyJson(copyDir, "repository-policy.json", document);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
  });

  test("a compiled lens bound to a charter the document did not name is caught", async () => {
    const copyDir = await policyDirCopy();
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    snapshot.compiled.snapshot.reviewLenses[1].personaId = "persona.testing-policy";
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
  });

  // The agreement rule compares three axes at once, so each axis needs its own
  // witness: a test that moves two of them at once is satisfied by whichever
  // clause happens to fire, and the other clause can then be deleted unnoticed.
  test("a compiled lens bound to a lens identity the document never declared is caught", async () => {
    const copyDir = await policyDirCopy();
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    snapshot.compiled.snapshot.reviewLenses[0].lensId = "lens.renamed";
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
  });

  test("a compiled lens filed under a category the document never declared is caught", async () => {
    const copyDir = await policyDirCopy();
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    snapshot.compiled.snapshot.reviewLenses[0].category = "additional";
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
  });

  // Every other mutation removes a member; these malform one, which is what
  // holds the two format rules to their shape rather than to mere presence.
  test("a charter identity that is not a well-formed persona id is caught", async () => {
    const copyDir = await policyDirCopy();
    const document = await readPolicyJson(copyDir, "repository-policy.json");
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    // Carried on both sides so the agreement rule stays quiet and the red is
    // attributable to the identity format rule alone.
    document.reviewLenses[0].personaId = "persona.Outcome_Correctness";
    snapshot.compiled.snapshot.reviewLenses[0].personaId = "persona.Outcome_Correctness";
    await writePolicyJson(copyDir, "repository-policy.json", document);
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
  });

  test("a resolved charter digest that is not a sha256 is caught", async () => {
    const copyDir = await policyDirCopy();
    const snapshot = await readPolicyJson(copyDir, "compiled-snapshot.json");
    // Hex, but far short of a sha256: a rule checking only the alphabet
    // rather than the width would accept this.
    snapshot.compiled.snapshot.reviewLenses[0].personaDigest = "abc123";
    await writePolicyJson(copyDir, "compiled-snapshot.json", snapshot);
    await restampPolicyDigests(copyDir);

    const result = await runPolicyProjectionCheck(rootDir, { policyDir: copyDir });
    expect(result.status).toBe("fail");
    expect(findingCodes(result)).toContain("lens_persona_defect");
  });

  test("the tracked document references shipped charters by identity alone", async () => {
    const document = await readPolicyJson(policyDir, "repository-policy.json");
    const snapshot = await readPolicyJson(policyDir, "compiled-snapshot.json");
    // Pinned by name, not derived from the file, so retargeting a lens at a
    // different charter is a deliberate two-place edit.
    expect(
      document.reviewLenses.map((lens: { lensId: string; personaId: string }) => [
        lens.lensId,
        lens.personaId,
      ]),
    ).toEqual([
      ["lens.outcome-correctness", "persona.outcome-correctness"],
      ["lens.adversarial-testing", "persona.adversarial"],
    ]);
    for (const lens of document.reviewLenses) {
      expect(lens.personaDigest).toBeUndefined();
    }
    for (const lens of snapshot.compiled.snapshot.reviewLenses) {
      expect(lens.personaDigest).toMatch(/^[0-9a-f]{64}$/);
    }
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
