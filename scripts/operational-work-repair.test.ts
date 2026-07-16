import { describe, expect, it } from "vitest";

import {
  buildOperationalWorkRepairInvocation,
  parseOperationalWorkRepairArgs,
} from "./operational-work-repair";

describe("operational work repair CLI", () => {
  it("requires audited create evidence and targets the internal repair command", () => {
    const parsed = parseOperationalWorkRepairArgs([
      "create",
      "--organization-id",
      "org-1",
      "--store-id",
      "store-1",
      "--group-key",
      "synced_sale_inventory_review:store-1:sku-1",
      "--initiator",
      "support@example.com",
      "--reason",
      "Resolve oversized work",
      "--support-ticket",
      "SUP-123",
    ]);

    expect(buildOperationalWorkRepairInvocation(parsed)).toEqual([
      "bunx",
      "convex",
      "run",
      "operations/oversizedOperationalWorkRepair:createRepair",
      JSON.stringify(parsed.payload),
    ]);
  });

  it("rejects repair commands without a support ticket", () => {
    expect(() =>
      parseOperationalWorkRepairArgs([
        "resume",
        "--repair-id",
        "repair-1",
        "--initiator",
        "support@example.com",
        "--reason",
        "Resume after validation",
      ]),
    ).toThrow("Missing required --support-ticket.");
  });
});
