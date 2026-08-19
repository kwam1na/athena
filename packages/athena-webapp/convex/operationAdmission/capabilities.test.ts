import { describe, expect, it } from "vitest";

import { resolveOperationCapabilities } from "./capabilities";
import type { OperationDynamicCapability } from "./types";

const batchCapability: OperationDynamicCapability = {
  kind: "dynamic",
  candidates: ["pos.sync.write", "cash.control.write", "expense.manage"],
  resolve: (args) => (args.kinds as string[]) as never,
};

describe("dynamic set capability", () => {
  it("returns the single declared capability unchanged", () => {
    expect(
      resolveOperationCapabilities("daily_operations.write", {}),
    ).toEqual({ kind: "resolved", capabilities: ["daily_operations.write"] });
  });

  it("classifies the whole batch at once, with all-of semantics", () => {
    expect(
      resolveOperationCapabilities(batchCapability, {
        kinds: ["pos.sync.write", "cash.control.write"],
      }),
    ).toEqual({
      kind: "resolved",
      capabilities: ["pos.sync.write", "cash.control.write"],
    });
  });

  it("reports a resolved capability outside the declared candidates", () => {
    expect(
      resolveOperationCapabilities(batchCapability, {
        kinds: ["pos.sync.write", "administration.destructive"],
      }),
    ).toEqual({
      kind: "out_of_candidates",
      capabilities: ["administration.destructive"],
    });
  });
});
