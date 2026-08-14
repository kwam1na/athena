/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

const originalReviewer = env.ATHENA_WAIVER_REVIEWER_EMAIL;
const originalEnrollmentHash = env.ATHENA_WAIVER_ENROLLMENT_TOKEN_HASH;
const testEnv = env as Record<string, string | undefined>;

beforeEach(async () => {
  testEnv.ATHENA_WAIVER_REVIEWER_EMAIL = "reviewer@example.com";
  testEnv.ATHENA_WAIVER_ENROLLMENT_TOKEN_HASH = await enrollmentTokenDigest("bootstrap-secret");
});

afterEach(() => {
  testEnv.ATHENA_WAIVER_REVIEWER_EMAIL = originalReviewer;
  testEnv.ATHENA_WAIVER_ENROLLMENT_TOKEN_HASH = originalEnrollmentHash;
});

describe("authorizeRegistration", () => {
  it("requires the configured authenticated reviewer", async () => {
    const t = convexTest(schema, modules);
    const args = { bootstrapSecret: "bootstrap-secret", tokenHash: "a".repeat(64) };

    await expect(t.mutation(
      api.harnessWaiver.registrationAuthorization.authorizeRegistration,
      args,
    )).rejects.toThrow("Sign in");
    await expect(t.withIdentity({ email: "other@example.com" }).mutation(
      api.harnessWaiver.registrationAuthorization.authorizeRegistration,
      args,
    )).rejects.toThrow("not authorized");
  });

  it("issues a short-lived ticket only for the reviewer and bootstrap secret", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "reviewer@example.com" });
    await expect(t.mutation(
      api.harnessWaiver.registrationAuthorization.authorizeRegistration,
      { bootstrapSecret: "wrong", tokenHash: "b".repeat(64) },
    )).rejects.toThrow("bootstrap secret");

    await expect(t.mutation(
      api.harnessWaiver.registrationAuthorization.authorizeRegistration,
      { bootstrapSecret: "bootstrap-secret", tokenHash: "c".repeat(64) },
    )).resolves.toBeNull();
    const [authorization] = await t.run((ctx) =>
      ctx.db.query("harnessWaiverRegistrationAuthorization").take(1),
    );
    expect(authorization).toMatchObject({
      tokenHash: "c".repeat(64),
      reviewerEmail: "reviewer@example.com",
    });
    expect(authorization.expiresAt).toBeGreaterThan(Date.now());
    expect(authorization.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
