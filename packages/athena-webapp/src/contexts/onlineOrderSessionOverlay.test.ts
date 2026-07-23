import { describe, expect, it } from "vitest";

import { applySharedDemoSessionOrderPatches } from "./onlineOrderSessionOverlay";
import type { Id } from "~/convex/_generated/dataModel";

describe("online order session overlay", () => {
  it("applies shared demo order patches across the orders workspace", () => {
    const patches = new Map([
      [
        "order-1",
        {
          didSendCompletedEmail: true,
          orderCompletedEmailSentAt: 200,
          status: "picked-up",
        },
      ],
    ]);

    expect(
      applySharedDemoSessionOrderPatches(
        [
          {
            _creationTime: 1,
            _id: "order-1" as Id<"onlineOrder">,
            amount: 3500,
            status: "ready",
          },
        ],
        patches,
      ),
    ).toEqual([
      {
        _creationTime: 1,
        _id: "order-1",
        amount: 3500,
        didSendCompletedEmail: true,
        orderCompletedEmailSentAt: 200,
        status: "picked-up",
      },
    ]);
  });
});
