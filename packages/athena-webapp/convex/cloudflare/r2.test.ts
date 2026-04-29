import { describe, expect, it } from "vitest";
import { resolveR2ConfigFromEnv } from "./r2";

describe("resolveR2ConfigFromEnv", () => {
  it("reports missing R2 config before creating AWS credentials", () => {
    expect(() => resolveR2ConfigFromEnv({})).toThrow(
      "Missing Cloudflare R2 environment variables: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL",
    );
  });

  it("treats blank R2 credential values as missing", () => {
    expect(() =>
      resolveR2ConfigFromEnv({
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        R2_ACCESS_KEY_ID: "   ",
        R2_SECRET_ACCESS_KEY: "secret-key",
        R2_BUCKET: "bucket",
        R2_PUBLIC_URL: "https://images.example.com",
      }),
    ).toThrow(
      "Missing Cloudflare R2 environment variables: R2_ACCESS_KEY_ID",
    );
  });

  it("trims configured R2 values", () => {
    expect(
      resolveR2ConfigFromEnv({
        CLOUDFLARE_ACCOUNT_ID: " account-id ",
        R2_ACCESS_KEY_ID: " access-key ",
        R2_SECRET_ACCESS_KEY: " secret-key ",
        R2_BUCKET: " bucket ",
        R2_PUBLIC_URL: " https://images.example.com ",
      }),
    ).toEqual({
      accountId: "account-id",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      bucket: "bucket",
      publicUrl: "https://images.example.com",
      endpoint: "https://account-id.r2.cloudflarestorage.com",
    });
  });
});
