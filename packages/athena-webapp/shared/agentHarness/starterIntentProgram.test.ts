import { describe, expect, it } from "vitest";

import { renderStarterIntentProgram, STARTER_INTENT_SAMPLE_CONTEXT } from "./starterIntentProgram";

const SNAPSHOT_KEYS = ["operatingDate"] as const;

describe("renderStarterIntentProgram", () => {
  it("substitutes a shape-valid snapshot value into every placeholder occurrence", () => {
    const rendered = renderStarterIntentProgram(
      'const day = await athena.operations.storeDay.get({ operatingDate: "{{operatingDate}}" });\nconst sales = await athena.reports.daySales.get({ operatingDate: "{{operatingDate}}" });\nreturn { day, sales };',
      { operatingDate: "2026-08-21" },
      SNAPSHOT_KEYS,
    );
    expect(rendered).toMatchObject({ ok: true });
    if (!rendered.ok) return;
    expect(rendered.source).toContain('get({ operatingDate: "2026-08-21" })');
    expect(rendered.source).not.toContain("{{");
  });

  it("renders a template with no placeholders unchanged", () => {
    const rendered = renderStarterIntentProgram("return { fixed: true };", {}, SNAPSHOT_KEYS);
    expect(rendered).toEqual({ ok: true, source: "return { fixed: true };" });
  });

  it("fails closed on an unknown placeholder, a non-snapshot key, a missing value, and a malformed date", () => {
    const cases: readonly [string, Record<string, string>, string][] = [
      ['return "{{mystery}}";', { operatingDate: "2026-08-21" }, "mystery"],
      // storeName is real turn context but NOT a snapshot key of the binding.
      ['return "{{storeName}}";', { storeName: "Wigclub", operatingDate: "2026-08-21" }, "storeName"],
      ['return "{{operatingDate}}";', {}, "operatingDate"],
      ['return "{{operatingDate}}";', { operatingDate: "21/08/2026" }, "operatingDate"],
    ];
    for (const [template, context, path] of cases) {
      const rendered = renderStarterIntentProgram(template, context, SNAPSHOT_KEYS);
      expect(rendered.ok, template).toBe(false);
      if (rendered.ok) continue;
      expect(rendered.issues.some((issue) => issue.path === path), template).toBe(true);
    }
  });

  it("fails closed for a snapshot key with no shape-table entry", () => {
    // A future profile snapshotting a free-text key must not silently render
    // operator-supplied text into program source.
    const rendered = renderStarterIntentProgram('return "{{shiftLabel}}";', { shiftLabel: "morning" }, ["shiftLabel"]);
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(rendered.issues.some((issue) => issue.code === "shape_unknown")).toBe(true);
  });

  it("publishes shape-valid sample values for every shaped key, for conformance rendering", () => {
    for (const [key, sample] of Object.entries(STARTER_INTENT_SAMPLE_CONTEXT)) {
      const rendered = renderStarterIntentProgram(`return "{{${key}}}";`, { [key]: sample }, [key]);
      expect(rendered.ok, key).toBe(true);
    }
  });
});
