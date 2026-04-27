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

function renderAttribution(
  customerInfo?: Partial<CustomerInfo>,
  disabled = false,
) {
  const setCustomerInfo = vi.fn();
  const onCustomerCommitted = vi.fn().mockResolvedValue(undefined);

  render(
    <RegisterCustomerAttribution
      disabled={disabled}
      customerInfo={{
        customerProfileId: customerInfo?.customerProfileId,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
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

  it("disables the entire attribution flow when active store session is not active", async () => {
    const user = userEvent.setup();

    renderAttribution(undefined, true);

    const findOrAddButton = screen.getByRole("button", {
      name: "Find or add customer",
    });
    expect(findOrAddButton).toBeDisabled();

    await user.click(findOrAddButton);
    expect(
      screen.queryByPlaceholderText("Name, phone, or email"),
    ).not.toBeInTheDocument();
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
      customerProfileId: undefined,
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
      customerProfileId: undefined,
      name: "Kojo Mensah",
      email: "",
      phone: "",
    };
    expect(setCustomerInfo).toHaveBeenCalledWith(expectedCustomer);
    expect(onCustomerCommitted).toHaveBeenCalledWith(expectedCustomer);
  });

  it("submits customer creation when Enter is pressed in the search field", async () => {
    const user = userEvent.setup();
    const { setCustomerInfo, onCustomerCommitted } = renderAttribution();

    await user.click(
      screen.getByRole("button", { name: "Find or add customer" }),
    );
    const searchInput = screen.getByPlaceholderText("Name, phone, or email");
    await user.type(searchInput, "Kojo Mensah");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        storeId: mockActiveStore._id,
        name: "Kojo Mensah",
      });
    });

    const expectedCustomer = {
      customerProfileId: undefined,
      name: "Kojo Mensah",
      email: "",
      phone: "",
    };
    expect(setCustomerInfo).toHaveBeenCalledWith(expectedCustomer);
    expect(onCustomerCommitted).toHaveBeenCalledWith(expectedCustomer);
  });

  it("creates reusable attribution when the search input is an email", async () => {
    const user = userEvent.setup();
    renderAttribution();

    await user.click(
      screen.getByRole("button", { name: "Find or add customer" }),
    );
    await user.type(
      screen.getByPlaceholderText("Name, phone, or email"),
      "kojo@example.com",
    );
    await user.click(screen.getByRole("button", { name: 'Add "kojo@example.com"' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        storeId: mockActiveStore._id,
        name: "kojo@example.com",
        email: "kojo@example.com",
        phone: undefined,
      });
    });
  });

  it("creates reusable attribution when the search input is a phone number", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({
      kind: "ok",
      data: {
        _id: "customer_new",
        name: "",
        email: undefined,
        phone: "+233 20 000 0000",
      },
    });
    renderAttribution();

    await user.click(
      screen.getByRole("button", { name: "Find or add customer" }),
    );
    await user.type(
      screen.getByPlaceholderText("Name, phone, or email"),
      "+233 20 000 0000",
    );
    await user.click(
      screen.getByRole("button", { name: 'Add "+233 20 000 0000"' }),
    );

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        storeId: mockActiveStore._id,
        name: "",
        email: undefined,
        phone: "+233 20 000 0000",
      });
    });

    expect(screen.queryByText("No matching customer found.")).not.toBeInTheDocument();
  });

  it("collapses selected attribution to name and one secondary identifier", async () => {
    const user = userEvent.setup();
    const { setCustomerInfo, onCustomerCommitted } = renderAttribution({
      customerProfileId: "profile_1" as CustomerInfo["customerProfileId"],
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
      customerProfileId: undefined,
      name: "",
      email: "",
      phone: "",
    };
    expect(setCustomerInfo).toHaveBeenCalledWith(emptyCustomer);
    expect(onCustomerCommitted).toHaveBeenCalledWith(emptyCustomer);
  });

  it("ignores stale created customer results after the lookup query changes", async () => {
    const user = userEvent.setup();
    const addCustomer = deferred<Awaited<ReturnType<typeof mockCreate>>>();
    mockCreate.mockReturnValue(addCustomer.promise);
    const { setCustomerInfo, onCustomerCommitted } = renderAttribution();

    await user.click(
      screen.getByRole("button", { name: "Find or add customer" }),
    );
    await user.type(
      screen.getByPlaceholderText("Name, phone, or email"),
      "Kojo Mensah",
    );
    await user.click(screen.getByRole("button", { name: 'Add "Kojo Mensah"' }));
    await user.type(screen.getByPlaceholderText("Name, phone, or email"), " Jr");

    addCustomer.resolve({
      kind: "ok",
      data: {
        _id: "customer_stale",
        name: "Kojo Mensah",
        email: undefined,
        phone: undefined,
        customerProfileId: "profile_stale",
      },
    });

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        storeId: mockActiveStore._id,
        name: "Kojo Mensah",
      });
    });
    expect(setCustomerInfo).not.toHaveBeenCalled();
    expect(onCustomerCommitted).not.toHaveBeenCalled();
  });
});
