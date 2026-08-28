import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  auditPortableWorkflowBaseline,
  collectTreeEntries,
  digestTreeEntries,
  loadPortableBaselineDocuments,
} from "./portable-baseline-check";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CASE_ALIAS_MEMBER_PATH = ".agents/skills/deliver-work/agents/OPENAI.yaml";
const CASE_ALIAS_MEMBER_CANONICAL_PATH =
  ".agents/skills/deliver-work/agents/openai.yaml";

async function canResolveCaseInsensitiveMemberAlias() {
  try {
    return (
      (await realpath(path.join(REPO_ROOT, CASE_ALIAS_MEMBER_PATH))) ===
      (await realpath(path.join(REPO_ROOT, CASE_ALIAS_MEMBER_CANONICAL_PATH)))
    );
  } catch {
    return false;
  }
}

const CASE_INSENSITIVE_MEMBER_ALIAS_SUPPORTED =
  await canResolveCaseInsensitiveMemberAlias();

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

  it("requires explicit approval provenance for an observed-only parity blocker", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const firstAssertion = documents.baseline.assertions[0];
    const repositorySource = documents.baseline.sources.find(
      (source) => source.kind === "repository-policy",
    )!;
    const repositoryText = await readFile(
      path.join(REPO_ROOT, repositorySource.path),
      "utf8",
    );
    const selector = repositoryText
      .split("\n")
      .find((line) => line.length > 20)!;
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
              adjudication: "approved",
              citations: [{ sourceId: repositorySource.id, selector }],
            },
            ...documents.baseline.assertions.slice(1),
          ],
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "observed-only-approval-citation-invalid",
    );
  });

  it("rejects counterfeited approval provenance from a relabeled repository source", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const firstAssertion = documents.baseline.assertions[0];
    const rootGuide = documents.baseline.sources.find(
      (source) => source.id === "root-agent-guide",
    )!;
    const rootGuideText = await readFile(
      path.join(REPO_ROOT, rootGuide.path),
      "utf8",
    );
    const selector = rootGuideText
      .split("\n")
      .find((line) => line.trim().length > 20)!;
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        baseline: {
          ...documents.baseline,
          sources: documents.baseline.sources.map((source) =>
            source.id === rootGuide.id
              ? { ...source, kind: "approved-plan" as const }
              : source,
          ),
          assertions: [
            {
              ...firstAssertion,
              authority: "observed-only",
              parity: "blocking",
              adjudication: "approved",
              citations: [{ sourceId: rootGuide.id, selector }],
            },
            ...documents.baseline.assertions.slice(1),
          ],
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "observed-only-approval-citation-invalid",
    );
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

  it("rejects a phantom bounded member even when its empty count and digest agree", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const templateMember = documents.overlayMap.boundedClosure.members[0];
    const phantomMember = {
      ...templateMember,
      id: "phantom-source-bundle",
      path: ".agents/skills/nonexistent-portable-baseline-member",
      fileCount: 0,
      treeDigest:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    };
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            members: [
              ...documents.overlayMap.boundedClosure.members,
              phantomMember,
            ],
            auditedMemberIds: [
              ...documents.overlayMap.boundedClosure.auditedMemberIds,
              phantomMember.id,
            ],
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "bounded-member-missing",
    );
  });

  it.each([
    ".agents/skills/compound-delivery-kernel/./",
    ".agents//skills/compound-delivery-kernel",
    ".agents/skills/compound-delivery-kernel/",
    ".agents\\skills\\compound-delivery-kernel",
  ])("rejects noncanonical bounded member path %s", async (aliasedPath) => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            members: documents.overlayMap.boundedClosure.members.map(
              (member) =>
                member.id === "compound-delivery-kernel"
                  ? { ...member, path: aliasedPath }
                  : member,
            ),
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "bounded-member-path-noncanonical",
    );
  });

  it.skipIf(!CASE_INSENSITIVE_MEMBER_ALIAS_SUPPORTED)(
    "rejects a case-only alias of an existing bounded member filesystem identity",
    async () => {
      const documents = await loadPortableBaselineDocuments(REPO_ROOT);
      const canonicalMember = documents.overlayMap.boundedClosure.members.find(
        (member) => member.id === "deliver-work-codex-metadata",
      )!;
      const aliasEntries = await collectTreeEntries(
        REPO_ROOT,
        CASE_ALIAS_MEMBER_PATH,
      );
      const aliasMember = {
        ...canonicalMember,
        id: "deliver-work-codex-metadata-case-alias",
        path: CASE_ALIAS_MEMBER_PATH,
        fileCount: aliasEntries.length,
        treeDigest: digestTreeEntries(aliasEntries),
      };
      const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
        documents: {
          ...documents,
          overlayMap: {
            ...documents.overlayMap,
            boundedClosure: {
              ...documents.overlayMap.boundedClosure,
              members: [
                ...documents.overlayMap.boundedClosure.members,
                aliasMember,
              ],
              auditedMemberIds: [
                ...documents.overlayMap.boundedClosure.auditedMemberIds,
                aliasMember.id,
              ],
            },
          },
        },
      });

      expect(result.findings.map((finding) => finding.code)).toEqual(
        expect.arrayContaining([
          "bounded-member-duplicate",
          "bounded-member-path-filesystem-noncanonical",
        ]),
      );
    },
  );

  it.skipIf(!CASE_INSENSITIVE_MEMBER_ALIAS_SUPPORTED)(
    "uses filesystem identity for case-aliased member overlap and residual filtering",
    async () => {
      const documents = await loadPortableBaselineDocuments(REPO_ROOT);
      const canonicalMember = documents.overlayMap.boundedClosure.members.find(
        (member) => member.id === "deliver-work-codex-metadata",
      )!;
      const aliasEntries = await collectTreeEntries(
        REPO_ROOT,
        CASE_ALIAS_MEMBER_PATH,
      );
      const aliasMember = {
        ...canonicalMember,
        path: CASE_ALIAS_MEMBER_PATH,
        fileCount: aliasEntries.length,
        treeDigest: digestTreeEntries(aliasEntries),
      };
      const replacementResult = await auditPortableWorkflowBaseline(REPO_ROOT, {
        documents: {
          ...documents,
          overlayMap: {
            ...documents.overlayMap,
            boundedClosure: {
              ...documents.overlayMap.boundedClosure,
              members: documents.overlayMap.boundedClosure.members.map(
                (member) =>
                  member.id === canonicalMember.id ? aliasMember : member,
              ),
            },
          },
        },
      });

      expect(
        replacementResult.findings.map((finding) => finding.code),
      ).toContain("bounded-member-path-filesystem-noncanonical");
      expect(
        replacementResult.findings.map((finding) => finding.code),
      ).not.toEqual(
        expect.arrayContaining([
          "inventory-count-drift",
          "inventory-digest-drift",
        ]),
      );

      const overlapPath = ".AGENTS/skills/deliver-work";
      const overlapEntries = await collectTreeEntries(REPO_ROOT, overlapPath);
      const overlapMember = {
        ...canonicalMember,
        id: "deliver-work-case-alias-overlap",
        kind: "skill-bundle" as const,
        path: overlapPath,
        fileCount: overlapEntries.length,
        treeDigest: digestTreeEntries(overlapEntries),
      };
      const overlapResult = await auditPortableWorkflowBaseline(REPO_ROOT, {
        documents: {
          ...documents,
          overlayMap: {
            ...documents.overlayMap,
            boundedClosure: {
              ...documents.overlayMap.boundedClosure,
              members: [
                ...documents.overlayMap.boundedClosure.members,
                overlapMember,
              ],
              auditedMemberIds: [
                ...documents.overlayMap.boundedClosure.auditedMemberIds,
                overlapMember.id,
              ],
            },
          },
        },
      });

      expect(overlapResult.findings.map((finding) => finding.code)).toEqual(
        expect.arrayContaining([
          "bounded-member-overlap",
          "bounded-member-path-filesystem-noncanonical",
        ]),
      );
    },
  );

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
    expect(
      new Set(documents.overlayMap.boundedClosure.auditedMemberIds),
    ).toEqual(
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
          ["ce-debug-source-bundle", "ce-code-review-source-bundle"].includes(
            dependency.toMemberId,
          ),
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
                  if (dependency.fromMemberId !== "deliver-work-body") {
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
                      selector: selectorByTarget.get("ce-debug-source-bundle")!,
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
                  if (dependency.fromMemberId !== "deliver-work-body") {
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

  it("binds explicit execute and track selectors to their resolved targets", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const selectorByTarget = new Map(
      documents.overlayMap.boundedClosure.directDependencies
        .filter(
          (dependency) =>
            dependency.fromMemberId === "deliver-work-body" &&
            [
              "athena-execute-source-bundle",
              "linear-track-source-bundle",
            ].includes(dependency.toMemberId),
        )
        .map((dependency) => [dependency.toMemberId, dependency.selector]),
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
                  if (dependency.fromMemberId !== "deliver-work-body") {
                    return dependency;
                  }
                  if (
                    dependency.toMemberId === "athena-execute-source-bundle"
                  ) {
                    return {
                      ...dependency,
                      selector: selectorByTarget.get(
                        "linear-track-source-bundle",
                      )!,
                    };
                  }
                  if (dependency.toMemberId === "linear-track-source-bundle") {
                    return {
                      ...dependency,
                      selector: selectorByTarget.get(
                        "athena-execute-source-bundle",
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
      "direct-dependency-reference-target-mismatch",
    );
  });

  it("binds reference-free session selectors to their intended targets", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const swappedTargets = new Map([
      [
        "ce-session-extract-source-bundle",
        "ce-session-inventory-source-bundle",
      ],
      [
        "ce-session-inventory-source-bundle",
        "ce-session-extract-source-bundle",
      ],
    ]);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            directDependencies:
              documents.overlayMap.boundedClosure.directDependencies.map(
                (dependency) =>
                  dependency.fromMemberId === "compound-reviewer-prompts" &&
                  swappedTargets.has(dependency.toMemberId)
                    ? {
                        ...dependency,
                        toMemberId: swappedTargets.get(dependency.toMemberId)!,
                      }
                    : dependency,
              ),
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "reference-free-dependency-binding-mismatch",
    );
  });

  it("binds the reference-free brainstorm debug tuple through requirement and parity", async () => {
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
                (dependency) =>
                  dependency.fromMemberId === "ce-brainstorm-source-bundle" &&
                  dependency.toMemberId === "ce-debug-source-bundle"
                    ? { ...dependency, requirement: "contextual" as const }
                    : dependency,
              ),
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "reference-free-dependency-binding-mismatch",
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
      documents.baseline.assertions.map((assertion) => [
        assertion.id,
        assertion,
      ]),
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

    expect(result.findings.map((finding) => finding.code)).toContain(
      "scenario-document-shape-invalid",
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

  it("fails closed on a malformed baseline document shape", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        baseline: {
          ...documents.baseline,
          sources: null,
        },
      } as never,
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "baseline-document-shape-invalid",
    );
  });

  it("fails closed when documents are explicitly null", async () => {
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: null,
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "baseline-document-shape-invalid",
    );
  });

  it("requires the authoritative discovery roots even when inventory is self-consistent", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        baseline: { ...documents.baseline, discoveryRoots: [] },
        overlayMap: {
          ...documents.overlayMap,
          outOfScopeInventory: {
            ...documents.overlayMap.outOfScopeInventory,
            scanRoots: [],
            fileCount: 0,
            treeDigest:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        },
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "discovery-root-required-missing",
    );
  });

  it("fails closed on overlay enums, counts, and digests", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const [firstMember, ...remainingMembers] =
      documents.overlayMap.boundedClosure.members;
    const [firstDependency, ...remainingDependencies] =
      documents.overlayMap.boundedClosure.directDependencies;
    const [firstDisposition, ...remainingDispositions] =
      documents.overlayMap.boundedClosure.referenceDispositions;
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        overlayMap: {
          ...documents.overlayMap,
          boundedClosure: {
            ...documents.overlayMap.boundedClosure,
            members: [
              {
                ...firstMember,
                kind: "unknown-member-kind",
                classification: "unknown-classification",
                fileCount: -1,
                treeDigest: "NOT-A-DIGEST",
              },
              ...remainingMembers,
            ],
            directDependencies: [
              {
                ...firstDependency,
                requirement: "unknown-requirement",
                parity: "unknown-parity",
              },
              ...remainingDependencies,
            ],
            referenceDispositions: [
              {
                ...firstDisposition,
                resolution: "unknown-resolution",
                parity: "blocking",
              },
              ...remainingDispositions,
            ],
          },
        },
      } as never,
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "overlay-document-shape-invalid",
    );
  });

  it("fails closed on a malformed scenario document shape", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const [firstScenario, ...remainingScenarios] = documents.scenarios;
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        scenarios: [
          {
            ...firstScenario,
            requestKind: "unknown-request-kind",
            expectedAssertionIds: [42],
          },
          ...remainingScenarios,
        ],
      } as never,
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "scenario-document-shape-invalid",
    );
  });

  it("binds each required scenario to its request kind", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        scenarios: documents.scenarios.map((scenario) =>
          scenario.id === "planning"
            ? { ...scenario, requestKind: "review" }
            : scenario,
        ),
      },
    });

    expect(result.findings.map((finding) => finding.code)).toContain(
      "scenario-contract-request-kind-mismatch",
    );
  });

  it("rejects non-empty scenarios that shrink required coverage", async () => {
    const documents = await loadPortableBaselineDocuments(REPO_ROOT);
    const result = await auditPortableWorkflowBaseline(REPO_ROOT, {
      documents: {
        ...documents,
        scenarios: documents.scenarios.map((scenario) =>
          scenario.id === "bounded-implementation"
            ? {
                ...scenario,
                expectedAssertionIds: scenario.expectedAssertionIds.filter(
                  (id) => id !== "athena-pr-contract-remains-mandatory",
                ),
                expectedClassificationIds:
                  scenario.expectedClassificationIds.filter(
                    (id) => id !== "athena-pr-policy",
                  ),
              }
            : scenario,
        ),
      },
    });

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "scenario-contract-assertion-missing",
        "scenario-contract-classification-missing",
      ]),
    );
  });

  it("rejects a tree path that escapes through a parent symlink", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "portable-baseline-containment-"),
    );
    try {
      const repoRoot = path.join(temporaryRoot, "repo");
      const externalRoot = path.join(temporaryRoot, "external");
      await mkdir(repoRoot);
      await mkdir(externalRoot);
      await writeFile(path.join(externalRoot, "secret.txt"), "outside\n");
      await symlink(externalRoot, path.join(repoRoot, "escape"));

      await expect(
        collectTreeEntries(repoRoot, "escape/secret.txt"),
      ).rejects.toMatchObject({ code: "path-containment-escape" });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("hashes an external leaf symlink as metadata without reading its target", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "portable-baseline-leaf-symlink-"),
    );
    try {
      const repoRoot = path.join(temporaryRoot, "repo");
      const externalFile = path.join(temporaryRoot, "external.txt");
      await mkdir(path.join(repoRoot, "inventory"), { recursive: true });
      await writeFile(externalFile, "first target contents\n");
      await symlink(
        externalFile,
        path.join(repoRoot, "inventory", "external-link"),
      );

      const before = await collectTreeEntries(repoRoot, "inventory");
      await writeFile(externalFile, "different target contents\n");
      const after = await collectTreeEntries(repoRoot, "inventory");

      expect(after).toEqual(before);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("binds tree digests to whether an entry is a file or symlink", () => {
    const digest = "0".repeat(64);
    const fileTreeDigest = digestTreeEntries([
      { path: "same-path", digest, kind: "file" },
    ]);
    const symlinkTreeDigest = digestTreeEntries([
      { path: "same-path", digest, kind: "symlink" },
    ]);

    expect(fileTreeDigest).not.toBe(symlinkTreeDigest);
  });
});
