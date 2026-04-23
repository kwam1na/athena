import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FulfillmentView } from "./FulfillmentView";

const mockUpdateConfig = vi.fn();
let mockActiveStore: any = null;

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: mockActiveStore,
  }),
}));

vi.mock("../hooks/useStoreConfigUpdate", () => ({
  useStoreConfigUpdate: () => ({
    updateConfig: mockUpdateConfig,
    isUpdating: false,
  }),
}));

describe("FulfillmentView", () => {
  beforeEach(() => {
    mockUpdateConfig.mockReset();
    mockActiveStore = {
      _id: "store-1",
      config: {},
    };
    window.scrollTo = vi.fn();
  });

  it("restores the delivery toggle when the shared config update reports an error", async () => {
    const user = userEvent.setup();
    mockUpdateConfig.mockImplementation(async ({ onError }) => {
      onError?.();
    });

    render(<FulfillmentView />);

    const deliverySwitch = screen.getByLabelText("Enable delivery");
    expect(deliverySwitch).toHaveAttribute("aria-checked", "true");

    await user.click(deliverySwitch);

    expect(mockUpdateConfig).toHaveBeenCalledWith({
      storeId: "store-1",
      patch: {
        commerce: {
          fulfillment: {
            enableDelivery: false,
          },
        },
      },
      successMessage: "Delivery has been disabled",
      errorMessage: "An error occurred while updating delivery settings",
      onError: expect.any(Function),
    });

    await waitFor(() =>
      expect(deliverySwitch).toHaveAttribute("aria-checked", "true"),
    );
  });
});
