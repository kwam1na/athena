import {
  ATHENA_PENDING_AUTH_SYNC_EVENT,
  PENDING_ATHENA_AUTH_SYNC_KEY,
} from "~/src/lib/constants";

function normalizeAuthSyncRedirect(redirectTo?: string | null) {
  if (!redirectTo?.startsWith("/") || redirectTo.startsWith("//")) {
    return "/";
  }

  return redirectTo;
}

export function startAthenaAuthSyncHandoff(redirectTo?: string | null) {
  sessionStorage.setItem(PENDING_ATHENA_AUTH_SYNC_KEY, "1");
  window.dispatchEvent(new Event(ATHENA_PENDING_AUTH_SYNC_EVENT));

  return normalizeAuthSyncRedirect(redirectTo);
}
