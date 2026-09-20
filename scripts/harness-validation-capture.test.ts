import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import config from "./harness-base-config";
import {
  candidateTreeEvidenceReader,
  runGitCommand,
} from "../.agent-skills/current/runtime/kernel.mjs";
import {
  captureCanonicalValidationPlan,
  assertSelectionCandidate,
  projectCapturedValidationPlan,
  type SourceReaderFactory,
} from "./harness-validation-capture";

const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
async function fixture(
  run: (root: string, git: (...args: string[]) => string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "athena-validation-capture-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    await mkdir(join(root, "docs/reports"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      '{"name":"fixture","private":true}',
    );
    await writeFile(join(root, "docs/reports/change.html"), "before");
    git("add", ".");
    git("commit", "-qm", "fixture base");
    await run(root, git);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const fixtureConfig = { ...config, baseRef: "refs/heads/main" };
// Small fixture uses the same public immutable reader protocol; production has
// no fallback and explicitly requires the unbounded source capability.
const fixtureReader: SourceReaderFactory = async (...args) =>
  Object.assign(await candidateTreeEvidenceReader(...args), {
    // This fixture contains only regular files; metadata qualification has its own
    // source-reader controls. Never substitute this fixture port in production.
    metadata: async () => ({ mode: "100644", links: [] }),
  });
const ports = { readSource: fixtureReader };

describe("native candidate-bound validation selection", () => {
  it("uses the installed native source reader for files beyond the evidence limit", async () =>
    fixture(async (root, git) => {
      const source = "€".repeat(750000);
      await writeFile(join(root, "docs/reports/change.html"), source);
      git("add", ".");
      const result = await captureCanonicalValidationPlan(
        root,
        fixtureConfig,
        "comparison",
      );
      expect(result.snapshots.candidate["docs/reports/change.html"]).toBe(
        source,
      );
      expect(result.candidate.treeSha).toBe(git("write-tree"));
      expect(
        result.plan.checks.some((check) => check.profile === "docs-publishing"),
      ).toBe(true);
    }));
  it("plans the staged tree and both complete native snapshots", async () =>
    fixture(async (root, git) => {
      await writeFile(join(root, "docs/reports/change.html"), "after");
      git("add", ".");
      const result = await captureCanonicalValidationPlan(
        root,
        fixtureConfig,
        "comparison",
        ports,
      );
      expect(result.candidate.treeSha).toBe(git("write-tree"));
      expect(result.plan.changes).toEqual([
        { path: "docs/reports/change.html", status: "modified" },
      ]);
      expect(result.snapshots.base["docs/reports/change.html"]).toBe("before");
      expect(result.snapshots.candidate["docs/reports/change.html"]).toBe(
        "after",
      );
      expect(
        result.plan.checks.some((check) => check.profile === "docs-publishing"),
      ).toBe(true);
    }));
  it("projects only captured scripts and inventory for the Node config bridge", async () =>
    fixture(async (root, git) => {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "fixture",
          scripts: { test: "captured-command" },
        }),
      );
      git("add", ".");
      const capture = await captureCanonicalValidationPlan(
        root,
        fixtureConfig,
        "comparison",
        ports,
      );
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "fixture",
          scripts: { test: "ambient-command" },
        }),
      );
      const projection = projectCapturedValidationPlan(capture);
      expect(projection.packageScripts["."].test).toBe("captured-command");
      expect(projection.inventory).toContain("package.json");
      expect(projection).not.toHaveProperty("snapshots");
      expect(projection.candidate).toEqual(capture.candidate);
    }));
  it("captures the current base tip, including consumers added after divergence", async () =>
    fixture(async (root, git) => {
      git("checkout", "-qb", "candidate");
      git("checkout", "-q", "main");
      await writeFile(
        join(root, "docs/reports/base-added.html"),
        "new base consumer",
      );
      git("add", ".");
      git("commit", "-qm", "new base consumer");
      git("checkout", "-q", "candidate");
      const result = await captureCanonicalValidationPlan(
        root,
        fixtureConfig,
        "comparison",
        ports,
      );
      expect(result.candidate.base.tipSha).not.toBe(
        result.candidate.base.mergeBaseSha,
      );
      expect(result.snapshots.base["docs/reports/base-added.html"]).toBe(
        "new base consumer",
      );
      expect(result.plan.changes).toContainEqual({
        path: "docs/reports/base-added.html",
        status: "deleted",
      });
    }));
  it("retains the product's refusal for unstaged source", async () =>
    fixture(async (root) => {
      await writeFile(join(root, "docs/reports/change.html"), "unstaged");
      await expect(
        captureCanonicalValidationPlan(
          root,
          fixtureConfig,
          "comparison",
          ports,
        ),
      ).rejects.toThrow();
    }));
  it("refuses changes during the source read instead of authorizing an old selection", async () =>
    fixture(async (root, git) => {
      let changed = false;
      const readSource: SourceReaderFactory = async (...args) => {
        const native = await fixtureReader(...args);
        return Object.assign(
          async (path: string) => {
            if (!changed) {
              changed = true;
              await writeFile(join(root, "docs/reports/change.html"), "raced");
              git("add", ".");
            }
            return native(path);
          },
          { metadata: native.metadata },
        );
      };
      await expect(
        captureCanonicalValidationPlan(root, fixtureConfig, "comparison", {
          readSource,
        }),
      ).rejects.toThrow("moved");
    }));
  it("refuses incomplete listing transport", async () =>
    fixture(async (root) => {
      await expect(
        captureCanonicalValidationPlan(root, fixtureConfig, "comparison", {
          ...ports,
          run: async (command, options) =>
            command[1] === "ls-tree"
              ? { exitCode: 0, stdout: "unparseable\0", stderr: "" }
              : runGitCommand(command, options),
        }),
      ).rejects.toThrow("Incomplete");
    }));
  it("binds base movement independently of identical source bytes", async () =>
    fixture(async (root) => {
      const { candidate } = await captureCanonicalValidationPlan(
        root,
        fixtureConfig,
        "comparison",
        ports,
      );
      expect(() =>
        assertSelectionCandidate(candidate, {
          ...candidate,
          base: { ...candidate.base, tipSha: "f".repeat(40) },
        }),
      ).toThrow("moved");
    }));
});
