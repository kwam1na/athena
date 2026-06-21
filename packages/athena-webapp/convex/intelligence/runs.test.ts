import { describe, expect, it } from "vitest";

import { shouldSupersedeArtifact } from "./runs";

describe("intelligence artifact superseding", () => {
  it("only supersedes the same subject stream for subject-scoped artifacts", () => {
    const next = {
      kind: "user_insights",
      subjectTable: "storeFrontActor",
      subjectId: "customer-1",
    } as const;

    expect(
      shouldSupersedeArtifact(
        {
          kind: "user_insights",
          subjectTable: "storeFrontActor",
          subjectId: "customer-1",
        },
        next,
      ),
    ).toBe(true);

    expect(
      shouldSupersedeArtifact(
        {
          kind: "user_insights",
          subjectTable: "storeFrontActor",
          subjectId: "customer-2",
        },
        next,
      ),
    ).toBe(false);
  });

  it("allows broad superseding only for artifacts without a subject", () => {
    expect(
      shouldSupersedeArtifact(
        {
          kind: "store_insights",
          subjectTable: "store",
          subjectId: "store-1",
        },
        {
          kind: "store_insights",
          subjectTable: undefined,
          subjectId: undefined,
        },
      ),
    ).toBe(true);
  });
});
