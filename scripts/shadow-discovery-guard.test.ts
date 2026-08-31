import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SHADOW_ACTIVATION_FILE,
  SHADOW_GATE_RECORD_FILE,
  VENDORED_DISCOVERY_LAYOUT_DIGEST,
  computeVendoredDiscoveryLayoutDigest,
  observeVendoredDiscoveryLayoutWorkingTree,
  runShadowDiscoveryGuard,
} from "./shadow-discovery-guard";
import { POLICY_PROJECTION_DIR } from "./policy-projection-check";

const rootDir = path.resolve(import.meta.dirname, "..");
const policyDir = path.join(rootDir, POLICY_PROJECTION_DIR);

function codes(result: Awaited<ReturnType<typeof runShadowDiscoveryGuard>>) {
  return result.findings.map((finding) => finding.code);
}

async function readPolicy(file: string) {
  return JSON.parse(await readFile(path.join(policyDir, file), "utf8"));
}

/**
 * A disposable tree carrying the two policy artifacts, so a planted defect is
 * never written into the repository's own tracked bytes.
 */
async function plantedTree(edit: {
  activation?: (value: any) => void;
  gateRecord?: (value: any) => void;
}) {
  const dir = await mkdtemp(path.join(tmpdir(), "athena-shadow-guard-"));
  const activation = await readPolicy(SHADOW_ACTIVATION_FILE);
  const gateRecord = await readPolicy(SHADOW_GATE_RECORD_FILE);
  edit.activation?.(activation);
  edit.gateRecord?.(gateRecord);
  await writeFile(
    path.join(dir, SHADOW_ACTIVATION_FILE),
    `${JSON.stringify(activation, null, 2)}\n`,
  );
  await writeFile(
    path.join(dir, SHADOW_GATE_RECORD_FILE),
    `${JSON.stringify(gateRecord, null, 2)}\n`,
  );
  return dir;
}

/** An affirmative record in exactly the shape the binding produces. */
function bindingSourcedDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: "athena-shadow-1",
    category: "code",
    countedInComparisonSet: true,
    projectionConsumption: {
      source: "binding",
      affirmative: true,
      projectionDigest:
        "6791217c94ce2cafe5aa802c057ad4db11d874920b68fbf9598bb1f86e34539e",
      marker: {
        deliveryId: "athena-shadow-1",
        fence: 1,
        consumed: "skills/agent-skills-core-v1.zip",
      },
    },
    ...overrides,
  };
}

describe("shadow-window posture", () => {
  test("the tracked activation and gate record pass the guard", async () => {
    const result = await runShadowDiscoveryGuard(rootDir);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
  });

  test("an activation that claims delivery authority is a finding", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.deliveryAuthority = "managed";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("delivery_authority_claimed");
  });

  test("an activation outside shadow mode is a finding", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.installationMode = "active";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("activation_not_shadow");
  });

  test("a missing artifact is a finding rather than a silent pass", async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), "athena-shadow-guard-empty-"));
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: emptyDir });
    expect(codes(result)).toContain("artifact_unreadable");
    expect(result.status).toBe("fail");
  });
});

describe("vendored discovery layout byte-neutrality", () => {
  test("the tracked layout still hashes to the pinned digest", async () => {
    const observed = await computeVendoredDiscoveryLayoutDigest(rootDir);
    expect(observed).toBe(VENDORED_DISCOVERY_LAYOUT_DIGEST);
  });

  test("a changed vendored byte is drift, not an accepted new normal", async () => {
    const result = await runShadowDiscoveryGuard(rootDir, {
      observedLayoutDigest: "0".repeat(64),
    });
    expect(codes(result)).toContain("vendored_layout_drift");
  });

  test("the tracked layout is also clean in the working tree", async () => {
    expect(observeVendoredDiscoveryLayoutWorkingTree(rootDir)).toBe("");
  });

  test("an unstaged retarget of an exposure symlink is drift the index cannot see", async () => {
    const result = await runShadowDiscoveryGuard(rootDir, {
      observedLayoutWorkingTree: " M .claude/skills/deliver-work",
    });
    expect(codes(result)).toContain("vendored_layout_drift");
  });
});

describe("projection scoping", () => {
  test("a projection inside a managed delivery worktree is in scope", async () => {
    const result = await runShadowDiscoveryGuard(rootDir, {
      worktree: {
        dir: path.join(rootDir, ".worktrees", "managed", "delivery-1"),
        projectionPresent: true,
      },
    });
    expect(codes(result)).not.toContain("projection_outside_managed_worktree");
  });

  test("a projection at the repository root is out of scope", async () => {
    const result = await runShadowDiscoveryGuard(rootDir, {
      worktree: { dir: rootDir, projectionPresent: true },
    });
    expect(codes(result)).toContain("projection_outside_managed_worktree");
  });

  test("a projection in a non-managed worktree is out of scope", async () => {
    const result = await runShadowDiscoveryGuard(rootDir, {
      worktree: {
        dir: path.join(rootDir, ".worktrees", "codex", "some-other-work"),
        projectionPresent: true,
      },
    });
    expect(codes(result)).toContain("projection_outside_managed_worktree");
  });

  test("a degenerate managed worktree root does not turn the scope rule off", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.projection.managedDeliveryWorktreeRoot = "";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, {
      policyDir: policyDirCopy,
      worktree: { dir: rootDir, projectionPresent: true },
    });
    expect(codes(result)).toContain("projection_outside_managed_worktree");
  });

  test("a managed worktree without a projection is not a finding", async () => {
    const result = await runShadowDiscoveryGuard(rootDir, {
      worktree: {
        dir: path.join(rootDir, ".worktrees", "managed", "delivery-1"),
        projectionPresent: false,
      },
    });
    expect(codes(result)).not.toContain("projection_outside_managed_worktree");
  });

  test("the repository root the guard actually runs in carries no projection", async () => {
    const result = await runShadowDiscoveryGuard(rootDir);
    expect(codes(result)).not.toContain("projection_outside_managed_worktree");
  });
});

describe("exactly-one-discovery exclusivity", () => {
  test("coexisting roots on an exclusivity-ungraded host are non-blocking", async () => {
    const result = await runShadowDiscoveryGuard(rootDir, {
      worktree: {
        dir: path.join(rootDir, ".worktrees", "managed", "delivery-1"),
        projectionPresent: true,
        vendoredDiscoveryVisible: true,
      },
    });
    expect(codes(result)).not.toContain("discovery_exclusivity_violation");
    expect(
      result.observations.map((observation) => observation.code),
    ).toContain("exclusivity_non_blocking");
  });

  test("coexisting roots become a finding once the host is exclusivity-graded", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.hosts[0].exclusivityGrading = "exclusivity-graded";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, {
      policyDir: policyDirCopy,
      worktree: {
        dir: path.join(rootDir, ".worktrees", "managed", "delivery-1"),
        projectionPresent: true,
        vendoredDiscoveryVisible: true,
      },
    });
    expect(codes(result)).toContain("discovery_exclusivity_violation");
  });

  test("an activation that claims blocking exclusivity while the grade is ungraded is a finding", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.exclusivityPosition.duringShadowWindow = "blocking";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("exclusivity_position_unsupported");
  });
});

describe("binding-sourced projection-consumption records", () => {
  test("an affirmative binding-sourced record counts toward the comparison set", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [bindingSourcedDelivery()];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(result.findings).toEqual([]);
    expect(result.countedDeliveryIds).toEqual(["athena-shadow-1"]);
  });

  test("an agent-supplied consumption claim is rejected", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [
          bindingSourcedDelivery({
            projectionConsumption: {
              source: "agent",
              affirmative: true,
              projectionDigest: "6791217c94ce2cafe5aa802c057ad4db11d874920b68fbf9598bb1f86e34539e",
              marker: {
                deliveryId: "athena-shadow-1",
                fence: 1,
                consumed: "skills/agent-skills-core-v1.zip",
              },
            },
          }),
        ];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("agent_supplied_consumption_claim");
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("a delivery with no consumption record is excluded from the comparison set", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [
          bindingSourcedDelivery({ projectionConsumption: undefined, countedInComparisonSet: false }),
        ];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("consumption_record_missing");
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("a record affirming non-consumption is excluded from the comparison set", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [
          bindingSourcedDelivery({
            countedInComparisonSet: false,
            projectionConsumption: {
              source: "binding",
              affirmative: false,
              reason: "the run consumed the ambient vendored generation",
            },
          }),
        ];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toEqual([]);
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("counting a delivery whose record is not affirmative is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [
          bindingSourcedDelivery({
            countedInComparisonSet: true,
            projectionConsumption: {
              source: "binding",
              affirmative: false,
              reason: "the run consumed the ambient vendored generation",
            },
          }),
        ];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("comparison_set_admission_defect");
  });

  test("a marker that names another delivery is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        const delivery = bindingSourcedDelivery();
        delivery.projectionConsumption.marker.deliveryId = "some-other-delivery";
        value.deliveries = [delivery];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("consumption_record_shape");
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("an unnamed delivery whose marker is also unnamed is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        const delivery = bindingSourcedDelivery();
        delete delivery.id;
        delete delivery.projectionConsumption.marker.deliveryId;
        value.deliveries = [delivery];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("consumption_record_shape");
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("an affirmative flag that is not a boolean is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        const delivery = bindingSourcedDelivery();
        delivery.projectionConsumption.affirmative = "yes";
        value.deliveries = [delivery];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("consumption_record_shape");
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("an affirmative record without the receipted projection digest is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        const delivery = bindingSourcedDelivery();
        delete delivery.projectionConsumption.projectionDigest;
        value.deliveries = [delivery];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("consumption_record_shape");
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("a marker naming no consumed workflow source is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        const delivery = bindingSourcedDelivery();
        delivery.projectionConsumption.marker.consumed = "";
        value.deliveries = [delivery];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("consumption_record_shape");
  });

  test("a counted category the baseline mix does not include is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [bindingSourcedDelivery({ category: "chore" })];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("comparison_set_mix_defect");
  });

  test("a marker missing its fence is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        const delivery = bindingSourcedDelivery();
        delivery.projectionConsumption.marker.fence = "one";
        value.deliveries = [delivery];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("consumption_record_shape");
  });

  test("a counted set larger than the baseline mix is a finding", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [
          bindingSourcedDelivery({ id: "a", projectionConsumption: { ...bindingSourcedDelivery().projectionConsumption, marker: { deliveryId: "a", fence: 1, consumed: "skills/agent-skills-core-v1.zip" } } }),
          bindingSourcedDelivery({ id: "b", projectionConsumption: { ...bindingSourcedDelivery().projectionConsumption, marker: { deliveryId: "b", fence: 1, consumed: "skills/agent-skills-core-v1.zip" } } }),
        ];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("comparison_set_mix_defect");
  });

  test("an empty comparison set reports the gate as not yet runnable", async () => {
    const result = await runShadowDiscoveryGuard(rootDir);
    expect(
      result.observations.map((observation) => observation.code),
    ).toContain("comparison_set_incomplete");
  });
});

describe("the guard is read-only", () => {
  test("running the guard writes nothing into the policy directory", async () => {
    const before = await readFile(path.join(policyDir, SHADOW_GATE_RECORD_FILE));
    await runShadowDiscoveryGuard(rootDir);
    const after = await readFile(path.join(policyDir, SHADOW_GATE_RECORD_FILE));
    expect(after.equals(before)).toBe(true);
  });
});
