import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/shared-demo/SharedDemoRuntime.tsx"),
  "utf8",
);

describe("SharedDemoRuntime architecture", () => {
  it("leaves pending POS sale and closeout ingestion to the authoritative sync runtime", () => {
    expect(source).not.toContain("api.pos.public.sync.ingestLocalEvents");
    expect(source).not.toContain("store.listEvents()");
    expect(source).not.toContain("store.markEventsSynced");
    expect(source).not.toContain("store.markEventsNeedsReview");
  });
});
