import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRunExport, parseRunExport } from "../.agent-skills/current/runtime/cli-api.mjs";
import { computeDeliverableIdentity, createRunStore, resolveRunStoreLocation, runGitDirect, gitNamespaceClearedEnvironment, type RunEvent } from "../.agent-skills/current/runtime/kernel.mjs";
import { collectDeliveryRunTelemetryFindings, deliveryRunTelemetryPath, parseArgs, parseDeliveryRunTelemetry, readDeliveryRunTelemetryRecords, readCurrentDeliveryRunExport, matchesCurrentGate, writeDeliveryRunTelemetryRecord, type DeliveryRunTelemetryCheckInput } from "./delivery-run-telemetry";
import config from "../harness.config";
import { productRunFixture } from "./delivery-run-telemetry.fixtures";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(path.join(tmpdir(), "athena-product-telemetry-")); roots.push(value); return value; }
const record = productRunFixture();
const recordPath = deliveryRunTelemetryPath(record);
function input(overrides: Partial<DeliveryRunTelemetryCheckInput> = {}): DeliveryRunTelemetryCheckInput {
  return { changedPaths: [recordPath], sourceLineTotal: 150, changedRecordContents: new Map([[recordPath, record]]), trackedPaths: new Set([recordPath]), currentRecordPaths: new Set([recordPath]), localGateCompleted: true, ciMode: false, ...overrides };
}

describe("product projection persistence", () => {
  it("stores exactly the canonical product export without a second accounting schema", async () => {
    const dir = await root(); const written = await writeDeliveryRunTelemetryRecord(dir, record);
    const text = await readFile(path.join(dir, written.path), "utf8");
    const parsed = parseRunExport(JSON.stringify(record));
    if (!parsed.ok) throw new Error("Invalid fixture");
    expect(JSON.parse(text)).toEqual(parsed.value);
    expect(await readDeliveryRunTelemetryRecords(dir)).toEqual([record]);
    expect(record.summary.open).toBe(true);
    expect(record.costs).toEqual({ review: { coverage: "unreported", unreportedEntries: 0, totals: [] }, run: { coverage: "unreported" } });
  });
  it("rejects tampered projected totals and unsafe run ids before writing", async () => {
    const dir = await root();
    const altered = { ...record, summary: { ...record.summary, durationSeconds: 900 } };
    expect(parseDeliveryRunTelemetry(JSON.stringify(altered))).toBeNull();
    await expect(writeDeliveryRunTelemetryRecord(dir, altered)).rejects.toThrow("Invalid product run export");
    await expect(writeDeliveryRunTelemetryRecord(dir, { ...record, runId: "../outside" })).rejects.toThrow();
  });
  it("keeps historical Athena records on disk without treating them as product observations", async () => {
    const dir = await root(); await mkdir(path.join(dir, "telemetry/delivery-runs"), { recursive: true });
    const old = JSON.stringify({ schemaVersion: 1, status: "pass", summary: { totalDurationMs: 1000 } });
    await writeFile(path.join(dir, "telemetry/delivery-runs/historical.json"), old);
    expect(await readDeliveryRunTelemetryRecords(dir)).toEqual([]);
    expect(await readFile(path.join(dir, "telemetry/delivery-runs/historical.json"), "utf8")).toBe(old);
  });
  it("retains separate partial review and whole-run costs from product projection", () => {
    const review: RunEvent = { ...record.events[1]!, kind: "review.round.closed", candidateTreeSha: "a".repeat(40), actor: { role: "executor" }, seq: 3, payload: { round: 1, candidateTreeSha: "a".repeat(40), outcome: "aligned", findings: { P0: 0, P1: 0, P2: 0, P3: 0 }, cost: { coverage: "partial", reportedBy: "codex", unit: "subagent-tokens", total: 17 } } };
    const ended: RunEvent = { ...record.events[1]!, kind: "run.ended", seq: 4, payload: { result: "complete", cost: { coverage: "unreported", reportedBy: "codex" } } };
    const export_ = buildRunExport({ runId: record.runId, events: [...record.events, review, ended] });
    const parsed = parseDeliveryRunTelemetry(JSON.stringify(export_));
    expect(parsed?.costs.review.coverage).toBe("partial");
    expect(parsed?.costs.review.totals).toEqual([{ unit: "subagent-tokens", reportedBy: "codex", total: 17 }]);
    expect(parsed?.costs.run).toEqual({ coverage: "unreported", reportedBy: "codex" });
  });
});

describe("Athena artifact directory policy", () => {
  it("accepts a tracked current product export", () => expect(collectDeliveryRunTelemetryFindings(input())).toEqual([]));
  it("accepts a product delivery record sibling without counting it as run telemetry", () => {
    const deliveryPath = "telemetry/delivery-runs/delivery-record.json";
    const delivery = { version: "delivery-record/2", gateId: "fixture", identityToken: "deliverable-tree/v1", workspaceId: "fixture", claims: [], manifestDigest: null, attestation: { level: "self" },
      candidateBinding: { treeSha: "a".repeat(40), deliverableDigest: "b".repeat(64), identityToken: "deliverable-tree/v1", baseRef: "main", baseTipSha: "c".repeat(40), mergeBaseSha: "c".repeat(40), workspaceId: "fixture" } };
    expect(collectDeliveryRunTelemetryFindings(input({ changedPaths: [recordPath, deliveryPath], changedRecordContents: new Map<string, unknown>([[recordPath, record], [deliveryPath, delivery]]) }))).toEqual([]);
    expect(collectDeliveryRunTelemetryFindings(input({ changedPaths: [deliveryPath], changedRecordContents: new Map([[deliveryPath, delivery]]), trackedPaths: new Set([deliveryPath]) })).map(f => f.code)).toEqual(["telemetry_record_missing"]);
  });
  it.each([false, true])("blocks malformed siblings even with valid current export (CI %s)", ciMode => {
    const broken = "telemetry/delivery-runs/broken.json";
    const result = collectDeliveryRunTelemetryFindings(input({ ciMode, changedPaths: [recordPath, broken], changedRecordContents: new Map<string, unknown>([[recordPath, record], [broken, {}]]) }));
    expect(result.map(f => f.code)).toEqual(["telemetry_record_malformed"]);
  });
  it("blocks malformed files below the size threshold and before the first gate", () => {
    expect(collectDeliveryRunTelemetryFindings(input({ sourceLineTotal: 1, localGateCompleted: false, changedRecordContents: new Map([[recordPath, null]]) }))[0]?.code).toBe("telemetry_record_malformed");
  });
  it("does not allow an untracked or stale export to satisfy required telemetry", () => {
    expect(collectDeliveryRunTelemetryFindings(input({ trackedPaths: new Set() }))[0]?.code).toBe("telemetry_record_missing");
    expect(collectDeliveryRunTelemetryFindings(input({ currentRecordPaths: new Set() }))[0]?.code).toBe("telemetry_record_missing");
  });
  it("allows first local gate bootstrap but requires current telemetry in CI", () => {
    const absent = input({ changedPaths: [], localGateCompleted: false });
    expect(collectDeliveryRunTelemetryFindings(absent)).toEqual([]);
    expect(collectDeliveryRunTelemetryFindings({ ...absent, ciMode: true })[0]?.code).toBe("telemetry_record_missing");
  });
  it("treats deleted artifacts as removals and refuses historical changed records", () => {
    expect(collectDeliveryRunTelemetryFindings(input({ sourceLineTotal: 1, changedRecordContents: new Map() }))).toEqual([]);
    expect(collectDeliveryRunTelemetryFindings(input({ changedRecordContents: new Map([[recordPath, { schemaVersion: 1, status: "pass" }]]) })).map(f => f.code)).toContain("telemetry_record_malformed");
  });
});

it("exports a real product journal without allocating a second run or ending it", async () => {
  const dir = await root(); spawnSync("git", ["init", "-q"], { cwd: dir });
  const location = await resolveRunStoreLocation({ cwd: dir, run: runGitDirect, env: gitNamespaceClearedEnvironment() }); if (!location.ok) throw new Error(location.reason);
  const store = createRunStore(location.commonDir); const allocation = await store.allocate(); if (!allocation.ok) throw new Error("allocation failed");
  const fixture = productRunFixture({ runId: allocation.runId });
  for (const { seq, ...event } of fixture.events) expect((await store.append(allocation.runId, { ...event, repo: { commonDir: location.commonDir } })).ok).toBe(true);
  expect((await store.setCurrent(location.worktreeKey, allocation.runId)).ok).toBe(true);
  const exported = await readCurrentDeliveryRunExport(dir);
  expect(exported?.runId).toBe(allocation.runId); expect(exported?.summary.open).toBe(true);
  expect(await store.list()).toEqual([allocation.runId]);
});

it("parses only supported invocation arguments", () => {
  expect(parseArgs(["record", "--run", "run-1234567890abcdef"])).toMatchObject({ command: "record", runId: "run-1234567890abcdef" });
  expect(() => parseArgs(["check", "--run", "id"])).toThrow();
  expect(() => parseArgs(["record", "--base"])).toThrow();
});


it("binds only an adjacent successful CLI gate context and permits record-neutral transport", async () => {
  const dir = await root();
  function git(...args: string[]) {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  }
  git("init", "-q");
  await writeFile(path.join(dir, "source.ts"), "export const value = 0;\n");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "base");
  await writeFile(path.join(dir, "source.ts"), "export const value = 1;\n");
  git("add", "."); const sourceTree = git("write-tree");
  const saved: RunEvent = { ...record.events[0]!, seq: 2, kind: "context.saved", candidateTreeSha: sourceTree, payload: {
    spec: "ordinary-run-context/1", stage: "athena-gate", candidateTreeSha: sourceTree,
    contract: { objective: "Deliver change", acceptanceCriteria: ["Change works"], finishLine: "merge-ready" },
    candidateBinding: { deliverableDigest: "a".repeat(64), identity: "deliverable-tree/v1", baseRef: "main", baseTipSha: "b".repeat(40), mergeBaseSha: "b".repeat(40), workspaceId: "fixture" },
    policyDigest: "c".repeat(64), release: { runtimeVersion: "1", releaseId: "product", profile: "linear", archiveSha256: "d".repeat(64) },
  } };
  const digest = await computeDeliverableIdentity({ rootDir: dir, treeSha: sourceTree, config: { ...config, computingIdentityVersion: "validation-tree/v1", reviewNeutral: config.recordNeutral } });
  const gate = { ...record.events[1]!, seq: 3, payload: { ...record.events[1]!.payload, digest } };
  const withEvents = (events: RunEvent[]) => buildRunExport({ runId: record.runId, events });
  const export_ = withEvents([record.events[0]!, saved, gate]);
  expect(parseDeliveryRunTelemetry(JSON.stringify(export_))).not.toBeNull();
  expect(await matchesCurrentGate(dir, config, sourceTree, export_)).toBe(true);
  expect(await matchesCurrentGate(dir, config, sourceTree, record)).toBe(false);
  expect(await matchesCurrentGate(dir, config, sourceTree, withEvents([record.events[0]!, saved, { ...record.events[1]!, seq: 3 }]))).toBe(false);
  expect(await matchesCurrentGate(dir, config, sourceTree, withEvents([record.events[0]!, saved, { ...gate, actor: { role: "executor" } }]))).toBe(false);
  expect(await matchesCurrentGate(dir, config, sourceTree, withEvents([...export_.events, { ...gate, seq: 4, payload: { ...gate.payload, outcome: "policy" } }]))).toBe(false);
  // A second successful completion cannot borrow the earlier context.
  expect(await matchesCurrentGate(dir, config, sourceTree, withEvents([...export_.events, { ...gate, seq: 4 }]))).toBe(false);
  await mkdir(path.join(dir, "telemetry/delivery-runs"), { recursive: true });
  await writeFile(path.join(dir, "telemetry/delivery-runs/export.json"), JSON.stringify(export_));
  git("add", "."); expect(await matchesCurrentGate(dir, config, git("write-tree"), export_)).toBe(true);
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "source and telemetry together");
  const clone = await root();
  const cloned = spawnSync("git", ["clone", "--no-local", dir, clone], { encoding: "utf8" });
  expect(cloned.status, cloned.stderr).toBe(0);
  expect(spawnSync("git", ["cat-file", "-e", sourceTree], { cwd: clone }).status).not.toBe(0);
  const cloneTree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: clone, encoding: "utf8" }).stdout.trim();
  const transported = parseDeliveryRunTelemetry(await readFile(path.join(clone, "telemetry/delivery-runs/export.json"), "utf8"));
  expect(transported).not.toBeNull();
  expect(await matchesCurrentGate(clone, config, cloneTree, transported!)).toBe(true);
  await mkdir(path.join(dir, "docs/reports"), { recursive: true });
  await writeFile(path.join(dir, "docs/reports/report.html"), "Report change");
  git("add", "."); expect(await matchesCurrentGate(dir, config, git("write-tree"), export_)).toBe(false);
  git("rm", "--cached", "docs/reports/report.html");
  await writeFile(path.join(dir, "source.ts"), "export const value = 2;\n");
  git("add", "source.ts"); expect(await matchesCurrentGate(dir, config, git("write-tree"), export_)).toBe(false);
});
