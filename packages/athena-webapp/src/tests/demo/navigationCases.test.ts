import { describe, expect, it } from "vitest";
import { ATHENA_VIEW_SURFACE_CATALOG, isSharedDemoSurfaceVisible } from "~/src/components/shared-demo/sharedDemoSurfaceCatalog";
import { demoNavigationCases } from "./navigationCases";

describe("live demo navigation coverage", () => {
  it("requires an explicit page expectation for every static application route", () => {
    const routes = Object.values(ATHENA_VIEW_SURFACE_CATALOG)
      .flatMap((surface) => surface.routes)
      .map((route) => route.replace(":orgUrlSlug", "demo").replace(":storeUrlSlug", "central"))
      .filter((route) => !route.includes(":"));
    expect(demoNavigationCases.map((entry) => entry.path).sort()).toEqual(routes.sort());
  });

  it("does not silently turn working demo pages into restricted-page successes", () => {
    for (const entry of demoNavigationCases) {
      expect(isSharedDemoSurfaceVisible(entry.path), entry.path).toBe(
        entry.text !== "This area is not available in the demo.",
      );
    }
  });
});
