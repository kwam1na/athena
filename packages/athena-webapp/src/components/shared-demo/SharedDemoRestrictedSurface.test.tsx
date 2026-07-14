import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifySharedDemoSurface,
  isSharedDemoRestrictedPath,
} from "./sharedDemoRestrictions";
import { ATHENA_VIEW_SURFACE_CATALOG } from "./sharedDemoSurfaceCatalog";

const AUTHED_ROUTES_ROOT = path.resolve(
  import.meta.dirname,
  "../../routes/_authed",
);

function listRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listRouteFiles(absolutePath);
    }
    if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) {
      return [];
    }
    return [path.relative(AUTHED_ROUTES_ROOT, absolutePath)];
  });
}

function routeFileToTemplate(routeFile: string) {
  const segments = routeFile
    .replace(/\.tsx$/, "")
    .replace(/(?:^|\/)index$/, "")
    .replace(/\.index$/, "")
    .split("/")
    .flatMap((segment) => segment.split("."))
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith("$") ? `:${segment.slice(1)}` : segment,
    );
  return `/${segments.join("/")}`;
}

function routeTemplateToPathname(routeTemplate: string) {
  return routeTemplate.replace(/:[^/]+/g, "sample");
}

describe("shared demo restricted surfaces", () => {
  it("blocks administration routes while preserving operating routes", () => {
    for (const path of [
      "/demo/store/central/members",
      "/demo/store/central/app-settings",
      "/demo/store/central/configuration",
      "/demo/store/central/bulk-operations",
      "/demo/store/central/products/new",
      "/demo/store/central/products/complimentary/new",
      "/demo/settings/organization",
    ]) {
      expect(isSharedDemoRestrictedPath(path), path).toBe(true);
    }
    for (const path of [
      "/demo/store/central/pos",
      "/demo/store/central/reports",
      "/demo/store/central/orders/ready",
      "/demo/store/central/operations/stock-adjustments",
      "/demo/store/central/operations/approvals",
      "/demo/store/central/operations/inventory-import",
      "/demo/store/central/operations/inventory-import/review",
      "/demo/store/central/procurement",
      "/demo/store/central/services/catalog-management",
      "/demo/store/central/pos/settings",
      "/demo/store/central/pos/terminals",
      "/demo/store/central/pos/terminals/terminal-1",
    ]) {
      expect(isSharedDemoRestrictedPath(path), path).toBe(false);
    }
  });

  it("classifies every authenticated application route", () => {
    const discoveredRouteTemplates = [
      ...new Set(listRouteFiles(AUTHED_ROUTES_ROOT).map(routeFileToTemplate)),
    ].sort();
    const declaredRouteTemplates = [
      ...new Set(
        Object.values(ATHENA_VIEW_SURFACE_CATALOG).flatMap(
          (surface) => surface.routes,
        ),
      ),
    ].sort();

    expect(declaredRouteTemplates).toEqual(discoveredRouteTemplates);
    expect(
      discoveredRouteTemplates.filter(
        (routeTemplate) =>
          classifySharedDemoSurface(
            routeTemplateToPathname(routeTemplate),
          ) === null,
      ),
    ).toEqual([]);
  });

  it("does not declare the same route template in multiple surfaces", () => {
    const declaredRouteTemplates = Object.values(
      ATHENA_VIEW_SURFACE_CATALOG,
    ).flatMap((surface) => surface.routes);

    expect(new Set(declaredRouteTemplates).size).toBe(
      declaredRouteTemplates.length,
    );
  });

  it("denies an unknown authenticated route by default", () => {
    expect(
      isSharedDemoRestrictedPath(
        "/demo/store/central/future-administration",
      ),
    ).toBe(true);
  });

  it("prefers a literal sensitive route over a parameterized detail route", () => {
    expect(
      classifySharedDemoSurface(
        "/demo/store/central/products/new",
      ),
    ).toBe("catalog.product_create");
    expect(
      classifySharedDemoSurface(
        "/demo/store/central/products/shampoo",
      ),
    ).toBe("catalog.products");
  });
});
