import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MaintenanceView } from "./MaintenanceView";

const mockUpdateConfig = vi.fn();
let mockActiveStore: any = null;

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: mockActiveStore,
  }),
}));

vi.mock("../../homepage/MaintenanceMessageEditor", () => ({
  MaintenanceMessageEditor: () => <div>Maintenance editor</div>,
}));

vi.mock("../hooks/useStoreConfigUpdate", () => ({
  useStoreConfigUpdate: () => ({
    updateConfig: mockUpdateConfig,
    isUpdating: false,
  }),
}));

describe("MaintenanceView", () => {
  beforeEach(() => {
    mockUpdateConfig.mockReset();
    mockActiveStore = {
      _id: "store-1",
      config: {},
    };
    window.scrollTo = vi.fn();
  });

  it("restores the maintenance toggle when the shared config update reports an error", async () => {
    const user = userEvent.setup();
    mockUpdateConfig.mockImplementation(async ({ onError }) => {
      onError?.();
    });

    render(<MaintenanceView />);

    const maintenanceSwitch = screen.getByLabelText("Maintenance mode");
    expect(maintenanceSwitch).toHaveAttribute("aria-checked", "false");

    await user.click(maintenanceSwitch);

    expect(mockUpdateConfig).toHaveBeenCalledWith({
      storeId: "store-1",
      patch: {
        operations: {
          availability: {
            inMaintenanceMode: true,
          },
        },
      },
      successMessage: "Store set to maintenance mode",
      errorMessage: "An error occurred while updating store availability",
      onError: expect.any(Function),
    });

    await waitFor(() =>
      expect(maintenanceSwitch).toHaveAttribute("aria-checked", "false"),
    );
  });
});
