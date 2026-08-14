import { describe, expect, test } from "bun:test";

import {
  DIAGRAMS,
  bundleFileName,
  parseExportOptions,
} from "./architecture-diagram-config";

describe("architecture diagram export options", () => {
  test("preserves the existing Athena light export by default", () => {
    expect(parseExportOptions([])).toEqual({
      profile: "athena",
      themes: ["light"],
      bundleDirectory: undefined,
    });
  });

  test("exports both themes when creating a bundle", () => {
    expect(
      parseExportOptions([
        "--profile",
        "kwamina-fyi",
        "--bundle",
        "./dist/diagrams",
      ]),
    ).toEqual({
      profile: "kwamina-fyi",
      themes: ["light", "dark"],
      bundleDirectory: "./dist/diagrams",
    });
  });

  test("allows one explicit theme", () => {
    expect(parseExportOptions(["--theme", "dark"])).toMatchObject({
      profile: "athena",
      themes: ["dark"],
    });
  });

  test("rejects unknown profiles and flags", () => {
    expect(() => parseExportOptions(["--profile", "unknown"])).toThrow(
      "Unknown diagram profile",
    );
    expect(() => parseExportOptions(["--wat"])).toThrow("Unknown argument");
  });

  test("uses stable bundle filenames", () => {
    expect(bundleFileName(DIAGRAMS[0], "dark")).toBe(
      "harness-overview-dark.png",
    );
  });
});
