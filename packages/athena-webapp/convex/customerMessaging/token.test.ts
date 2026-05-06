import { describe, expect, it } from "vitest";

import { createReceiptShareToken, hashReceiptShareToken } from "./token";

describe("receipt share tokens", () => {
  it("creates 24-byte opaque hex tokens", () => {
    const token = createReceiptShareToken();

    expect(token).toMatch(/^[a-f0-9]{48}$/);
  });

  it("hashes receipt share tokens before persistence", async () => {
    await expect(hashReceiptShareToken("receipt-token")).resolves.toBe(
      "40f8ded8544da472d303d7871502cf82c2024a13b2074947a6e617ff0a6c7ac2",
    );
  });
});
