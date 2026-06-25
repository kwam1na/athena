import type {
  ContextActorRef,
  ContextEnvironment,
  ContextPayload,
  ContextPrimitiveValue,
  ContextSessionRef,
  ContextTrackingEnvelope,
} from "./contextTypes";
import type { ContextEventInput } from "./contextEventTypes";
import {
  findContextEventDefinition,
  type SurfaceContextDefinition,
  validateContextEventPayload,
} from "./surfaceDefinition";

type BuildContextEventOptions = {
  actorRef?: ContextActorRef;
  environment?: ContextEnvironment;
  sessionRef?: ContextSessionRef;
  now?: () => number;
};

export function buildContextEventEnvelope(
  surface: SurfaceContextDefinition,
  input: ContextEventInput,
  options: BuildContextEventOptions = {},
): ContextTrackingEnvelope {
  const definition = findContextEventDefinition(surface, input.eventId);
  if (!definition) {
    throw new Error(`Unknown context event: ${surface.surface}.${input.eventId}`);
  }

  const payload = compactContextPayload(input.payload ?? {});
  const validation = validateContextEventPayload(definition, payload);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const occurredAt = input.occurredAt ?? options.now?.() ?? Date.now();
  const primarySubject =
    input.primarySubject ??
    (definition.primarySubjectType
      ? input.subjectRefs?.find(
          (subject) => subject.type === definition.primarySubjectType,
        )
      : undefined);

  return {
    surface: surface.surface,
    eventId: definition.eventId,
    schemaVersion: definition.schemaVersion,
    idempotencyKey:
      input.idempotencyKey ??
      buildContextEventIdempotencyKey({
        surface: surface.surface,
        eventId: definition.eventId,
        occurredAt,
        payload,
        primarySubjectId: primarySubject?.id,
      }),
    occurredAt,
    payload,
    origin: input.origin,
    actorRef: options.actorRef,
    sessionRef: options.sessionRef,
    primarySubject,
    subjectRefs: input.subjectRefs,
    sourceRefs: input.sourceRefs,
    visibilityMode: definition.visibilityMode,
    retentionClass: definition.retentionClass,
    environment: input.environment ?? options.environment,
    synthetic: input.synthetic,
  };
}

export function compactContextPayload(payload: ContextPayload): ContextPayload {
  const compacted: ContextPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    const compactedValue = compactContextValue(value);
    if (compactedValue !== undefined) {
      compacted[key] = compactedValue;
    }
  }

  return compacted;
}

export function stableContextStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableContextStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableContextStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function buildContextEventIdempotencyKey(input: {
  surface: string;
  eventId: string;
  occurredAt: number;
  payload: ContextPayload;
  primarySubjectId?: string;
}) {
  return [
    input.surface,
    input.eventId,
    input.primarySubjectId ?? "none",
    input.occurredAt,
    hashStableValue(input.payload),
  ].join(":");
}

export function hashStableValue(value: unknown) {
  const json = stableContextStringify(value);
  let hash = 2166136261;

  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function compactContextValue(
  value: ContextPrimitiveValue | undefined,
): ContextPrimitiveValue | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => compactContextValue(entry))
      .filter((entry): entry is ContextPrimitiveValue => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const compacted = compactContextPayload(value as ContextPayload);
    return Object.keys(compacted).length > 0 ? compacted : undefined;
  }

  return value;
}
