import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLocalValidationAuthority,
  HEALTH_WORKFLOW_PATH,
  HEALTH_ARTIFACT_NAME,
  HEALTH_CLASSIFICATION_PATH,
  type LocalValidationAuthorityOptions,
} from "./harness-validation-local-authority.ts";
import {
  VALIDATION_HEALTH_INVENTORY_PATH,
  type ValidationHealthInventory,
} from "./harness-validation-health-inventory.ts";
import type { HealthSnapshot } from "./harness-validation-health.ts";

const mainSha = "a".repeat(40);
const base = "/repos/kwam1na/athena";
const mainEndpoint = `${base}/commits/main`;
const workflowEndpoint = `${base}/actions/workflows/athena-validation-health.yml`;
const inventoryEndpoint = `${base}/contents/${VALIDATION_HEALTH_INVENTORY_PATH}?ref=${mainSha}`;
const inventory: ValidationHealthInventory = {
  schemaVersion: "athena-validation-health-inventory/1",
  checks: [
    {
      checkId: "unit",
      profile: "packages/athena-webapp:unit",
      scope: { kind: "package", package: "packages/athena-webapp" },
    },
  ],
};
function content(value: unknown, path = VALIDATION_HEALTH_INVENTORY_PATH) {
  return {
    type: "file",
    path,
    sha: "b".repeat(40),
    encoding: "base64",
    content: Buffer.from(JSON.stringify(value)).toString("base64"),
  };
}
function fixture() {
  const health: HealthSnapshot = {
    schemaVersion: "athena-validation-health/1",
    revision: "health-1",
    observedAt: Date.now(),
    availability: "api-unavailable",
    findings: [],
    closedFindings: [],
  };
  const replies: Record<string, unknown> = {
    [base]: { full_name: "kwam1na/athena", default_branch: "main" },
    [mainEndpoint]: { sha: mainSha },
    [workflowEndpoint]: { id: 7, path: HEALTH_WORKFLOW_PATH, state: "active" },
    [inventoryEndpoint]: content(inventory),
  };
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const options: LocalValidationAuthorityOptions = {
    readOrigin: async () => "git@github.com:kwam1na/athena.git\n",
    requestJson: async (endpoint, signal) => {
      calls.push(endpoint);
      signals.push(signal);
      if (!(endpoint in replies)) throw new Error("API unavailable");
      return structuredClone(replies[endpoint]);
    },
    readHealth: async (policy, options) => {
      expect(policy.artifactName).toBe(HEALTH_ARTIFACT_NAME);
      expect(policy.classificationPath).toBe(HEALTH_CLASSIFICATION_PATH);
      expect(options?.verifyClassificationApproval).toBeFunction();
      expect(options?.excludeCurrentRunId).toBeUndefined();
      expect(options?.requestJson).toBeFunction();
      return health;
    },
  };
  return { options, health, replies, calls, signals };
}

describe("trusted local health authority", () => {
  test.each([
    "git@github.com:kwam1na/athena.git",
    "https://github.com/kwam1na/athena.git",
    "ssh://git@github.com/kwam1na/athena.git",
  ])("authenticates %s without hosted identity", async (origin) => {
    const f = fixture();
    f.options.readOrigin = async () => origin;
    const result = await readLocalValidationAuthority("/unused", f.options);
    expect(result.repository).toBe("kwam1na/athena");
    expect(result.mainSha).toBe(mainSha);
    expect(result.inventory).toEqual(inventory);
    expect(result.health).toEqual(f.health);
    expect(result.policy.checks).toEqual([
      { checkId: "unit", scope: inventory.checks[0].scope },
    ]);
    expect(f.calls.filter((path) => path.includes("contents/"))).toEqual([
      inventoryEndpoint,
    ]);
    expect(
      f.signals.every(
        (signal) => signal instanceof AbortSignal && !signal.aborted,
      ),
    ).toBe(true);
  });
  test("metadata API unavailability refuses before health reading", async () => {
    const f = fixture();
    delete f.replies[base];
    await expect(
      readLocalValidationAuthority("/unused", f.options),
    ).rejects.toMatchObject({ code: "local_health_authority_unavailable" });
  });
  test.each([
    "https://evil.example/kwam1na/athena.git",
    "file:///tmp/repo",
    "git@github.com:../athena.git",
  ])("refuses untrusted origin %s", async (origin) => {
    const f = fixture();
    f.options.readOrigin = async () => origin;
    await expect(
      readLocalValidationAuthority("/unused", f.options),
    ).rejects.toMatchObject({ code: "local_health_origin_invalid" });
    expect(f.calls).toHaveLength(0);
  });
  test("repository mismatch and missing main identity refuse", async () => {
    const f = fixture();
    f.replies[base] = { full_name: "other/athena", default_branch: "main" };
    await expect(
      readLocalValidationAuthority("/unused", f.options),
    ).rejects.toMatchObject({ code: "local_health_repository_invalid" });
    const g = fixture();
    g.replies[mainEndpoint] = { sha: "bad" };
    await expect(
      readLocalValidationAuthority("/unused", g.options),
    ).rejects.toMatchObject({ code: "local_health_main_invalid" });
  });
  test.each([
    { id: 7, path: ".github/workflows/other.yml", state: "active" },
    { id: 7, path: HEALTH_WORKFLOW_PATH, state: "disabled_manually" },
    { id: 0, path: HEALTH_WORKFLOW_PATH, state: "active" },
  ])("refuses invalid workflow %j", async (workflow) => {
    const f = fixture();
    f.replies[workflowEndpoint] = workflow;
    await expect(
      readLocalValidationAuthority("/unused", f.options),
    ).rejects.toMatchObject({ code: "local_health_workflow_invalid" });
  });
  test("missing protected inventory cannot use a candidate fallback", async () => {
    const f = fixture();
    delete f.replies[inventoryEndpoint];
    await expect(
      readLocalValidationAuthority("/candidate-with-inventory", f.options),
    ).rejects.toMatchObject({ code: "local_health_authority_unavailable" });
  });
  test.each([
    {},
    { ...inventory, extra: true },
    { ...inventory, checks: [] },
    { ...inventory, checks: [...inventory.checks, ...inventory.checks] },
  ])("strict inventory parser rejects %j", async (value) => {
    const f = fixture();
    f.replies[inventoryEndpoint] = content(value);
    await expect(
      readLocalValidationAuthority("/unused", f.options),
    ).rejects.toMatchObject({ code: "local_health_inventory_invalid" });
  });
  test("wrong content path and invalid base64 refuse", async () => {
    const f = fixture();
    f.replies[inventoryEndpoint] = content(inventory, "candidate.json");
    await expect(
      readLocalValidationAuthority("/unused", f.options),
    ).rejects.toMatchObject({ code: "local_health_inventory_invalid" });
    const g = fixture();
    g.replies[inventoryEndpoint] = {
      ...content(inventory),
      content: "not@base64",
    };
    await expect(
      readLocalValidationAuthority("/unused", g.options),
    ).rejects.toMatchObject({ code: "local_health_inventory_invalid" });
  });
  test.each(["main", "branch", "workflow", "origin"])(
    "refuses %s movement during health collection",
    async (kind) => {
      const f = fixture();
      f.options.readHealth = async () => {
        if (kind === "main") f.replies[mainEndpoint] = { sha: "c".repeat(40) };
        if (kind === "branch")
          f.replies[base] = {
            full_name: "kwam1na/athena",
            default_branch: "replacement",
          };
        if (kind === "workflow")
          f.replies[workflowEndpoint] = {
            id: 9,
            path: HEALTH_WORKFLOW_PATH,
            state: "active",
          };
        if (kind === "origin")
          f.options.readOrigin = async () =>
            "git@github.com:other/repository.git";
        return f.health;
      };
      await expect(
        readLocalValidationAuthority("/unused", f.options),
      ).rejects.toMatchObject({ code: "local_health_authority_changed" });
    },
  );
  test("internal main race remains blocking even if health reader catches it and main moves back", async () => {
    const f = fixture();
    f.options.readHealth = async (_policy, options) => {
      f.replies[mainEndpoint] = { sha: "c".repeat(40) };
      await options!.requestJson!(mainEndpoint).catch(() => undefined);
      f.replies[mainEndpoint] = { sha: mainSha };
      return f.health;
    };
    await expect(
      readLocalValidationAuthority("/unused", f.options),
    ).rejects.toMatchObject({ code: "local_health_authority_changed" });
  });
  test("real health reader returns unavailable history with authenticated inventory", async () => {
    const f = fixture();
    delete f.options.readHealth;
    // Classification/history API unavailable; final metadata remains readable.
    const result = await readLocalValidationAuthority("/unused", f.options);
    expect(result.health.availability).toBe("api-unavailable");
    expect(result.inventory).toEqual(inventory);
    expect(f.calls).toContain(
      `${base}/contents/${HEALTH_CLASSIFICATION_PATH}?ref=${mainSha}`,
    );
  });
  test("caller abort reaches active API request and bounds noncooperative transport", async () => {
    const f = fixture();
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    f.options.signal = controller.signal;
    f.options.requestJson = async (_endpoint, signal) => {
      observed = signal;
      controller.abort();
      return new Promise(() => {});
    };
    await expect(
      readLocalValidationAuthority("/unused", f.options),
    ).rejects.toMatchObject({ code: "local_health_authority_cancelled" });
    expect(observed?.aborted).toBe(true);
  });
  test("default gh transport obeys total timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-authority-gh-"));
    try {
      await writeFile(
        join(dir, "gh"),
        '#!/bin/sh\n[ "$1" = "--ready" ] && exit 0\n[ "$1:$2:$3" = "api:--hostname:github.com" ] || exit 1\nprintf invoked > "$0.invoked"\nexec sleep 10\n',
        {
          mode: 0o755,
        },
      );
      // Bun 1.1.29 resolves subprocess commands against its startup PATH.
      // A runtime PATH edit can silently run the real, authenticated gh instead.
      const started = Date.now();
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `import { readLocalValidationAuthority } from ${JSON.stringify(
            new URL("./harness-validation-local-authority.ts", import.meta.url)
              .href,
          )};
        // Warm the executable before measuring the transport's 50ms deadline.
        // A newly written shell script can incur cold OS launch latency.
        if (Bun.which("gh") !== ${JSON.stringify(join(dir, "gh"))}) process.exit(2);
        if (Bun.spawnSync(["gh", "--ready"]).exitCode !== 0) process.exit(3);
        try {
          await readLocalValidationAuthority("/unused", {
            readOrigin: async () => "git@github.com:kwam1na/athena.git",
            timeoutMs: 50,
          });
          process.exitCode = 1;
        } catch (error) {
          console.log(JSON.stringify({ code: error.code }));
        }`,
        ],
        {
          env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const timeout = setTimeout(() => child.kill(), 2_000);
      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toEqual({
          code: "local_health_authority_cancelled",
        });
        expect(await readFile(join(dir, "gh.invoked"), "utf8")).toBe("invoked");
      } finally {
        clearTimeout(timeout);
      }
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
