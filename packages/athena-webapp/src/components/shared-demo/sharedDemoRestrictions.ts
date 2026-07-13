const RESTRICTED_PATHS = [
  /\/app-settings(?:\/|$)/,
  /\/bulk-operations(?:\/|$)/,
  /\/configuration(?:\/|$)/,
  /\/members(?:\/|$)/,
  /\/operations\/(?:approvals|inventory-import)(?:\/|$)/,
  /\/pos\/(?:settings|terminals)(?:\/|$)/,
  /\/products\/(?:archived|new)(?:\/|$)/,
  /\/products\/[^/]+\/edit(?:\/|$)/,
  /\/promo-codes(?:\/|$)/,
  /\/settings(?:\/|$)/,
];

export function isSharedDemoRestrictedPath(pathname: string) {
  return RESTRICTED_PATHS.some((pattern) => pattern.test(pathname));
}
