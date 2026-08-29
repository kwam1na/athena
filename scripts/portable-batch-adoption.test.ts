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
import { describe, expect, it } from "vitest";

import {
  auditPortableBatchAdoption,
  loadPortableBatchBaselineProjection,
  rehearsePortableBatchRollback,
} from "./portable-batch-adoption";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOWS = [
  "compound-delivery-kernel",
  "compound-learning",
  "deliver-work",
  "execute-work",
  "plan-work",
  "review-work",
];

async function batchFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "athena-portable-batches-"));
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
      path.join(ROOT, ".agents/migrations"),
      path.join(root, ".agents/migrations"),
      { recursive: true },
    ),
    cp(
      path.join(ROOT, ".agents/portable"),
      path.join(root, ".agents/portable"),
      { recursive: true },
    ),
    cp(
      path.join(ROOT, ".agents/portable-overlay-map.json"),
      path.join(root, ".agents/portable-overlay-map.json"),
    ),
    cp(
      path.join(
        ROOT,
        "telemetry/delivery-runs/2026-08-28T20-20-17-363Z-codex-v26-1429-shadow-canary.json",
      ),
      path.join(
        root,
        "telemetry/delivery-runs/2026-08-28T20-20-17-363Z-codex-v26-1429-shadow-canary.json",
      ),
    ),
  ]);
  await Promise.all(
    WORKFLOWS.flatMap((workflow) =>
      [".agents/skills", ".claude/skills"].map((host) =>
        cp(
          path.join(ROOT, host, workflow),
          path.join(root, host, workflow),
          { recursive: true, verbatimSymlinks: true },
        ),
      ),
    ),
  );
  return root;
}

describe("portable workflow batch adoption", () => {
  it("binds both ordered batches to the accepted release and complete inventory", async () => {
    const result = await auditPortableBatchAdoption(ROOT);

    expect(result.findings).toEqual([]);
    expect(result.summary).toContain("2 reversible batches");
    expect(result.summary).toContain("5 remaining portable workflows");
  });

  it("rolls back the entry point and then the dependency workflows offline", async () => {
    const result = await rehearsePortableBatchRollback(ROOT);

    expect(result).toEqual({
      restoredBatches: ["delivery-entrypoint", "workflow-primitives"],
      sourceIndependent: true,
      unrelatedBytesPreserved: true,
    });
  });

  it("rejects a host projection with the wrong target", async () => {
    const root = await batchFixture();
    try {
      const exposure = path.join(root, ".claude/skills/plan-work");
      await unlink(exposure);
      await symlink("../../.agent-skills/current", exposure);

      const result = await auditPortableBatchAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "batch-host-exposure-invalid",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to hide an invalid host exposure from baseline discovery", async () => {
    const root = await batchFixture();
    try {
      const exposure = path.join(root, ".claude/skills/plan-work");
      await unlink(exposure);
      await symlink("../../.agent-skills/current", exposure);

      await expect(loadPortableBatchBaselineProjection(root)).rejects.toThrow(
        "portable workflow batch exposure .claude/skills/plan-work is not current",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects tampered portable workflow bytes", async () => {
    const root = await batchFixture();
    try {
      await appendFile(
        path.join(root, ".agent-skills/current/skills/review-work/SKILL.md"),
        "tampered",
      );

      const result = await auditPortableBatchAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "batch-workflow-drift",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a tampered retained entry-point predecessor", async () => {
    const root = await batchFixture();
    try {
      const record = JSON.parse(
        await readFile(
          path.join(root, ".agents/migrations/portable-workflow-batches.json"),
          "utf8",
        ),
      );
      await appendFile(
        path.join(
          root,
          record.batches[1].rollback.predecessorPath,
          "deliver-work/SKILL.md",
        ),
        "tampered",
      );

      const result = await auditPortableBatchAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "batch-predecessor-drift",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects inventory that omits a baseline classification", async () => {
    const root = await batchFixture();
    try {
      const recordPath = path.join(
        root,
        ".agents/migrations/portable-workflow-batches.json",
      );
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      record.inventory.pop();
      await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

      const result = await auditPortableBatchAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "batch-record-invalid",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps Linear as a full optional adapter instead of a migration limit", async () => {
    const root = await batchFixture();
    try {
      const recordPath = path.join(
        root,
        ".agents/migrations/portable-workflow-batches.json",
      );
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      const linear = record.inventory.find(
        (entry: { id: string }) => entry.id === "linear-tracker-adapter",
      );
      linear.outcome = "migrated";
      await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

      const result = await auditPortableBatchAdoption(root);

      expect(result.findings.map((finding) => finding.code)).toContain(
        "batch-record-invalid",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
