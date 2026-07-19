/**
 * Durable client-side buffer for POS telemetry events.
 *
 * Events are appended locally (localStorage-backed, in-memory fallback) and
 * drained to Convex by usePosClientTelemetryDrain. The buffer must never throw:
 * telemetry is a best-effort rail and can degrade silently, but the buffer is
 * durable across reloads so events captured while offline survive until the
 * terminal reconnects.
 */

export type PosClientEventLevel = "warn" | "error";

export type PosClientEventFlow =
  | "checkout"
  | "session"
  | "register"
  | "sync"
  | "storage"
  | "catalog"
  | "expense"
  | "settings"
  | "runtime"
  | "unhandled"
  | "other";

export type PosClientTelemetryEvent = {
  clientEventId: string;
  level: PosClientEventLevel;
  flow: PosClientEventFlow;
  message: string;
  occurredAt: number;
  localRegisterSessionId?: string;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  appVersion?: string;
  metadata: Record<string, string | number | boolean>;
};

export type PosClientTelemetryEventInput = {
  level: PosClientEventLevel;
  flow?: PosClientEventFlow;
  message: string;
  error?: unknown;
  localRegisterSessionId?: string;
  appVersion?: string;
  metadata?: Record<string, unknown>;
};

const STORAGE_KEY = "athena-pos-client-telemetry-v1";
const MAX_BUFFERED_EVENTS = 200;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_VALUE_LENGTH = 300;

let memoryFallback: PosClientTelemetryEvent[] = [];

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function mintClientEventId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual id
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readBuffer(): PosClientTelemetryEvent[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [...memoryFallback];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...memoryFallback];
    }
    return parsed.filter(isBufferedEvent);
  } catch {
    return [...memoryFallback];
  }
}

function writeBuffer(events: PosClientTelemetryEvent[]): void {
  memoryFallback = [...events];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Storage unavailable or full — the in-memory fallback keeps events for
    // this page lifetime, which is the best we can do.
  }
}

function isBufferedEvent(value: unknown): value is PosClientTelemetryEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const event = value as Partial<PosClientTelemetryEvent>;
  return (
    typeof event.clientEventId === "string" &&
    (event.level === "warn" || event.level === "error") &&
    typeof event.flow === "string" &&
    typeof event.message === "string" &&
    typeof event.occurredAt === "number" &&
    typeof event.metadata === "object" &&
    event.metadata !== null
  );
}

export function normalizePosTelemetryError(error: unknown): {
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
} {
  if (error instanceof Error) {
    return {
      errorName: truncate(error.name, 200),
      errorMessage: truncate(error.message, MAX_MESSAGE_LENGTH),
      errorStack: error.stack
        ? truncate(error.stack, MAX_STACK_LENGTH)
        : undefined,
    };
  }
  if (typeof error === "string" && error.length > 0) {
    return { errorMessage: truncate(error, MAX_MESSAGE_LENGTH) };
  }
  if (error !== undefined && error !== null) {
    try {
      return {
        errorMessage: truncate(JSON.stringify(error), MAX_MESSAGE_LENGTH),
      };
    } catch {
      return { errorMessage: String(error) };
    }
  }
  return {};
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  if (!metadata) {
    return sanitized;
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(sanitized).length >= MAX_METADATA_KEYS) {
      break;
    }
    if (typeof value === "string") {
      sanitized[key] = truncate(value, MAX_METADATA_VALUE_LENGTH);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function enqueuePosClientEvent(
  input: PosClientTelemetryEventInput,
): void {
  try {
    const event: PosClientTelemetryEvent = {
      clientEventId: mintClientEventId(),
      level: input.level,
      flow: input.flow ?? "other",
      message: truncate(input.message, MAX_MESSAGE_LENGTH),
      occurredAt: Date.now(),
      ...(input.localRegisterSessionId
        ? { localRegisterSessionId: input.localRegisterSessionId }
        : {}),
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
      ...normalizePosTelemetryError(input.error),
      metadata: sanitizeMetadata(input.metadata),
    };
    const events = readBuffer();
    events.push(event);
    // Ring buffer: drop the oldest events under pressure. Recent failures are
    // more diagnostic than stale ones.
    writeBuffer(events.slice(-MAX_BUFFERED_EVENTS));
  } catch {
    // Telemetry must never break the register.
  }
}

export function peekPosClientEventBatch(
  maxEvents: number,
): PosClientTelemetryEvent[] {
  return readBuffer().slice(0, Math.max(maxEvents, 0));
}

export function removePosClientEvents(clientEventIds: string[]): void {
  if (clientEventIds.length === 0) {
    return;
  }
  const drained = new Set(clientEventIds);
  writeBuffer(readBuffer().filter((event) => !drained.has(event.clientEventId)));
}

export function posClientTelemetryBufferSize(): number {
  return readBuffer().length;
}

export function clearPosClientTelemetryBuffer(): void {
  writeBuffer([]);
}
