import { describe, expect, it } from "vitest";
import { createSharedDemoPeriodSkus } from "@/components/shared-demo/sharedDemoReportsFixture";
import { weekPeriodKey } from "~/shared/reportsContract";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import { demoJourneyDate } from "./journeyDate";

describe("demo journey dates", () => {
  it.each(["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2027-01-01"])(
    "selects a historical week with sales for every product on %s",
    (today) => {
      const date = demoJourneyDate(today);
      expect(date < today).toBe(true);
      expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(1);
      const report = createSharedDemoPeriodSkus({ today, periodKey: weekPeriodKey(date), sortBy: "revenue" });
      expect(report.rows.map((row) => row.productSkuId).sort()).toEqual(
        SHARED_DEMO_PRODUCTS.map((product) => `shared-demo-sku-${product.slug}`).sort(),
      );
    },
  );
});
