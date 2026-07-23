import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildSharedDemoSessionOrderUpdate } from "./OrderView";
import type { Id } from "~/convex/_generated/dataModel";

describe("buildSharedDemoSessionOrderUpdate", () => {
  it("records the completed message event when a demo pickup is completed", () => {
    expect(
      buildSharedDemoSessionOrderUpdate({
        currentTransitions: [
          {
            date: 100,
            status: "ready-for-pickup",
          },
        ],
        now: 200,
        update: { status: "picked-up" },
        user: {
          email: "operator@osustudio.com",
          id: "operator-id" as Id<"athenaUser">,
        },
      }),
    ).toEqual({
      didSendCompletedEmail: true,
      orderCompletedEmailSentAt: 200,
      status: "picked-up",
      transitions: [
        {
          date: 100,
          status: "ready-for-pickup",
        },
        {
          date: 200,
          signedInAthenaUser: {
            email: "operator@osustudio.com",
            id: "operator-id",
          },
          status: "picked-up",
        },
      ],
      updatedAt: 200,
    });
  });

  it("hides only the refund actions card once an order is refunded", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/orders/OrderView.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'const shouldShowRefundActions = order.status !== "refunded";',
    );
    expect(source).toContain("{shouldShowRefundActions && (");
    expect(source).toContain(
      '<PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_320px]">',
    );
  });
});
