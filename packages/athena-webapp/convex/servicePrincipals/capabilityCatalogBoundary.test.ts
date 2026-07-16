import { describe, expect, it } from "vitest";

import { defineServicePrincipalCapabilityCatalog } from "./capabilities";

describe("service-principal capability catalog boundary", () => {
  it("matches only exact declared capability IDs", () => {
    const catalog = defineServicePrincipalCapabilityCatalog("fixture", [
      "fixture.application",
      "fixture.sync.read",
    ] as const);

    expect(catalog.has("fixture.application")).toBe(true);
    expect(catalog.has("fixture.sync.read")).toBe(true);

    for (const undeclared of [
      "fixture",
      "fixture.*",
      "fixture.application.read",
      "fixture.sync",
      "Fixture.application",
      "fixture.application ",
      "other.application",
    ]) {
      expect(catalog.has(undeclared), undeclared).toBe(false);
    }
  });

  it.each([
    ["blank consumer", "", ["fixture.application"]],
    ["uppercase consumer", "Fixture", ["Fixture.application"]],
    ["dotted consumer", "fixture.child", ["fixture.child.application"]],
    ["empty declaration", "fixture", []],
    ["bare consumer ID", "fixture", ["fixture"]],
    ["wildcard declaration", "fixture", ["fixture.*"]],
    ["uppercase segment", "fixture", ["fixture.Application"]],
    ["trailing separator", "fixture", ["fixture.application."]],
    ["foreign namespace", "fixture", ["other.application"]],
  ])("rejects %s", (_label, consumerId, capabilityIds) => {
    expect(() =>
      defineServicePrincipalCapabilityCatalog(consumerId, capabilityIds),
    ).toThrow(/capability_(?:catalog_invalid|namespace_mismatch)/);
  });

  it("snapshots and freezes declarations at definition time", () => {
    const declarations = ["fixture.application"];
    const catalog = defineServicePrincipalCapabilityCatalog(
      "fixture",
      declarations,
    );

    declarations.push("fixture.injected");

    expect(catalog.has("fixture.injected")).toBe(false);
    expect(catalog.capabilityIds).toEqual(["fixture.application"]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.capabilityIds)).toBe(true);
    expect(() =>
      (catalog.capabilityIds as unknown as string[]).push("fixture.injected"),
    ).toThrow();
  });
});
