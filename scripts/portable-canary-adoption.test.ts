import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  auditPortableCanaryAdoption,
  rehearsePortableCanaryRollback,
} from "./portable-canary-adoption";
import { portableShadowComparisonSha256 } from "./portable-shadow-observation";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const execFileAsync = promisify(execFile);

async function canaryFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "athena-portable-canary-audit-"),
  );
  await Promise.all([
    mkdir(path.join(root, ".agents/skills"), { recursive: true }),
    mkdir(path.join(root, ".claude/skills"), { recursive: true }),
    mkdir(path.join(root, "telemetry/delivery-runs"), { recursive: true }),
  ]);
  await Promise.all([
    cp(path.join(ROOT, ".agent-skills"), path.join(root, ".agent-skills"), {
      recursive: true,
      verbatimSymlinks: true,
    }),
    cp(
      path.join(ROOT, ".agents/skills/compound-delivery-kernel"),
      path.join(root, ".agents/skills/compound-delivery-kernel"),
      { recursive: true, verbatimSymlinks: true },
    ),
    cp(
      path.join(ROOT, ".claude/skills/compound-delivery-kernel"),
      path.join(root, ".claude/skills/compound-delivery-kernel"),
      { recursive: true, verbatimSymlinks: true },
    ),
    cp(
      path.join(ROOT, ".agents/portable/releases"),
      path.join(root, ".agents/portable/releases"),
      { recursive: true },
    ),
    cp(
      path.join(ROOT, ".agents/migrations"),
      path.join(root, ".agents/migrations"),
      { recursive: true },
    ),
  ]);
  await cp(
    path.join(
      ROOT,
      "telemetry/delivery-runs/2026-08-28T20-20-17-363Z-codex-v26-1429-shadow-canary.json",
    ),
    path.join(
      root,
      "telemetry/delivery-runs/2026-08-28T20-20-17-363Z-codex-v26-1429-shadow-canary.json",
    ),
  );
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  return root;
}

describe("portable workflow canary adoption", () => {
  it("binds one active workflow to the accepted shadow and exact release", async () => {
    const result = await auditPortableCanaryAdoption(ROOT);

    expect(result.findings).toEqual([]);
    expect(result.summary).toContain(
      "compound-delivery-kernel is active from core-v1 for codex and claude-code",
    );
  });

  it("restores the prior Athena body offline without touching unrelated work", async () => {
    const result = await rehearsePortableCanaryRollback(ROOT);

    expect(result).toMatchObject({
      restored: true,
      sourceIndependent: true,
      unrelatedBytesPreserved: true,
    });
  });

  it("rejects tampered release bytes", async () => {
    const root = await canaryFixture();
    try {
      await appendFile(
        path.join(root, ".agents/portable/releases/core-v1.zip"),
        "tampered",
      );
      const result = await auditPortableCanaryAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "canary-archive-drift",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects tampered release metadata", async () => {
    const root = await canaryFixture();
    try {
      await appendFile(
        path.join(root, ".agents/portable/releases/core-v1.release.json"),
        "tampered",
      );
      const result = await auditPortableCanaryAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "canary-metadata-drift",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing host exposure", async () => {
    const root = await canaryFixture();
    try {
      await unlink(path.join(root, ".claude/skills/compound-delivery-kernel"));
      const result = await auditPortableCanaryAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "canary-host-exposure-invalid",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an existing host exposure with the wrong target", async () => {
    const root = await canaryFixture();
    try {
      const exposurePath = path.join(
        root,
        ".claude/skills/compound-delivery-kernel",
      );
      await unlink(exposurePath);
      await symlink("../../.agent-skills/current", exposurePath);
      const result = await auditPortableCanaryAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "canary-host-exposure-invalid",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a migration record bound to another predecessor", async () => {
    const root = await canaryFixture();
    try {
      const recordPath = path.join(
        root,
        ".agents/migrations/portable-kernel-canary.json",
      );
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      record.lifecycle.predecessorSha256 = "0".repeat(64);
      await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

      const result = await auditPortableCanaryAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "canary-record-invalid",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an active receipt bound to another valid predecessor", async () => {
    const root = await canaryFixture();
    try {
      const body = "alternate valid predecessor\n";
      const digest = createHash("sha256").update(body).digest("hex");
      const predecessorRoot = path.join(
        root,
        ".agent-skills/predecessors",
        digest,
      );
      await mkdir(predecessorRoot, { recursive: true });
      await Promise.all([
        writeFile(path.join(predecessorRoot, "SKILL.md"), body),
        writeFile(
          path.join(predecessorRoot, ".agent-skills-predecessor.json"),
          `${JSON.stringify(
            {
              ownership: "agent-skills-managed",
              schemaVersion: "agent-skills-predecessor/1",
              sha256: digest,
              skill: "compound-delivery-kernel",
            },
            null,
            2,
          )}\n`,
        ),
      ]);
      const receiptPath = path.join(root, ".agent-skills/active.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      receipt.adoption.predecessorSha256 = digest;
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

      const result = await auditPortableCanaryAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "canary-lifecycle-invalid",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects shadow evidence that no longer represents an exact match", async () => {
    const root = await canaryFixture();
    try {
      const telemetryPath = path.join(
        root,
        "telemetry/delivery-runs/2026-08-28T20-20-17-363Z-codex-v26-1429-shadow-canary.json",
      );
      const telemetry = JSON.parse(await readFile(telemetryPath, "utf8"));
      telemetry.shadowComparison.status = "mismatch";
      await writeFile(telemetryPath, `${JSON.stringify(telemetry, null, 2)}\n`);
      const result = await auditPortableCanaryAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "canary-shadow-not-accepted",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a valid matching shadow comparison with another digest", async () => {
    const root = await canaryFixture();
    try {
      const telemetryPath = path.join(
        root,
        "telemetry/delivery-runs/2026-08-28T20-20-17-363Z-codex-v26-1429-shadow-canary.json",
      );
      const telemetry = JSON.parse(await readFile(telemetryPath, "utf8"));
      telemetry.shadowComparison.observedAt = "2026-08-28T20:20:24.459Z";
      telemetry.shadowComparison.comparisonSha256 =
        portableShadowComparisonSha256(telemetry.shadowComparison);
      await writeFile(telemetryPath, `${JSON.stringify(telemetry, null, 2)}\n`);

      const result = await auditPortableCanaryAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "canary-shadow-not-accepted",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
