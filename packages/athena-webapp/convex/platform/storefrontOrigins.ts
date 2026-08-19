/**
 * Storefront origin allowlist.
 *
 * The storefront claim cookies are `SameSite=None`, so any origin that can
 * reach the router could otherwise drive a customer write with the visitor's
 * cookie attached. Customer write routes therefore declare
 * `ingressVerification: { kind: "origin_allowlist" }`, and the router's CORS
 * middleware (U11) uses the same list.
 *
 * Fail closed by construction: an unset or empty environment value allows no
 * origin at all. Matching is exact string equality — no wildcard, no suffix
 * match, and no `Referer` fallback.
 */
export const STOREFRONT_ALLOWED_ORIGINS_ENV = "ATHENA_STOREFRONT_ALLOWED_ORIGINS";

type Environment = Record<string, string | undefined>;

export function readStorefrontOriginAllowlist(
  environment: Environment = process.env,
): readonly string[] {
  const raw = environment[STOREFRONT_ALLOWED_ORIGINS_ENV];
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * `null` is a real `Origin` header value (opaque origin) and is never allowed;
 * an absent header is likewise never allowed on a route that declares the
 * origin allowlist.
 */
export function isAllowedStorefrontOrigin(
  origin: string | null | undefined,
  environment: Environment = process.env,
): boolean {
  if (typeof origin !== "string") return false;
  if (origin.length === 0 || origin === "null") return false;
  return readStorefrontOriginAllowlist(environment).includes(origin);
}
