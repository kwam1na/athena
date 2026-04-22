import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("workflow trace core and public query usage", () => {
  it("uses indexed trace, event, and lookup access patterns", () => {
    const coreSource = getSource("./core.ts");
    const publicSource = getSource("./public.ts");

    expect(coreSource).toContain('.withIndex("by_storeId_traceId"');
    expect(coreSource).toContain('.withIndex("by_storeId_workflowType_lookup"');
    expect(coreSource).toContain('.withIndex("by_traceId_sequence"');

    expect(publicSource).toContain('.withIndex("by_storeId_traceId"');
    expect(publicSource).toContain('.withIndex("by_traceId_sequence"');
    expect(publicSource).toContain('.withIndex("by_storeId_workflowType_lookup"');
    expect(publicSource).toContain(
      "normalizeWorkflowTraceLookupValue(args.lookupValue)",
    );
  });
});
