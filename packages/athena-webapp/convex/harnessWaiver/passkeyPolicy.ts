export type WaiverCandidate = {
  repository: string;
  prNumber: number;
  headSha: string;
  baseRef: string;
  baseSha: string;
  diffBaseSha: string;
  deliverableTreeSha: string;
  identityVersion: string;
  waivedFindingCodes: string[];
  reason: string;
};

export function canonicalWaiverCandidate(candidate: WaiverCandidate) {
  return JSON.stringify({
    repository: candidate.repository,
    prNumber: candidate.prNumber,
    headSha: candidate.headSha,
    baseRef: candidate.baseRef,
    baseSha: candidate.baseSha,
    diffBaseSha: candidate.diffBaseSha,
    deliverableTreeSha: candidate.deliverableTreeSha,
    identityVersion: candidate.identityVersion,
    waivedFindingCodes: [...new Set(candidate.waivedFindingCodes)].sort(),
    reason: candidate.reason.trim(),
  });
}

export function assertWaiverCandidateMatches(
  actual: WaiverCandidate,
  expected: WaiverCandidate,
) {
  if (canonicalWaiverCandidate(actual) !== canonicalWaiverCandidate(expected)) {
    throw new Error("Passkey approval candidate does not match the expected candidate.");
  }
}

export function assertApprovalRequestUsable(
  request: {
    status: string;
    expiresAt: number;
    consumedAt?: number;
  },
  now: number,
) {
  if (request.consumedAt !== undefined) throw new Error("Approval request is consumed.");
  if (request.status !== "pending") throw new Error("Approval request is not pending.");
  if (request.expiresAt <= now) throw new Error("Approval request is expired.");
}

export function assertApprovedRequestConsumable(
  request: {
    status: string;
    expiresAt: number;
    consumeExpiresAt?: number;
    consumedAt?: number;
  },
  now: number,
) {
  if (request.consumedAt !== undefined || request.status === "consumed") {
    throw new Error("Approval request is consumed.");
  }
  if (request.status !== "approved") throw new Error("Approval request is not approved.");
  if ((request.consumeExpiresAt ?? request.expiresAt) <= now) {
    throw new Error("Approval request is expired.");
  }
}

export async function enrollmentTokenDigest(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireEnrollmentBootstrap(token: string, expectedDigest: string) {
  const actual = await enrollmentTokenDigest(token.trim());
  const expected = expectedDigest.trim().toLowerCase();
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ (expected.charCodeAt(index) || 0);
  }
  if (!expected || difference !== 0) {
    throw new Error("The enrollment bootstrap secret is invalid or unavailable.");
  }
}

export function requireConfiguredReviewer(identityEmail: string, configuredEmail: string) {
  const actual = identityEmail.trim().toLowerCase();
  const expected = configuredEmail.trim().toLowerCase();
  if (!expected || actual !== expected) {
    throw new Error("Authenticated identity is not authorized to manage the waiver passkey.");
  }
  return actual;
}
