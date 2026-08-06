import { describe, expect, it, vi } from "vitest";

import {
  buildDocsWorkspaceVisit,
  getOrCreateDocsVisitorSession,
} from "./docsWorkspaceTracking";

describe("docs workspace context tracking", () => {
  it("reuses one anonymous visitor session per browser tab", () => {
    const storage = new Map<string, string>();
    const sessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("session-1")
      .mockReturnValueOnce("session-2");

    expect(getOrCreateDocsVisitorSession(sessionStorage, randomUUID)).toBe(
      "session-1",
    );
    expect(getOrCreateDocsVisitorSession(sessionStorage, randomUUID)).toBe(
      "session-1",
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("builds a minimized, retry-stable workspace visit", () => {
    expect(
      buildDocsWorkspaceVisit({
        occurredAt: 1_700_000_000_000,
        sessionId: "session-1",
        visitorKind: "anonymous",
        viewportBucket: "lg",
      }),
    ).toEqual({
      eventId: "athena_webapp.workspace_viewed",
      idempotencyKey: "docs-workspace:session-1:anonymous",
      occurredAt: 1_700_000_000_000,
      payload: { route: "/docs", workspace: "docs" },
      schemaVersion: 1,
      sessionId: "session-1",
      viewportBucket: "lg",
    });
  });
});
