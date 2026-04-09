import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MtnMomoView } from "./MtnMomoView";

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

describe("MtnMomoView", () => {
  beforeEach(() => {
    mockUpdateConfig.mockReset();
    mockActiveStore = {
      _id: "store-1",
      currency: "ghs",
      config: {},
    };
    window.scrollTo = vi.fn();
  });

  it("renders existing MTN account details and status metadata", () => {
    mockActiveStore = {
      ...mockActiveStore,
      config: {
        payments: {
          mtnMomo: {
            receivingAccounts: [
              {
                label: "Flagship store",
                walletNumber: "233000111222",
                businessName: "Flagship Retail",
                market: "Ghana",
                businessContact: "ops@flagship.example",
                isPrimary: true,
                status: "under_review",
                statusNote: "Compliance review in progress",
              },
            ],
          },
        },
      },
    };

    render(<MtnMomoView />);

    expect(screen.getByDisplayValue("Flagship store")).toBeInTheDocument();
    expect(screen.getByDisplayValue("233000111222")).toBeInTheDocument();
    expect(screen.getByText("Under review")).toBeInTheDocument();
    expect(screen.getByText("Compliance review in progress")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
  });

  it("saves multiple MTN accounts with a single primary account", async () => {
    const user = userEvent.setup();

    render(<MtnMomoView />);

    await user.click(screen.getByRole("button", { name: /add mtn account/i }));
    await user.click(screen.getByRole("button", { name: /add mtn account/i }));

    await user.type(screen.getAllByLabelText("Account label")[0], "Flagship store");
    await user.type(
      screen.getAllByLabelText("MTN merchant wallet or account number")[0],
      "233000111222",
    );
    await user.type(
      screen.getAllByLabelText("MTN account or business name")[0],
      "Flagship Retail",
    );
    await user.type(screen.getAllByLabelText("MTN market or country")[0], "Ghana");
    await user.type(
      screen.getAllByLabelText("Business contact for follow-up")[0],
      "ops@flagship.example",
    );

    await user.type(screen.getAllByLabelText("Account label")[1], "Backup store");
    await user.type(
      screen.getAllByLabelText("MTN merchant wallet or account number")[1],
      "256000333444",
    );
    await user.type(
      screen.getAllByLabelText("MTN account or business name")[1],
      "Flagship Retail Uganda",
    );
    await user.type(screen.getAllByLabelText("MTN market or country")[1], "Uganda");
    await user.type(
      screen.getAllByLabelText("Business contact for follow-up")[1],
      "finance@flagship.example",
    );

    await user.click(
      screen.getByRole("button", { name: /make account 2 primary/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /save mtn momo settings/i }),
    );

    expect(mockUpdateConfig).toHaveBeenCalledWith({
      storeId: "store-1",
      patch: {
        payments: {
          mtnMomo: {
            receivingAccounts: [
              {
                label: "Flagship store",
                walletNumber: "233000111222",
                businessName: "Flagship Retail",
                market: "Ghana",
                businessContact: "ops@flagship.example",
                isPrimary: false,
                status: "not_configured",
              },
              {
                label: "Backup store",
                walletNumber: "256000333444",
                businessName: "Flagship Retail Uganda",
                market: "Uganda",
                businessContact: "finance@flagship.example",
                isPrimary: true,
                status: "not_configured",
              },
            ],
          },
        },
      },
      successMessage: "MTN MoMo settings updated",
      errorMessage: "An error occurred while updating MTN MoMo settings",
    });
  });
});
