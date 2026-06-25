import type {
  ContextPayload,
  ContextEnvironment,
  ContextRetentionClass,
  ContextSourceRef,
  ContextSubjectRef,
  ContextVisibilityMode,
} from "./contextTypes";

export type ContextEventDefinition<
  EventId extends string = string,
  Payload extends ContextPayload = ContextPayload,
> = {
  eventId: EventId;
  schemaVersion: number;
  description?: string;
  visibilityMode: ContextVisibilityMode;
  retentionClass: ContextRetentionClass;
  primarySubjectType?: string;
  requiredPayloadKeys?: readonly (keyof Payload & string)[];
};

export type ContextEventInput<
  EventId extends string = string,
  Payload extends ContextPayload = ContextPayload,
> = {
  eventId: EventId;
  payload?: Payload;
  occurredAt?: number;
  origin?: string;
  idempotencyKey?: string;
  primarySubject?: ContextSubjectRef;
  subjectRefs?: ContextSubjectRef[];
  sourceRefs?: ContextSourceRef[];
  environment?: Pick<ContextEnvironment, "viewportBucket">;
  synthetic?: boolean;
};

export type ContextEventValidationResult =
  | { ok: true }
  | { ok: false; reason: string };
