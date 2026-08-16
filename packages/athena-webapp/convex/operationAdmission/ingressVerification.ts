import { isAllowedStorefrontOrigin } from "../platform/storefrontOrigins";
import type { AnyOperationDefinition } from "./types";

export type OperationIngressInput = {
  headers: Headers;
  rawBody: string;
  request: Request;
};

/**
 * A signature verifier fails closed when its secret is absent and compares in
 * constant time. Verifiers are registered at the composition root; the rail
 * core only sequences them.
 */
export type OperationIngressVerifier = (
  input: OperationIngressInput,
) => Promise<boolean> | boolean;

export type OperationIngressVerifierRegistry = Readonly<
  Record<string, OperationIngressVerifier>
>;

export type OperationIngressVerificationResult =
  | { ok: true }
  | { ok: false; reason: "origin_denied" | "signature_denied" | "unknown_verifier" };

export async function verifyOperationIngress(
  definition: AnyOperationDefinition,
  input: OperationIngressInput,
  verifiers: OperationIngressVerifierRegistry = {},
  environment: Record<string, string | undefined> = process.env,
): Promise<OperationIngressVerificationResult> {
  const verification = definition.ingressVerification;
  if (!verification) return { ok: true };

  if (verification.kind === "origin_allowlist") {
    const origin = input.headers.get("Origin");
    return isAllowedStorefrontOrigin(origin, environment)
      ? { ok: true }
      : { ok: false, reason: "origin_denied" };
  }

  const verifier = verifiers[verification.verifier];
  if (!verifier) return { ok: false, reason: "unknown_verifier" };
  return (await verifier(input))
    ? { ok: true }
    : { ok: false, reason: "signature_denied" };
}

/** Constant-time comparison for signature verifiers. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

/** Verifier id registered for the Paystack webhook at the composition root. */
export const PAYSTACK_SIGNATURE_VERIFIER = "paystack_signature";

export const PAYSTACK_SECRET_ENV = "PAYSTACK_SECRET_KEY";
export const PAYSTACK_SIGNATURE_HEADER = "x-paystack-signature";

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let index = 0; index < bytes.length; index += 1) {
    hex += bytes[index].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * HMAC-SHA512 over the RAW request body, which is exactly the string the
 * handler goes on to parse — the rail reads the body once and hands the same
 * value to the verifier and the handler, so a signature can never cover
 * something different from what is acted on.
 *
 * Fails closed in every degenerate case: no configured secret, no signature
 * header, an empty header, or a crypto failure all return `false` rather than
 * skipping verification. The comparison is constant time and case-insensitive
 * on the hex digest only (Paystack sends lowercase hex).
 */
export function createPaystackSignatureVerifier(
  environment: Record<string, string | undefined> = process.env,
): OperationIngressVerifier {
  return async (input) => {
    const secret = environment[PAYSTACK_SECRET_ENV];
    // An unconfigured secret is a denial, never an allow: a webhook route with
    // no secret is an unauthenticated write endpoint.
    if (typeof secret !== "string" || secret.length === 0) return false;

    const signature = input.headers.get(PAYSTACK_SIGNATURE_HEADER);
    if (typeof signature !== "string" || signature.length === 0) return false;

    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-512" },
        false,
        ["sign"],
      );
      const digest = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(input.rawBody),
      );
      return timingSafeEqualStrings(toHex(digest), signature.toLowerCase());
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------------------
// U11 verifiers: WhatsApp, MTN MoMo, the harness waiver broker, and the two
// origin fences the public marketing / tracking beacons ride on.
//
// Every one of them fails closed on a missing secret, compares in constant
// time, and reads the RAW body the rail already read once — so the bytes a
// signature covers are exactly the bytes the handler goes on to parse.
// ---------------------------------------------------------------------------

/** Verifier id registered for the WhatsApp (Meta) webhook. */
export const WHATSAPP_SIGNATURE_VERIFIER = "whatsapp_signature";
export const WHATSAPP_APP_SECRET_ENV = "WHATSAPP_WEBHOOK_APP_SECRET";
export const WHATSAPP_SIGNATURE_HEADER = "x-hub-signature-256";
const WHATSAPP_SIGNATURE_PREFIX = "sha256=";

/** HMAC-SHA256 over the raw body, the `sha256=` scheme Meta signs with. */
export function createWhatsAppSignatureVerifier(
  environment: Record<string, string | undefined> = process.env,
): OperationIngressVerifier {
  return async (input) => {
    const secret = environment[WHATSAPP_APP_SECRET_ENV]?.trim();
    if (!secret) return false;

    const header = input.headers.get(WHATSAPP_SIGNATURE_HEADER);
    if (!header?.startsWith(WHATSAPP_SIGNATURE_PREFIX)) return false;

    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const digest = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(input.rawBody),
      );
      return timingSafeEqualStrings(
        toHex(digest),
        header.slice(WHATSAPP_SIGNATURE_PREFIX.length).toLowerCase(),
      );
    } catch {
      return false;
    }
  };
}

/** Verifier id registered for the MTN MoMo collections callback. */
export const MTN_MOMO_CALLBACK_VERIFIER = "mtn_momo_callback";
export const MTN_MOMO_CALLBACK_SECRET_ENV =
  "MTN_MOMO_COLLECTIONS_CALLBACK_SECRET";
export const MTN_MOMO_CALLBACK_SECRET_HEADER = "x-callback-secret";
export const MTN_MOMO_CALLBACK_SECRET_QUERY = "callbackSecret";

/**
 * MTN signs nothing, so the callback is authenticated by a shared secret we
 * mint ourselves and register inside the callback URL (query parameter) or
 * send as a header when the provider allows one. Absent configuration denies:
 * an unauthenticated money-movement callback is not a fallback we accept.
 */
export function createMtnMomoCallbackVerifier(
  environment: Record<string, string | undefined> = process.env,
): OperationIngressVerifier {
  return (input) => {
    const secret = environment[MTN_MOMO_CALLBACK_SECRET_ENV]?.trim();
    if (!secret) return false;

    const header = input.headers.get(MTN_MOMO_CALLBACK_SECRET_HEADER);
    if (header && timingSafeEqualStrings(header, secret)) return true;

    let presented: string | null = null;
    try {
      presented = new URL(input.request.url).searchParams.get(
        MTN_MOMO_CALLBACK_SECRET_QUERY,
      );
    } catch {
      return false;
    }
    return presented ? timingSafeEqualStrings(presented, secret) : false;
  };
}

/** Verifier id registered for the harness waiver broker routes. */
export const HARNESS_WAIVER_BROKER_VERIFIER = "harness_waiver_broker";
export const HARNESS_WAIVER_BROKER_SECRET_ENV = "ATHENA_WAIVER_BROKER_SECRET";

/**
 * The delivery harness broker presents a bearer secret. This mirrors the
 * route's own middleware (which keeps the 401/503 status contract); declaring
 * it here is what puts the boundary on the definition rather than only in a
 * handler someone could later reorder.
 */
export function createHarnessWaiverBrokerVerifier(
  environment: Record<string, string | undefined> = process.env,
): OperationIngressVerifier {
  return (input) => {
    const secret = environment[HARNESS_WAIVER_BROKER_SECRET_ENV]?.trim();
    if (!secret) return false;
    const presented = input.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    return presented ? timingSafeEqualStrings(presented, secret) : false;
  };
}

/** Verifier id registered for the public marketing ingress routes. */
export const MARKETING_ORIGIN_VERIFIER = "marketing_origin";
export const MARKETING_ALLOWED_ORIGINS_ENV = "WALKTHROUGH_ALLOWED_ORIGINS";

/**
 * The marketing site is not the storefront, so it carries its own exact-match
 * origin list. Unset means no origin at all, the same fail-closed shape as the
 * storefront allowlist.
 *
 * The allowlist is INJECTED rather than parsed here. `WALKTHROUGH_ALLOWED_ORIGINS`
 * already had a resolver in `convex/marketing/walkthroughConfig.ts` that also
 * honours `WALKTHROUGH_ALLOW_LOCAL_ORIGINS`, and a second parser in the rail
 * core silently disagreed with it: with local origins enabled the handler
 * would accept a localhost caller the verifier had already refused. Two
 * parsers of one variable is two policies. The rail core cannot import
 * marketing config (its import allowlist forbids it), so the composition root
 * supplies the one resolver and this function only compares.
 */
export function createMarketingOriginVerifier(
  resolveAllowedOrigins: () => readonly string[],
): OperationIngressVerifier {
  return (input) => {
    const origin = input.headers.get("Origin");
    if (!origin || origin === "null") return false;
    let allowed: readonly string[];
    try {
      allowed = resolveAllowedOrigins();
    } catch {
      // A malformed configuration denies, like an absent one.
      return false;
    }
    return allowed.includes(origin);
  };
}

/** Verifier id registered for the anonymous storefront tracking beacon. */
export const STOREFRONT_TRACKING_ORIGIN_VERIFIER =
  "storefront_tracking_origin";

/**
 * The tracking beacon predates the storefront origin allowlist and is fenced
 * by a fixed host list instead. It is stated here, once, so the route handler
 * and the declared ingress verification can never disagree.
 */
const TRACKING_ALLOWED_HOSTNAMES = new Set([
  "wigclub.store",
  "www.wigclub.store",
  "dev.wigclub.store",
  "localhost",
  "127.0.0.1",
]);

export function isAllowedTrackingOrigin(origin?: string | null): boolean {
  if (!origin) return false;
  try {
    return TRACKING_ALLOWED_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function createStorefrontTrackingOriginVerifier(): OperationIngressVerifier {
  return (input) => isAllowedTrackingOrigin(input.headers.get("Origin"));
}
