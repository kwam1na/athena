import { describe, expect, it } from "vitest";

import { formatRegisterSessionCode } from "./registerSessionCode";

describe("formatRegisterSessionCode", () => {
  it("formats register session ids as the shared six-character operator code", () => {
    expect(
      formatRegisterSessionCode("th75c0qqzpk4n5mz2p8rrr5b9x8980zc"),
    ).toBe("8980ZC");
  });

  it("ignores blank session ids", () => {
    expect(formatRegisterSessionCode("   ")).toBeUndefined();
    expect(formatRegisterSessionCode(null)).toBeUndefined();
  });
});
