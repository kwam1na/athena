import { describe, expect, it } from "vitest";

import schema from "../schema";

function getTableIndexes(tableName: string) {
  return ((schema as any).tables[tableName]?.indexes ?? []) as Array<{
    indexDescriptor: string;
    fields: string[];
  }>;
}

describe("workflow trace schema indexes", () => {
  it("registers workflow trace, event, and lookup tables with additive indexes", () => {
    expect(getTableIndexes("workflowTrace")).toContainEqual({
      indexDescriptor: "by_storeId_traceId",
      fields: ["storeId", "traceId"],
    });
    expect(getTableIndexes("workflowTrace")).toContainEqual({
      indexDescriptor: "by_storeId_workflowType_primaryLookup",
      fields: ["storeId", "workflowType", "primaryLookupType", "primaryLookupValue"],
    });
    expect(getTableIndexes("workflowTraceEvent")).toContainEqual({
      indexDescriptor: "by_traceId_sequence",
      fields: ["traceId", "sequence"],
    });
    expect(getTableIndexes("workflowTraceLookup")).toContainEqual({
      indexDescriptor: "by_storeId_workflowType_lookup",
      fields: ["storeId", "workflowType", "lookupType", "lookupValue"],
    });
  });
});
