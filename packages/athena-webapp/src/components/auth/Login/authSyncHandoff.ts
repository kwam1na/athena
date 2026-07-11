import {
  ATHENA_AUTH_SYNC_FAILED_EVENT,
  ATHENA_PENDING_AUTH_SYNC_EVENT,
  PENDING_ATHENA_AUTH_SYNC_KEY,
} from "~/src/lib/constants";
import { APP_ENTRY_PATH } from "~/src/lib/navigation/appEntryRoutes";

export const ATHENA_AUTH_SYNC_HANDOFF_TTL_MS = 60_000;

export type AthenaAuthSyncHandoff = {
  redirectTo: string;
  startedAt: number;
};

export type AthenaAuthSyncHandoffStatus =
  | {
      kind: "active";
      handoff: AthenaAuthSyncHandoff;
      expiresAt: number;
    }
  | {
      kind: "expired" | "invalid" | "missing";
    };

function normalizeAuthSyncRedirect(redirectTo?: string | null) {
  if (!redirectTo?.startsWith("/") || redirectTo.startsWith("//")) {
    return APP_ENTRY_PATH;
  }

  return redirectTo;
}

function readRawHandoff() {
  try {
    return sessionStorage.getItem(PENDING_ATHENA_AUTH_SYNC_KEY);
  } catch {
    return null;
  }
}

function parseHandoff(raw: string): AthenaAuthSyncHandoff | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AthenaAuthSyncHandoff>;
    if (
      !parsed ||
      typeof parsed.startedAt !== "number" ||
      !Number.isFinite(parsed.startedAt) ||
      typeof parsed.redirectTo !== "string"
    ) {
      return null;
    }

    return {
      startedAt: parsed.startedAt,
      redirectTo: normalizeAuthSyncRedirect(parsed.redirectTo),
    };
  } catch {
    return null;
  }
}

export function getAthenaAuthSyncHandoffStatus(
  now = Date.now(),
): AthenaAuthSyncHandoffStatus {
  const raw = readRawHandoff();
  if (!raw) {
    return { kind: "missing" };
  }

  const handoff = parseHandoff(raw);
  if (!handoff) {
    return { kind: "invalid" };
  }

  const expiresAt = handoff.startedAt + ATHENA_AUTH_SYNC_HANDOFF_TTL_MS;
  if (expiresAt <= now) {
    return { kind: "expired" };
  }

  return {
    kind: "active",
    handoff,
    expiresAt,
  };
}

export function clearAthenaAuthSyncHandoff() {
  try {
    sessionStorage.removeItem(PENDING_ATHENA_AUTH_SYNC_KEY);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export function failAthenaAuthSyncHandoff() {
  clearAthenaAuthSyncHandoff();
  window.dispatchEvent(new Event(ATHENA_AUTH_SYNC_FAILED_EVENT));
}

export function startAthenaAuthSyncHandoff(redirectTo?: string | null) {
  const normalizedRedirect = normalizeAuthSyncRedirect(redirectTo);
  const handoff: AthenaAuthSyncHandoff = {
    redirectTo: normalizedRedirect,
    startedAt: Date.now(),
  };

  sessionStorage.setItem(PENDING_ATHENA_AUTH_SYNC_KEY, JSON.stringify(handoff));
  window.dispatchEvent(new Event(ATHENA_PENDING_AUTH_SYNC_EVENT));

  return normalizedRedirect;
}
