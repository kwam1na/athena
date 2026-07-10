import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

describe("Athena user identity writers", () => {
  it.each(["./auth.ts", "./inviteCode.ts"])(
    "stores the normalized lookup key in %s",
    (file) => {
      const writer = source(file);
      expect(writer).toContain("normalizeAthenaUserEmail");
      expect(writer).toContain("findAthenaUserByEmailWithCtx");
      expect(writer).toContain("normalizedEmail,");
    },
  );
});
