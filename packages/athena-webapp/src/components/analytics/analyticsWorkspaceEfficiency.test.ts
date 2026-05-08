import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("analytics workspace query efficiency", () => {
  it("uses one workspace summary query instead of child fan-out subscriptions", () => {
    const viewSource = readSource("src/components/analytics/AnalyticsView.tsx");
    const usersSource = readSource(
      "src/components/analytics/AnalyticsCombinedUsers.tsx",
    );
    const productsSource = readSource(
      "src/components/analytics/AnalyticsProducts.tsx",
    );

    expect(viewSource).toContain("getWorkspaceSummary");
    expect(viewSource).not.toContain("analytics.getAll");
    expect(viewSource).not.toContain("getUniqueVisitorsForDay");
    expect(viewSource).not.toContain("getActiveCheckoutSessionsForStore");
    expect(usersSource).not.toContain("useQuery");
    expect(productsSource).not.toContain("useQuery");
    expect(productsSource).not.toContain("batchGet");
  });

  it("keeps workspace aggregation in indexed Convex reads", () => {
    const analyticsSource = readSource("convex/storeFront/analytics.ts");
    const schemaSource = readSource("convex/schema.ts");

    expect(analyticsSource).toContain("export const getWorkspaceSummary");
    expect(analyticsSource).toContain('ctx.db.normalizeId("storeFrontUser"');
    expect(analyticsSource).toContain('ctx.db.normalizeId("guest"');
    expect(analyticsSource).toContain(
      '.withIndex("by_storeId_hasCompletedCheckoutSession"',
    );
    expect(analyticsSource).not.toContain('ctx.db.get(shopper.userId as');
    expect(analyticsSource).not.toContain(
      'shopper.userId as Id<"storeFrontUser">',
    );
    expect(schemaSource).toContain(
      '.index("by_storeId_hasCompletedCheckoutSession"',
    );
  });
});
