import { ZodError, z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  capitalizeFirstLetter,
  capitalizeWords,
  cn,
  currencyFormatter,
  getErrorForField,
  getRelativeTime,
  slugToWords,
  toSlug,
} from "./utils";

describe("utils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges class names with tailwind precedence", () => {
    expect(cn("px-2", false && "hidden", "px-4", "text-sm")).toBe(
      "px-4 text-sm"
    );
  });

  it("returns a field-specific zod issue when present", () => {
    const schema = z.object({
      profile: z.object({
        firstName: z.string().min(2, "First name is too short"),
      }),
    });

    const result = schema.safeParse({
      profile: {
        firstName: "A",
      },
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    expect(getErrorForField(result.error, "profile.firstName")?.message).toBe(
      "First name is too short"
    );
    expect(getErrorForField(result.error, "profile.lastName")).toBeUndefined();
    expect(getErrorForField(null, "profile.firstName")).toBeUndefined();
  });

  it("capitalizes strings consistently", () => {
    expect(capitalizeFirstLetter("athena")).toBe("Athena");
    expect(capitalizeFirstLetter("")).toBe("");
    expect(capitalizeWords("nATURAL black body wave")).toBe(
      "Natural Black Body Wave"
    );
  });

  it("formats and normalizes display strings", () => {
    expect(currencyFormatter("USD").format(1250)).toBe("$1,250");
    expect(toSlug("  Raw Hair Bundle! Deal  ")).toBe("raw-hair-bundle-deal");
    expect(slugToWords("same-day-delivery")).toBe("same day delivery");
  });

  it("formats relative time across seconds, minutes, hours, and days", () => {
    const now = Date.now();

    expect(getRelativeTime(now - 30_000)).toBe("30 seconds ago");
    expect(getRelativeTime(now - 5 * 60_000)).toBe("5 minutes ago");
    expect(getRelativeTime(now - 2 * 60 * 60_000)).toBe("2 hours ago");
    expect(getRelativeTime(now - 3 * 24 * 60 * 60_000)).toBe("3 days ago");
  });
});
