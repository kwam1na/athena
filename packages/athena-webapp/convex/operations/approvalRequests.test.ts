import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { buildApprovalRequest } from "./approvalRequests";

describe("approval request helpers", () => {
  it("builds pending approval requests with timestamps", () => {
    const request = buildApprovalRequest({
      storeId: "store_1" as Id<"store">,
      requestType: "variance_review",
      subjectType: "register_session",
      subjectId: "register_session_1",
      reason: "Variance exceeded threshold",
    });

    expect(request).toMatchObject({
      storeId: "store_1",
      requestType: "variance_review",
      subjectType: "register_session",
      subjectId: "register_session_1",
      reason: "Variance exceeded threshold",
      status: "pending",
    });
    expect(request.createdAt).toEqual(expect.any(Number));
  });
});
