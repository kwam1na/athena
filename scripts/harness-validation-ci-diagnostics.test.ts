import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectValidationDiagnostics,
  boundValidationDiagnostics,
  unavailableDiagnostics,
  writeValidationDiagnostics,
  diagnosticsDirectory,
  type AttemptDiagnostic,
  type ReadDiagnostics,
} from "./harness-validation-ci-diagnostics";
import type {
  NativeValidationInput,
  NativeValidationResult,
} from "./harness-validation-native";
import type { NativeValidationSelection } from "./harness-validation-load";
import { ATHENA_LEGACY_CONFIG } from "./harness-base-config";

function fixture(count = 1) {
  const binding = {
    repository: "owner/repo",
    runId: 20,
    runAttempt: 1,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
  };
  const candidate = {
    vcs: "git" as const,
    mode: "clean" as const,
    statusEntries: [],
    untrackedFiles: [],
    treeSha: "c".repeat(40),
    headSha: binding.headSha,
    workspaceId: "workspace",
    base: {
      ref: binding.baseSha,
      tipSha: binding.baseSha,
      mergeBaseSha: binding.baseSha,
    },
    deliverable: { digest: "deliverable", identity: "identity" },
  };
  const checks = Array.from({ length: count }, (_, i) => ({
    id: `check-${i}`,
    profile: "unit",
    cwd: ".",
    argv: ["bun", "run", "test"],
    membership: ["a.test.ts"],
    inputs: [],
    absentInputs: [],
    prerequisites: [],
    supersedes: [],
    identity: "check",
    reasons: [],
    coveredChecks: [`check-${i}`, `covered-${i}`],
  }));
  const plan = {
    schemaVersion: "athena-validation-plan/1",
    mode: "full-health",
    authority: "legacy-gate",
    evidence: "not-evaluated",
    digest: "plan",
    changes: [],
    checks,
  } as NativeValidationSelection["plan"];
  const config = {
    ...ATHENA_LEGACY_CONFIG,
    computingIdentityVersion: "identity",
  };
  const providers = checks.map((c, i) => ({
    providerId: `provider-${i}`,
    attempts: [
      {
        version: "scoped-attempt/1" as const,
        providerId: `provider-${i}`,
        attemptId: `attempt-${i}`,
        generation: 1,
        inputDigest: "input",
        profileDigest: "profile",
        status: "failed" as "failed" | "interrupted",
        origin: {
          runId: "native-run",
          candidate: {
            treeSha: candidate.treeSha,
            baseRef: binding.baseSha,
            baseTipSha: binding.baseSha,
            mergeBaseSha: binding.baseSha,
            workspaceId: "workspace",
            identityToken: "identity",
            deliverableDigest: "deliverable",
          },
        },
      },
    ],
  }));
  const result = {
    status: "failed",
    candidate,
    phase: "gate",
    exitCode: 1,
    phases: [{ phase: "gate", exitCode: 1 }],
    beforeObservations: {
      version: "scoped-check-observations/1",
      providers: [],
    },
    observations: { version: "scoped-check-observations/1", providers },
  } as NativeValidationResult;
  const nativeInput = {
    rootDir: "/fixture",
    config,
    binding,
    env: {},
    checkIdToProviderId: Object.fromEntries(
      checks.map((c, i) => [c.id, `provider-${i}`]),
    ),
  } as NativeValidationInput;
  const selection = {
    candidate,
    plan,
    inventory: [],
    packageScripts: {},
  } as unknown as NativeValidationSelection;
  const detail: AttemptDiagnostic = {
    availability: "available",
    phase: "command",
    failure: { code: "check_command_failed" },
    command: {
      exitCode: 7,
      outputTail: "assertion failed [REDACTED]",
      truncated: false,
    },
  };
  const calls: string[][] = [];
  const read = async ({ attemptIds }: Parameters<ReadDiagnostics>[0]) => {
    calls.push([...attemptIds]);
    return {
      version: "scoped-check-diagnostics/1" as const,
      unavailableAttemptIds: [] as readonly string[],
      providers: providers
        .filter((p) => attemptIds.includes(p.attempts[0].attemptId))
        .map((p) => ({
          ...p,
          attempts: p.attempts.map((a) => ({
            ...a,
            diagnostic: detail as AttemptDiagnostic,
          })),
        })),
    };
  };
  return {
    rootDir: "/fixture",
    binding,
    selection,
    plan,
    nativeInput,
    result,
    read,
    providers,
    detail,
    calls,
  };
}

test("maps current new attempts to canonical and covered checks without exporting raw errors", async () => {
  const f = fixture();
  (f.result as { error?: string }).error = "SECRET raw error";
  const output = await collectValidationDiagnostics(f);
  expect(f.calls).toEqual([["attempt-0"]]);
  expect(output.rows[0].coveredCheckIds).toEqual(["check-0", "covered-0"]);
  expect(output.rows[0].diagnostic).toEqual(f.detail);
  expect(output.binding).toEqual(f.binding);
  expect(JSON.stringify(output)).not.toContain("SECRET");
  expect(output.rows[0].attempt?.origin.runId).toBe("native-run");
});

test("excludes old attempts and mismatched observation bindings", async () => {
  for (const mismatch of [
    "old",
    "provider",
    "tree",
    "base",
    "identity",
    "deliverable",
    "workspace",
  ]) {
    const f = fixture();
    const a = f.providers[0].attempts[0];
    if (mismatch === "old")
      f.result.beforeObservations = structuredClone(f.result.observations);
    if (mismatch === "provider") a.providerId = "other";
    if (mismatch === "tree") a.origin.candidate.treeSha = "other";
    if (mismatch === "base") a.origin.candidate.baseTipSha = "other";
    if (mismatch === "identity") a.origin.candidate.identityToken = "other";
    if (mismatch === "deliverable")
      a.origin.candidate.deliverableDigest = "other";
    if (mismatch === "workspace") a.origin.candidate.workspaceId = "other";
    const output = await collectValidationDiagnostics(f);
    expect(f.calls).toEqual([]);
    expect(output.rows[0].unavailable).toBe("no-new-attempt");
  }
});

test("refuses swapped exported bindings, duplicate IDs, unsupported schemas and corrupt history", async () => {
  for (const mismatch of ["digest", "origin", "duplicate", "schema", "throw"]) {
    const f = fixture();
    const read = f.read;
    f.read = async (input) => {
      if (mismatch === "throw") throw Error("SECRET corruption");
      const d = await read(input);
      const a = d.providers[0].attempts[0];
      if (mismatch === "digest") a.inputDigest = "swapped";
      if (mismatch === "origin") a.origin = { ...a.origin, runId: "swapped" };
      if (mismatch === "duplicate") d.providers[0].attempts.push(a);
      if (mismatch === "schema") (d as { version: string }).version = "unknown";
      return d;
    };
    const output = await collectValidationDiagnostics(f);
    expect(output.rows[0].diagnostic).toBeUndefined();
    expect(output.rows[0].unavailable).toBe("diagnostic-read-unavailable");
    expect(JSON.stringify(output)).not.toContain("SECRET");
  }
});

test("retains typed precommand failure, legacy/running and explicit absent-attempt diagnostics", async () => {
  for (const detail of [
    { availability: "unavailable", reason: "legacy" },
    { availability: "unavailable", reason: "running" },
    {
      availability: "available",
      phase: "snapshot-setup",
      failure: { code: "check_dependency_failed" },
      command: { unavailable: "not-started" },
    },
    {
      availability: "available",
      phase: "command",
      failure: { unavailable: "unclassified" },
      command: { unavailable: "not-completed" },
    },
  ] as AttemptDiagnostic[]) {
    const f = fixture();
    const read = f.read;
    f.read = async (i) => {
      const d = await read(i);
      d.providers[0].attempts[0].diagnostic = detail;
      return d;
    };
    expect((await collectValidationDiagnostics(f)).rows[0].diagnostic).toEqual(
      detail,
    );
  }
  const f = fixture();
  f.read = async ({ attemptIds }) => ({
    version: "scoped-check-diagnostics/1" as const,
    providers: [],
    unavailableAttemptIds: attemptIds,
  });
  expect((await collectValidationDiagnostics(f)).rows[0].unavailable).toBe(
    "attempt-diagnostics-unavailable",
  );
  expect(
    (await collectValidationDiagnostics({ ...f, result: undefined })).native
      .phase,
  ).toBe("capture");
});

test("chunks more than100 selected IDs and bounds artifact bytes with explicit omissions", async () => {
  const f = fixture(205);
  const read = f.read;
  f.read = async (i) => {
    const d = await read(i);
    for (const p of d.providers)
      for (const a of p.attempts)
        a.diagnostic = {
          availability: "available",
          phase: "command",
          failure: { code: "check_command_failed" },
          command: {
            exitCode: 1,
            outputTail: "x".repeat(4000),
            truncated: true,
          },
        };
    return d;
  };
  const output = await collectValidationDiagnostics(f);
  expect(f.calls.map((c) => c.length)).toEqual([100, 100, 5]);
  expect(new Set(f.calls.flat()).size).toBe(205);
  expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(64 * 1024);
  expect(output.truncated).toBe(true);
  expect(output.omittedRows).toBeGreaterThan(0);
});

test("retains a late failed row when successful rows exhaust the artifact cap", async () => {
  const report = await collectValidationDiagnostics(fixture());
  const original = report.rows[0];
  report.rows = Array.from({ length: 205 }, (_, i) => ({
    ...structuredClone(original),
    checkId: `check-${i}`,
    attempt: {
      ...original.attempt!,
      status: i === 204 ? ("failed" as const) : ("passed" as const),
    },
  }));

  const output = boundValidationDiagnostics(report);

  expect(output.truncated).toBe(true);
  expect(output.omittedRows).toBeGreaterThan(0);
  expect(output.rows.length + output.omittedRows).toBe(report.rows.length);
  expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(64 * 1024);
  expect(output.rows.some((row) => row.checkId === "check-204")).toBe(true);
  expect(output.rows.some((row) => row.attempt?.status === "passed")).toBe(true);
});

test("does not publish arbitrary diagnostic fields or oversize command output", async () => {
  const f = fixture();
  const read = f.read;
  f.read = async (i) => {
    const d = await read(i);
    Object.assign(d.providers[0].attempts[0].diagnostic, {
      rawError: "SECRET",
    });
    return d;
  };
  expect(JSON.stringify(await collectValidationDiagnostics(f))).not.toContain(
    "SECRET",
  );
  f.read = async (i) => {
    const d = await read(i);
    const detail = d.providers[0].attempts[0].diagnostic;
    if (detail.availability === "available" && "outputTail" in detail.command)
      d.providers[0].attempts[0].diagnostic = {
        ...detail,
        command: { ...detail.command, outputTail: "x".repeat(4001) },
      };
    return d;
  };
  expect((await collectValidationDiagnostics(f)).rows[0].unavailable).toBe(
    "diagnostic-read-unavailable",
  );
});

test("atomic fixed-path diagnostic writer refuses aliased directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "health-diag-"));
  const outside = await mkdtemp(path.join(tmpdir(), "health-diag-outside-"));
  try {
    const f = fixture();
    await writeValidationDiagnostics(
      root,
      unavailableDiagnostics(f.plan, f.binding, "runtime-unavailable"),
    );
    expect(
      JSON.parse(
        await readFile(
          path.join(root, "artifacts/validation-ci/diagnostics.json"),
          "utf8",
        ),
      ).authority,
    ).toBe("diagnostic-only");
    await rm(path.join(root, "artifacts"), { recursive: true, force: true });
    await symlink(outside, path.join(root, "artifacts"));
    await expect(diagnosticsDirectory(root)).rejects.toThrow("Unsafe");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("adapter exposes safe startup diagnostics through injected native ports", async () => {
  const { execFileSync } = await import("node:child_process");
  const { realpath } = await import("node:fs/promises");
  const { createValidationCiRuntime } =
    await import("./harness-validation-ci-adapter");
  const { projectValidationPolicy } =
    await import("./harness-validation-policy");
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "diag-adapter-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    );
    const f = fixture();
    const sha = git("rev-parse", "HEAD");
    f.binding.headSha = sha;
    f.binding.baseSha = sha;
    f.selection.candidate = {
      ...f.selection.candidate,
      headSha: sha,
      treeSha: git("rev-parse", "HEAD^{tree}"),
      base: { ref: sha, tipSha: sha, mergeBaseSha: sha },
    };
    const api = await createValidationCiRuntime(root, {
      env: {},
      controllerRoot: root,
      authenticate: async () => ({
        ...f.binding,
        defaultMainSha: sha,
        defaultBranch: "main",
        workflowId: 42,
      }),
      loadLegacy: async () => ATHENA_LEGACY_CONFIG,
      captureSelection: async () => f.selection,
      configure: (_root, base) => {
        const projected = projectValidationPolicy(base, f.plan, {
          profiles: [
            {
              id: "plain",
              gitContext: "none",
              dependencyInputs: [],
              mutableOutputs: [],
              credentialIdentities: {},
            },
          ],
          profileByCheck: { "check-0": "plain" },
          mechanicalChecks: [],
        });
        return { ...projected, selection: f.selection };
      },
      executeNative: async () => {
        throw new Error("SECRET startup");
      },
      readDiagnostics: async () => {
        throw new Error("No attempt should be requested");
      },
    });
    await api.healthInventory(sha);
    const plan = await api.recomputePlan(f.binding, "full-health");
    await expect(
      api.execute(plan, f.binding, {
        invocationId: "owner/repo:20:1:full-health",
        health: {
          schemaVersion: "athena-validation-health/1",
          revision: "health",
          observedAt: 1,
          availability: "available",
          findings: [],
          closedFindings: [],
        },
      }),
    ).rejects.toThrow("startup");
    const report = await api.readDiagnostics!(plan, f.binding);
    expect(report.native.phase).toBe("capture");
    expect(report.rows[0].unavailable).toBe("no-new-attempt");
    expect(JSON.stringify(report)).not.toContain("SECRET");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves unknown raw exit and closed execution error codes for interrupted attempts", async () => {
  const f = fixture();
  f.providers[0].attempts[0].status = "interrupted";
  const read = f.read;
  f.read = async (input) => {
    const data = await read(input);
    data.providers[0].attempts[0].diagnostic = {
      availability: "available",
      phase: "command",
      failure: { code: "check_command_failed", executionErrorCode: "SIGTERM" },
      command: { exitCode: null, outputTail: "interrupted", truncated: false },
    };
    return data;
  };
  const report = await collectValidationDiagnostics(f);
  expect(report.rows[0].attempt?.status).toBe("interrupted");
  expect(report.rows[0].diagnostic).toEqual({
    availability: "available",
    phase: "command",
    failure: { code: "check_command_failed", executionErrorCode: "SIGTERM" },
    command: { exitCode: null, outputTail: "interrupted", truncated: false },
  });
});

test("actual public CI capture differs from planning identity and diagnostics bind the native capture", async () => {
  const { execFileSync } = await import("node:child_process");
  const { realpath, writeFile } = await import("node:fs/promises");
  const { wireRepo } =
    await import("../.agent-skills/current/runtime/cli-api.mjs");
  const { projectValidationPolicy } =
    await import("./harness-validation-policy");
  const { createCiValidationConfiguration } =
    await import("./harness-validation-ci-policy");
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "diag-capture-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    await writeFile(path.join(root, "a.test.ts"), "// fixture\n");
    await writeFile(path.join(root, ".gitignore"), "artifacts/\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "fixture",
    );
    const f = fixture();
    const sha = git("rev-parse", "HEAD");
    const base = { ...ATHENA_LEGACY_CONFIG, baseRef: sha };
    const planning = await (await wireRepo(root, base)).captureCandidate();
    if (!planning.ok) throw Error(JSON.stringify(planning.blockers));
    f.selection.candidate = planning.candidate;
    f.binding.headSha = sha;
    f.binding.baseSha = sha;
    const projected = projectValidationPolicy(base, f.plan, {
      profiles: [
        {
          id: "plain",
          gitContext: "none",
          dependencyInputs: [],
          mutableOutputs: [],
          credentialIdentities: {},
        },
      ],
      profileByCheck: { "check-0": "plain" },
      mechanicalChecks: [],
    });
    const ci = createCiValidationConfiguration(projected.config, true);
    const native = await (await wireRepo(root, ci)).captureCandidate();
    if (!native.ok) throw Error(JSON.stringify(native.blockers));
    expect(native.candidate.treeSha).toBe(planning.candidate.treeSha);
    expect(native.candidate.deliverable.digest).not.toBe(
      planning.candidate.deliverable.digest,
    );
    const providerId = projected.checks[0].providerId;
    f.nativeInput.config = ci;
    f.nativeInput.checkIdToProviderId = { "check-0": providerId };
    f.result.candidate = native.candidate;
    f.providers[0].providerId = providerId;
    const a = f.providers[0].attempts[0];
    a.providerId = providerId;
    a.origin.candidate = {
      treeSha: native.candidate.treeSha,
      baseRef: native.candidate.base.ref,
      baseTipSha: native.candidate.base.tipSha,
      mergeBaseSha: native.candidate.base.mergeBaseSha,
      workspaceId: native.candidate.workspaceId,
      identityToken: native.candidate.deliverable.identity,
      deliverableDigest: native.candidate.deliverable.digest,
    };
    expect((await collectValidationDiagnostics(f)).rows[0].diagnostic).toEqual(
      f.detail,
    );
    f.result.candidate = planning.candidate;
    expect((await collectValidationDiagnostics(f)).rows[0].unavailable).toBe(
      "native-candidate-unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overflow diagnostic preserves typed cause while omitting clipped output", async () => {
  const f = fixture();
  const read = f.read;
  f.read = async (input) => {
    const data = await read(input);
    data.providers[0].attempts[0].diagnostic = {
      availability: "available",
      phase: "command",
      failure: {
        code: "check_command_failed",
        executionErrorCode: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      },
      command: { unavailable: "not-completed" },
    };
    return data;
  };
  const report = await collectValidationDiagnostics(f);
  expect(report.rows[0].diagnostic).toEqual({
    availability: "available",
    phase: "command",
    failure: {
      code: "check_command_failed",
      executionErrorCode: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    },
    command: { unavailable: "not-completed" },
  });
  expect(JSON.stringify(report)).not.toContain("outputTail");
});
