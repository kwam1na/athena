import { describe, expect, it, vi } from "vitest";

import { evaluateDeliveryDocumentationAdmission } from "./delivery-documentation-admission";
import { DELIVERABLE_TREE_V1 as HARNESS_REVIEW_IDENTITY_VERSION } from "../.agent-skills/current/runtime/kernel.mjs";

const candidate = {
  vcs: "git" as const,
  workspaceId: "workspace-1",
  headSha: "head-1",
  treeSha: "tree-1",
  deliverable: {
    digest: "deliverable-1",
    identity: HARNESS_REVIEW_IDENTITY_VERSION,
  },
  base: { ref: "origin/main", tipSha: "base-1", mergeBaseSha: "merge-base-1" },
  mode: "clean" as const,
  statusEntries: [],
  untrackedFiles: [],
};

const pullRequest = {
  number: 123,
  pull_request: {
    head: { sha: "head-1" },
    base: { ref: "main", sha: "base-1" },
  },
};

const documentationFailure = {
  status: "fail" as const,
  findings: [
    {
      policy: "compound-solution" as const,
      label: "Solution notes" as const,
      message: "missing",
    },
  ],
};

describe("evaluateDeliveryDocumentationAdmission", () => {
  it("passes immediately when live documentation is current", async () => {
    const discoverWaiver = vi.fn();
    const result = await evaluateDeliveryDocumentationAdmission("/repo", {
      evaluateDocumentation: () => ({ status: "pass", findings: [] }),
      collectDocuments: async () => [
        { path: "docs/reports/current.html", content: "reviewed report" },
      ],
      discoverWaiver,
    });

    expect(result).toEqual({
      status: "pass",
      resolution: "live",
      documents: [
        { path: "docs/reports/current.html", content: "reviewed report" },
      ],
    });
    expect(discoverWaiver).not.toHaveBeenCalled();
  });

  it("admits a verified waiver for the exact pull-request candidate", async () => {
    const result = await evaluateDeliveryDocumentationAdmission("/repo", {
      evaluateDocumentation: () => documentationFailure,
      captureCandidate: async () => ({ ok: true as const, candidate }),
      repository: "v26-labs/athena",
      pullRequest,
      discoverWaiver: async () => ({
        recordId: "github-check:789",
        approvedBy: "human-reviewer",
        attestationUrl: "https://github.com/v26-labs/athena/actions/runs/456",
        attestation: {} as never,
      }),
    });

    expect(result).toMatchObject({
      status: "pass",
      resolution: "waived",
      waiver: { recordId: "github-check:789" },
    });
  });

  it.each(["synthetic-merge-commit", "different-source-commit"])(
    "rejects waiver against a different head: %s",
    async (headSha) => {
      const discoverWaiver = vi.fn();
      const result = await evaluateDeliveryDocumentationAdmission("/repo", {
        evaluateDocumentation: () => documentationFailure,
        captureCandidate: async () => ({
          ok: true as const,
          candidate: { ...candidate, headSha },
        }),
        repository: "v26-labs/athena",
        pullRequest,
        discoverWaiver,
      });
      expect(result.status).toBe("fail");
      expect(discoverWaiver).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ref: "origin/other", tipSha: "base-1", mergeBaseSha: "merge-base-1" },
    { ref: "origin/main", tipSha: "moved-base", mergeBaseSha: "merge-base-1" },
  ])("refuses a waiver after the approved base changes: %j", async base => {
    const discoverWaiver = vi.fn();
    const result = await evaluateDeliveryDocumentationAdmission("/repo", {
      evaluateDocumentation: () => documentationFailure,
      captureCandidate: async () => ({ ok: true as const, candidate: { ...candidate, base } }),
      repository: "v26-labs/athena", pullRequest, discoverWaiver,
    });
    expect(result.status).toBe("fail");
    expect(discoverWaiver).not.toHaveBeenCalled();
  });

  it("admits staged telemetry but refuses source and report drift against the approved head", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { default: config } = await import("../harness.config");
    const root = await mkdtemp(path.join(tmpdir(), "athena-staged-documentation-"));
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    const waiver = {
      recordId: "github-check:789", approvedBy: "human-reviewer",
      attestationUrl: "https://github.com/v26-labs/athena/actions/runs/456",
      attestation: {} as never,
    };
    const discoverWaiver = vi.fn(async () => waiver);
    try {
      git("init", "-q");
      await writeFile(path.join(root, "harness.config.ts"), `export default ${JSON.stringify(config)};`);
      await writeFile(path.join(root, "source.ts"), "export const value = 1;\n");
      await mkdir(path.join(root, "telemetry/delivery-runs"), { recursive: true });
      await writeFile(path.join(root, "telemetry/delivery-runs/export.json"), "{}\n");
      git("add", ".");
      git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-qm", "approved head");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const headSha = git("rev-parse", "HEAD");
      const approvedPullRequest = {
        number: 123,
        pull_request: { head: { sha: headSha }, base: { ref: "main", sha: headSha } },
      };
      for (const file of ["telemetry/delivery-runs/export.json", "source.ts", "docs/reports/changed.html"]) {
        git("reset", "--hard", "HEAD");
        discoverWaiver.mockClear();
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), "changed staged bytes\n");
        git("add", file);
        expect(git("diff", "--cached", "--name-only")).toBe(file);
        // Capture and compare with the installed product's real Git/config path.
        const result = await evaluateDeliveryDocumentationAdmission(root, {
          evaluateDocumentation: () => documentationFailure,
          repository: "v26-labs/athena", pullRequest: approvedPullRequest, discoverWaiver,
        });
        if (file.startsWith("telemetry/")) {
          expect(result).toEqual({ status: "pass", resolution: "waived", waiver });
          expect(discoverWaiver).toHaveBeenCalledWith(expect.objectContaining({
            expected: expect.objectContaining({ headSha, baseTipSha: headSha }),
            findingCodes: ["compound-solution"],
          }));
        } else {
          expect(result.status, file).toBe("fail");
          expect(discoverWaiver, file).not.toHaveBeenCalled();
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a staged approval when repository configuration is unreadable", async () => {
    const discoverWaiver = vi.fn();
    const result = await evaluateDeliveryDocumentationAdmission("/repo", {
      evaluateDocumentation: () => documentationFailure,
      captureCandidate: async () => ({
        ok: true as const,
        candidate: { ...candidate, mode: "staged-index" as const },
      }),
      repository: "v26-labs/athena",
      pullRequest,
      discoverWaiver,
    });
    expect(result.status).toBe("fail");
    expect(discoverWaiver).not.toHaveBeenCalled();
  });
});

it("retains the actual report bytes in the installed sensor's JSON output", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { collectDeliverableDiffFingerprint } =
    await import("./delivery-diff-fingerprint");
  const root = await mkdtemp(path.join(tmpdir(), "athena-documentation-json-"));
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const git = (args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  try {
    git(["init"]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const fingerprint = collectDeliverableDiffFingerprint(
      root,
      "origin/main",
      [],
    );
    const sections = [
      "summary",
      "problem",
      "mental-model",
      "before-after",
      "key-files",
      "changes",
      "validation",
      "guidance",
      "subagent-evidence",
    ];
    const content = `<!doctype html><html><head><title>Fixture</title></head><body><article data-athena-landed-change-report="v2" data-athena-report-diff-fingerprint="${fingerprint}">${sections.map((section) => `<section data-report-section="${section}"><h2>${section}</h2><p>Evidence.</p></section>`).join("")}<section data-report-section="quiz" data-quiz-pass-threshold="4">Quiz</section></article></body></html>`;
    await mkdir(path.join(root, "docs/reports"), { recursive: true });
    await writeFile(path.join(root, "docs/reports/fixture.html"), content);
    const result = Bun.spawnSync(
      [
        "bun",
        path.join(import.meta.dir, "delivery-documentation-admission.ts"),
        "--json",
      ],
      { cwd: root, env, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      status: "pass",
      resolution: "live",
      documents: [{ path: "docs/reports/fixture.html", content }],
    });
    const { default: config } = await import("../harness.config");
    await writeFile(
      path.join(root, "harness.config.ts"),
      `export default ${JSON.stringify(config)};`,
    );
    await writeFile(
      path.join(root, "docs/reports/fixture.html"),
      "<html>stale report</html>",
    );
    const refused = Bun.spawnSync(
      [
        "bun",
        path.join(import.meta.dir, "delivery-documentation-admission.ts"),
        "--json",
      ],
      { cwd: root, env, stdout: "pipe", stderr: "pipe" },
    );
    expect(refused.exitCode).toBe(1);
    expect(JSON.parse(refused.stdout.toString()).status).toBe("fail");
    expect(refused.stderr.toString()).toContain(
      "documentation_admission_failed",
    );
    expect(refused.stderr.toString()).not.toContain("harness_internal_error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
