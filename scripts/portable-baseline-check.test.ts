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
    expect(result.summary).toContain("24 bounded-closure members");
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

    for (const toMemberId of [
      "ce-debug-source-bundle",
      "ce-code-review-source-bundle",
    ]) {
      expect(
        documents.overlayMap.boundedClosure.directDependencies.find(
          (dependency) =>
            dependency.fromMemberId === "deliver-work-body" &&
            dependency.toMemberId === toMemberId,
        ),
      ).toMatchObject({ requirement: "routing", parity: "blocking" });
    }
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
        ".agents/skills/ce-worktree",
        ".agents/skills/ce-session-inventory",
        ".agents/skills/ce-session-extract",
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

  it("derives required dependency edges from selected source contents", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            directDependencies:
              documents.overlayMap.boundedClosure.directDependencies.filter(
                (dependency) =>
                  dependency.fromMemberId !== "deliver-work-body" ||
                  dependency.toMemberId !== "compound-delivery-kernel",
              ),
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "source-dependency-edge-missing",
    );
  });

  it.each([
    ["generic debugging route", "ce-debug-source-bundle"],
    ["generic review route", "ce-code-review-source-bundle"],
  ])(
    "derives the deliver-work %s edge from its source phrase",
    async (_route, omittedTargetMemberId) => {
      const documents = await loadPortableBaselineDocuments(REPO_ROOT);
      const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
        documents: {
          ...documents,
          overlayMap: {
            ...documents.overlayMap,
            boundedClosure: {
              ...documents.overlayMap.boundedClosure,
              directDependencies:
                documents.overlayMap.boundedClosure.directDependencies.filter(
                  (dependency) =>
                    dependency.fromMemberId !== "deliver-work-body" ||
                    dependency.toMemberId !== omittedTargetMemberId,
                ),
            },
          },
        },
      });

      expect(result.findings.map((finding) => finding.code)).toContain(
        "source-dependency-edge-missing",
      );
    },
  );

  it("rejects swapped generic router selectors", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const genericRouterEdges =
      documents.overlayMap.boundedClosure.directDependencies.filter(
        (dependency) =>
          dependency.fromMemberId === "deliver-work-body" &&
          [
            "ce-debug-source-bundle",
            "ce-code-review-source-bundle",
          ].includes(dependency.toMemberId),
      );
    const selectorByTarget = new Map(
      genericRouterEdges.map((dependency) => [
        dependency.toMemberId,
        dependency.selector,
      ]),
    );
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            directDependencies:
              documents.overlayMap.boundedClosure.directDependencies.map(
                (dependency) => {
                  if (
                    dependency.fromMemberId !== "deliver-work-body"
                  ) {
                    return dependency;
                  }
                  if (dependency.toMemberId === "ce-debug-source-bundle") {
                    return {
                      ...dependency,
                      selector: selectorByTarget.get(
                        "ce-code-review-source-bundle",
                      )!,
                    };
                  }
                  if (
                    dependency.toMemberId === "ce-code-review-source-bundle"
                  ) {
                    return {
                      ...dependency,
                      selector: selectorByTarget.get(
                        "ce-debug-source-bundle",
                      )!,
                    };
                  }
                  return dependency;
                },
              ),
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "source-routing-binding-mismatch",
    );
  });

  it("rejects swapped generic router targets", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            directDependencies:
              documents.overlayMap.boundedClosure.directDependencies.map(
                (dependency) => {
                  if (
                    dependency.fromMemberId !== "deliver-work-body"
                  ) {
                    return dependency;
                  }
                  if (dependency.toMemberId === "ce-debug-source-bundle") {
                    return {
                      ...dependency,
                      toMemberId: "ce-code-review-source-bundle",
                    };
                  }
                  if (
                    dependency.toMemberId === "ce-code-review-source-bundle"
                  ) {
                    return {
                      ...dependency,
                      toMemberId: "ce-debug-source-bundle",
                    };
                  }
                  return dependency;
                },
              ),
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "source-routing-binding-mismatch",
    );
  });

  it("scans dependencies of selected excluded resources", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const omittedMemberId = "ce-session-inventory-source-bundle";
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            members: documents.overlayMap.boundedClosure.members.filter(
              (member) => member.id !== omittedMemberId,
            ),
            auditedMemberIds:
              documents.overlayMap.boundedClosure.auditedMemberIds.filter(
                (memberId) => memberId !== omittedMemberId,
              ),
            directDependencies:
              documents.overlayMap.boundedClosure.directDependencies.filter(
                (dependency) =>
                  dependency.fromMemberId !== omittedMemberId &&
                  dependency.toMemberId !== omittedMemberId,
              ),
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "source-dependency-member-missing",
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
