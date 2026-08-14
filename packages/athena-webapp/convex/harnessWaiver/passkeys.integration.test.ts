/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webauthn = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: webauthn.generateRegistrationOptions,
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: webauthn.verifyRegistrationResponse,
}));

import { api } from "../_generated/api";
import { env } from "../_generated/server";
import schema from "../schema";
import { enrollmentTokenDigest } from "./passkeyPolicy";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./harnessWaiver/"),
    loader,
  ]),
);

const testEnv = env as Record<string, string | undefined>;
const originalEnv = {
  origin: env.ATHENA_WAIVER_ORIGIN,
  reviewer: env.ATHENA_WAIVER_REVIEWER_EMAIL,
  broker: env.ATHENA_WAIVER_BROKER_SECRET,
  rpId: env.ATHENA_WAIVER_RP_ID,
};

beforeEach(() => {
  testEnv.ATHENA_WAIVER_ORIGIN = "https://athena.example";
  testEnv.ATHENA_WAIVER_REVIEWER_EMAIL = "reviewer@example.com";
  testEnv.ATHENA_WAIVER_BROKER_SECRET = "broker-secret";
  testEnv.ATHENA_WAIVER_RP_ID = "athena.example";
  webauthn.generateRegistrationOptions.mockReset().mockResolvedValue({
    challenge: "registration-challenge",
  });
  webauthn.verifyRegistrationResponse.mockReset().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: "credential-1",
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
      },
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  });
});

afterEach(() => {
  testEnv.ATHENA_WAIVER_ORIGIN = originalEnv.origin;
  testEnv.ATHENA_WAIVER_REVIEWER_EMAIL = originalEnv.reviewer;
  testEnv.ATHENA_WAIVER_BROKER_SECRET = originalEnv.broker;
  testEnv.ATHENA_WAIVER_RP_ID = originalEnv.rpId;
});

describe("passkey registration authorization bridge", () => {
  it("redeems the raw ticket once and carries its reviewer into completion", async () => {
    const t = convexTest(schema, modules);
    const authorizationToken = "browser-generated-authorization-token";
    await t.run(async (ctx) => ctx.db.insert("harnessWaiverRegistrationAuthorization", {
      tokenHash: await enrollmentTokenDigest(authorizationToken),
      reviewerEmail: "reviewer@example.com",
      expiresAt: Date.now() + 60_000,
    }));

    const options = await t.action(api.harnessWaiver.passkeys.beginRegistration, {
      authorizationToken,
    });
    expect(options).toEqual({ challenge: "registration-challenge" });
    await expect(t.action(api.harnessWaiver.passkeys.beginRegistration, {
      authorizationToken,
    })).rejects.toThrow("authorization is unavailable");

    await expect(t.action(api.harnessWaiver.passkeys.completeRegistration, {
      challenge: "registration-challenge",
      response: { response: { transports: ["internal"] } },
    })).resolves.toEqual({ enrolled: true });
    const credential = await t.run((ctx) => ctx.db.query("harnessWaiverPasskey").unique());
    expect(credential?.reviewerEmail).toBe("reviewer@example.com");
  });

  it("rejects unknown and expired raw tickets before generating WebAuthn options", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(api.harnessWaiver.passkeys.beginRegistration, {
      authorizationToken: "unknown",
    })).rejects.toThrow("authorization is unavailable");
    const expiredToken = "expired-token";
    await t.run(async (ctx) => ctx.db.insert("harnessWaiverRegistrationAuthorization", {
      tokenHash: await enrollmentTokenDigest(expiredToken),
      reviewerEmail: "reviewer@example.com",
      expiresAt: Date.now() - 1,
    }));
    await expect(t.action(api.harnessWaiver.passkeys.beginRegistration, {
      authorizationToken: expiredToken,
    })).rejects.toThrow("authorization is unavailable");
    expect(webauthn.generateRegistrationOptions).not.toHaveBeenCalled();
  });
});
