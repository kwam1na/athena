import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fixturePolicy from "./fixtures/affected-validation/health/policy.json";
import fixtureDigest from "./fixtures/affected-validation/health/failed-digest.json";
import {
  createHealthApprovalVerifier,
  HEALTH_HISTORY_CHECK_ID,
  evaluateValidationHealth,
  readValidationHealth,
  runHealthProcess,
  type HealthSnapshot,
  type HealthPolicy,
  type RepairProof,
} from "./harness-validation-health";
import { createHash } from "node:crypto";

describe("protected maintainer health approval adapter", () => {
  test("caller cancellation reaches an in-flight health metadata read", async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const pending = readValidationHealth(fixturePolicy as HealthPolicy, {
      signal: controller.signal,
      requestJson: async (_endpoint, signal) => {
        observed = signal;
        controller.abort();
        return new Promise(() => {});
      },
    });
    const result = await pending;
    expect(observed?.aborted).toBe(true);
    expect(result.availability).toBe("api-unavailable");
  });
  const entry = {
    findingId: "failed-unit",
    findingRevision: "revision-1",
    scope: { kind: "package" as const, package: "operator" },
    revalidationRunId: 12,
  };
  const commit = "b".repeat(40);
  function fixture() {
    const body = JSON.stringify({
      schemaVersion: "athena-health-approval/1",
      repository: policy.repository,
      reviewedCommit: commit,
      classification: entry,
    });
    const reference = `https://github.com/${policy.repository}/pull/123#issuecomment-456@sha256:${createHash("sha256").update(body).digest("hex")}`;
    const responses: Record<string, unknown> = {
      [`/repos/${policy.repository}/issues/comments/456`]: {
        id: 456,
        body,
        issue_url: `https://api.github.com/repos/${policy.repository}/issues/123`,
        user: { login: "maintainer", type: "User" },
      },
      [`/repos/${policy.repository}/pulls/123`]: {
        number: 123,
        base: { repo: { full_name: policy.repository } },
      },
      [`/repos/${policy.repository}/collaborators/maintainer/permission`]: {
        permission: "admin",
        user: { login: "maintainer" },
      },
      [`/repos/${policy.repository}/compare/${commit}...${sha}`]: {
        status: "ahead",
      },
    };
    const calls: string[] = [];
    const verify = createHealthApprovalVerifier(
      policy,
      async (endpoint, signal) => {
        expect(signal).toBeDefined();
        calls.push(endpoint);
        if (!(endpoint in responses)) throw new Error("Unavailable API");
        return responses[endpoint];
      },
    );
    return {
      responses,
      calls,
      verify,
      classification: { ...entry, reference },
      signal: new AbortController().signal,
    };
  }
  test("verifies exact maintainer comment bytes, classification, PR repository and protected ancestry", async () => {
    const f = fixture();
    expect(await f.verify(f.classification, sha, f.signal)).toBe(true);
    expect(f.calls).toHaveLength(4);
  });
  test.each(["write", "read", "none"])(
    "%s permission is not maintainer approval",
    async (permission) => {
      const f = fixture();
      f.responses[
        `/repos/${policy.repository}/collaborators/maintainer/permission`
      ] = { permission, user: { login: "maintainer" } };
      expect(await f.verify(f.classification, sha, f.signal)).toBe(false);
    },
  );
  test("accepts GitHub's maintain role mapped to legacy write permission, then observes revocation", async () => {
    const f = fixture();
    const endpoint = `/repos/${policy.repository}/collaborators/maintainer/permission`;
    f.responses[endpoint] = {
      permission: "write",
      role_name: "maintain",
      user: { login: "maintainer" },
    };
    expect(await f.verify(f.classification, sha, f.signal)).toBe(true);
    f.responses[endpoint] = {
      permission: "write",
      role_name: "write",
      user: { login: "maintainer" },
    };
    expect(await f.verify(f.classification, sha, f.signal)).toBe(false);
  });
  test.each(["behind", "diverged"])(
    "reviewed repair commit %s pinned main is refused",
    async (status) => {
      const f = fixture();
      f.responses[`/repos/${policy.repository}/compare/${commit}...${sha}`] = {
        status,
      };
      expect(await f.verify(f.classification, sha, f.signal)).toBe(false);
    },
  );
  test("changed finding revision, scope or revalidation does not inherit approval", async () => {
    for (const patch of [
      { findingRevision: "r2" },
      { scope: { kind: "repo" as const } },
      { revalidationRunId: 13 },
    ]) {
      const f = fixture();
      expect(
        await f.verify({ ...f.classification, ...patch }, sha, f.signal),
      ).toBe(false);
    }
  });
  test("edited, deleted, bot-authored and wrong-PR comments fail closed", async () => {
    for (const patch of [
      { body: "edited" },
      { user: { login: "bot", type: "Bot" } },
      {
        issue_url: `https://api.github.com/repos/${policy.repository}/issues/999`,
      },
      { id: 999 },
    ]) {
      const f = fixture();
      const endpoint = `/repos/${policy.repository}/issues/comments/456`;
      f.responses[endpoint] = {
        ...(f.responses[endpoint] as object),
        ...patch,
      };
      expect(await f.verify(f.classification, sha, f.signal)).toBe(false);
    }
    const f = fixture();
    delete f.responses[`/repos/${policy.repository}/issues/comments/456`];
    expect(await f.verify(f.classification, sha, f.signal)).toBe(false);
  });
  test("foreign host/repository and reference without byte digest are refused before API access", async () => {
    for (const transform of [
      (s: string) => s.replace("github.com", "github.com.evil.test"),
      (s: string) => s.replace(policy.repository, "other/repo"),
      (s: string) => s.split("@sha256:")[0],
    ]) {
      const f = fixture();
      expect(
        await f.verify(
          {
            ...f.classification,
            reference: transform(f.classification.reference),
          },
          sha,
          f.signal,
        ),
      ).toBe(false);
      expect(f.calls).toHaveLength(0);
    }
  });
  test("aborted approval read cannot approve", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await f.verify(f.classification, sha, controller.signal)).toBe(
      false,
    );
  });
});

const now = Date.parse("2026-09-12T12:00:00Z");
const sha = "a".repeat(40);
const policy: HealthPolicy = {
  repository: "kwam1na/athena",
  defaultBranch: "main",
  workflowId: 42,
  workflowPath: ".github/workflows/full-health.yml",
  artifactName: "validation-health",
  classificationPath: "health-resolutions.json",
  checks: [
    { checkId: "operator", scope: { kind: "package", package: "operator" } },
  ],
};
function snapshot(): HealthSnapshot {
  return {
    schemaVersion: "athena-validation-health/1",
    revision: "r1",
    observedAt: now,
    availability: "available",
    lastAttempt: {
      runId: 9,
      headSha: sha,
      outcome: "failure",
      completedAt: now,
    },
    lastComplete: {
      runId: 9,
      headSha: sha,
      outcome: "failure",
      completedAt: now,
    },
    findings: [
      {
        id: "failure-1",
        revision: "failure-r1",
        checkId: "operator",
        scope: { kind: "package", package: "operator" },
        runId: 9,
        headSha: sha,
      },
    ],
    closedFindings: [],
  };
}
const candidate = {
  candidateRef: "tree:candidate",
  profile: "local" as const,
  scopes: [{ kind: "package" as const, package: "operator" }],
};
function proof(): RepairProof {
  return {
    candidateRef: candidate.candidateRef,
    profile: "local",
    healthRevision: "r1",
    findingId: "failure-1",
    findingRevision: "failure-r1",
    checkId: "operator",
    scope: { kind: "package", package: "operator" },
    outcome: "success",
    evidenceRef: "local:proof",
  };
}

describe("candidate repair admission", () => {
  test("intersecting finding requires repair while unrelated packages remain eligible", () => {
    expect(
      evaluateValidationHealth({ health: snapshot(), candidate, now }).status,
    ).toBe("repair-required");
    expect(
      evaluateValidationHealth({
        health: snapshot(),
        candidate: {
          ...candidate,
          scopes: [{ kind: "package", package: "storefront" }],
        },
        now,
      }).status,
    ).toBe("eligible");
  });
  test("local repair progresses without closing global state; cannot authorize hosted or other candidate", () => {
    const health = snapshot();
    expect(
      evaluateValidationHealth({ health, candidate, proofs: [proof()], now })
        .status,
    ).toBe("eligible");
    expect(health.findings).toHaveLength(1);
    for (const other of [
      { ...candidate, profile: "hosted" as const },
      { ...candidate, candidateRef: "other" },
    ]) {
      expect(
        evaluateValidationHealth({
          health,
          candidate: other,
          proofs: [proof()],
          now,
        }).status,
      ).toBe("repair-required");
    }
  });
  test("new health revision invalidates discharge and flags plan reevaluation", () => {
    const health = { ...snapshot(), revision: "r2" };
    const result = evaluateValidationHealth({
      health,
      candidate,
      proofs: [proof()],
      plannedHealthRevision: "r1",
      now,
    });
    expect(result.status).toBe("repair-required");
    expect(result.reevaluationRequired).toBe(true);
  });
  test("narrower scope, failed proof, and absent provenance cannot discharge repair", () => {
    for (const patch of [
      {
        scope: {
          kind: "paths" as const,
          package: "operator",
          paths: ["src/a.ts"],
        },
      },
      { outcome: "failure" as const },
      { evidenceRef: "" },
    ]) {
      expect(
        evaluateValidationHealth({
          health: snapshot(),
          candidate,
          proofs: [{ ...proof(), ...patch }],
          now,
        }).status,
      ).toBe("repair-required");
    }
  });
  test("unknown repo failure intersects every candidate; package fallback remains bounded", () => {
    const health = snapshot();
    health.findings[0].scope = { kind: "repo" };
    expect(
      evaluateValidationHealth({
        health,
        candidate: {
          ...candidate,
          scopes: [{ kind: "package", package: "other" }],
        },
        now,
      }).status,
    ).toBe("repair-required");
  });
  test("unavailable health offers full validation and retains known repair obligations", () => {
    const health = { ...snapshot(), availability: "api-unavailable" as const };
    const result = evaluateValidationHealth({ health, candidate, now });
    expect(result.status).toBe("health-unavailable");
    expect(result.recovery).toEqual({
      mode: "full-health",
      retainFindings: true,
    });
    expect(result.obligations).toHaveLength(1);
  });
  test("48 hour boundary is overdue; a fresh observation does not refresh old completion", () => {
    const health = snapshot();
    health.lastComplete!.completedAt = now - 48 * 3600000;
    expect(evaluateValidationHealth({ health, candidate, now }).reason).toBe(
      "overdue",
    );
  });
});

function run(id = 9, overrides = {}) {
  return {
    id,
    run_attempt: 1,
    workflow_id: 42,
    path: policy.workflowPath,
    head_branch: "main",
    head_sha: sha,
    event: "schedule",
    status: "completed",
    conclusion: "failure",
    updated_at: new Date(now).toISOString(),
    repository: { full_name: policy.repository },
    head_repository: { full_name: policy.repository },
    ...overrides,
  };
}
function digest(overrides = {}) {
  return {
    schemaVersion: "athena-validation-health-digest/1",
    repository: policy.repository,
    runId: 9,
    runAttempt: 1,
    headSha: sha,
    complete: true,
    checks: [{ checkId: "operator", outcome: "failure" }],
    findings: [
      {
        id: "failure-1",
        revision: "failure-r1",
        checkId: "operator",
        runId: 9,
        headSha: sha,
      },
    ],
    ...overrides,
  };
}
function source(
  options: {
    runs?: unknown[];
    artifact?: unknown;
    body?: unknown;
    classification?: unknown;
    apiError?: boolean;
  } = {},
) {
  return {
    verifyClassificationApproval: async () => true,
    requestJson: async (url: string): Promise<unknown> => {
      if (options.apiError) throw new Error("offline");
      if (url.includes("/compare/")) return { status: "identical" };
      if (url.includes("/commits/")) return { sha };
      if (url.includes("/contents/"))
        return {
          encoding: "base64",
          content: Buffer.from(
            JSON.stringify(
              options.classification ?? {
                schemaVersion: "athena-health-classifications/1",
                entries: [],
              },
            ),
          ).toString("base64"),
        };
      if (url.includes("/artifacts")) {
        const runId = Number(/\/runs\/(\d+)\/artifacts/.exec(url)?.[1] ?? 9);
        return {
          total_count: 1,
          artifacts: [
            options.artifact ?? {
              id: runId * 10 + 1,
              name: policy.artifactName,
              expired: false,
              workflow_run: { id: runId, head_sha: sha },
              created_at: new Date(now).toISOString(),
            },
          ],
        };
      }
      return {
        total_count: (options.runs ?? [run()]).length,
        workflow_runs: options.runs ?? [run()],
      };
    },
    loadArtifact: async (_repository: string, artifactId: number) =>
      options.body ??
      (artifactId === 91
        ? digest()
        : digest({
            runId: Math.floor(artifactId / 10),
            complete: false,
            checks: [{ checkId: "operator", outcome: "cancelled" }],
            findings: [],
          })),
  };
}

describe("trusted health reader", () => {
  test("completed workflow with only a partial digest remains incomplete for admission", async () => {
    const fixture = source({ runs: [run(10), run()] });
    const health = await readValidationHealth(policy, {
      ...fixture,
      now,
      loadArtifact: async (_repo, id) =>
        id === 101
          ? digest({
              runId: 10,
              complete: false,
              findings: [
                {
                  id: "partial",
                  revision: "partial-r1",
                  checkId: "operator",
                  runId: 10,
                  headSha: sha,
                },
              ],
            })
          : digest(),
    });
    expect(health.availability).toBe("incomplete");
    expect(health.historyComplete).toBe(true);
    expect(health.findings.map((f) => f.id)).toEqual(["failure-1", "partial"]);
  });
  test("global unknown history closes only after approved complete all-check revalidation and reopens on revocation", async () => {
    const gap = {
      id: "gap-8",
      revision: "gap-revision",
      checkId: HEALTH_HISTORY_CHECK_ID,
      runId: 8,
      runAttempt: 2,
      headSha: sha,
    };
    const classification = {
      schemaVersion: "athena-health-classifications/1",
      entries: [
        {
          findingId: gap.id,
          findingRevision: gap.revision,
          reference: "explicit-maintainer-approval",
          revalidationRunId: 9,
          scope: { kind: "package", package: "operator" },
        },
      ],
    };
    const body = digest({
      checks: [{ checkId: "operator", outcome: "success" }],
      findings: [gap],
    });
    const approved = await readValidationHealth(policy, {
      ...source({
        body,
        classification,
        runs: [run(9, { conclusion: "success" })],
      }),
      now,
    });
    expect(approved.findings).toHaveLength(0);
    expect(approved.closedFindings[0].finding).toMatchObject({
      ...gap,
      scope: { kind: "repo" },
    });
    const revoked = await readValidationHealth(policy, {
      ...source({
        body,
        classification,
        runs: [run(9, { conclusion: "success" })],
      }),
      verifyClassificationApproval: async () => false,
      previous: approved,
      now,
    });
    expect(revoked.findings[0]).toMatchObject({
      ...gap,
      scope: { kind: "repo" },
    });
    const failed = await readValidationHealth(policy, {
      ...source({
        classification,
        body: digest({ findings: [gap, ...digest().findings] }),
      }),
      now,
    });
    expect(failed.findings.some((f) => f.id === gap.id)).toBe(true);
    expect(failed.findings.find((f) => f.id === gap.id)?.scope).toEqual({
      kind: "repo",
    });
    const staleRevision = {
      ...classification,
      entries: [{ ...classification.entries[0], findingRevision: "different" }],
    };
    const stale = await readValidationHealth(policy, {
      ...source({
        body,
        classification: staleRevision,
        runs: [run(9, { conclusion: "success" })],
      }),
      now,
    });
    expect(stale.findings.some((f) => f.id === gap.id)).toBe(true);
  });
  test("reconciles cancelled partial failures before a cumulative predecessor for producer recovery", async () => {
    const fixture = source({
      runs: [run(10, { conclusion: "cancelled" }), run()],
    });
    const health = await readValidationHealth(policy, {
      ...fixture,
      now,
      loadArtifact: async (_repo, id) =>
        id === 101
          ? digest({
              runId: 10,
              complete: false,
              findings: [
                {
                  id: "cancelled-failure",
                  revision: "cancelled-r1",
                  checkId: "operator",
                  runId: 10,
                  headSha: sha,
                },
              ],
            })
          : digest(),
    });
    expect(health.availability).toBe("incomplete");
    expect(health.historyComplete).toBe(true);
    expect(health.findings.map((f) => f.id)).toEqual([
      "cancelled-failure",
      "failure-1",
    ]);
  });
  test("first cancelled run with no artifact cannot become an empty bootstrap", async () => {
    const health = await readValidationHealth(policy, {
      ...source({ runs: [run(10, { conclusion: "cancelled" })] }),
      loadArtifact: async () => {
        throw new Error("missing artifact");
      },
      now,
    });
    expect(health.availability).not.toBe("missing-seed");
    expect(health.historyComplete).toBe(false);
    expect(health.lastAttempt?.runId).toBe(10);
  });
  test("admission observes the in-progress run while producer reads only earlier history", async () => {
    const options = {
      ...source({
        runs: [run(10, { status: "in_progress", conclusion: null }), run()],
      }),
      now,
    };
    const admission = await readValidationHealth(policy, options);
    expect(admission.availability).toBe("incomplete");
    expect(admission.lastAttempt?.runId).toBe(10);
    expect(admission.findings).toHaveLength(1);
    const history = await readValidationHealth(policy, {
      ...options,
      excludeCurrentRunId: 10,
    });
    expect(history.availability).toBe("available");
    expect(history.lastAttempt?.runId).toBe(9);
    expect(history.findings).toEqual(admission.findings);
  });
  test("producer can identify a genuinely empty first seed while its own run is active", async () => {
    const health = await readValidationHealth(policy, {
      ...source({
        runs: [run(10, { status: "in_progress", conclusion: null })],
      }),
      now,
      excludeCurrentRunId: 10,
    });
    expect(health.availability).toBe("missing-seed");
    expect(health.lastAttempt).toBeUndefined();
  });
  test("accepts bound full result and uses declared package scope for unlocalized failure", async () => {
    const health = await readValidationHealth(policy, { ...source(), now });
    expect(health.availability).toBe("available");
    expect(health.findings[0].scope).toEqual({
      kind: "package",
      package: "operator",
    });
  });
  test("no seed, API outage, malformed/empty successful digest and expired artifact are unavailable", async () => {
    for (const fixture of [
      source({ runs: [] }),
      source({ apiError: true }),
      source({ body: {} }),
      source({ body: digest({ checks: [] }) }),
      source({
        artifact: { id: 91, name: policy.artifactName, expired: true },
      }),
    ]) {
      expect(
        (await readValidationHealth(policy, { ...fixture, now })).availability,
      ).not.toBe("available");
    }
  });
  test("rejects foreign artifact, candidate run and mismatched attempt", async () => {
    for (const fixture of [
      source({ body: digest({ runId: 77 }) }),
      source({ body: digest({ runAttempt: 2 }) }),
      source({ runs: [run(9, { event: "pull_request" })] }),
      source({
        runs: [run(9, { head_repository: { full_name: "attacker/athena" } })],
      }),
    ]) {
      expect(
        (await readValidationHealth(policy, { ...fixture, now })).availability,
      ).not.toBe("available");
    }
  });
  test("cancelled latest attempt retains recent complete evidence and unresolved failures", async () => {
    const health = await readValidationHealth(policy, {
      ...source({ runs: [run(10, { conclusion: "cancelled" }), run()] }),
      now,
    });
    expect(health.availability).toBe("incomplete");
    expect(health.lastAttempt?.outcome).toBe("cancelled");
    expect(health.findings).toHaveLength(1);
  });
  test("cancelled attempt without seed is unavailable", async () => {
    expect(
      (
        await readValidationHealth(policy, {
          ...source({ runs: [run(10, { conclusion: "cancelled" })] }),
          now,
        })
      ).availability,
    ).not.toBe("available");
  });
  test("successful digest cannot erase retained global finding without approved main resolution", async () => {
    const health = await readValidationHealth(policy, {
      ...source({
        runs: [run(9, { conclusion: "success" })],
        body: digest({
          checks: [{ checkId: "operator", outcome: "success" }],
          findings: [],
        }),
      }),
      previous: snapshot(),
      now,
    });
    expect(health.findings).toHaveLength(1);
  });
});

describe("health closure and recovery negative controls", () => {
  test("trusted main approval and newer complete passing run close the global finding", async () => {
    const health = await readValidationHealth(policy, {
      ...source({
        runs: [run(10, { conclusion: "success" })],
        artifact: {
          id: 101,
          name: policy.artifactName,
          expired: false,
          workflow_run: { id: 10, head_sha: sha },
        },
        body: digest({
          runId: 10,
          checks: [{ checkId: "operator", outcome: "success" }],
        }),
        classification: {
          schemaVersion: "athena-health-classifications/1",
          entries: [
            {
              findingId: "failure-1",
              findingRevision: "failure-r1",
              reference: "main:approved-repair",
              revalidationRunId: 10,
            },
          ],
        },
      }),
      previous: snapshot(),
      now,
    });
    expect(health.availability).toBe("available");
    expect(health.findings).toHaveLength(0);
    expect(health.closedFindings).toHaveLength(1);
    expect(health.closedFindings[0].mainSha).toBe(sha);
  });
  test("same/older or failing revalidation never closes a finding", async () => {
    for (const revalidationRunId of [8, 9, 10]) {
      const health = await readValidationHealth(policy, {
        ...source({
          classification: {
            schemaVersion: "athena-health-classifications/1",
            entries: [
              {
                findingId: "failure-1",
                findingRevision: "failure-r1",
                reference: "main:approval",
                revalidationRunId,
              },
            ],
          },
        }),
        now,
      });
      expect(health.findings).toHaveLength(1);
    }
  });
  test("unavailable explicit full validation is bound to candidate, profile and revision", () => {
    const health = { ...snapshot(), availability: "api-unavailable" as const };
    const fullValidation = {
      candidateRef: candidate.candidateRef,
      profile: "local" as const,
      healthRevision: "r1",
      mode: "full-health" as const,
      outcome: "success" as const,
      evidenceRef: "verified:full-inventory",
    };
    expect(
      evaluateValidationHealth({
        health,
        candidate,
        fullValidation,
        proofs: [proof()],
        now,
      }).status,
    ).toBe("eligible");
    expect(
      evaluateValidationHealth({ health, candidate, fullValidation, now })
        .status,
    ).toBe("repair-required");
    expect(
      evaluateValidationHealth({
        health,
        candidate: { ...candidate, profile: "hosted" },
        fullValidation,
        proofs: [proof()],
        now,
      }).status,
    ).toBe("health-unavailable");
    expect(health.findings).toHaveLength(1);
  });
  test("removed scope approval broadens retained failure back to declared scope", async () => {
    const previous = snapshot();
    previous.findings[0].scope = {
      kind: "paths",
      package: "operator",
      paths: ["src/a.ts"],
    };
    const health = await readValidationHealth(policy, {
      ...source({
        runs: [run(9, { conclusion: "success" })],
        body: digest({
          checks: [{ checkId: "operator", outcome: "success" }],
          findings: [],
        }),
      }),
      previous,
      now,
    });
    expect(health.findings[0].scope).toEqual({
      kind: "package",
      package: "operator",
    });
  });
  test("repeated reads of identical closure preserve a stable revision", async () => {
    const fixture = source({
      runs: [run(10, { conclusion: "success" })],
      artifact: {
        id: 101,
        name: policy.artifactName,
        expired: false,
        workflow_run: { id: 10, head_sha: sha },
      },
      body: digest({
        runId: 10,
        checks: [{ checkId: "operator", outcome: "success" }],
      }),
      classification: {
        schemaVersion: "athena-health-classifications/1",
        entries: [
          {
            findingId: "failure-1",
            findingRevision: "failure-r1",
            reference: "main:approved-repair",
            revalidationRunId: 10,
          },
        ],
      },
    });
    const first = await readValidationHealth(policy, { ...fixture, now });
    const second = await readValidationHealth(policy, {
      ...fixture,
      previous: first,
      now: now + 10,
    });
    expect(second.revision).toBe(first.revision);
    expect(second.closedFindings).toHaveLength(1);
  });
});

describe("additional provenance guards", () => {
  test("failed workflow cannot publish an all-green complete digest", async () => {
    const health = await readValidationHealth(policy, {
      ...source({
        body: digest({
          checks: [{ checkId: "operator", outcome: "success" }],
          findings: [],
        }),
      }),
      now,
    });
    expect(health.availability).toBe("invalid-health");
  });
  test("closure revalidation must be an ancestor of the approved protected main", async () => {
    const fixture = source({
      runs: [run(10, { conclusion: "success" })],
      artifact: {
        id: 101,
        name: policy.artifactName,
        expired: false,
        workflow_run: { id: 10, head_sha: sha },
      },
      body: digest({
        runId: 10,
        checks: [{ checkId: "operator", outcome: "success" }],
      }),
      classification: {
        schemaVersion: "athena-health-classifications/1",
        entries: [
          {
            findingId: "failure-1",
            findingRevision: "failure-r1",
            reference: "main:approval",
            revalidationRunId: 10,
          },
        ],
      },
    });
    const health = await readValidationHealth(policy, {
      ...fixture,
      requestJson: async (url) =>
        url.includes("/compare/")
          ? { status: "diverged" }
          : fixture.requestJson(url),
      now,
    });
    expect(health.findings).toHaveLength(1);
    expect(health.closedFindings).toHaveLength(0);
  });
});

test("published fixtures satisfy the exported reader contract", async () => {
  const health = await readValidationHealth(fixturePolicy as HealthPolicy, {
    ...source({ body: fixtureDigest }),
    now,
  });
  expect(health.availability).toBe("available");
  expect(health.findings[0].id).toBe("failure-1");
});

test("independent hosted repair succeeds while global finding stays open", () => {
  const health = snapshot();
  const result = evaluateValidationHealth({
    health,
    candidate: { ...candidate, profile: "hosted" },
    proofs: [
      {
        ...proof(),
        profile: "hosted",
        evidenceRef: "github:verified-execution",
      },
    ],
    now,
  });
  expect(result.status).toBe("eligible");
  expect(health.findings).toHaveLength(1);
});

test("healthy full seed is available and main classification read is pinned", async () => {
  const fixture = source({
    runs: [run(9, { conclusion: "success" })],
    body: digest({
      checks: [{ checkId: "operator", outcome: "success" }],
      findings: [],
    }),
  });
  const requested: string[] = [];
  const health = await readValidationHealth(policy, {
    ...fixture,
    requestJson: async (url) => {
      requested.push(url);
      return fixture.requestJson(url);
    },
    now,
  });
  expect(health.availability).toBe("available");
  expect(health.findings).toHaveLength(0);
  expect(requested.find((u) => u.includes("/contents/"))).toEndWith(
    `?ref=${sha}`,
  );
});

test("history pagination finds a recent complete result beyond cancelled attempts", async () => {
  const fixture = source();
  const health = await readValidationHealth(policy, {
    ...fixture,
    requestJson: async (url) => {
      if (url.includes("/workflows/"))
        return {
          total_count: 101,
          workflow_runs: url.includes("page=2")
            ? [run()]
            : Array.from({ length: 100 }, (_, i) =>
                run(110 - i, { conclusion: "cancelled" }),
              ),
        };
      return fixture.requestJson(url);
    },
    now,
  });
  expect(health.availability).toBe("incomplete");
  expect(health.lastComplete?.runId).toBe(9);
  expect(health.findings).toHaveLength(1);
});

test("path scopes intersect exactly and unknown candidate impact remains conservative", () => {
  const health = snapshot();
  health.findings[0].scope = {
    kind: "paths",
    package: "operator",
    paths: ["src/a.ts"],
  };
  expect(
    evaluateValidationHealth({
      health,
      candidate: {
        ...candidate,
        scopes: [{ kind: "paths", package: "operator", paths: ["src/b.ts"] }],
      },
      now,
    }).status,
  ).toBe("eligible");
  expect(
    evaluateValidationHealth({
      health,
      candidate: { ...candidate, scopes: [] },
      now,
    }).status,
  ).toBe("repair-required");
});

test("stale artifact cannot roll retained failure history back to an older revision", async () => {
  const previous = snapshot();
  previous.findings[0].revision = "newer-failure";
  previous.findings[0].runId = 10;
  const health = await readValidationHealth(policy, {
    ...source(),
    previous,
    now,
  });
  expect(health.findings[0].revision).toBe("newer-failure");
  expect(health.findings[0].runId).toBe(10);
});

test("conflicting revision for the same origin retains known failure and becomes unavailable", async () => {
  const previous = snapshot();
  previous.findings[0].revision = "conflicting-revision";
  const health = await readValidationHealth(policy, {
    ...source(),
    previous,
    now,
  });
  expect(health.availability).toBe("invalid-health");
  expect(health.findings[0].revision).toBe("conflicting-revision");
});

test("main membership without independent approval capability cannot narrow or close a finding", async () => {
  const fixture = source({
    runs: [run(10, { conclusion: "success" })],
    artifact: {
      id: 101,
      name: policy.artifactName,
      expired: false,
      workflow_run: { id: 10, head_sha: sha },
    },
    body: digest({
      runId: 10,
      checks: [{ checkId: "operator", outcome: "success" }],
    }),
    classification: {
      schemaVersion: "athena-health-classifications/1",
      entries: [
        {
          findingId: "failure-1",
          findingRevision: "failure-r1",
          reference: "main:unverified-approval",
          scope: { kind: "paths", package: "operator", paths: ["src/a.ts"] },
          revalidationRunId: 10,
        },
      ],
    },
  });
  const health = await readValidationHealth(policy, {
    ...fixture,
    verifyClassificationApproval: undefined,
    now,
  });
  expect(health.findings).toHaveLength(1);
  expect(health.findings[0].scope).toEqual({
    kind: "package",
    package: "operator",
  });
  expect(health.closedFindings).toHaveLength(0);
});

test("approved historical revalidation stays closed after a newer complete run and on a fresh read", async () => {
  const base = source({
    runs: [run(11, { conclusion: "success" })],
    classification: {
      schemaVersion: "athena-health-classifications/1",
      entries: [
        {
          findingId: "failure-1",
          findingRevision: "failure-r1",
          reference: "main:approved-repair",
          revalidationRunId: 10,
        },
      ],
    },
  });
  const fixture = {
    ...base,
    requestJson: async (url: string): Promise<unknown> => {
      if (url.endsWith("/actions/runs/10"))
        return run(10, { conclusion: "success" });
      const match = url.match(/\/actions\/runs\/(10|11)\/artifacts/);
      if (match) {
        const runId = Number(match[1]);
        return {
          total_count: 1,
          artifacts: [
            {
              id: runId * 10,
              name: policy.artifactName,
              expired: false,
              workflow_run: { id: runId, head_sha: sha },
            },
          ],
        };
      }
      return base.requestJson(url);
    },
    loadArtifact: async (_repository: string, artifactId: number) =>
      digest({
        runId: artifactId / 10,
        checks: [{ checkId: "operator", outcome: "success" }],
      }),
  };
  const previous = snapshot();
  previous.findings = [];
  previous.closedFindings = [
    {
      finding: snapshot().findings[0],
      reference: "main:approved-repair",
      mainSha: sha,
      revalidationRunId: 10,
    },
  ];
  for (const prior of [previous, undefined]) {
    const health = await readValidationHealth(policy, {
      ...fixture,
      previous: prior,
      now,
    });
    expect(health.availability).toBe("available");
    expect(health.findings).toHaveLength(0);
    expect(health.closedFindings).toHaveLength(1);
    expect(health.closedFindings[0].revalidationRunId).toBe(10);
    expect(health.lastComplete?.runId).toBe(11);
  }
});

test("a later real failure is not discharged by an older approved closure", async () => {
  const base = source({
    runs: [run(11)],
    artifact: {
      id: 110,
      name: policy.artifactName,
      expired: false,
      workflow_run: { id: 11, head_sha: sha },
    },
    body: digest({
      runId: 11,
      findings: [
        {
          id: "failure-1",
          revision: "failure-r2",
          checkId: "operator",
          runId: 11,
          headSha: sha,
        },
      ],
    }),
    classification: {
      schemaVersion: "athena-health-classifications/1",
      entries: [
        {
          findingId: "failure-1",
          findingRevision: "failure-r1",
          reference: "main:approved-repair",
          revalidationRunId: 10,
        },
      ],
    },
  });
  const health = await readValidationHealth(policy, { ...base, now });
  expect(health.availability).toBe("available");
  expect(health.findings).toHaveLength(1);
  expect(health.findings[0].revision).toBe("failure-r2");
  expect(health.closedFindings).toHaveLength(0);
});

test("proof finding revision is bound independently of all other matching proof fields", () => {
  const input = { health: snapshot(), candidate, now };
  const matched = evaluateValidationHealth({ ...input, proofs: [proof()] });
  expect(matched.status).toBe("eligible");
  expect(matched.obligations[0].discharged).toBe(true);
  const differentRevision = evaluateValidationHealth({
    ...input,
    proofs: [{ ...proof(), findingRevision: "different-finding-revision" }],
  });
  expect(differentRevision.status).toBe("repair-required");
  expect(differentRevision.obligations[0].discharged).toBe(false);
});

for (const stage of ["request", "artifact", "approval"] as const) {
  test(`stalled ${stage} adapter times out and retains prior failures`, async () => {
    const fixture = source({
      classification: {
        schemaVersion: "athena-health-classifications/1",
        entries: [
          {
            findingId: "failure-1",
            findingRevision: "failure-r1",
            reference: "main:approval",
            scope: { kind: "paths", package: "operator", paths: ["src/a.ts"] },
          },
        ],
      },
    });
    const stalled = () => new Promise<never>(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        readValidationHealth(policy, {
          ...fixture,
          previous: snapshot(),
          now,
          timeoutMs: 20,
          ...(stage === "request"
            ? { requestJson: stalled }
            : stage === "artifact"
              ? { loadArtifact: stalled }
              : { verifyClassificationApproval: stalled }),
        }),
        new Promise<"hung">((resolve) => {
          timer = setTimeout(() => resolve("hung"), 200);
        }),
      ]);
      expect(result).not.toBe("hung");
      if (result === "hung") throw new Error("health read remained pending");
      expect(result.availability).toBe("api-unavailable");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].scope).toEqual({
        kind: "package",
        package: "operator",
      });
    } finally {
      clearTimeout(timer);
    }
  });
}

for (const stage of ["request", "artifact"] as const) {
  test(`owned stalled ${stage} process is reaped and temporary archives are removed`, async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "health-process-test-"),
    );
    const pidPath = path.join(directory, "child.pid");
    const ghPath = path.join(directory, "gh");
    const outer = new AbortController();
    const guard = setTimeout(() => outer.abort(), 5000);
    try {
      await writeFile(
        ghPath,
        `#!/bin/sh\nprintf '%s' "$$" > '${pidPath.replace(/'/g, "'\\''")}'\nexec sleep 60\n`,
      );
      await chmod(ghPath, 0o755);
      const responses = {
        commit: { sha },
        classification: {
          encoding: "base64",
          content: Buffer.from(
            JSON.stringify({
              schemaVersion: "athena-health-classifications/1",
              entries: [],
            }),
          ).toString("base64"),
        },
        runs: { total_count: 1, workflow_runs: [run()] },
        artifacts: {
          total_count: 1,
          artifacts: [
            {
              id: 91,
              name: policy.artifactName,
              expired: false,
              workflow_run: { id: 9, head_sha: sha },
            },
          ],
        },
      };
      const program = `
        process.env.PATH = ${JSON.stringify(directory)} + ':' + process.env.PATH;
        process.env.TMPDIR = ${JSON.stringify(directory)};
        const { readValidationHealth } = await import(${JSON.stringify(path.join(import.meta.dir, "harness-validation-health.ts"))});
        const { readdirSync } = await import('node:fs');
        const responses = ${JSON.stringify(responses)};
        const requestJson = async (url) => url.includes('/commits/') ? responses.commit : url.includes('/contents/') ? responses.classification : url.includes('/artifacts') ? responses.artifacts : responses.runs;
        const health = await readValidationHealth(${JSON.stringify(policy)}, {
          now: ${now}, timeoutMs: 1000, previous: ${JSON.stringify(snapshot())},
          ...(${JSON.stringify(stage)} === 'artifact' ? { requestJson } : {}),
        });
        console.log(JSON.stringify({ availability: health.availability, findings: health.findings.length, residual: readdirSync(${JSON.stringify(directory)}).filter(name => name.startsWith('athena-health-')) }));
      `;
      const result = await runHealthProcess(
        [
          "/usr/bin/env",
          `PATH=${directory}:${process.env.PATH}`,
          `TMPDIR=${directory}`,
          process.execPath,
          "-e",
          program,
        ],
        outer.signal,
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        availability: "api-unavailable",
        findings: 1,
        residual: [],
      });
      const pid = Number(await readFile(pidPath, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      clearTimeout(guard);
      outer.abort();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

function historicalTrustSource(overrides: Record<string, unknown> = {}) {
  const base = source({
    runs: [run(11, { conclusion: "success" })],
    classification: {
      schemaVersion: "athena-health-classifications/1",
      entries: [
        {
          findingId: "failure-1",
          findingRevision: "failure-r1",
          reference: "main:approved-repair",
          revalidationRunId: 10,
        },
      ],
    },
  });
  return {
    ...base,
    requestJson: async (url: string): Promise<unknown> => {
      if (url.endsWith("/actions/runs/10"))
        return run(10, { conclusion: "success", event: "push", ...overrides });
      const match = url.match(/\/actions\/runs\/(10|11)\/artifacts/);
      if (match) {
        const runId = Number(match[1]);
        return {
          total_count: 1,
          artifacts: [
            {
              id: runId * 10,
              name: policy.artifactName,
              expired: false,
              workflow_run: { id: runId, head_sha: sha },
            },
          ],
        };
      }
      return base.requestJson(url);
    },
    loadArtifact: async (_repository: string, artifactId: number) =>
      digest({
        runId: artifactId / 10,
        checks: [{ checkId: "operator", outcome: "success" }],
      }),
  };
}

test("historical trust accepts a matching trusted default-branch push", async () => {
  const health = await readValidationHealth(policy, {
    ...historicalTrustSource(),
    now,
  });
  expect(health.availability).toBe("available");
  expect(health.findings).toHaveLength(0);
  expect(health.closedFindings).toHaveLength(1);
});

for (const [field, overrides] of [
  ["branch", { head_branch: "candidate-branch" }],
  ["workflow id", { workflow_id: 99 }],
  ["workflow path", { path: ".github/workflows/other.yml" }],
  ["repository", { repository: { full_name: "foreign/athena" } }],
  ["head repository", { head_repository: { full_name: "foreign/athena" } }],
  ["event", { event: "pull_request" }],
  ["status", { status: "in_progress" }],
  ["conclusion", { conclusion: "cancelled" }],
  ["run id", { id: 12 }],
  ["attempt", { run_attempt: 0 }],
] as const) {
  test(`historical trust rejects ${field} independently of matching closure evidence`, async () => {
    const health = await readValidationHealth(policy, {
      ...historicalTrustSource(overrides),
      now,
    });
    expect(health.availability).toBe("invalid-health");
    expect(health.findings.map((finding) => finding.id)).toEqual(["failure-1"]);
    expect(health.closedFindings).toHaveLength(0);
  });
}
