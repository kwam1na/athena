/**
 * Origin allowlist for credentialed storefront/admin HTTP requests.
 *
 * The API sets `SameSite=None` session cookies and responds with
 * `Access-Control-Allow-Credentials: true`, so any origin we reflect back can
 * drive authenticated requests as the logged-in customer. We therefore only
 * reflect first-party origins:
 *   - localhost / 127.0.0.1 on any port (local dev)
 *   - the apex `wigclub.store` and any `*.wigclub.store` subdomain
 *     (storefront, admin, dev, and preview deploys)
 *
 * Additional origins can be supplied via the `ADDITIONAL_ALLOWED_ORIGINS` env
 * var (comma-separated exact origins) without a code change.
 */

const ROOT_DOMAIN = "wigclub.store";

const parseAdditionalOrigins = (): Set<string> => {
  const raw = process.env.ADDITIONAL_ALLOWED_ORIGINS;
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
};

export const isAllowedStorefrontOrigin = (
  origin: string | undefined | null
): boolean => {
  if (!origin) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const hostname = url.hostname;

  // Local dev origins are only trusted outside production, so a real customer's
  // browser (never on localhost) can't be used to drive credentialed requests
  // from a locally-hosted attacker page against prod.
  if (
    process.env.STAGE !== "prod" &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  ) {
    return true;
  }

  if (hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    return true;
  }

  return parseAdditionalOrigins().has(origin);
};

/**
 * CORS `origin` resolver: reflect the caller's origin only when it is on the
 * allowlist, otherwise return `null` so the browser blocks the response.
 */
export const resolveAllowedOrigin = (
  origin: string | undefined | null
): string | null => {
  return isAllowedStorefrontOrigin(origin) ? (origin as string) : null;
};
