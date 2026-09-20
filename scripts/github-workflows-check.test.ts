import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectWorkflowFiles,
  runWorkflowCheck,
  AFFECTED_WORKFLOW_CONTRACT,
} from "./github-workflows-check";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-workflow-check-"));
  tempRoots.push(rootDir);
  return rootDir;
}

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
});

describe("collectWorkflowFiles", () => {
  it("collects only root GitHub workflow YAML files", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      "name: Test\n",
      rootDir,
    );
    await write(".github/workflows/qa.yaml", "name: QA\n", rootDir);
    await write(".github/workflows/notes.md", "# ignored\n", rootDir);
    await write(
      ".github/workflows/nested/ignored.yml",
      "name: nested\n",
      rootDir,
    );

    await expect(collectWorkflowFiles(rootDir)).resolves.toEqual([
      ".github/workflows/athena-pr-tests.yml",
      ".github/workflows/qa.yaml",
    ]);
  });
});

describe("runWorkflowCheck", () => {
  it("parses workflows with Ruby YAML instead of depending on PyYAML", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      "name: Test\non: pull_request\n",
      rootDir,
    );

    const spawnedCommands: string[][] = [];
    const logLines: string[] = [];

    await runWorkflowCheck(rootDir, {
      logger: { log: (line) => logLines.push(line) },
      spawn: (command) => {
        spawnedCommands.push(command);
        return { exited: Promise.resolve(0) };
      },
    });

    expect(spawnedCommands).toEqual([
      [
        "ruby",
        "-ryaml",
        "-e",
        'YAML.load_file(ARGV.fetch(0)); puts "[workflow:check] parsed #{ARGV.fetch(0)}"',
        ".github/workflows/athena-pr-tests.yml",
      ],
      ["ruby", "-ryaml", "-e", AFFECTED_WORKFLOW_CONTRACT],
    ]);
    expect(logLines).toEqual([
      "GitHub workflow YAML check passed for 1 workflow file(s).",
    ]);
  });

  it("fails with the workflow path when YAML parsing fails", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      "name: [broken\n",
      rootDir,
    );

    await expect(
      runWorkflowCheck(rootDir, {
        spawn: () => ({ exited: Promise.resolve(1) }),
      }),
    ).rejects.toThrow(
      "GitHub workflow YAML check failed for .github/workflows/athena-pr-tests.yml",
    );
  });

  it("parses the current repo workflows", async () => {
    await expect(
      runWorkflowCheck(path.resolve(import.meta.dirname, "..")),
    ).resolves.toBeUndefined();
  });
});

describe("hosted consolidated validation ownership", () => {
  it("base-owned contract refuses candidate removal of guard, summary proof, required context or exact health artifact", async () => {
    const repo = path.resolve(import.meta.dirname, "..");
    const pr = await readFile(
      path.join(repo, ".github/workflows/athena-pr-tests.yml"),
      "utf8",
    );
    const health = await readFile(
      path.join(repo, ".github/workflows/athena-validation-health.yml"),
      "utf8",
    );
    const mutations = [
      {
        pr: pr.replace(
          "harness-validation-ci.ts guard --candidate-root",
          "removed-guard",
        ),
        health,
      },
      { pr: pr.replaceAll('test "$NATIVE_VERIFIED" = "true"', "true"), health },
      {
        pr: pr.replace('test "$EXECUTION_RESULT" = "success"', "true"),
        health,
      },
      {
        pr: pr.replaceAll(
          "needs.affected-validation-final.outputs.verified",
          "needs.affected-validation-qualification.outputs.verified",
        ),
        health,
      },
      {
        pr: pr.replace(
          'bun "$GITHUB_WORKSPACE/pinned-base/scripts/harness-validation-ci.ts" verify-final',
          "bun run harness:validation-ci -- verify-final",
        ),
        health,
      },
      {
        pr: pr.replace(
          'bun "$GITHUB_WORKSPACE/pinned-base/scripts/harness-validation-ci.ts" qualify',
          "bun run harness:validation-ci -- qualify",
        ),
        health,
      },
      {
        pr: pr.replace(
          'bun scripts/harness-validation-ci.ts guard --candidate-root "$GITHUB_WORKSPACE/candidate"',
          'echo "base_guard_ready=true" >> "$GITHUB_OUTPUT"',
        ),
        health,
      },
      {
        pr: pr.replace(
          "name: Harness Implementation Tests",
          "name: Removed required context",
        ),
        health,
      },
      {
        pr,
        health: health.replace(
          "path: artifacts/validation-ci/health.json",
          "path: artifacts/validation-ci/*.json",
        ),
      },
      {
        pr,
        health: health.replace(
          "cancel-in-progress: false",
          "cancel-in-progress: true",
        ),
      },
    ];
    mutations.push(
      {
        pr,
        health: health.replace(
          "name: athena-validation-health-diagnostics",
          "name: removed-diagnostics",
        ),
      },
      {
        pr,
        health: health.replace(
          "path: artifacts/validation-ci/diagnostics.json",
          "path: artifacts/validation-ci/*.json",
        ),
      },
    );
    for (const mutation of mutations) {
      expect(mutation.pr !== pr || mutation.health !== health).toBe(true);
      const root = await createFixtureRoot();
      await write(".github/workflows/athena-pr-tests.yml", mutation.pr, root);
      await write(
        ".github/workflows/athena-validation-health.yml",
        mutation.health,
        root,
      );
      await expect(
        runWorkflowCheck(root, {
          logger: { log() {} },
          spawn: (command, options) =>
            Bun.spawn(command, {
              cwd: options.cwd,
              stdout: "ignore",
              stderr: "ignore",
            }),
        }),
      ).rejects.toThrow("workflow contract failed");
    }
  });
  it("daily health owns a separate serialized workflow and publishes only the authenticated producer artifact", async () => {
    const file = path.resolve(
      import.meta.dirname,
      "../.github/workflows/athena-validation-health.yml",
    );
    const parsed = Bun.spawnSync([
      "ruby",
      "-ryaml",
      "-rjson",
      "-e",
      "puts JSON.generate(YAML.load_file(ARGV.fetch(0)))",
      file,
    ]);
    expect(parsed.exitCode).toBe(0);
    const workflow = JSON.parse(parsed.stdout.toString());
    const trigger = workflow.on ?? workflow.true;
    expect(trigger.schedule).toEqual([{ cron: "0 14 * * *" }]);
    expect(trigger.workflow_dispatch.inputs.bootstrap.type).toBe("boolean");
    expect(workflow.concurrency).toEqual({
      group: "athena-validation-health",
      "cancel-in-progress": false,
    });
    const job = workflow.jobs["full-health"];
    expect(job.if).toContain("github.event.repository.default_branch");
    expect(job.permissions).toEqual({
      actions: "read",
      contents: "read",
      "pull-requests": "read",
    });
    const producer = job.steps.find((s: { id?: string }) => s.id === "produce");
    expect(producer.run).toContain("bun run harness:validation-ci -- health");
    const artifact = job.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(artifact.if).toBe("always()");
    expect(artifact.with.name).toBe("athena-validation-health");
    expect(artifact.with.path).toBe("artifacts/validation-ci/health.json");
    expect(artifact.with["retention-days"]).toBe(90);
  });
  it("runs full coverage and equivalent harness sensors only through harness review while retaining build and production jobs", async () => {
    const { readFile } = await import("node:fs/promises");
    const workflow = await readFile(
      path.resolve(
        import.meta.dirname,
        "../.github/workflows/athena-pr-tests.yml",
      ),
      "utf8",
    );
    expect(
      workflow.match(/run: bun run harness:review --base origin\/main/g),
    ).toHaveLength(1);
    const validationJob = workflow.slice(
      workflow.indexOf("  harness-validation:"),
      workflow.indexOf("  harness-janitor-report:"),
    );
    for (const duplicate of [
      "run: bun run harness:self-review",
      "run: bun run harness:check",
      "run: bun run architecture:check",
      "run: bun run harness:audit",
      "run: bun run harness:inferential-review",
      "run: bun run harness:scorecard",
      "run: bun run graphify:check",
      "bun run test:coverage",
    ])
      expect(validationJob).not.toContain(duplicate);
    expect(workflow).not.toContain("bun run test:coverage");
    expect(workflow).toContain(
      "ATHENA_COVERAGE_MAX_WORKERS: ${{ inputs.coverage_workers || '2' }}",
    );
    expect(workflow).toContain("HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow");
    expect(workflow).toContain("name: Athena and Storefront Webapp Validation");
    expect(workflow).toContain(
      "name: Athena POS E2E against Production Backend",
    );
    expect(workflow).toContain("run: bun run --filter '@athena/webapp' build");
    expect(workflow).toContain(
      "run: bun run --filter '@athena/storefront-webapp' build",
    );
    expect(workflow).not.toContain("--validation-provided-by");
    expect(workflow).toMatch(
      /needs:\s*\[\s*harness-validation,\s*athena-webapp-validation,\s*affected-validation-qualification,\s*affected-validation-final,?\s*\]/,
    );
    expect(workflow).toContain(
      'needs.harness-validation.result }}" != "success"',
    );
  });
});
