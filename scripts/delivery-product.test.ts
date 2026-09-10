import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  defineHarnessConfig, computeDeliverableIdentity, GATE_STRUCTURAL_FINDING_CODES,
  type HarnessConfigInput,
} from "../.agent-skills/current/runtime/kernel.mjs";
import { installDeliveryProductSigquitHandler, runDeliveryProduct, wireRepo } from "./delivery-product";
import { reviewEvidenceArguments } from "./harness-review-evidence";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it.each([
  { platform: "darwin", expected: ["on:SIGQUIT", "remove:SIGQUIT"] },
  { platform: "win32", expected: [] },
] as const)("SIGQUIT listener lifecycle follows the $platform platform guard", ({ platform, expected }) => {
  const observed: string[] = [];
  const remove = installDeliveryProductSigquitHandler(
    platform,
    () => {},
    signal => { observed.push(`on:${signal}`); },
    signal => { observed.push(`remove:${signal}`); },
  );
  remove();
  expect(observed).toEqual(expected);
});

function config(overrides: Partial<HarnessConfigInput> = {}) {
  return defineHarnessConfig({
    gateId: "athena-test.pr-validation", acceptedEnvelopeSpecs: ["delivery-evidence/1"],
    identityVersions: ["deliverable-tree/v1"], computingIdentityVersion: "deliverable-tree/v1",
    reviewNeutral: [{ prefix: "docs/reports/" }, { prefix: "docs/solutions/" }, { prefix: "telemetry/delivery-runs/" }],
    recordNeutral: [{ prefix: "telemetry/delivery-runs/" }],
    pathClassification: { generated: [], test: [], lockfile: [] }, sensitivePaths: [], activationThreshold: 1,
    providers: [{ id: "native-review", findingCodes: [] }], agentEnvSignals: ["TEST_AGENT"], ciPolicies: [], ciPolicyEnvKey: "TEST_CI_POLICY",
    preparationWiringPaths: ["harness.config.ts"], preparationCommands: [], deliveryRecordPath: "telemetry/delivery-runs/record.json",
    obligations: [{ id: "review.green", activation: { kind: "relevant_change" }, freshness: "exact_candidate", providers: ["native-review"],
      acceptedPayloadSpecs: ["review.green/1"], allowedResolutionKinds: ["satisfied_evidence", "not_applicable"], humanWaiverAllowed: false,
      minimumAttestationLevel: "self", ciDelegationPolicyIds: [], waivableCodes: [], nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES],
      remediation: { default: [{ id: "review", kind: "manual_action", summary: "Complete independent review." }] },
    }], ...overrides,
  });
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "athena-product-core-")); roots.push(root);
  const git = async (...args: string[]) => (await exec("git", args, { cwd: root })).stdout.trim();
  const write = async (name: string, contents: string) => { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents); };
  await git("init", "-q"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
  await write("harness.config.ts", "export default {};\n"); await write("source.ts", "export const value = 1;\n");
  await git("add", "."); await git("-c", "commit.gpgsign=false", "commit", "-qm", "base"); await git("branch", "origin/main");
  const out: string[] = [], errors: string[] = [];
  const run = async (args: string[], current = config()) => {
    out.length = errors.length = 0;
    return runDeliveryProduct(args, root, { env: { TEST_AGENT: "1" }, stdinIsTTY: false, stdoutIsTTY: false,
      stdout: text => out.push(text), stderr: text => errors.push(text), loadConfig: async () => current });
  };
  return { root, git, write, run, out, errors };
}

it("uses product capture for clean, staged, unstaged, and untracked candidates", async () => {
  const f = await fixture(); const wiring = await wireRepo(f.root, config());
  expect((await wiring.captureCandidate()).ok).toBe(true);
  await f.write("source.ts", "export const value = 2;\n");
  expect((await wiring.captureCandidate()).ok).toBe(false);
  await f.git("add", "source.ts");
  const staged = await wiring.captureCandidate(); expect(staged.ok).toBe(true);
  if (staged.ok) expect(staged.candidate.mode).toBe("staged-index");
  await f.write("untracked.ts", "new\n");
  expect((await wiring.captureCandidate()).ok).toBe(false);
});

it("a real failing mechanical command prevents preparation and review context", async () => {
  const f = await fixture();
  const failed = config({ preparationCommands: [{ id: "mechanical", command: ["bun", "-e", "process.exit(1)"], timeoutMs: 10000 }] });
  expect(await f.run(["prepare"], failed)).toBe(1);
  expect(await f.run(["review-context"], failed)).toBe(1);
  expect(await f.run(["prepare"]), f.errors.join("\n")).toBe(0);
  expect(await f.run(["review-context"]), f.errors.join("\n")).toBe(0);
});

it("prepared source changes still block gate and recording without reviewer evidence", async () => {
  const f = await fixture(); await f.write("source.ts", "export const value = 2;\n"); await f.git("add", "source.ts");
  expect(await f.run(["prepare"])).toBe(0);
  expect(await f.run(["gate"])).toBe(1);
  expect(f.errors.join("\n")).toContain("review_evidence_missing");
  expect(await f.run(["record"])).toBe(1);
  expect(await f.run(["verify"])).toBe(1);
});

it.each(["docs/reports/result.html", "docs/solutions/learning.md", "telemetry/delivery-runs/run.json"])("product review identity excludes only configured narration: %s", async name => {
  const f = await fixture(); const c = config();
  const digest = async () => computeDeliverableIdentity({ rootDir: f.root, treeSha: await f.git("write-tree"), config: c });
  const initial = await digest(); await f.write(name, "narration\n"); await f.git("add", "."); expect(await digest()).toBe(initial);
  await f.write("generated/api.ts", "generated change\n"); await f.git("add", "."); expect(await digest()).not.toBe(initial);
});

it("keeps familiar evidence aliases as direct product arguments", () => {
  expect(reviewEvidenceArguments(["context"])).toEqual(["review-context", "--json"]);
  expect(reviewEvidenceArguments(["record", "/tmp/evidence.json"])).toEqual(["submit-evidence", "--manifest", "/tmp/evidence.json"]);
});

it.each(["comment", "graph", "mode", "rename", "delete"])("product identity invalidates review for %s changes", async kind => {
  const f = await fixture(); const c = config();
  const digest = async () => computeDeliverableIdentity({ rootDir: f.root, treeSha: await f.git("write-tree"), config: c });
  const initial = await digest();
  if (kind === "comment") await f.write("source.ts", "// Changed source comment\nexport const value = 1;\n");
  if (kind === "graph") await f.write("graphify-out/graph.json", "{}\n");
  if (kind === "mode") await f.git("update-index", "--chmod=+x", "source.ts");
  if (kind === "rename") await f.git("mv", "source.ts", "renamed.ts");
  if (kind === "delete") await f.git("rm", "source.ts");
  if (kind !== "mode") await f.git("add", ".");
  expect(await digest()).not.toBe(initial);
});

it("preparation rejects changed base and policy rather than reusing old context", async () => {
  const f = await fixture();
  expect(await f.run(["prepare"])).toBe(0);
  await f.write("harness.config.ts", "export default { activationThreshold: 2 };\n"); await f.git("add", "harness.config.ts");
  expect(await f.run(["review-context"])).toBe(1);
  await f.write("source.ts", "export const value = 2;\n"); await f.git("add", ".");
  await f.git("-c", "commit.gpgsign=false", "commit", "-qm", "candidate");
  expect(await f.run(["prepare"])).toBe(0);
  await f.git("branch", "-f", "origin/main", "HEAD");
  expect(await f.run(["review-context"])).toBe(1);
});

it("product evidence ingestion refuses absent and malformed evidence", async () => {
  const f = await fixture(); expect(await f.run(["prepare"])).toBe(0);
  expect(await f.run(["submit-evidence", "--manifest", path.join(f.root, ".git/missing.json")])).toBe(1);
  await f.write(".git/malformed.json", "{broken");
  expect(await f.run(["submit-evidence", "--manifest", path.join(f.root, ".git/malformed.json")])).toBe(1);
});

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const productEntry = path.join(repositoryRoot, "scripts/delivery-product.ts");

async function installedFixture() {
  const f = await fixture();
  for (const name of [".agent-skills", ".agents/skills", ".claude/skills"]) {
    await cp(path.join(repositoryRoot, name), path.join(f.root, name), { recursive: true, verbatimSymlinks: true });
  }
  await f.write("harness.config.ts", `export default ${JSON.stringify(config())};\n`);
  await f.git("add", ".");
  await f.git("-c", "commit.gpgsign=false", "commit", "-qm", "installed product fixture");
  await f.git("branch", "-f", "origin/main", "HEAD");
  const native = async (...args: string[]) => {
    const child = Bun.spawn(["bun", productEntry, ...args], { cwd: f.root, env: { ...process.env, TEST_AGENT: "1" }, stdout: "pipe", stderr: "pipe" });
    const [code, out, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, out, errors };
  };
  return { ...f, native };
}

it("native installed commands prepare successfully and refuse missing review evidence", async () => {
  const f = await installedFixture();
  await f.write("source.ts", "export const value = 2;\n"); await f.git("add", "source.ts");
  const prepared = await f.native("prepare");
  expect(prepared.code, prepared.out + prepared.errors).toBe(0);
  expect(prepared.out).toContain("prepared athena-test.pr-validation");
  const denied = await f.native("gate");
  expect(denied.code).toBe(1);
  expect(denied.out + denied.errors).toContain("review_evidence_missing");
}, 20000);

it.each(["--help", "-h"])("native installed %s exposes product commands", async flag => {
  const f = await installedFixture();
  const help = await f.native(flag);
  expect(help.code, help.errors).toBe(0);
  expect(help.out).toContain("prepare");
  expect(help.out).toContain("submit-evidence");
  expect(help.out).toContain("resume");
}, 20000);

it.each([
  { signal: "SIGINT", terminalGroup: false, resistant: true },
  { signal: "SIGTERM", terminalGroup: false, resistant: true },
  { signal: "SIGHUP", terminalGroup: false, resistant: true },
  { signal: "SIGHUP", terminalGroup: true, resistant: true },
  { signal: "SIGQUIT", terminalGroup: false, resistant: false },
  { signal: "SIGQUIT", terminalGroup: false, resistant: true },
  { signal: "SIGQUIT", terminalGroup: true, resistant: false },
  { signal: "SIGQUIT", terminalGroup: true, resistant: true },
] as const)("native wrapper %j waits for launcher and worker termination", async ({ signal, terminalGroup, resistant }) => {
  const f = await fixture();
  // Import the installed launcher's cancellation boundary without changing its payload.
  const installed = path.join(repositoryRoot, ".agent-skills/current");
  await f.write(".agent-skills/current/__main__.py", `import os, sys\nfrom pathlib import Path\nsys.path.insert(0, ${JSON.stringify(installed)})\nfrom agent_skills.product import _run_command\nPath('launcher.pid').write_text(str(os.getpid()))\nraise SystemExit(_run_command([sys.executable, '-B', 'worker.py', ${JSON.stringify(String(resistant))}], Path.cwd()))\n`);
  await f.write("worker.py", "import os, signal, sys, time\nfrom pathlib import Path\nresistant = sys.argv[1] == 'true'\ndef received(signum, _frame):\n    Path('worker.sig').write_text(signal.Signals(signum).name)\n    if not resistant: os._exit(0)\nfor name in ('SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'):\n    if hasattr(signal, name): signal.signal(getattr(signal, name), received)\nPath('worker.pid').write_text(str(os.getpid()))\nwhile True: time.sleep(1)\n");
  // An isolated foreground group models a terminal hangup reaching both the
  // wrapper and its Python child; the runtime itself starts a detached session.
  const command = terminalGroup
    ? ["python3", "-B", "-c", "import os, sys; os.setsid(); os.execvp('bun', ['bun', *sys.argv[1:]])", productEntry, "gate"]
    : ["bun", productEntry, "gate"];
  const wrapper = Bun.spawn(command, { cwd: f.root, stdout: "pipe", stderr: "pipe" });
  let launcherPid: number | undefined;
  let workerPid: number | undefined;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        launcherPid = Number(await readFile(path.join(f.root, "launcher.pid"), "utf8"));
        workerPid = Number(await readFile(path.join(f.root, "worker.pid"), "utf8"));
        break;
      }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    expect(launcherPid).toBeDefined();
    expect(workerPid).toBeDefined();
    if (terminalGroup) {
      await exec("python3", ["-B", "-c", "import os, signal, sys; os.killpg(int(sys.argv[1]), getattr(signal, sys.argv[2]))", String(wrapper.pid), signal]);
    }
    else wrapper.kill(signal);
    const exitCode = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : signal === "SIGHUP" ? 129 : 131;
    expect(await wrapper.exited).toBe(exitCode);
    expect(await readFile(path.join(f.root, "worker.sig"), "utf8")).toBe(signal);
    for (const pid of [launcherPid, workerPid]) {
      const process = await exec("ps", ["-o", "stat=", "-p", String(pid)]).catch(() => ({ stdout: "" }));
      expect(process.stdout.trim() === "" || process.stdout.trim().startsWith("Z")).toBe(true);
    }
  } finally {
    wrapper.kill("SIGKILL");
    if (launcherPid) { try { process.kill(launcherPid, "SIGKILL"); } catch { /* already stopped */ } }
    if (workerPid) { try { process.kill(workerPid, "SIGKILL"); } catch { /* already stopped */ } }
  }
}, 15000);
