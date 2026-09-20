import { describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
  realpath,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ATHENA_LEGACY_CONFIG } from "./harness-base-config";
import {
  guardValidationCandidate,
  runValidationGuardCli,
} from "./harness-validation-trust";

type TrustFixture = {
  root: string;
  baseRoot: string;
  candidateRoot: string;
  git: (cwd: string, ...args: string[]) => string;
  env: Record<string, string>;
  ports: {
    legacyConfig: typeof ATHENA_LEGACY_CONFIG;
    requestJson: (endpoint: string) => Promise<unknown>;
  };
};
async function fixture(
  run: (f: TrustFixture) => Promise<void>,
  historical = false,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "athena-trust-")));
  const baseRoot = join(root, "base"),
    candidateRoot = join(root, "candidate");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    await mkdir(baseRoot);
    git(baseRoot, "init", "-q", "-b", "main");
    git(baseRoot, "config", "user.name", "Fixture");
    git(baseRoot, "config", "user.email", "fixture@example.test");
    await mkdir(join(baseRoot, "scripts"));
    await mkdir(join(baseRoot, "docs/reports"), { recursive: true });
    await writeFile(
      join(baseRoot, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: {
          "landed-report:check":
            "bun scripts/landed-change-report-check.ts --base origin/main",
          "harness:inferential-review":
            "bun scripts/harness-inferential-review.ts",
        },
      }),
    );
    for (const app of ["athena-webapp", "storefront-webapp"]) {
      await mkdir(join(baseRoot, "packages", app), { recursive: true });
      await writeFile(
        join(baseRoot, "packages", app, "package.json"),
        JSON.stringify({
          scripts: {
            build: "vite build && tsc --noEmit",
            "build:assets": "vite build",
            typecheck: "tsc --noEmit",
          },
        }),
      );
      await writeFile(join(baseRoot, "packages", app, "tsconfig.json"), "{}");
    }
    await writeFile(
      join(baseRoot, "harness.config.ts"),
      'throw new Error("CANDIDATE_CONFIG_EXECUTED");',
    );
    if (!historical)
      await writeFile(
        join(baseRoot, "scripts/harness-validation-runtime.ts"),
        'throw new Error("CANDIDATE_RUNTIME_EXECUTED");',
      );
    await writeFile(join(baseRoot, "docs/reports/sentinel.html"), "before");
    git(baseRoot, "add", ".");
    git(baseRoot, "commit", "-qm", "base");
    const baseSha = git(baseRoot, "rev-parse", "HEAD");
    git(baseRoot, "clone", "-q", baseRoot, candidateRoot);
    git(candidateRoot, "config", "user.name", "Fixture");
    git(candidateRoot, "config", "user.email", "fixture@example.test");
    await writeFile(
      join(candidateRoot, "docs/reports/sentinel.html"),
      "candidate sentinel",
    );
    git(candidateRoot, "add", ".");
    git(candidateRoot, "commit", "-qm", "candidate");
    const env = {
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "10",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/feature",
      GITHUB_SHA: git(candidateRoot, "rev-parse", "HEAD"),
      GITHUB_WORKSPACE: root,
      VALIDATION_GUARD_BASE_SHA: baseSha,
    };
    const requestJson = async (endpoint: string) => {
      if (endpoint.endsWith("/actions/runs/10"))
        return {
          id: 10,
          run_attempt: 1,
          head_sha: env.GITHUB_SHA,
          event: "workflow_dispatch",
          head_branch: "feature",
          workflow_id: 42,
          path: ".github/workflows/athena-pr-tests.yml",
          repository: { full_name: "owner/repo" },
          head_repository: { full_name: "owner/repo" },
        };
      if (endpoint.includes("/actions/workflows/"))
        return { id: 42, path: ".github/workflows/athena-pr-tests.yml" };
      if (endpoint.endsWith("/commits/main")) return { sha: baseSha };
      return { default_branch: "main" };
    };
    await run({
      root,
      baseRoot,
      candidateRoot,
      git,
      env,
      ports: { legacyConfig: ATHENA_LEGACY_CONFIG, requestJson },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("base-owned candidate trust guard", () => {
  it("parses actual candidate source using base policy without evaluating candidate config/runtime", async () =>
    fixture(async (f) => {
      const result = await guardValidationCandidate(
        f.baseRoot,
        f.candidateRoot,
        f.env,
        f.ports,
      );
      expect(result.readiness).toBe("scoped");
      expect(result.selection?.plan.changes).toEqual([
        { path: "docs/reports/sentinel.html", status: "modified" },
      ]);
      expect(
        result.selection?.plan.checks.some(
          (c) => c.profile === "docs-publishing",
        ),
      ).toBe(true);
      expect(result.selection?.candidate.headSha).toBe(f.env.GITHUB_SHA);
      expect(
        await readFile(
          join(f.candidateRoot, "docs/reports/sentinel.html"),
          "utf8",
        ),
      ).toBe("candidate sentinel");
      expect(f.git(f.candidateRoot, "status", "--porcelain")).toBe("");
    }));
  it("returns historical absence as legacy with no selection", async () =>
    fixture(async (f) => {
      const result = await guardValidationCandidate(
        f.baseRoot,
        f.candidateRoot,
        f.env,
        { requestJson: f.ports.requestJson },
      );
      expect(result).toMatchObject({
        readiness: "legacy",
        reason: "historical-guard-absence",
        selection: null,
      });
    }, true));
  it.each(["harness.config.ts", "scripts/harness-base-config.ts"])(
    "requires legacy for committed authority change %s without importing candidate code",
    async (authorityPath) =>
      fixture(async (f) => {
        await writeFile(
          join(f.candidateRoot, authorityPath),
          'throw new Error("NEVER_EXECUTE");',
        );
        f.git(f.candidateRoot, "add", ".");
        f.git(f.candidateRoot, "commit", "-qm", "authority change");
        f.env.GITHUB_SHA = f.git(f.candidateRoot, "rev-parse", "HEAD");
        expect(
          await guardValidationCandidate(
            f.baseRoot,
            f.candidateRoot,
            f.env,
            f.ports,
          ),
        ).toMatchObject({
          readiness: "legacy",
          selection: null,
          changedControllerPaths: [authorityPath],
        });
      }),
  );
  it.each([
    "dirty",
    "staged",
    "untracked",
    "deleted-base-guard",
    "wrong-head",
    "symlink-root",
    "same-root",
  ])("rejects %s instead of readiness", async (kind) =>
    fixture(async (f) => {
      let candidate = f.candidateRoot;
      if (kind === "dirty" || kind === "staged") {
        await writeFile(join(candidate, "docs/reports/sentinel.html"), "dirty");
        if (kind === "staged") f.git(candidate, "add", ".");
      }
      if (kind === "untracked")
        await writeFile(join(candidate, "extra.ts"), "extra");
      if (kind === "deleted-base-guard")
        await rm(join(f.baseRoot, "scripts/harness-validation-runtime.ts"));
      if (kind === "wrong-head") f.env.GITHUB_SHA = "f".repeat(40);
      if (kind === "symlink-root") {
        candidate = join(f.root, "alias");
        await symlink(f.candidateRoot, candidate);
      }
      if (kind === "same-root") candidate = f.baseRoot;
      await expect(
        guardValidationCandidate(f.baseRoot, candidate, f.env, f.ports),
      ).rejects.toThrow(
        kind === "wrong-head"
          ? "HEAD"
          : kind === "symlink-root"
            ? "aliases"
            : kind === "same-root"
              ? "distinct"
              : "dirty",
      );
    }),
  );
});

it("rejects authenticated base movement on the final check", async () =>
  fixture(async (f) => {
    let reads = 0;
    const requestJson = async (endpoint: string) => {
      if (endpoint.endsWith("/commits/main") && ++reads === 2)
        return { sha: "f".repeat(40) };
      return f.ports.requestJson(endpoint);
    };
    await expect(
      guardValidationCandidate(f.baseRoot, f.candidateRoot, f.env, {
        ...f.ports,
        requestJson,
      }),
    ).rejects.toThrow("Pinned base moved");
  }));
it("rejects candidate mutation after selection rather than returning readiness", async () =>
  fixture(async (f) => {
    let reads = 0;
    const requestJson = async (endpoint: string) => {
      if (endpoint.endsWith("/actions/runs/10") && ++reads === 2)
        await writeFile(
          join(f.candidateRoot, "docs/reports/sentinel.html"),
          "late change",
        );
      return f.ports.requestJson(endpoint);
    };
    await expect(
      guardValidationCandidate(f.baseRoot, f.candidateRoot, f.env, {
        ...f.ports,
        requestJson,
      }),
    ).rejects.toThrow("dirty");
  }));
it("rejects escaped committed links even when they change authority", async () =>
  fixture(async (f) => {
    await symlink(
      "/tmp/outside-authority",
      join(f.candidateRoot, "scripts/escape.ts"),
    );
    f.git(f.candidateRoot, "add", ".");
    f.git(f.candidateRoot, "commit", "-qm", "escape");
    f.env.GITHUB_SHA = f.git(f.candidateRoot, "rev-parse", "HEAD");
    await expect(
      guardValidationCandidate(f.baseRoot, f.candidateRoot, f.env, f.ports),
    ).rejects.toThrow();
  }));
it("rejects a committed symlink base guard rather than historical absence", async () =>
  fixture(async (f) => {
    await rm(join(f.baseRoot, "scripts/harness-validation-runtime.ts"));
    await symlink(
      "./harness-base-config.ts",
      join(f.baseRoot, "scripts/harness-validation-runtime.ts"),
    );
    f.git(f.baseRoot, "add", ".");
    f.git(f.baseRoot, "commit", "-qm", "invalid guard");
    const sha = f.git(f.baseRoot, "rev-parse", "HEAD");
    f.env.VALIDATION_GUARD_BASE_SHA = sha;
    const requestJson = async (endpoint: string) =>
      endpoint.endsWith("/commits/main")
        ? { sha }
        : f.ports.requestJson(endpoint);
    await expect(
      guardValidationCandidate(f.baseRoot, f.candidateRoot, f.env, {
        ...f.ports,
        requestJson,
      }),
    ).rejects.toThrow("regular committed");
  }));
it("does not silently import a config when the explicit base config is missing", async () =>
  fixture(async (f) => {
    await expect(
      guardValidationCandidate(f.baseRoot, f.candidateRoot, f.env, {
        requestJson: f.ports.requestJson,
      }),
    ).rejects.toThrow("supplied explicitly");
  }));
it("propagates authenticated API failure without readiness", async () =>
  fixture(async (f) => {
    await expect(
      guardValidationCandidate(f.baseRoot, f.candidateRoot, f.env, {
        ...f.ports,
        requestJson: async () => {
          throw new Error("GitHub unavailable");
        },
      }),
    ).rejects.toThrow("GitHub unavailable");
  }));

it("publishes false readiness for an authenticated legacy fallback", async () =>
  fixture(async (f) => {
    const outputs: string[] = [];
    await runValidationGuardCli(
      ["guard", "--candidate-root", f.candidateRoot],
      {
        ...f.ports,
        baseRoot: f.baseRoot,
        env: f.env,
        writeOutput: async (text) => {
          outputs.push(text);
        },
      },
    );
    expect(outputs).toEqual(["base_guard_ready=false\n"]);
  }, true));

it("publishes true readiness only after real base-owned selection", async () =>
  fixture(async (f) => {
    const outputs: string[] = [];
    await runValidationGuardCli(
      ["guard", "--candidate-root", f.candidateRoot],
      {
        ...f.ports,
        baseRoot: f.baseRoot,
        env: f.env,
        writeOutput: async (text) => {
          outputs.push(text);
        },
      },
    );
    expect(outputs).toEqual(["base_guard_ready=true\n"]);
  }));

it("publishes no readiness after malformed arguments or failed authentication", async () =>
  fixture(async (f) => {
    const outputs: string[] = [];
    const options = {
      ...f.ports,
      baseRoot: f.baseRoot,
      env: f.env,
      writeOutput: async (text: string) => {
        outputs.push(text);
      },
    };
    await expect(
      runValidationGuardCli(
        ["guard", "--candidate-root", f.candidateRoot, "--ready"],
        options,
      ),
    ).rejects.toThrow("Usage");
    await expect(
      runValidationGuardCli(["guard", "--candidate-root", f.candidateRoot], {
        ...options,
        requestJson: async () => {
          throw new Error("API failed");
        },
      }),
    ).rejects.toThrow("API failed");
    expect(outputs).toEqual([]);
  }));

it("accepts authenticated PR head/base while rejecting a changed or foreign PR identity", async () =>
  fixture(async (f) => {
    const candidateSha = f.env.GITHUB_SHA;
    const env = {
      ...f.env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_SHA: "f".repeat(40),
      VALIDATION_CANDIDATE_SHA: candidateSha,
      VALIDATION_PR_NUMBER: "123",
    };
    const original = f.ports.requestJson;
    const requestJson = async (endpoint: string) => {
      if (endpoint.endsWith("/pulls/123"))
        return {
          base: {
            sha: env.VALIDATION_GUARD_BASE_SHA,
            ref: "main",
            repo: { full_name: "owner/repo" },
          },
          head: { sha: candidateSha, repo: { full_name: "owner/repo" } },
        };
      const result = await original(endpoint);
      return endpoint.endsWith("/actions/runs/10")
        ? {
            ...(result as Record<string, unknown>),
            event: "pull_request",
            head_sha: candidateSha,
          }
        : result;
    };
    const result = await guardValidationCandidate(
      f.baseRoot,
      f.candidateRoot,
      env,
      { legacyConfig: f.ports.legacyConfig, requestJson },
    );
    expect(result.readiness).toBe("scoped");
    expect(result.selection?.candidate.headSha).toBe(candidateSha);
    for (const head of [
      { sha: "b".repeat(40), repo: { full_name: "owner/repo" } },
      { sha: candidateSha, repo: { full_name: "foreign/repo" } },
    ]) {
      await expect(
        guardValidationCandidate(f.baseRoot, f.candidateRoot, env, {
          legacyConfig: f.ports.legacyConfig,
          requestJson: async (endpoint) =>
            endpoint.endsWith("/pulls/123")
              ? {
                  base: {
                    sha: env.VALIDATION_GUARD_BASE_SHA,
                    ref: "main",
                    repo: { full_name: "owner/repo" },
                  },
                  head,
                }
              : requestJson(endpoint),
        }),
      ).rejects.toThrow("base or candidate changed");
    }
  }));
