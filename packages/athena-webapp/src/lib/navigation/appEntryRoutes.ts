export const APP_ENTRY_PATH = "/" as const;
export const PUBLIC_HOME_PATH = "/landing" as const;
export const LOGIN_PATH = "/login" as const;
export const WALKTHROUGH_PATH = "/walkthrough" as const;
export const DEMO_PATH = "/demo" as const;

const PUBLIC_ROUTE_PATHS = new Set<string>([
  PUBLIC_HOME_PATH,
  LOGIN_PATH,
  WALKTHROUGH_PATH,
  DEMO_PATH,
  "/privacy",
]);

export function isPublicRoutePath(pathname: string) {
  return PUBLIC_ROUTE_PATHS.has(normalizePathname(pathname));
}

export function getRecoveryHomePath(pathname: string) {
  return isPublicRoutePath(pathname) ? PUBLIC_HOME_PATH : APP_ENTRY_PATH;
}

function normalizePathname(pathname: string) {
  if (pathname === APP_ENTRY_PATH) {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}
