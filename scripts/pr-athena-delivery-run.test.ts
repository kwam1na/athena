import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { computeDeliverableIdentity, defineHarnessConfig, GATE_STRUCTURAL_FINDING_CODES, parseDeliveryRecord } from "../.agent-skills/current/runtime/kernel.mjs";

import { evaluateDeliveryDocumentationAdmission } from "./delivery-documentation-admission";
import { readCurrentDeliveryRunExport } from "./delivery-run-telemetry";


const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(withWaiver = false) {
  const temporary = await mkdtemp(path.join(tmpdir(), "athena-coordinator-")); roots.push(temporary);
  const root = path.join(temporary, "repo"); await mkdir(root);
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: root, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  const write = async (name: string, value: string) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), value); };
  const baseConfig = defineHarnessConfig({
    gateId: "fixture.validation", acceptedEnvelopeSpecs: ["delivery-evidence/1"], identityVersions: ["deliverable-tree/v1"], computingIdentityVersion: "deliverable-tree/v1",
    reviewNeutral: [{ prefix: "docs/reports/" }, { prefix: "docs/solutions/" }, { prefix: "telemetry/delivery-runs/" }], recordNeutral: [{ prefix: "telemetry/delivery-runs/", suffix: ".json" }],
    pathClassification: { generated: [], test: [], lockfile: [] }, sensitivePaths: [], activationThreshold: 150,
    providers: [{ id: "native-review", findingCodes: [] }], obligations: [{ id: "review.green", activation: { kind: "relevant_change" }, freshness: "exact_candidate", providers: ["native-review"], acceptedPayloadSpecs: ["review.green/1"], allowedResolutionKinds: ["satisfied_evidence", "not_applicable"], humanWaiverAllowed: false, minimumAttestationLevel: "self", ciDelegationPolicyIds: [], waivableCodes: [], nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES], remediation: { default: [{ id: "review", kind: "manual_action", summary: "Complete review." }] } }], agentEnvSignals: ["TEST_AGENT"], ciPolicies: [], ciPolicyEnvKey: "TEST_CI_POLICY",
    preparationWiringPaths: ["harness.config.ts"], preparationCommands: [{ id: "mechanical", command: ["bun", "-e", 'require("node:fs").appendFileSync(".git/mechanical-runs", "prepared\\n")'], timeoutMs: 10000 }], deliveryRecordPath: "telemetry/delivery-runs/record.json",
  });
  const config = withWaiver ? defineHarnessConfig({
    ...baseConfig,
    providers: [...baseConfig.providers, { id: "fixture.documentation", findingCodes: [], command: ["bun", path.join(temporary, "waiver-check.ts")] }],
    obligations: [...baseConfig.obligations, { id: "documentation.current", activation: { kind: "always" }, freshness: "live", providers: ["fixture.documentation"], acceptedPayloadSpecs: ["checks.passed/1"], allowedResolutionKinds: ["satisfied_live_fact", "not_applicable"], humanWaiverAllowed: false, minimumAttestationLevel: "self", ciDelegationPolicyIds: [], waivableCodes: [], nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES], remediation: { default: [{ id: "documentation", kind: "manual_action", summary: "Repair documentation." }] } }],
  }) : baseConfig;
  await write("harness.config.ts", `export default ${JSON.stringify(config)};`);
  for (const name of [".agent-skills", ".agents/skills", ".claude/skills"]) {
    await cp(path.join(repositoryRoot, name), path.join(root, name), { recursive: true, verbatimSymlinks: true });
  }
  await write("source.ts", "export const value = 1;\n");
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid"); git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "base"); git("branch", "origin/main");
  const errors: string[] = [];
  const native = async (script: string, args: readonly string[] = [], extraEnv: Record<string, string> = {}) => {
    const child = Bun.spawn(["bun", path.join(repositoryRoot, "scripts", script), ...args], { cwd: root, env: { ...process.env, TEST_AGENT: "1", ...extraEnv }, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    errors.push(out, err); return code;
  };
  const run = (args: readonly string[]) => native("delivery-product.ts", args);
  const coordinate = async (failPhase?: string) => {
    // Test-only launcher delegates to the actual immutable installed product.
    // Failures are real candidate refusals, introduced just before a phase.
    const python = Bun.spawnSync(["python3", "-c", "import sys; print(sys.executable)"], { stdout: "pipe" }).stdout.toString().trim();
    const bin = path.join(temporary, "bin"); await mkdir(bin, { recursive: true });
    const launcher = path.join(bin, "python3");
    const checker = path.join(temporary, "waiver-check.ts");
    await writeFile(checker, `import { evaluateDeliveryDocumentationAdmission } from ${JSON.stringify(path.join(repositoryRoot, "scripts/delivery-documentation-admission.ts"))};
import { importHarnessConfig, wireRepo } from ${JSON.stringify(path.join(repositoryRoot, "scripts/delivery-product.ts"))};
import { appendFileSync } from "node:fs";
import { computeDeliverableIdentity, DELIVERY_PROVIDER_RAILS_VERSION } from ${JSON.stringify(path.join(repositoryRoot, ".agent-skills/current/runtime/kernel.mjs"))};
import { createInterface } from "node:readline";
const input = createInterface({ input: process.stdin });
for await (const line of input) {
const message = JSON.parse(line);
if (message.kind === "negotiate") {
  console.log(JSON.stringify({ kind: "negotiation", outcome: "supported", selectedVersion: DELIVERY_PROVIDER_RAILS_VERSION, supportedVersions: [DELIVERY_PROVIDER_RAILS_VERSION] })); continue;
}
const root = process.cwd(); const config = await importHarnessConfig(root); const capture = await (await wireRepo(root, config)).captureCandidate();
if (!capture.ok) throw new Error("Fixture capture failed");
const headSha = ${JSON.stringify(git("rev-parse", "HEAD"))};
const approvedDigest = await computeDeliverableIdentity({ rootDir: root, treeSha: headSha, config });
const result = await evaluateDeliveryDocumentationAdmission(root, {
  evaluateDocumentation: () => ({ status: "fail", findings: [{ policy: "compound-solution", label: "Solution notes", message: "missing" }] }),
  captureCandidate: async () => capture, repository: "fixture/repo", pullRequest: { number: 1, pull_request: { head: { sha: headSha }, base: { ref: "main", sha: headSha } } },
  discoverWaiver: async request => {
    if (request.expected.headSha !== headSha || request.expected.baseTipSha !== headSha || request.expected.deliverableTreeSha !== approvedDigest || request.expected.identityVersion !== config.computingIdentityVersion || request.findingCodes.join() !== "compound-solution") throw new Error("Waiver binding changed");
    return { recordId: "github-check:123", approvedBy: "human", attestationUrl: "https://github.com/fixture/repo/actions/runs/1", attestation: {} as never };
  },
});
if (result.status !== "pass") throw new Error("Waiver admission refused " + capture.candidate.mode);
appendFileSync(${JSON.stringify(path.join(temporary, "waiver-modes"))}, capture.candidate.mode + "\\n");
console.log(JSON.stringify({ kind: "terminal", version: DELIVERY_PROVIDER_RAILS_VERSION, requestId: message.requestId, sequence: 1, outcome: "success", summary: "Trusted waiver admission passed", result: {} }));
break;
}
input.close();
`);
    await writeFile(launcher, `#!${python}
import os, sys
args = sys.argv[1:]
phase = args[args.index("harness") + 1] if "harness" in args else ""
if phase == os.environ.get("FIXTURE_FAIL_PHASE"):
    open("unexpected.ts", "w").write("export {};\\n")
os.execv(${JSON.stringify(python)}, [${JSON.stringify(python)}] + args)
`);
    await chmod(launcher, 0o755);
    if (failPhase === "stage") {
      const realGit = Bun.spawnSync(["which", "git"], { stdout: "pipe" }).stdout.toString().trim();
      const gitLauncher = path.join(bin, "git");
      await writeFile(gitLauncher, `#!${python}
import os, sys
if sys.argv[1:3] == ["add", "--"]:
    sys.exit(7)
os.execv(${JSON.stringify(realGit)}, [${JSON.stringify(realGit)}] + sys.argv[1:])
`);
      await chmod(gitLauncher, 0o755);
    }
    return native("pr-athena-delivery-run.ts", [], { PATH: bin + path.delimiter + process.env.PATH, FIXTURE_FAIL_PHASE: failPhase ?? "" });
  };
  const start = async () => {
    expect(await run(["emit", "run.started", "--json", JSON.stringify({ host: "codex", workflow: { releaseId: "fixture", profile: "linear" } })]), errors.join("\n")).toBe(0);
    expect(await run(["save-context", "--json", JSON.stringify({ contract: { objective: "Exercise the coordinator", acceptanceCriteria: ["Export verified evidence"], finishLine: "merge-ready" }, stage: "work" })]), errors.join("\n")).toBe(0);
    expect(await run(["prepare"]), errors.join("\n")).toBe(0);
  };
  const staged = () => git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
  return { root, temporary, git, write, config, run, start, staged, coordinate, errors };
}

it("refuses a missing accepted context before producing any artifacts", async () => {
  const f = await fixture();
  expect(await f.coordinate()).toBe(1);
  expect(f.errors.join("\n")).toContain("delivery_context_missing");
  expect(f.staged()).toEqual([]);
  expect(await readCurrentDeliveryRunExport(f.root)).toBeNull();
}, 30000);

it("runs the real product through gate, staged export, record and final verification, preserving unrelated staging", async () => {
  const f = await fixture();
  await f.write("unrelated.txt", "already staged\n"); f.git("add", "unrelated.txt");
  const before = f.git("rev-parse", ":unrelated.txt");
  await f.start();
  expect(await f.coordinate(), f.errors.join("\n")).toBe(0);
  expect(f.git("rev-parse", ":unrelated.txt")).toBe(before);
  expect(await readFile(path.join(f.root, ".git/mechanical-runs"), "utf8")).toBe("prepared\n");
  const artifacts = f.staged().filter(file => file.startsWith("telemetry/"));
  expect(artifacts).toHaveLength(2);
  const recordPath = artifacts.find(file => file.includes("record"))!;
  expect(parseDeliveryRecord(await readFile(path.join(f.root, recordPath), "utf8")).ok).toBe(true);
  const run = await readCurrentDeliveryRunExport(f.root);
  const gate = run?.events.findLast(event => event.kind === "command.completed" && event.payload.command === "gate");
  const digest = await computeDeliverableIdentity({ rootDir: f.root, treeSha: f.git("write-tree"), config: { ...f.config, computingIdentityVersion: "validation-tree/v1", reviewNeutral: f.config.recordNeutral } });
  expect(gate?.payload.digest).toBe(digest);
  console.log(JSON.stringify({ nativeCoordinator: "verified", gateDigest: digest, mechanicalExecutions: 1 }));
  expect(run?.events.filter(event => event.kind === "command.completed").at(-1)?.payload).toMatchObject({ command: "verify", outcome: "ok" });
}, 30000);

it.each(["save-context", "gate", "prepare", "record", "verify"])("propagates a real product %s failure and leaves only artifacts already produced", async phase => {
  const f = await fixture(); await f.start();
  expect(await f.coordinate(phase)).toBe(1);
  const artifacts = f.staged().filter(file => file.startsWith("telemetry/"));
  expect(artifacts).toHaveLength(["save-context", "gate"].includes(phase) ? 0 : phase === "verify" ? 2 : 1);
  if (phase === "gate") expect((await readCurrentDeliveryRunExport(f.root))?.summary.gate?.outcome).not.toBe("ok");
  expect(f.git("ls-files", "--others", "--exclude-standard")).toContain("unexpected.ts");
}, 30000);

it("returns a Git staging failure without creating a delivery record or staging unrelated work", async () => {
  const f = await fixture(); await f.start();
  expect(await f.coordinate("stage")).toBe(7);
  expect(f.staged()).toEqual([]);
  const untracked = f.git("ls-files", "--others", "--exclude-standard").split("\n");
  expect(untracked).toHaveLength(1);
  expect(untracked[0]).toMatch(/^telemetry\/delivery-runs\/run-[a-f0-9]+\.json$/);
}, 30000);

it("retains the same exact-head waiver through the coordinator's staged export and delivery record", async () => {
  const f = await fixture(true); await f.start();
  expect(await f.coordinate(), f.errors.join("\n")).toBe(0);
  expect((await readFile(path.join(f.temporary, "waiver-modes"), "utf8")).trim().split("\n")).toEqual(["clean", "staged-index", "staged-index"]);
  expect(f.staged()).toHaveLength(2);
}, 30000);

it.each(["source.ts", "docs/reports/changed.html", "docs/solutions/changed.md", "graphify-out/graph.json", "telemetry/delivery-runs/not-a-record.ts"])("refuses staged non-record differences from an approved head: %s", async file => {
  const f = await fixture(); const headSha = f.git("rev-parse", "HEAD");
  await f.write(file, "changed\n"); f.git("add", file);
  let discovered = false;
  const result = await evaluateDeliveryDocumentationAdmission(f.root, {
    evaluateDocumentation: () => ({ status: "fail", findings: [{ policy: "compound-solution", label: "Solution notes", message: "missing" }] }),
    repository: "fixture/repo", pullRequest: { number: 1, pull_request: { head: { sha: headSha }, base: { ref: "main", sha: headSha } } },
    discoverWaiver: async () => { discovered = true; return undefined; },
  });
  expect(result.status).toBe("fail"); expect(discovered).toBe(false);
}, 30000);

it.each(["run.json", "delivery-record.json"])("admits only record-neutral staged JSON with unchanged exact approval binding: %s", async name => {
  const f = await fixture(); const headSha = f.git("rev-parse", "HEAD");
  await f.write(`telemetry/delivery-runs/${name}`, "{}\n"); f.git("add", ".");
  let discovered = false;
  const result = await evaluateDeliveryDocumentationAdmission(f.root, {
    evaluateDocumentation: () => ({ status: "fail", findings: [{ policy: "compound-solution", label: "Solution notes", message: "missing" }] }),
    repository: "fixture/repo", pullRequest: { number: 1, pull_request: { head: { sha: headSha }, base: { ref: "main", sha: headSha } } },
    discoverWaiver: async request => {
      discovered = true;
      expect(request.expected).toMatchObject({ headSha, baseRef: "origin/main", baseTipSha: headSha });
      expect(request.findingCodes).toEqual(["compound-solution"]);
      return { recordId: "github-check:123", approvedBy: "human", attestationUrl: "https://github.com/fixture/repo/actions/runs/1", attestation: {} as never };
    },
  });
  expect(result.status).toBe("pass"); expect(discovered).toBe(true);
}, 30000);
