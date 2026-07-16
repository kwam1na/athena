import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  POS_RECOVERY_PBKDF2_ITERATIONS,
  createPosRecoveryCodeVerifier,
  verifyPosRecoveryCodeVerifier,
} from "./posRecoveryCodeVerifier";

describe("deployment-keyed POS recovery verifier", () => {
  beforeEach(() => {
    process.env.POS_RECOVERY_CODE_ACTIVE_PEPPER_VERSION = "2";
    process.env.POS_RECOVERY_CODE_PEPPERS_JSON = JSON.stringify({
      1: "previous-pepper-material-0000000000000001",
      2: "current-pepper-material-00000000000000002",
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          importKey: vi.fn(async (_format, material) => material),
          deriveBits: vi.fn(async (algorithm, material) => {
            const source = [
              ...new Uint8Array(material as ArrayBuffer),
              ...new Uint8Array(algorithm.salt as ArrayBuffer),
              algorithm.iterations % 251,
            ];
            const output = new Uint8Array(32);
            source.forEach((value, index) => {
              output[index % output.length] ^= value;
            });
            return output.buffer;
          }),
        },
      },
    });
  });

  it("creates a versioned calibrated PBKDF2 verifier and verifies it", async () => {
    const verifier = await createPosRecoveryCodeVerifier({
      normalizedCode: "anchorapron01",
      saltHex: "00112233445566778899aabbccddeeff",
    });

    expect(verifier).toMatchObject({
      iterations: POS_RECOVERY_PBKDF2_ITERATIONS,
      pepperVersion: 2,
      verifierVersion: 1,
    });
    await expect(
      verifyPosRecoveryCodeVerifier({
        ...verifier,
        normalizedCode: "anchorapron01",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyPosRecoveryCodeVerifier({
        ...verifier,
        normalizedCode: "wrong-code",
      }),
    ).resolves.toBe(false);
  });

  it("keeps an older pepper version verifiable during overlap", async () => {
    process.env.POS_RECOVERY_CODE_ACTIVE_PEPPER_VERSION = "1";
    const oldVerifier = await createPosRecoveryCodeVerifier({
      normalizedCode: "anchorapron01",
      saltHex: "00112233445566778899aabbccddeeff",
    });
    process.env.POS_RECOVERY_CODE_ACTIVE_PEPPER_VERSION = "2";

    await expect(
      verifyPosRecoveryCodeVerifier({
        ...oldVerifier,
        normalizedCode: "anchorapron01",
      }),
    ).resolves.toBe(true);
  });

  it("fails closed when deployment pepper configuration is absent", async () => {
    delete process.env.POS_RECOVERY_CODE_PEPPERS_JSON;
    await expect(
      createPosRecoveryCodeVerifier({
        normalizedCode: "anchorapron01",
        saltHex: "00112233445566778899aabbccddeeff",
      }),
    ).rejects.toThrow("not configured");
  });
});
