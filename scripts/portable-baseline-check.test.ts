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
    ]);
    expect(result.summary).toContain("6 characterization scenarios");
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
});
