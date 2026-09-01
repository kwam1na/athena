import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  REPOSITORY_POLICY_FILE,
  SHADOW_ACTIVATION_FILE,
  SHADOW_GATE_RECORD_FILE,
  VENDORED_DISCOVERY_LAYOUT_DIGEST,
  computeVendoredDiscoveryLayoutDigest,
  observeVendoredDiscoveryLayoutWorkingTree,
  vendoredDiscoveryLayoutPathspec,
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
 * A disposable tree carrying the policy artifacts, so a planted defect is
 * never written into the repository's own tracked bytes. Planted trees clear
 * the temporary pre-M1 blocker list before applying their edit so the existing
 * per-entry checks remain independently exercised.
 */
async function plantedTree(edit: {
  activation?: (value: any) => void;
  gateRecord?: (value: any) => void;
  repositoryPolicy?: (value: any) => void;
}) {
  const dir = await mkdtemp(path.join(tmpdir(), "athena-shadow-guard-"));
  const activation = await readPolicy(SHADOW_ACTIVATION_FILE);
  const gateRecord = await readPolicy(SHADOW_GATE_RECORD_FILE);
  const repositoryPolicy = await readPolicy(REPOSITORY_POLICY_FILE);
  gateRecord.openPreM1Blockers = [];
  edit.activation?.(activation);
  edit.gateRecord?.(gateRecord);
  edit.repositoryPolicy?.(repositoryPolicy);
  await writeFile(
    path.join(dir, SHADOW_ACTIVATION_FILE),
    `${JSON.stringify(activation, null, 2)}\n`,
  );
  await writeFile(
    path.join(dir, SHADOW_GATE_RECORD_FILE),
    `${JSON.stringify(gateRecord, null, 2)}\n`,
  );
  await writeFile(
    path.join(dir, REPOSITORY_POLICY_FILE),
    `${JSON.stringify(repositoryPolicy, null, 2)}\n`,
  );
  return dir;
}

/** A shape-valid derived summary; the guard does not independently verify provenance. */
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
    expect(result.countedDeliveryIds).toEqual([]);
    expect(
      result.observations.map((observation) => observation.code),
    ).toContain("comparison_set_incomplete");
  });

  test("the scratch marker characterization remains diagnostic and non-counting", async () => {
    const activation = await readPolicy(SHADOW_ACTIVATION_FILE);
    const entry = activation.characterization.historicalScopeCharacterization.observed.gateRecordEntry;
    expect(entry.countedInComparisonSet).toBe(false);
    expect(entry.evidenceClassification).toBe("diagnostic-only");
    expect(entry.nonCountingReason).toContain("no qualified host callback");
    expect(entry.nonCountingReason).toContain("fills no M1 slot");
  });

  test("an activation that claims delivery authority is a finding", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.deliveryAuthority = "managed";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("delivery_authority_claimed");
    expect(result.status).toBe("fail");
  });

  test("valid JSON of the wrong shape is an unreadable artifact, not a crash", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.projection.managedDeliveryWorktreeRoot = 7;
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, {
      policyDir: policyDirCopy,
      worktree: { dir: rootDir, projectionPresent: true },
    });
    expect(result.status).toBe("fail");
    expect(codes(result)).toContain("artifact_unreadable");
  });

  test("a hosts list that is not a list is handled without crashing", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.hosts = { "claude-code": {} };
        value.exclusivityPosition.duringShadowWindow = "blocking";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("exclusivity_position_unsupported");
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

describe("the pinned product and the evidence recorded about it", () => {
  test("the tracked characterization names the pinned commit, as a full object id", async () => {
    const activation = await readPolicy(SHADOW_ACTIVATION_FILE);
    expect(activation.product.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(activation.characterization.productCommit).toBe(activation.product.commit);
  });

  test("the historical scope characterization records resolving a charter for every declared lens", async () => {
    // Named members, not a count: a compilation that resolved some other lens
    // set would satisfy a count and satisfy nothing else, and the defect this
    // repository actually hit was a specific charter reference the pinned
    // product could not resolve.
    const activation = await readPolicy(SHADOW_ACTIVATION_FILE);
    const policy = await readPolicy(REPOSITORY_POLICY_FILE);
    const resolved = activation.characterization.historicalScopeCharacterization.observed.policyCompilation.resolvedLenses;
    expect(
      resolved.map((lens: any) => [lens.lensId, lens.personaId]).sort(),
    ).toEqual([
      ["lens.adversarial-testing", "persona.adversarial"],
      ["lens.outcome-correctness", "persona.outcome-correctness"],
    ]);
    expect(
      policy.reviewLenses.map((lens: any) => [lens.lensId, lens.personaId]).sort(),
    ).toEqual([
      ["lens.adversarial-testing", "persona.adversarial"],
      ["lens.outcome-correctness", "persona.outcome-correctness"],
    ]);
    // Each resolved lens carries the digest of the charter bytes the pinned
    // composition resolved it to. Athena holds no copy of that composition, so
    // this asserts the shape only — that a charter digest was recorded at all,
    // not that these bytes are the charter's.
    for (const lens of resolved) expect(lens.personaDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("reverting the pin without re-characterizing is a finding", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.product.commit = "8635ea8aca18f27f660b3551b950ffb7e6ad22dd";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterization_pin_mismatch");
  });

  test("moving the characterization off the pin is the same finding", async () => {
    // The mirror of the row above: the defect is the two disagreeing, not the
    // product member specifically, so the guard must not be satisfied by
    // re-stamping the evidence's commit instead of re-observing it.
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.characterization.productCommit = "8635ea8aca18f27f660b3551b950ffb7e6ad22dd";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterization_pin_mismatch");
  });

  test("an explicit scorer from another commit is a finding", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.characterization.observed.scorerAuthority.commit =
          "8635ea8aca18f27f660b3551b950ffb7e6ad22dd";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterization_pin_mismatch");
  });

  test("a characterization that names no commit is a finding", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        delete value.characterization.productCommit;
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterization_pin_mismatch");
  });

  test("an abbreviated pin is a finding, whatever the characterization says", async () => {
    // An abbreviation names a commit only until a colliding prefix exists, so
    // it is refused even when the recorded evidence agrees with it.
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.product.commit = "0c87428";
        value.characterization.productCommit = "0c87428";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterization_pin_mismatch");
  });

  test("a lens the pinned product was never shown to resolve is a finding", async () => {
    const policyDirCopy = await plantedTree({
      repositoryPolicy: (value) => {
        value.reviewLenses.push({
          lensId: "lens.security",
          category: "security",
          personaId: "persona.security",
        });
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterized_lenses_stale");
  });

  test("re-pointing a declared lens at another charter is a finding", async () => {
    // The exact mapping this repository chose: lens.adversarial-testing sits
    // in the testing-policy category and references persona.adversarial. A
    // guard that only counted lenses would pass this silently.
    const policyDirCopy = await plantedTree({
      repositoryPolicy: (value) => {
        value.reviewLenses[1].personaId = "persona.testing-policy";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterized_lenses_stale");
  });

  test("re-pointing a declared lens at another category is a finding", async () => {
    // The category is a taxonomy slot the compilation resolved under, and it
    // is part of the identity the guard compares. Mutating only the charter
    // reference would leave this component of that identity unwitnessed, and a
    // later narrowing of the comparison would ship green.
    const policyDirCopy = await plantedTree({
      repositoryPolicy: (value) => {
        value.reviewLenses[1].category = "outcome-correctness";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterized_lenses_stale");
  });

  test("renaming a declared lens is a finding", async () => {
    const policyDirCopy = await plantedTree({
      repositoryPolicy: (value) => {
        value.reviewLenses[1].lensId = "lens.adversarial";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterized_lenses_stale");
  });

  test("dropping a declared lens is a finding", async () => {
    const policyDirCopy = await plantedTree({
      repositoryPolicy: (value) => {
        value.reviewLenses = [value.reviewLenses[0]];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("characterized_lenses_stale");
  });

  test("reordering the declared lenses is not a finding", async () => {
    // The comparison is over the lens set, not the document's order: a
    // reordering changes no charter reference, and a guard that fired on it
    // would demand a re-characterization for nothing.
    const policyDirCopy = await plantedTree({
      repositoryPolicy: (value) => {
        value.reviewLenses = [...value.reviewLenses].reverse();
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).not.toContain("characterized_lenses_stale");
  });

  test("a policy document with no lens list is an unreadable artifact, not a crash", async () => {
    const policyDirCopy = await plantedTree({
      repositoryPolicy: (value) => {
        value.reviewLenses = "two";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
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

  test("the working-tree pathspec covers the layout's members, not the exposure roots", async () => {
    // The exposure roots also hold Athena's own skills. Watching the roots
    // wholesale would raise drift on ordinary skill churn, which is a guard
    // the operator learns to ignore.
    // One untracked file rather than a directory: a killed run then leaves a
    // stray file under the exposure root, never a stray discoverable skill.
    const skillProbe = path.join(rootDir, ".agents", "skills", "zz-guard-pathspec-probe.md");
    const layoutProbe = path.join(rootDir, ".agent-skills", "zz-guard-layout-probe");
    await writeFile(skillProbe, "probe\n");
    try {
      expect(observeVendoredDiscoveryLayoutWorkingTree(rootDir)).toBe("");
      // The positive control: the same observer must see a change inside the
      // layout itself, so an empty result is a real observation and not a
      // pathspec that matches nothing.
      await writeFile(layoutProbe, "probe\n");
      expect(observeVendoredDiscoveryLayoutWorkingTree(rootDir)).not.toBe("");
      // And the pathspec must name both halves of the layout. Watching the
      // generation tree alone would leave a retargeted exposure symlink — the
      // change this position most exists to catch — outside what git is asked
      // about, with the suite still green.
      const pathspec = vendoredDiscoveryLayoutPathspec(rootDir);
      expect(pathspec).toContain(".agent-skills");
      expect(
        pathspec.filter((entry) => entry.startsWith(".claude/skills/")).length,
      ).toBeGreaterThan(0);
      expect(
        pathspec.filter((entry) => entry.startsWith(".agents/skills/")).length,
      ).toBeGreaterThan(0);
    } finally {
      await rm(skillProbe, { force: true });
      await rm(layoutProbe, { force: true });
    }
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

  test("a sibling of the managed worktree root is not a managed worktree", async () => {
    const result = await runShadowDiscoveryGuard(rootDir, {
      worktree: {
        dir: path.join(rootDir, ".worktrees", "managed-delivery-1"),
        projectionPresent: true,
      },
    });
    expect(codes(result)).toContain("projection_outside_managed_worktree");
  });

  test("a real projection at the repository root is observed without being injected", async () => {
    // A file, not a directory: the guard only asks existsSync, so a file is an
    // identical control — and it can never adopt-and-delete a live run-pinned
    // projection if this suite is ever run from inside a managed delivery
    // worktree. A leaked probe also shows up in git status, which an empty
    // directory would not.
    const projection = path.join(rootDir, ".managed-projection");
    await writeFile(projection, "probe\n");
    try {
      const result = await runShadowDiscoveryGuard(rootDir);
      expect(codes(result)).toContain("projection_outside_managed_worktree");
      expect(
        result.observations.map((observation) => observation.code),
      ).toContain("exclusivity_non_blocking");
    } finally {
      await rm(projection, { force: true });
    }
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
  test("coexisting roots on the current-version-unverified proving host are non-blocking", async () => {
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

  test("coexisting roots stay non-blocking on any grading that is not the capable one", async () => {
    for (const grading of ["exclusivity-pending", undefined]) {
      const policyDirCopy = await plantedTree({
        activation: (value) => {
          if (grading === undefined) delete value.hosts[0].exclusivityGrading;
          else value.hosts[0].exclusivityGrading = grading;
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
      expect(codes(result)).not.toContain("discovery_exclusivity_violation");
      expect(
        result.observations.map((observation) => observation.code),
      ).toContain("exclusivity_non_blocking");
    }
  });

  test("coexisting roots stay non-blocking when no hosts entry grades the proving host", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.provingHost = "claude-code-2";
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
    expect(codes(result)).not.toContain("discovery_exclusivity_violation");
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
        value.hosts[0].exclusivityGrading = "exclusivity-ungraded";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("exclusivity_position_unsupported");
  });

  test("a blocking claim is refused on any grading that is not the capable one", async () => {
    for (const grading of ["ungraded", "exclusivity-pending", undefined]) {
      const policyDirCopy = await plantedTree({
        activation: (value) => {
          value.exclusivityPosition.duringShadowWindow = "blocking";
          if (grading === undefined) delete value.hosts[0].exclusivityGrading;
          else value.hosts[0].exclusivityGrading = grading;
        },
      });
      const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
      expect(codes(result)).toContain("exclusivity_position_unsupported");
    }
  });

  test("a blocking claim is refused when no hosts entry grades the proving host", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.exclusivityPosition.duringShadowWindow = "blocking";
        value.provingHost = "claude-code-2";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("exclusivity_position_unsupported");
  });

  test("a blocking claim is accepted once the proving host is graded capable", async () => {
    const policyDirCopy = await plantedTree({
      activation: (value) => {
        value.exclusivityPosition.duringShadowWindow = "blocking";
        value.hosts[0].exclusivityGrading = "exclusivity-graded";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).not.toContain("exclusivity_position_unsupported");
  });
});

describe("derived projection-consumption summaries without external-artifact inspection", () => {
  test("open pre-M1 blockers reject a marker-only entry before it can count", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.openPreM1Blockers = ["V26-1519", "V26-1520", "V26-1521"];
        value.deliveries = [bindingSourcedDelivery()];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toEqual(["pre_m1_blockers_open"]);
    expect(result.countedDeliveryIds).toEqual([]);
    expect(
      result.observations.map((observation) => observation.code),
    ).toContain("comparison_set_incomplete");
  });

  test("a shape-valid derived summary is accepted without independent provenance inspection", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [bindingSourcedDelivery()];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(result.findings).toEqual([]);
    expect(result.countedDeliveryIds).toEqual(["athena-shadow-1"]);
  });

  test("a literal non-binding consumption summary is rejected", async () => {
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

  test("a consumption record with no declared source is rejected", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        const delivery = bindingSourcedDelivery();
        delete delivery.projectionConsumption.source;
        value.deliveries = [delivery];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("agent_supplied_consumption_claim");
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("an empty-string delivery id is a finding, not an admitted entry", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        const delivery = bindingSourcedDelivery({ id: "" });
        delivery.projectionConsumption.marker.deliveryId = "";
        value.deliveries = [delivery];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("consumption_record_shape");
    expect(result.countedDeliveryIds).toEqual([]);
  });

  test("one run counted twice does not fill the comparison set", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [
          bindingSourcedDelivery(),
          bindingSourcedDelivery({ category: "docs" }),
        ];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("comparison_set_admission_defect");
    expect(result.countedDeliveryIds).toEqual(["athena-shadow-1"]);
  });

  test("a category named after a prototype member does not skip the mix cap", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.deliveries = [bindingSourcedDelivery({ category: "constructor" })];
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(codes(result)).toContain("comparison_set_mix_defect");
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

  test("an affirmative record without a receipted projection digest is a finding", async () => {
    // Both the absent field and a value that is not the receipted digest's
    // shape: an absence-only test leaves the shape check unpinned.
    for (const digest of [undefined, "not-a-digest"]) {
      const policyDirCopy = await plantedTree({
        gateRecord: (value) => {
          const delivery = bindingSourcedDelivery();
          if (digest === undefined) delete delivery.projectionConsumption.projectionDigest;
          else delivery.projectionConsumption.projectionDigest = digest;
          value.deliveries = [delivery];
        },
      });
      const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
      expect(codes(result)).toContain("consumption_record_shape");
      expect(result.countedDeliveryIds).toEqual([]);
    }
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

  test("an unparseable required total still reports the gate as not runnable", async () => {
    const policyDirCopy = await plantedTree({
      gateRecord: (value) => {
        value.comparisonSetRequirement.total = "three";
      },
    });
    const result = await runShadowDiscoveryGuard(rootDir, { policyDir: policyDirCopy });
    expect(
      result.observations.map((observation) => observation.code),
    ).toContain("comparison_set_incomplete");
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
