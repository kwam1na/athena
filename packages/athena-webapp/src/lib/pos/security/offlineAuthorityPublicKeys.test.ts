// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest";

import {
  POS_OFFLINE_AUTHORITY_PUBLIC_KEYS,
  verifyPosOfflineAuthorityReceipt,
  type PosOfflineAuthorityPublicKey,
  type PosOfflineAuthorityReceiptPayloadV1,
} from "./offlineAuthorityPublicKeys";

let privateKey: CryptoKey;
let publicKeyJwk: JsonWebKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
});

describe("POS offline authority public keys", () => {
  it("loads only the reviewed development trust anchor", async () => {
    expect(POS_OFFLINE_AUTHORITY_PUBLIC_KEYS).toEqual([
      expect.objectContaining({
        issuer: "athena-dev-pos-authority",
        keyVersion: 1,
        state: "current",
      }),
    ]);
  });

  it("fails closed when the trust-anchor registry is empty", async () => {
    const envelope = await signReceipt(receiptPayload());

    await expect(
      verifyPosOfflineAuthorityReceipt({
        envelope,
        expectedStoreId: "store-1",
        expectedTerminalId: "terminal-1",
        now: 2_000,
        publicKeys: [],
      }),
    ).resolves.toEqual({ status: "rejected", reason: "unknown_key" });
  });

  it.each(["current", "retiring"] as const)(
    "accepts a scoped, current lease signed by a %s reviewed key",
    async (state) => {
      const payload = receiptPayload();
      const envelope = await signReceipt(payload);

      await expect(
        verifyPosOfflineAuthorityReceipt({
          envelope,
          expectedStoreId: payload.storeId,
          expectedTerminalId: payload.terminalId,
          now: 2_000,
          publicKeys: [reviewedKey(state)],
        }),
      ).resolves.toMatchObject({
        status: "valid",
        receipt: {
          envelope,
          payload,
          verifiedAt: 2_000,
        },
      });
    },
  );

  it.each([
    ["revoked", [reviewedKey("revoked")], "revoked_key"],
    ["unknown", [], "unknown_key"],
  ] as const)("rejects %s signing keys", async (_label, publicKeys, reason) => {
    await expect(
      verifyPosOfflineAuthorityReceipt({
        envelope: await signReceipt(receiptPayload()),
        expectedStoreId: "store-1",
        expectedTerminalId: "terminal-1",
        now: 2_000,
        publicKeys,
      }),
    ).resolves.toEqual({ status: "rejected", reason });
  });

  it("rejects forged, noncanonical, and wrong-audience envelopes", async () => {
    const envelope = await signReceipt(receiptPayload());
    const forged = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;
    const wrongAudience = await signReceipt({
      ...receiptPayload(),
      audience: "athena.pos.admin" as "athena.pos.offline",
    });
    const [payloadSegment, signatureSegment] = envelope.split(".");
    const parsed = JSON.parse(decode(payloadSegment)) as Record<string, unknown>;
    const noncanonicalPayload = encode(JSON.stringify(parsed, null, 1));

    for (const candidate of [
      forged,
      wrongAudience,
      `${noncanonicalPayload}.${signatureSegment}`,
    ]) {
      await expect(
        verifyPosOfflineAuthorityReceipt({
          envelope: candidate,
          expectedStoreId: "store-1",
          expectedTerminalId: "terminal-1",
          now: 2_000,
          publicKeys: [reviewedKey("current")],
        }),
      ).resolves.toMatchObject({ status: "rejected" });
    }
  });

  it("rejects store, terminal, and inclusive lease scope mismatches", async () => {
    const envelope = await signReceipt(receiptPayload());

    for (const expected of [
      { expectedStoreId: "store-2", expectedTerminalId: "terminal-1" },
      { expectedStoreId: "store-1", expectedTerminalId: "terminal-2" },
    ]) {
      await expect(
        verifyPosOfflineAuthorityReceipt({
          envelope,
          ...expected,
          now: 2_000,
          publicKeys: [reviewedKey("current")],
        }),
      ).resolves.toEqual({ status: "rejected", reason: "scope_mismatch" });
    }

    for (const now of [999, 61_001]) {
      await expect(
        verifyPosOfflineAuthorityReceipt({
          envelope,
          expectedStoreId: "store-1",
          expectedTerminalId: "terminal-1",
          now,
          publicKeys: [reviewedKey("current")],
        }),
      ).resolves.toEqual({ status: "rejected", reason: "outside_lease" });
    }
    for (const now of [1_000, 61_000]) {
      await expect(
        verifyPosOfflineAuthorityReceipt({
          envelope,
          expectedStoreId: "store-1",
          expectedTerminalId: "terminal-1",
          now,
          publicKeys: [reviewedKey("current")],
        }),
      ).resolves.toMatchObject({ status: "valid" });
    }
  });
});

function reviewedKey(
  state: PosOfflineAuthorityPublicKey["state"],
): PosOfflineAuthorityPublicKey {
  return {
    issuer: "athena-test",
    keyVersion: 1,
    publicKeyJwk,
    state,
  };
}

function receiptPayload(): PosOfflineAuthorityReceiptPayloadV1 {
  return {
    audience: "athena.pos.offline",
    capabilityId: "pos.application",
    capabilityRevision: 3,
    credentialRevision: 5,
    expiresAt: 61_000,
    issuedAt: 1_000,
    issuer: "athena-test",
    keyVersion: 1,
    nonce: "receipt-nonce",
    posApplicationSessionBindingId: "binding-1",
    principalLifecycleRevision: 2,
    servicePrincipalId: "principal-1",
    servicePrincipalSessionId: "session-1",
    storeId: "store-1",
    terminalId: "terminal-1",
    terminalLifecycleRevision: 7,
    terminalProofRevision: 11,
    version: 1,
  };
}

async function signReceipt(payload: PosOfflineAuthorityReceiptPayloadV1) {
  const encodedPayload = encode(canonicalJson(payload));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${encodeBytes(new Uint8Array(signature))}`;
}

function canonicalJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(
        ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
      ),
    ),
  );
}

function encode(value: string) {
  return encodeBytes(new TextEncoder().encode(value));
}

function encodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}
