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
