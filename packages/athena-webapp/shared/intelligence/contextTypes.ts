export const CONTEXT_VISIBILITY_MODES = [
  "store_admin",
  "store_staff",
  "support",
] as const;

export const CONTEXT_RETENTION_CLASSES = [
  "short_lived",
  "standard",
  "diagnostic",
] as const;

export const CONTEXT_FRESHNESS_STATES = [
  "current",
  "stale",
  "partial",
  "failed",
] as const;

export type ContextVisibilityMode = (typeof CONTEXT_VISIBILITY_MODES)[number];
export type ContextRetentionClass = (typeof CONTEXT_RETENTION_CLASSES)[number];
export type ContextFreshnessState = (typeof CONTEXT_FRESHNESS_STATES)[number];

export type ContextPrimitiveValue =
  | string
  | number
  | boolean
  | null
  | ContextPrimitiveValue[]
  | { [key: string]: ContextPrimitiveValue };

export type ContextPayload = Record<string, ContextPrimitiveValue>;

export type ContextActorRef = {
  kind: "athenaUser" | "staffProfile" | "storefrontUser" | "guest" | "system";
  id?: string;
  label?: string;
};

export type ContextSessionRef = {
  kind: "browser_session" | "storefront_session" | "athena_webapp_session";
  id: string;
};

export type ContextSubjectRef = {
  type: string;
  id: string;
  label?: string;
};

export type ContextSourceRef = {
  table: string;
  id: string;
  label?: string;
  surface?: string;
  eventId?: string;
  schemaVersion?: number;
  redaction?: string;
  omitted?: boolean;
  synthetic?: boolean;
};

export type ContextTrackingEnvelope = {
  surface: string;
  eventId: string;
  schemaVersion: number;
  idempotencyKey: string;
  occurredAt: number;
  payload: ContextPayload;
  origin?: string;
  actorRef?: ContextActorRef;
  sessionRef?: ContextSessionRef;
  primarySubject?: ContextSubjectRef;
  subjectRefs?: ContextSubjectRef[];
  sourceRefs?: ContextSourceRef[];
  visibilityMode: ContextVisibilityMode;
  retentionClass: ContextRetentionClass;
  synthetic?: boolean;
};
