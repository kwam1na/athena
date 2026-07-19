import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const decoder = new TextDecoder();
const fixtureRoots: string[] = [];

async function createHookFixture(fakeBunSource: string) {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "athena-pre-push-hook-"),
  );
  fixtureRoots.push(fixtureRoot);

  const fixtureBin = path.join(fixtureRoot, "bin");
  const fixtureTmp = path.join(fixtureRoot, "tmp");
  await mkdir(path.join(fixtureRoot, ".husky"), { recursive: true });
  await mkdir(fixtureBin, { recursive: true });
  await mkdir(fixtureTmp, { recursive: true });
  await writeFile(
    path.join(fixtureRoot, ".husky/pre-push"),
    await readFile(path.join(ROOT_DIR, ".husky/pre-push"), "utf8"),
  );
  await writeFile(path.join(fixtureBin, "bun"), fakeBunSource);
  await chmod(path.join(fixtureBin, "bun"), 0o755);

  expect(
    Bun.spawnSync(["git", "init", "-q"], { cwd: fixtureRoot }).exitCode,
  ).toBe(0);

  return {
    fixtureRoot,
    fixtureTmp,
    env: {
      ...process.env,
      ATHENA_PRE_PUSH_HEARTBEAT_SECONDS: "1",
      PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
      TMPDIR: fixtureTmp,
    },
  };
}

async function waitForFile(filePath: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(filePath);
      return;
    } catch {
      await Bun.sleep(10);
    }
  }

  throw new Error(`Timed out waiting for ${filePath}`);
}

function retainedLogPath(output: string) {
  const match = output.match(/Full validation log retained at (.+)/);
  if (!match?.[1]) {
    throw new Error(`Missing retained log path in output:\n${output}`);
  }
  return match[1].trim();
}

function isProcessAlive(pid: number) {
  return Bun.spawnSync(["kill", "-0", String(pid)], {
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0;
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((fixtureRoot) =>
      rm(fixtureRoot, { recursive: true, force: true }),
    ),
  );
});

describe("bounded pre-push hook", () => {
  it("propagates failure status while byte-bounding diagnostics and retaining the full log", async () => {
    const fixture = await createHookFixture(
      [
        "#!/bin/sh",
        "index=0",
        'while [ "$index" -lt 250 ]; do',
        '  echo "failure-line-$index"',
        "  index=$((index + 1))",
        "done",
        "awk 'BEGIN { printf \"large-line:\"; for (i = 0; i < 50000; i++) printf \"x\"; printf \"\\n\" }'",
        "exit 7",
      ].join("\n"),
    );

    const result = Bun.spawnSync(["sh", ".husky/pre-push"], {
      cwd: fixture.fixtureRoot,
      env: fixture.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = decoder.decode(result.stderr);

    expect(result.exitCode).toBe(7);
    expect(stderr).toContain("capped at 16 KiB");
    expect(stderr.length).toBeLessThan(18_000);

    const logPath = retainedLogPath(stderr);
    expect(path.basename(logPath)).not.toContain("XXXXXX");
    const fullLog = await readFile(logPath, "utf8");
    expect(fullLog).toContain("failure-line-0");
    expect(fullLog).toContain("failure-line-249");
    expect(fullLog).toContain(`large-line:${"x".repeat(50_000)}`);
  });

  it.each([
    { signal: 1, name: "HUP", status: 129 },
    { signal: 15, name: "TERM", status: 143 },
    { signal: 13, name: "PIPE", status: 141 },
  ])(
    "forwards $name to the validator tree, returns $status, and retains the log",
    async ({ signal, name, status }) => {
      const fixture = await createHookFixture(
        [
          "#!/bin/sh",
          'echo "$$" > "$ATHENA_TEST_PARENT_PID_FILE"',
          "sh -c 'echo \"$$\" > \"$ATHENA_TEST_CHILD_PID_FILE\"; while :; do sleep 1; done' &",
          "wait",
        ].join("\n"),
      );
      const parentPidFile = path.join(fixture.fixtureRoot, "validator.pid");
      const childPidFile = path.join(fixture.fixtureRoot, "validator-child.pid");
      const hook = Bun.spawn(["sh", ".husky/pre-push"], {
        cwd: fixture.fixtureRoot,
        env: {
          ...fixture.env,
          ATHENA_TEST_CHILD_PID_FILE: childPidFile,
          ATHENA_TEST_PARENT_PID_FILE: parentPidFile,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      await Promise.all([waitForFile(parentPidFile), waitForFile(childPidFile)]);
      const parentPid = Number((await readFile(parentPidFile, "utf8")).trim());
      const childPid = Number((await readFile(childPidFile, "utf8")).trim());

      process.kill(hook.pid, signal);
      const [exitCode, stderr] = await Promise.all([
        hook.exited,
        new Response(hook.stderr).text(),
      ]);

      expect(exitCode).toBe(status);
      expect(stderr).toContain(`Interrupted by ${name}`);
      expect(await readFile(retainedLogPath(stderr), "utf8")).toBeDefined();
      expect(isProcessAlive(parentPid)).toBe(false);
      expect(isProcessAlive(childPid)).toBe(false);
    },
    15_000,
  );

  it("propagates a real heartbeat EPIPE to the hook and stops the validator tree", async () => {
    const fixture = await createHookFixture(
      [
        "#!/bin/sh",
        'echo "$$" > "$ATHENA_TEST_PARENT_PID_FILE"',
        "sh -c 'echo \"$$\" > \"$ATHENA_TEST_CHILD_PID_FILE\"; while :; do sleep 1; done' &",
        "wait",
      ].join("\n"),
    );
    const parentPidFile = path.join(fixture.fixtureRoot, "validator.pid");
    const childPidFile = path.join(fixture.fixtureRoot, "validator-child.pid");

    const result = Bun.spawnSync(
      ["bash", "-o", "pipefail", "-c", "sh .husky/pre-push | head -n 1"],
      {
        cwd: fixture.fixtureRoot,
        env: {
          ...fixture.env,
          ATHENA_TEST_CHILD_PID_FILE: childPidFile,
          ATHENA_TEST_PARENT_PID_FILE: parentPidFile,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stderr = decoder.decode(result.stderr);
    const parentPid = Number((await readFile(parentPidFile, "utf8")).trim());
    const childPid = Number((await readFile(childPidFile, "utf8")).trim());

    expect(result.exitCode).toBe(141);
    expect(stderr).toContain("Interrupted by PIPE");
    expect(await readFile(retainedLogPath(stderr), "utf8")).toBeDefined();
    expect(isProcessAlive(parentPid)).toBe(false);
    expect(isProcessAlive(childPid)).toBe(false);
  });
});
