import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnlineOrderProvider, useOnlineOrder } from "./OnlineOrderContext";

const mocks = vi.hoisted(() => ({
  order: {
    _creationTime: 1,
    _id: "order-1",
    amount: 3500,
    customerDetails: {
      email: "customer@osustudio.com",
      firstName: "Abena",
      lastName: "Owusu",
      phoneNumber: "024 555 0142",
    },
    deliveryMethod: "pickup",
    orderNumber: "10427",
    status: "ready",
    storeId: "store-1",
    updatedAt: 1,
  },
  sharedDemo: null as null | {
    baselineVersion: number;
    kind: "shared_demo";
    nextHourlyRestoreAt: number;
    restore: { epoch: number; status: "ready" };
    storeId: string;
  },
}));

vi.mock("../components/orders/hooks/useGetActiveOnlineOrder", () => ({
  default: () => mocks.order,
}));

vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => mocks.sharedDemo,
}));

function SessionOrderProbe() {
  const { order, updateSessionOrder } = useOnlineOrder();

  return (
    <div>
      <p>{order?.status}</p>
      <button
        onClick={() =>
          updateSessionOrder({
            status: "picked-up",
          })
        }
        type="button"
      >
        Pick up
      </button>
    </div>
  );
}

describe("OnlineOrderProvider", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.order = {
      ...mocks.order,
      status: "ready",
    };
    mocks.sharedDemo = null;
  });

  it("keeps shared demo order interactions in session storage", async () => {
    const user = userEvent.setup();
    const setItemSpy = vi.spyOn(window.sessionStorage, "setItem");
    mocks.sharedDemo = {
      baselineVersion: 19,
      kind: "shared_demo",
      nextHourlyRestoreAt: Date.now() + 3_600_000,
      restore: { epoch: 7, status: "ready" },
      storeId: "store-1",
    };

    render(
      <OnlineOrderProvider>
        <SessionOrderProbe />
      </OnlineOrderProvider>,
    );

    expect(screen.getByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pick up" }));

    expect(screen.getByText("picked-up")).toBeInTheDocument();
    expect(setItemSpy).toHaveBeenCalledWith(
      "athena:shared-demo:online-order-session:v1:store-1:7:order-1",
      expect.stringContaining('"status":"picked-up"'),
    );
  });
});
