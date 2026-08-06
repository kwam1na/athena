import { describe, expect, it } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  buildDocsWorkspaceAppendArgs,
  recordDocsWorkspaceVisit,
  validateDocsWorkspaceVisit,
} from "./athenaWebappEvents";

const visit = {
  eventId: "athena_webapp.workspace_viewed" as const,
  idempotencyKey: "docs-workspace:session-1:anonymous",
  occurredAt: 1_700_000_000_000,
  payload: { route: "/docs", workspace: "docs" },
  schemaVersion: 1 as const,
  sessionId: "session-1",
  viewportBucket: "lg" as const,
};

describe("Athena webapp context events", () => {
  it("accepts only bounded session identities and matching dedupe keys", () => {
    expect(
      validateDocsWorkspaceVisit(visit, visit.occurredAt + 1_000),
    ).toBeNull();
    expect(
      validateDocsWorkspaceVisit(
        { ...visit, idempotencyKey: "docs-workspace:someone-else:anonymous" },
        visit.occurredAt,
      ),
    ).toBe("Invalid docs workspace visit.");
    expect(
      validateDocsWorkspaceVisit(
        { ...visit, sessionId: "x".repeat(65) },
        visit.occurredAt,
      ),
    ).toBe("Invalid docs workspace visit.");
  });

  it("keeps workspace visit outcomes inside the public return contract", () => {
    assertConformsToExportedReturns(recordDocsWorkspaceVisit, {
      kind: "recorded",
      status: "recorded",
    });
    assertConformsToExportedReturns(recordDocsWorkspaceVisit, {
      kind: "duplicate",
      status: "recorded",
    });
    assertConformsToExportedReturns(recordDocsWorkspaceVisit, {
      kind: "rejected",
      message: "Context event write quota exceeded.",
    });
  });

  it("derives an authenticated visitor actor on the server", () => {
    expect(
      buildDocsWorkspaceAppendArgs(visit, {
        athenaUserId: "athena-user-1",
      }),
    ).toMatchObject({
      actorRef: { kind: "athenaUser", id: "athena-user-1" },
      sessionRef: { kind: "athena_webapp_session", id: "session-1" },
      storeId: undefined,
      surface: "athena_webapp",
    });
  });

  it("uses the server-approved browser session for anonymous visitors", () => {
    expect(buildDocsWorkspaceAppendArgs(visit, {})).toMatchObject({
      actorRef: { kind: "guest", id: "session-1" },
      abusePartitionKey: "docs-workspace:session-1",
    });
  });
});
