import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  auditPortableWorkflowBaseline,
  loadPortableBaselineDocuments,
} from "./portable-baseline-check";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("portable workflow characterization baseline", () => {
  it("validates the current source-backed baseline, classifications, scenarios, and inventory", async () => {
    const result = await auditPortableWorkflowBaseline(REPO_ROOT);

    expect(result.findings).toEqual([]);
    expect(result.scenarioIds).toEqual([
      "bounded-implementation",
      "compounding",
      "configured-harness-blocker",
      "linear-tracking",
      "planning",
      "review",
      "routing",
    ]);
    expect(result.summary).toContain("7 characterization scenarios");
  });

  it("rejects an unadjudicated observed-only assertion as a parity blocker", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const firstAssertion = documents.baseline.assertions[0];
    for (const adjudication of ["unadjudicated", "approved"] as const) {
      const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
        documents: {
          ...documents,
          baseline: {
            ...documents.baseline,
            assertions: [
              {
                ...firstAssertion,
                authority: "observed-only",
                parity: "blocking",
                adjudication,
                citations: [],
              },
              ...documents.baseline.assertions.slice(1),
            ],
          },
        },
      });

      expect(result.findings.map((finding) => finding.code)).toContain(
        "observed-only-blocker-unadjudicated",
      );
    }
  });

  it("detects drift in a selected source instead of recapturing it silently", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const [firstSource, ...remainingSources] = documents.baseline.sources;
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        baseline: {
          ...documents.baseline,
          sources: [
            { ...firstSource, sha256: "0".repeat(64) },
            ...remainingSources,
          ],
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "source-digest-drift",
    );
  });

  it("requires one classification per bounded-closure member and a stable residual inventory", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const [firstMember] = documents.overlayMap.boundedClosure.members;
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            members: [
              ...documents.overlayMap.boundedClosure.members,
              firstMember,
              {
                ...firstMember,
                id: "overlapping-member",
                path: ".agents/skills/deliver-work",
              },
            ],
          },
          outOfScopeInventory: {
            ...documents.overlayMap.outOfScopeInventory,
            fileCount: documents.overlayMap.outOfScopeInventory.fileCount + 1,
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "bounded-member-duplicate",
        "bounded-member-overlap",
        "inventory-count-drift",
      ]),
    );
  });

  it("keeps tracker-neutral and Linear behavior in separate classifications", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const classifications = new Map(
      documents.overlayMap.classifications.map((entry) => [
        entry.id,
        entry.classification,
      ]),
    );

    expect(classifications.get("tracker-neutral-capability-contract")).toBe(
      "portable-candidate",
    );
    expect(classifications.get("linear-tracker-adapter")).toBe(
      "optional-adapter",
    );
  });

  it("characterizes every active deliver-work routing branch", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const routing = documents.overlayMap.classifications.find(
      (entry) => entry.id === "routing-and-repository-discovery",
    );

    expect(routing?.assertionIds).toEqual(
      expect.arrayContaining([
        "route-tracked-implementation-to-execute",
        "route-approved-ticket-creation-to-track",
        "route-fuzzy-requirements-to-brainstorm",
        "route-approved-planning-to-plan-workflow",
        "route-unknown-root-cause-to-debugging",
        "route-review-only-to-code-review",
        "route-explicit-skill-as-requested",
        "route-default-implementation-through-deliver-work",
      ]),
    );
  });

  it("classifies the audited direct dependency closure", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const memberPaths = new Set(
      documents.overlayMap.boundedClosure.members.map((member) => member.path),
    );

    expect([...memberPaths]).toEqual(
      expect.arrayContaining([
        ".agents/skills/ce-brainstorm",
        ".agents/skills/ce-debug",
        ".agents/skills/ce-doc-review",
        ".agents/skills/ce-proof",
        ".agents/skills/ce-commit",
        ".agents/skills/ce-commit-push-pr",
        ".agents/skills/ce-compound-refresh",
        ".agents/skills/ce-landed-change-report",
        ".agents/skills/ce-frontend-design",
        ".agents/skills/ce-demo-reel",
        ".agents/skills/ce-setup",
      ]),
    );
    expect(new Set(documents.overlayMap.boundedClosure.auditedMemberIds)).toEqual(
      new Set(
        documents.overlayMap.boundedClosure.members.map((member) => member.id),
      ),
    );
  });

  it("rejects a bounded member omitted from the direct-dependency audit", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            auditedMemberIds:
              documents.overlayMap.boundedClosure.auditedMemberIds.slice(1),
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "bounded-member-dependency-audit-missing",
    );
  });

  it("models approved delivery decisions separately from current repository policy", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const assertions = new Map(
      documents.baseline.assertions.map((assertion) => [assertion.id, assertion]),
    );

    for (const assertionId of [
      "configured-harness-blockers-cannot-degrade-away",
      "operator-and-provider-proof-lanes-stay-separated",
    ]) {
      expect(assertions.get(assertionId)).toMatchObject({
        authority: "explicitly-approved",
        adjudication: "approved",
      });
    }
  });

  it("rejects empty or invalid characterization scenarios", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const [firstScenario, ...remainingScenarios] = documents.scenarios;
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        scenarios: [
          {
            ...firstScenario,
            requestKind: "",
            expectedAssertionIds: [],
            expectedClassificationIds: [],
          },
          ...remainingScenarios,
        ],
      },
    });

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "scenario-request-kind-invalid",
        "scenario-assertions-empty",
        "scenario-classifications-empty",
      ]),
    );
  });

  it("rejects assertions that are unrelated to a scenario's expected classifications", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const [firstScenario, ...remainingScenarios] = documents.scenarios;
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        scenarios: [
          {
            ...firstScenario,
            expectedClassificationIds: ["linear-tracker-adapter"],
          },
          ...remainingScenarios,
        ],
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "scenario-assertion-classification-mismatch",
    );
  });
});
