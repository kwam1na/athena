import type { PosDiagnosticRouteId } from "~/shared/posDiagnosticRedaction";

export const POS_TERMINAL_IDENTITY_CHANGE_EVENT =
  "athena:pos-terminal-identity-change";
export const POS_TERMINAL_IDENTITY_REFRESH_REQUEST_EVENT =
  "athena:pos-terminal-identity-refresh-request";
export const POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY =
  "athena-pos-terminal-identity-generation-v1";
export const POS_TERMINAL_IDENTITY_TRANSITION_LEASE_MS = 30_000;
export const POS_TERMINAL_IDENTITY_LOCK_WAIT_MS = 5_000;
export const POS_TERMINAL_IDENTITY_UNCOORDINATED_QUIESCENCE_MS = 30_000;
export const POS_TERMINAL_IDENTITY_WRITE_LOCK_NAME =
  "athena-pos-terminal-identity-write-v1";
const POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS = 1_000;
export type PosTerminalIdentityChangePhase =
  "changing" | "changed" | "uncoordinated";
export type PosTerminalIdentityTransition = {
  generation: string;
  phase: PosTerminalIdentityChangePhase;
  ownerDocumentId: string;
  revision: number;
  startedAt: number;
  updatedAt: number;
  uncoordinatedSettledAt?: number;
};

const documentBootstrapGeneration = mintGeneration("bootstrap");
const initialTransitionTime = Date.now();
let memoryTerminalIdentityTransition: PosTerminalIdentityTransition = {
  generation: mintGeneration("identity"),
  phase: "changed",
  ownerDocumentId: documentBootstrapGeneration,
  revision: 0,
  startedAt: initialTransitionTime,
  updatedAt: initialTransitionTime,
};
let localTransitionIsAuthoritative = false;
let localUncoordinatedReassertRequired = false;
let nextTransitionStorageRetryAt = 0;

export function readPosTerminalIdentityTransition(options?: {
  forceSharedRead?: boolean;
}): PosTerminalIdentityTransition {
  if (localUncoordinatedReassertRequired) {
    if (
      options?.forceSharedRead ||
      Date.now() >= nextTransitionStorageRetryAt
    ) {
      republishLocalUncoordinatedTransition();
    }
    return { ...memoryTerminalIdentityTransition };
  }
  if (
    localTransitionIsAuthoritative &&
    !options?.forceSharedRead &&
    Date.now() < nextTransitionStorageRetryAt
  ) {
    return { ...memoryTerminalIdentityTransition };
  }
  try {
    const stored = decodeTransition(
      window.localStorage.getItem(POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY),
    );
    if (stored) {
      if (localTransitionIsAuthoritative) {
        // A revision that could not be published is private to this document.
        // Once storage recovers, any durable record wins; promoting the private
        // generation could make events captured under it claimable later.
        memoryTerminalIdentityTransition = stored;
        localTransitionIsAuthoritative = false;
        nextTransitionStorageRetryAt = 0;
        return { ...stored };
      }
      const comparison = compareIdentityTransitions(
        stored,
        memoryTerminalIdentityTransition,
      );
      if (comparison >= 0) {
        memoryTerminalIdentityTransition = stored;
        localTransitionIsAuthoritative = false;
        nextTransitionStorageRetryAt = 0;
      } else {
        persistTransition(memoryTerminalIdentityTransition);
      }
      return { ...memoryTerminalIdentityTransition };
    }
    if (localTransitionIsAuthoritative) {
      nextTransitionStorageRetryAt =
        Date.now() + POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS;
      return { ...memoryTerminalIdentityTransition };
    }
    persistTransition(memoryTerminalIdentityTransition);
  } catch {
    localTransitionIsAuthoritative = true;
    nextTransitionStorageRetryAt =
      Date.now() + POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS;
  }
  return { ...memoryTerminalIdentityTransition };
}

export function readPosTerminalIdentityGeneration(): string {
  return readPosTerminalIdentityTransition().generation;
}

export function rotatePosTerminalIdentityGeneration(): string {
  const current = readPosTerminalIdentityTransition({ forceSharedRead: true });
  const now = Math.max(Date.now(), current.updatedAt + 1);
  memoryTerminalIdentityTransition = {
    generation: mintGeneration("identity"),
    phase: "changing",
    ownerDocumentId: documentBootstrapGeneration,
    revision: current.revision + 1,
    startedAt: now,
    updatedAt: now,
  };
  persistTransition(memoryTerminalIdentityTransition);
  return memoryTerminalIdentityTransition.generation;
}

export function isPosTerminalIdentityTransitionStale(
  transition: PosTerminalIdentityTransition,
  now = Date.now(),
): boolean {
  return (
    transition.phase === "changing" &&
    now - transition.updatedAt > POS_TERMINAL_IDENTITY_TRANSITION_LEASE_MS
  );
}

export function beginPosTerminalIdentityTransition():
  PosTerminalIdentityTransition | undefined {
  if (typeof window === "undefined") return undefined;
  let durable: PosTerminalIdentityTransition | undefined;
  try {
    durable = decodeTransition(
      window.localStorage.getItem(POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY),
    );
  } catch {
    return undefined;
  }
  const now = Math.max(Date.now(), (durable?.updatedAt ?? 0) + 1);
  const lease: PosTerminalIdentityTransition = {
    generation: mintGeneration("identity"),
    phase: "changing",
    ownerDocumentId: documentBootstrapGeneration,
    revision: (durable?.revision ?? 0) + 1,
    startedAt: now,
    updatedAt: now,
  };
  if (!persistTransitionExact(lease)) {
    if (durable) {
      memoryTerminalIdentityTransition = durable;
      localTransitionIsAuthoritative = false;
    }
    return undefined;
  }
  dispatchIdentityTransition(lease);
  return { ...lease };
}

export async function withPosTerminalIdentityWriteLock<T>(
  callback: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    return { acquired: false };
  }
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    POS_TERMINAL_IDENTITY_LOCK_WAIT_MS,
  );
  try {
    outcome = await navigator.locks.request(
      POS_TERMINAL_IDENTITY_WRITE_LOCK_NAME,
      { mode: "exclusive", signal: abortController.signal },
      async () => {
        try {
          return { ok: true as const, value: await callback() };
        } catch (error) {
          return { ok: false as const, error };
        }
      },
    );
  } catch {
    return { acquired: false };
  } finally {
    clearTimeout(timeout);
  }
  if (!outcome.ok) throw outcome.error;
  return { acquired: true, value: outcome.value };
}

export function markPosTerminalIdentityUncoordinated(
  state: "in_flight" | "settled" = "in_flight",
): PosTerminalIdentityTransition {
  let durable: PosTerminalIdentityTransition | undefined;
  try {
    durable = decodeTransition(
      window.localStorage.getItem(POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY),
    );
  } catch {
    durable = undefined;
  }
  const currentUncoordinated =
    memoryTerminalIdentityTransition.phase === "uncoordinated"
      ? memoryTerminalIdentityTransition
      : undefined;
  const now = Math.max(
    Date.now(),
    (durable?.updatedAt ?? 0) + 1,
    (currentUncoordinated?.updatedAt ?? 0) + 1,
  );
  const canSettleCurrentLease =
    state === "settled" &&
    currentUncoordinated !== undefined &&
    durable !== undefined &&
    sameIdentityTransition(durable, currentUncoordinated);
  memoryTerminalIdentityTransition = {
    generation: canSettleCurrentLease
      ? currentUncoordinated.generation
      : mintGeneration("identity"),
    phase: "uncoordinated",
    ownerDocumentId: documentBootstrapGeneration,
    revision: canSettleCurrentLease
      ? currentUncoordinated.revision
      : (durable?.revision ?? 0) + 1,
    startedAt: canSettleCurrentLease ? currentUncoordinated.startedAt : now,
    updatedAt: now,
    ...(state === "settled" ? { uncoordinatedSettledAt: now } : {}),
  };
  const uncoordinated = { ...memoryTerminalIdentityTransition };
  const published = persistTransitionExact(uncoordinated);
  memoryTerminalIdentityTransition = uncoordinated;
  localUncoordinatedReassertRequired = state === "in_flight" || !published;
  if (!published) {
    localTransitionIsAuthoritative = true;
    nextTransitionStorageRetryAt =
      Date.now() + POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS;
  }
  dispatchIdentityTransition(uncoordinated);
  return uncoordinated;
}

export function isPosTerminalIdentityUncoordinatedQuiescent(
  transition: PosTerminalIdentityTransition,
  now = Date.now(),
): boolean {
  return (
    transition.phase === "uncoordinated" &&
    typeof transition.uncoordinatedSettledAt === "number" &&
    now - transition.uncoordinatedSettledAt >=
      POS_TERMINAL_IDENTITY_UNCOORDINATED_QUIESCENCE_MS
  );
}

export function stabilizePosTerminalIdentityUncoordinated(
  transition: PosTerminalIdentityTransition,
): PosTerminalIdentityTransition | undefined {
  if (!isPosTerminalIdentityUncoordinatedQuiescent(transition)) {
    return undefined;
  }
  let durable: PosTerminalIdentityTransition | undefined;
  try {
    durable = decodeTransition(
      window.localStorage.getItem(POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY),
    );
  } catch {
    return undefined;
  }
  if (!durable || !sameIdentityTransition(durable, transition)) {
    return undefined;
  }
  const now = Math.max(Date.now(), durable.updatedAt + 1);
  const stabilized: PosTerminalIdentityTransition = {
    generation: mintGeneration("identity"),
    phase: "changed",
    ownerDocumentId: documentBootstrapGeneration,
    revision: durable.revision + 1,
    startedAt: now,
    updatedAt: now,
  };
  return persistTransitionExact(stabilized) ? stabilized : undefined;
}

export function settlePosTerminalIdentityTransition(
  transition = readPosTerminalIdentityTransition({ forceSharedRead: true }),
): PosTerminalIdentityTransition {
  let current: PosTerminalIdentityTransition | undefined;
  try {
    current = decodeTransition(
      window.localStorage.getItem(POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY),
    );
  } catch {
    return { ...memoryTerminalIdentityTransition };
  }
  if (!current || !sameIdentityLease(current, transition)) {
    if (current) memoryTerminalIdentityTransition = current;
    return { ...(current ?? memoryTerminalIdentityTransition) };
  }
  const settled = {
    ...transition,
    phase: "changed" as const,
    updatedAt: Math.max(Date.now(), transition.updatedAt + 1),
  };
  if (!persistTransitionExact(settled)) {
    return readPosTerminalIdentityTransition({ forceSharedRead: true });
  }
  dispatchIdentityTransition(settled);
  return { ...memoryTerminalIdentityTransition };
}

export function getPosTelemetryDocumentBootstrapGeneration(): string {
  return documentBootstrapGeneration;
}

export function signalPosTerminalIdentityChange(
  phase: PosTerminalIdentityChangePhase,
): void {
  if (typeof window === "undefined") return;
  if (phase === "changing") {
    rotatePosTerminalIdentityGeneration();
    dispatchIdentityTransition(memoryTerminalIdentityTransition);
  } else {
    settlePosTerminalIdentityTransition();
  }
}

export type PosTelemetryRoutePair = {
  orgUrlSlug: string;
  storeUrlSlug: string;
};

export type PosTelemetryResolvedContext = PosTelemetryRoutePair & {
  storeId: string;
  telemetryIdentityEpoch?: string;
  occurrenceContextToken?: string;
  terminalIdentityGeneration?: string;
  reportedCloudTerminalId?: string;
  reportedTerminalFingerprint?: string;
};

export type PosTelemetryOccurrenceContext = PosTelemetryRoutePair & {
  routeId: PosDiagnosticRouteId;
  occurrenceContextToken?: string;
  terminalIdentityGeneration?: string;
  storeId?: string;
  telemetryIdentityEpoch?: string;
  reportedCloudTerminalId?: string;
  reportedTerminalFingerprint?: string;
};

let activeOwner:
  | {
      ownerToken: string;
      identityGeneration: string;
      context: PosTelemetryResolvedContext;
    }
  | undefined;

export function registerPosTelemetryContext(
  ownerToken: string,
  context: PosTelemetryResolvedContext,
): () => void {
  activeOwner = {
    ownerToken,
    identityGeneration: readPosTerminalIdentityTransition().generation,
    context: { ...context },
  };
  return () => {
    if (activeOwner?.ownerToken === ownerToken) activeOwner = undefined;
  };
}

export function capturePosTelemetryOccurrenceContext(
  pathname = typeof window === "undefined" ? "" : window.location.pathname,
): PosTelemetryOccurrenceContext | undefined {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  const match = path.match(
    /^\/([A-Za-z0-9._-]+)\/store\/([A-Za-z0-9._-]+)\/pos(?:\/(.*))?$/,
  );
  if (!match) return undefined;
  const routePair = { orgUrlSlug: match[1], storeUrlSlug: match[2] };
  const routeId = routeIdFromSuffix(match[3] ?? "");
  const transition = readPosTerminalIdentityTransition();
  const identityGeneration = transition.generation;
  const matchingOwner =
    activeOwner && sameRoutePair(activeOwner.context, routePair)
      ? activeOwner
      : undefined;
  const resolved =
    transition.phase === "changed" &&
    matchingOwner?.identityGeneration === identityGeneration
      ? matchingOwner.context
      : undefined;
  return {
    ...routePair,
    routeId,
    occurrenceContextToken: resolved
      ? matchingOwner?.ownerToken
      : matchingOwner
        ? identityGeneration
        : documentBootstrapGeneration,
    terminalIdentityGeneration: identityGeneration,
    ...(resolved
      ? {
          storeId: resolved.storeId,
          ...(resolved.telemetryIdentityEpoch
            ? { telemetryIdentityEpoch: resolved.telemetryIdentityEpoch }
            : {}),
          ...(resolved.reportedCloudTerminalId
            ? { reportedCloudTerminalId: resolved.reportedCloudTerminalId }
            : {}),
          ...(resolved.reportedTerminalFingerprint
            ? {
                reportedTerminalFingerprint:
                  resolved.reportedTerminalFingerprint,
              }
            : {}),
        }
      : {}),
  };
}

export function resolvePendingPosTelemetryContext(
  pair: PosTelemetryRoutePair & {
    occurrenceContextToken?: string;
    terminalIdentityGeneration?: string;
  },
): PosTelemetryResolvedContext | undefined {
  const transition = readPosTerminalIdentityTransition();
  const identityGeneration = transition.generation;
  return activeOwner &&
    transition.phase === "changed" &&
    pair.occurrenceContextToken === activeOwner.ownerToken &&
    pair.terminalIdentityGeneration === activeOwner.identityGeneration &&
    activeOwner.identityGeneration === identityGeneration &&
    sameRoutePair(activeOwner.context, pair)
    ? {
        ...activeOwner.context,
        occurrenceContextToken: activeOwner.ownerToken,
        terminalIdentityGeneration: identityGeneration,
      }
    : undefined;
}

function mintGeneration(kind: "identity" | "bootstrap") {
  return `pos-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function validGeneration(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^pos-(?:identity|bootstrap)-[A-Za-z0-9-]{6,100}$/.test(value)
  );
}

function decodeTransition(
  raw: string | null,
): PosTerminalIdentityTransition | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      validGeneration((value as { generation?: unknown }).generation) &&
      ((value as { phase?: unknown }).phase === "changing" ||
        (value as { phase?: unknown }).phase === "changed" ||
        (value as { phase?: unknown }).phase === "uncoordinated")
    ) {
      const candidate = value as Record<string, unknown>;
      if (
        validGeneration(candidate.ownerDocumentId) &&
        isNonNegativeFiniteInteger(candidate.revision) &&
        isNonNegativeFiniteInteger(candidate.startedAt) &&
        isNonNegativeFiniteInteger(candidate.updatedAt)
      ) {
        return {
          generation: candidate.generation as string,
          phase: candidate.phase as PosTerminalIdentityChangePhase,
          ownerDocumentId: candidate.ownerDocumentId,
          revision: candidate.revision,
          startedAt: candidate.startedAt,
          updatedAt: candidate.updatedAt,
          ...(isNonNegativeFiniteInteger(candidate.uncoordinatedSettledAt)
            ? {
                uncoordinatedSettledAt: candidate.uncoordinatedSettledAt,
              }
            : {}),
        };
      }
      return undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function persistTransition(transition: PosTerminalIdentityTransition): void {
  try {
    const serialized = JSON.stringify(transition);
    window.localStorage.setItem(
      POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
      serialized,
    );
    const exactRaw = window.localStorage.getItem(
      POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
    );
    const verified = decodeTransition(exactRaw);
    if (verified && compareIdentityTransitions(verified, transition) >= 0) {
      memoryTerminalIdentityTransition = verified;
      localTransitionIsAuthoritative = false;
      nextTransitionStorageRetryAt = 0;
    } else {
      localTransitionIsAuthoritative = true;
      nextTransitionStorageRetryAt =
        Date.now() + POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS;
    }
  } catch {
    localTransitionIsAuthoritative = true;
    nextTransitionStorageRetryAt =
      Date.now() + POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS;
  }
}

function persistTransitionExact(
  transition: PosTerminalIdentityTransition,
): boolean {
  try {
    window.localStorage.setItem(
      POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
      JSON.stringify(transition),
    );
    const verified = decodeTransition(
      window.localStorage.getItem(POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY),
    );
    if (!verified || !sameIdentityTransition(verified, transition)) {
      localTransitionIsAuthoritative = false;
      return false;
    }
    memoryTerminalIdentityTransition = verified;
    localTransitionIsAuthoritative = false;
    localUncoordinatedReassertRequired = false;
    nextTransitionStorageRetryAt = 0;
    return true;
  } catch {
    localTransitionIsAuthoritative = false;
    return false;
  }
}

function republishLocalUncoordinatedTransition(): void {
  const local = memoryTerminalIdentityTransition;
  if (local.phase !== "uncoordinated") return;
  let durable: PosTerminalIdentityTransition | undefined;
  try {
    durable = decodeTransition(
      window.localStorage.getItem(POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY),
    );
  } catch {
    nextTransitionStorageRetryAt =
      Date.now() + POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS;
    return;
  }
  if (durable && sameIdentityTransition(durable, local)) {
    localUncoordinatedReassertRequired =
      local.uncoordinatedSettledAt === undefined;
    localTransitionIsAuthoritative = false;
    nextTransitionStorageRetryAt =
      Date.now() + POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS;
    return;
  }
  const now = Math.max(Date.now(), (durable?.updatedAt ?? 0) + 1);
  const candidate: PosTerminalIdentityTransition = {
    generation: mintGeneration("identity"),
    phase: "uncoordinated",
    ownerDocumentId: documentBootstrapGeneration,
    revision: (durable?.revision ?? 0) + 1,
    startedAt: local.startedAt,
    updatedAt: now,
    ...(local.uncoordinatedSettledAt !== undefined
      ? { uncoordinatedSettledAt: local.uncoordinatedSettledAt }
      : {}),
  };
  const persisted = persistTransitionExact(candidate);
  memoryTerminalIdentityTransition = candidate;
  localUncoordinatedReassertRequired =
    candidate.uncoordinatedSettledAt === undefined || !persisted;
  nextTransitionStorageRetryAt =
    Date.now() + POS_TERMINAL_IDENTITY_STORAGE_RETRY_MS;
  if (!persisted) localTransitionIsAuthoritative = true;
}

function sameIdentityLease(
  left: PosTerminalIdentityTransition,
  right: PosTerminalIdentityTransition,
): boolean {
  return (
    left.phase === "changing" &&
    left.generation === right.generation &&
    left.revision === right.revision &&
    left.ownerDocumentId === right.ownerDocumentId
  );
}

function sameIdentityTransition(
  left: PosTerminalIdentityTransition,
  right: PosTerminalIdentityTransition,
): boolean {
  return (
    left.generation === right.generation &&
    left.phase === right.phase &&
    left.ownerDocumentId === right.ownerDocumentId &&
    left.revision === right.revision &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt &&
    left.uncoordinatedSettledAt === right.uncoordinatedSettledAt
  );
}

function dispatchIdentityTransition(
  transition: PosTerminalIdentityTransition,
): void {
  window.dispatchEvent(
    new CustomEvent(POS_TERMINAL_IDENTITY_CHANGE_EVENT, {
      detail: { ...transition },
    }),
  );
}

function compareIdentityTransitions(
  left: PosTerminalIdentityTransition,
  right: PosTerminalIdentityTransition,
): number {
  if (left.revision !== right.revision) return left.revision - right.revision;
  if (left.generation === right.generation && left.phase !== right.phase) {
    return identityPhaseRank(left.phase) - identityPhaseRank(right.phase);
  }
  if (left.updatedAt !== right.updatedAt)
    return left.updatedAt - right.updatedAt;
  if (left.startedAt !== right.startedAt)
    return left.startedAt - right.startedAt;
  const generationOrder = left.generation.localeCompare(right.generation);
  if (generationOrder !== 0) return generationOrder;
  const ownerOrder = left.ownerDocumentId.localeCompare(right.ownerDocumentId);
  if (ownerOrder !== 0) return ownerOrder;
  return left.phase.localeCompare(right.phase);
}

function identityPhaseRank(phase: PosTerminalIdentityChangePhase): number {
  if (phase === "changed") return 2;
  if (phase === "changing") return 1;
  return 0;
}

function isNonNegativeFiniteInteger(value: unknown): value is number {
  return (
    Number.isFinite(value) && Number.isInteger(value) && Number(value) >= 0
  );
}

function sameRoutePair(a: PosTelemetryRoutePair, b: PosTelemetryRoutePair) {
  return a.orgUrlSlug === b.orgUrlSlug && a.storeUrlSlug === b.storeUrlSlug;
}

function routeIdFromSuffix(suffix: string): PosDiagnosticRouteId {
  const segments = suffix.split("/").filter(Boolean);
  if (segments.length === 0) return "hub";
  if (segments[0] === "register") return "register";
  if (segments[0] === "sessions") return "sessions";
  if (segments[0] === "transactions") {
    return segments.length > 1 ? "transaction_detail" : "transactions";
  }
  if (segments[0] === "expense") return "expense";
  if (segments[0] === "expense-reports") {
    return segments.length > 1 ? "expense_report_detail" : "expense_reports";
  }
  if (segments[0] === "settings") return "settings";
  if (segments[0] === "terminals") {
    return segments.length > 1 ? "terminal_detail" : "terminals";
  }
  return "unknown_pos_route";
}

export function clearPosTelemetryContextForTests(): void {
  activeOwner = undefined;
  localTransitionIsAuthoritative = false;
  localUncoordinatedReassertRequired = false;
  nextTransitionStorageRetryAt = 0;
}
