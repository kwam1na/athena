import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerInfo } from "@/components/pos/types";
import type { POSCustomerSummary } from "~/types";
import { RegisterCustomerAttribution } from "./RegisterCustomerAttribution";

const mockSearch = vi.fn();
const mockCreate = vi.fn();
const mockActiveStore = {
  _id: "store_1",
  currency: "GHS",
};

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: mockActiveStore }),
}));

vi.mock("@/lib/pos/infrastructure/convex/customerGateway", () => ({
  useConvexPosCustomerSearch: (
    storeId: string | undefined,
    searchQuery: string,
  ) => mockSearch(storeId, searchQuery),
  useConvexPosCustomerCreate: () => mockCreate,
}));

function makeCustomer(
  overrides: Partial<POSCustomerSummary> = {},
): POSCustomerSummary {
  return {
    _id: "customer_1" as POSCustomerSummary["_id"],
    _creationTime: 1,
    name: "Ama Serwa",
    email: "ama@example.com",
    phone: "+233 20 000 0000",
    totalSpent: 0,
    transactionCount: 0,
    lastTransactionAt: undefined,
    ...overrides,
  };
}

function renderAttribution(customerInfo?: Partial<CustomerInfo>) {
  const setCustomerInfo = vi.fn();
  const onCustomerCommitted = vi.fn().mockResolvedValue(undefined);

  render(
    <RegisterCustomerAttribution
      customerInfo={{
        customerId: customerInfo?.customerId,
        name: customerInfo?.name ?? "",
        email: customerInfo?.email ?? "",
        phone: customerInfo?.phone ?? "",
      }}
      onCustomerCommitted={onCustomerCommitted}
      setCustomerInfo={setCustomerInfo}
    />,
  );

  return {
    setCustomerInfo,
    onCustomerCommitted,
  };
}

describe("RegisterCustomerAttribution", () => {
  beforeEach(() => {
    mockSearch.mockReturnValue([]);
    mockCreate.mockResolvedValue({
      kind: "ok",
      data: {
        _id: "customer_new",
        name: "Kojo Mensah",
        email: undefined,
        phone: undefined,
      },
    });
  });

  it("renders a compact walk-in state with one find or add action", async () => {
    const user = userEvent.setup();

    renderAttribution();

    expect(screen.getByText("Walk-in customer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Find or add customer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Name, phone, or email"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Find or add customer" }),
    );

    expect(
      screen.getByPlaceholderText("Name, phone, or email"),
    ).toBeInTheDocument();
  });

  it("starts expanded lookup by name, phone, or email and offers results plus add from search", async () => {
    const user = userEvent.setup();
    mockSearch.mockReturnValue([makeCustomer()]);

    const { setCustomerInfo, onCustomerCommitted } = renderAttribution();

    await user.click(
      screen.getByRole("button", { name: "Find or add customer" }),
    );
    await user.type(screen.getByPlaceholderText("Name, phone, or email"), "ama");

    expect(mockSearch).toHaveBeenLastCalledWith(mockActiveStore._id, "ama");
    expect(
      screen.getByRole("button", { name: /Ama Serwa/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'Add "ama"' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Ama Serwa/ }));

    const expectedCustomer = {
      customerId: "customer_1",
      name: "Ama Serwa",
      email: "ama@example.com",
      phone: "+233 20 000 0000",
    };
    expect(setCustomerInfo).toHaveBeenCalledWith(expectedCustomer);
    expect(onCustomerCommitted).toHaveBeenCalledWith(expectedCustomer);
  });

  it("adds a customer from the current search", async () => {
    const user = userEvent.setup();
    const { setCustomerInfo, onCustomerCommitted } = renderAttribution();

    await user.click(
      screen.getByRole("button", { name: "Find or add customer" }),
    );
    await user.type(
      screen.getByPlaceholderText("Name, phone, or email"),
      "Kojo Mensah",
    );
    await user.click(screen.getByRole("button", { name: 'Add "Kojo Mensah"' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        storeId: mockActiveStore._id,
        name: "Kojo Mensah",
      });
    });

    const expectedCustomer = {
      customerId: "customer_new",
      name: "Kojo Mensah",
      email: "",
      phone: "",
    };
    expect(setCustomerInfo).toHaveBeenCalledWith(expectedCustomer);
    expect(onCustomerCommitted).toHaveBeenCalledWith(expectedCustomer);
  });

  it("collapses selected attribution to name and one secondary identifier", async () => {
    const user = userEvent.setup();
    const { setCustomerInfo, onCustomerCommitted } = renderAttribution({
      customerId: "customer_1" as CustomerInfo["customerId"],
      name: "Ama Serwa",
      email: "ama@example.com",
      phone: "+233 20 000 0000",
    });

    expect(screen.getByText("Ama Serwa")).toBeInTheDocument();
    expect(screen.getByText("ama@example.com")).toBeInTheDocument();
    expect(screen.queryByText("+233 20 000 0000")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change customer" }));
    expect(
      screen.getByPlaceholderText("Name, phone, or email"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear customer" }));

    const emptyCustomer = {
      customerId: undefined,
      name: "",
      email: "",
      phone: "",
    };
    expect(setCustomerInfo).toHaveBeenCalledWith(emptyCustomer);
    expect(onCustomerCommitted).toHaveBeenCalledWith(emptyCustomer);
  });
});
