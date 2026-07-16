import { beforeAll, describe, expect, it } from "vitest";

import {
  canonicalJsonV1,
  issuePosOfflineAuthorityReceipt,
  verifyPosOfflineAuthorityReceiptForEvent,
} from "./offlineAuthorityReceipt";

let key1: {
  privateKeyJwk: JsonWebKey;
  privateKeyPkcs8Base64Url: string;
  publicKeyJwk: JsonWebKey;
};
let key2: typeof key1;

beforeAll(async () => {
  key1 = await generateKeyConfig();
  key2 = await generateKeyConfig();
});

function configure(keys: Array<Record<string, unknown>>, leaseMs = 60_000) {
  process.env.POS_OFFLINE_AUTHORITY_KEYS_JSON = JSON.stringify({
    issuer: "athena-test",
    leaseMs,
    keys,
  });
}

async function generateKeyConfig() {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    privateKeyJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    privateKeyPkcs8Base64Url: encodeBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    ),
    publicKeyJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function issuanceInput() {
  return {
    authorityExpiresAt: 100_000,
    capabilityRevision: 3,
    credentialRevision: 5,
    issuedAt: 1_000,
    posApplicationSessionBindingId: "pos-binding-1",
    principalLifecycleRevision: 2,
    servicePrincipalId: "principal-1",
    servicePrincipalSessionId: "service-session-1",
    storeId: "store-1",
    terminalId: "terminal-1",
    terminalLifecycleRevision: 7,
    terminalProofRevision: 11,
  };
}

describe("POS offline authority receipt", () => {
  it("canonicalizes recursively and signs the complete bounded v1 authority tuple", async () => {
    configure([
      {
        version: 1,
        state: "current",
        privateKeyPkcs8Base64Url: key1.privateKeyPkcs8Base64Url,
        publicKeyJwk: key1.publicKeyJwk,
      },
    ]);
    expect(canonicalJsonV1({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );

    const receipt = await issuePosOfflineAuthorityReceipt(issuanceInput());
    const result = await verifyPosOfflineAuthorityReceiptForEvent({
      eventOccurredAt: 1_500,
      receipt,
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({
      disposition: "valid",
      payload: {
        audience: "athena.pos.offline",
        capabilityId: "pos.application",
        capabilityRevision: 3,
        credentialRevision: 5,
        expiresAt: 61_000,
        issuedAt: 1_000,
        issuer: "athena-test",
        keyVersion: 1,
        posApplicationSessionBindingId: "pos-binding-1",
        principalLifecycleRevision: 2,
        servicePrincipalId: "principal-1",
        servicePrincipalSessionId: "service-session-1",
        storeId: "store-1",
        terminalId: "terminal-1",
        terminalLifecycleRevision: 7,
        terminalProofRevision: 11,
        version: 1,
      },
    });
    expect(receipt).not.toContain("d\"");
    expect(receipt).not.toContain(JSON.stringify(key1.privateKeyJwk));
  });

  it("rejects forged, copied-store, and copied-terminal receipts", async () => {
    configure([{ version: 1, state: "current", ...key1 }]);
    const receipt = await issuePosOfflineAuthorityReceipt(issuanceInput());
    const [payload, signature] = receipt.split(".");
    const forged = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    await expect(
      verifyPosOfflineAuthorityReceiptForEvent({
        eventOccurredAt: 1_500,
        receipt: forged,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({ disposition: "rejected" });
    await expect(
      verifyPosOfflineAuthorityReceiptForEvent({
        eventOccurredAt: 1_500,
        receipt,
        storeId: "store-2",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ disposition: "rejected", reason: "scope_mismatch" });
    await expect(
      verifyPosOfflineAuthorityReceiptForEvent({
        eventOccurredAt: 1_500,
        receipt,
        storeId: "store-1",
        terminalId: "terminal-2",
      }),
    ).resolves.toEqual({ disposition: "rejected", reason: "scope_mismatch" });
  });

  it("routes missing, post-expiry, and pre-issuance evidence to review", async () => {
    configure([{ version: 1, state: "current", ...key1 }]);
    const receipt = await issuePosOfflineAuthorityReceipt(issuanceInput());
    await expect(
      verifyPosOfflineAuthorityReceiptForEvent({
        eventOccurredAt: 1_500,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      disposition: "needs_review",
      reason: "missing_receipt",
    });
    for (const eventOccurredAt of [999, 61_001]) {
      await expect(
        verifyPosOfflineAuthorityReceiptForEvent({
          eventOccurredAt,
          receipt,
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      ).resolves.toMatchObject({
        disposition: "needs_review",
        reason: "outside_lease",
      });
    }
  });

  it("verifies retiring overlap keys and rejects them after revocation", async () => {
    configure([{ version: 1, state: "current", ...key1 }]);
    const receipt = await issuePosOfflineAuthorityReceipt(issuanceInput());
    configure([
      { version: 1, state: "retiring", ...key1 },
      { version: 2, state: "current", ...key2 },
    ]);
    await expect(
      verifyPosOfflineAuthorityReceiptForEvent({
        eventOccurredAt: 1_500,
        receipt,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({ disposition: "valid" });

    configure([
      { version: 1, state: "revoked", ...key1 },
      { version: 2, state: "current", ...key2 },
    ]);
    await expect(
      verifyPosOfflineAuthorityReceiptForEvent({
        eventOccurredAt: 1_500,
        receipt,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ disposition: "rejected", reason: "revoked_key" });
  });

  it("treats unknown key/configuration as infrastructure rejection", async () => {
    configure([{ version: 1, state: "current", ...key1 }]);
    const receipt = await issuePosOfflineAuthorityReceipt(issuanceInput());
    configure([{ version: 2, state: "current", ...key2 }]);
    await expect(
      verifyPosOfflineAuthorityReceiptForEvent({
        eventOccurredAt: 1_500,
        receipt,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ disposition: "infrastructure_failure" });
  });
});
