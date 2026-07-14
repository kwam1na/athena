import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/orders/OrdersView.tsx"),
  "utf8",
);

describe("OrdersView status workspaces", () => {
  it("shows each status workspace across the full order history by default", () => {
    expect(source).toContain('const initialTimeRange: TimeRange = "all";');
  });
});
