import { describe, expect, it } from "vitest";

import { canonicalize } from "./agentRuntime";
import { computeSha256Digest, sha256Hex } from "./digest";

describe("sha256 digest (synchronous, environment-neutral)", () => {
  it("matches the published SHA-256 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    // One million 'a's exercises multi-block padding.
    expect(sha256Hex("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("hashes UTF-8 bytes, not UTF-16 code units", () => {
    expect(sha256Hex("é")).toBe(sha256Hex(new TextEncoder().encode("é")));
    expect(sha256Hex("é")).toBe(sha256Hex(new Uint8Array([0xc3, 0xa9])));
    expect(sha256Hex("🧾")).toBe(sha256Hex(new Uint8Array([0xf0, 0x9f, 0xa7, 0xbe])));
    expect(sha256Hex("🧾")).toHaveLength(64);
  });

  it("labels canonical JSON so key order and undefined never change the digest", () => {
    const a = computeSha256Digest({ b: 1, a: [1, { z: 2, y: undefined }] });
    const b = computeSha256Digest({ a: [1, { z: 2 }], b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a).toBe(`sha256:${sha256Hex(JSON.stringify(canonicalize({ b: 1, a: [1, { z: 2 }] })))}`);
    expect(computeSha256Digest({ a: 1 })).not.toBe(computeSha256Digest({ a: 2 }));
  });
});
