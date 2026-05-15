import { describe, expect, it } from "vitest";

import {
  createLocalPinVerifier,
  unwrapLocalStaffProofToken,
  verifyLocalPin,
  wrapLocalStaffProofToken,
} from "./localPinVerifier";

describe("localPinVerifier", () => {
  it("verifies the PIN used to create the local verifier and rejects a different PIN", async () => {
    const verifier = await createLocalPinVerifier("123456");

    expect(verifier).toEqual({
      algorithm: "PBKDF2-SHA256",
      hash: expect.any(String),
      iterations: 120000,
      salt: expect.any(String),
      version: 1,
    });
    await expect(verifyLocalPin(verifier, "123456")).resolves.toEqual({
      ok: true,
    });
    await expect(verifyLocalPin(verifier, "654321")).resolves.toEqual({
      ok: false,
      reason: "invalid_pin",
    });
  });

  it("fails closed for malformed or unsupported verifier payloads", async () => {
    await expect(verifyLocalPin({ hash: "missing-fields" }, "123456")).resolves.toEqual({
      ok: false,
      reason: "malformed_verifier",
    });
    await expect(
      verifyLocalPin(
        {
          algorithm: "PBKDF2-SHA512",
          hash: "hash",
          iterations: 1,
          salt: "salt",
          version: 99,
        },
        "123456",
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "unsupported_verifier",
    });
    await expect(
      verifyLocalPin(
        {
          algorithm: "PBKDF2-SHA256",
          hash: "hash",
          iterations: 120000,
          salt: "%",
          version: 1,
        },
        "123456",
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "malformed_verifier",
    });
    await expect(
      verifyLocalPin(
        {
          algorithm: "PBKDF2-SHA256",
          hash: "hash",
          iterations: 0,
          salt: "salt",
          version: 1,
        },
        "123456",
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "malformed_verifier",
    });
  });

  it("wraps local staff proof tokens so they only unwrap with the correct PIN", async () => {
    const verifier = await createLocalPinVerifier("123456");
    const wrapped = await wrapLocalStaffProofToken(verifier, "123456", {
      expiresAt: 2000,
      token: "proof-token-1",
    });

    expect(wrapped).toEqual({
      ciphertext: expect.any(String),
      expiresAt: 2000,
      iv: expect.any(String),
    });
    await expect(
      unwrapLocalStaffProofToken(verifier, "123456", wrapped ?? undefined),
    ).resolves.toEqual({
      expiresAt: 2000,
      token: "proof-token-1",
    });
    await expect(
      unwrapLocalStaffProofToken(verifier, "654321", wrapped ?? undefined),
    ).resolves.toBeNull();
  });
});
