import { useEffect } from "react";
import { useMutation } from "convex/react";

import { api } from "~/convex/_generated/api";
import {
  buildDocsWorkspaceVisit,
  getDocsViewportBucket,
  getOrCreateDocsVisitorSession,
} from "./docsWorkspaceTracking";

export function useDocsWorkspaceTracking(input: {
  isAuthenticated: boolean;
  isAuthLoading: boolean;
}) {
  const recordVisit = useMutation(
    api.contextTracking.athenaWebappEvents.recordDocsWorkspaceVisit,
  );

  useEffect(() => {
    if (input.isAuthLoading) return;

    const sessionId = getOrCreateDocsVisitorSession(window.sessionStorage, () =>
      crypto.randomUUID(),
    );
    void recordVisit(
      buildDocsWorkspaceVisit({
        occurredAt: Date.now(),
        sessionId,
        visitorKind: input.isAuthenticated ? "authenticated" : "anonymous",
        viewportBucket: getDocsViewportBucket(window.innerWidth),
      }),
    ).catch(() => undefined);
  }, [input.isAuthenticated, input.isAuthLoading, recordVisit]);
}
