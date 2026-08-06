const DOCS_VISITOR_SESSION_KEY = "athena-docs-visitor-session-v1";

type SessionStorage = Pick<Storage, "getItem" | "setItem">;
type ViewportBucket = "sm" | "md" | "lg" | "xl" | "unknown";

export function getOrCreateDocsVisitorSession(
  storage: SessionStorage,
  randomUUID: () => string,
): string {
  const existing = storage.getItem(DOCS_VISITOR_SESSION_KEY);
  if (existing) return existing;

  const sessionId = randomUUID();
  storage.setItem(DOCS_VISITOR_SESSION_KEY, sessionId);
  return sessionId;
}

export function getDocsViewportBucket(width: number): ViewportBucket {
  if (!Number.isFinite(width) || width <= 0) return "unknown";
  if (width < 640) return "sm";
  if (width < 1024) return "md";
  if (width < 1280) return "lg";
  return "xl";
}

export function buildDocsWorkspaceVisit(input: {
  occurredAt: number;
  sessionId: string;
  visitorKind: "anonymous" | "authenticated";
  viewportBucket: ViewportBucket;
}) {
  return {
    eventId: "athena_webapp.workspace_viewed" as const,
    idempotencyKey: `docs-workspace:${input.sessionId}:${input.visitorKind}`,
    occurredAt: input.occurredAt,
    payload: { route: "/docs", workspace: "docs" } as const,
    schemaVersion: 1 as const,
    sessionId: input.sessionId,
    viewportBucket: input.viewportBucket,
  };
}
