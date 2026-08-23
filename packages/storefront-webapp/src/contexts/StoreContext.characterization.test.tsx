import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORGANIZATION_ID_KEY, STORE_ID_KEY } from "@/lib/constants";

const useGetStoreMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock("@/hooks/useGetStore", () => ({
  useGetStore: () => useGetStoreMock(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/components/states/maintenance/Maintenance", () => ({
  MaintenanceMode: () => <div data-testid="maintenance-mode" />,
}));

import { StoreProvider, useStoreContext } from "./StoreContext";

const storeFixture = {
  _id: "store_1",
  _creationTime: 1,
  organizationId: "org_1",
  name: "Wigclub",
  currency: "ghs",
};

const userFixture = {
  _id: "sfu_1",
  _creationTime: 1,
  email: "shopper@example.com",
  firstName: "Ama",
};

const Probe = () => {
  const { organizationId, storeId, store, user, userId, formatter, navBarClassname, isNavbarShowing } =
    useStoreContext();

  return (
    <div>
      <span data-testid="organization-id">{organizationId}</span>
      <span data-testid="store-id">{storeId}</span>
      <span data-testid="store-name">{store?.name}</span>
      <span data-testid="user-email">{user?.email}</span>
      <span data-testid="user-id">{String(userId)}</span>
      <span data-testid="formatted">{formatter.format(12.5)}</span>
      <span data-testid="navbar-class">{navBarClassname}</span>
      <span data-testid="navbar-showing">{String(isNavbarShowing)}</span>
    </div>
  );
};

describe("StoreContext loads store and user data", () => {
  beforeEach(() => {
    localStorage.clear();
    useGetStoreMock.mockReset();
    useAuthMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("exposes the loaded store and signed-in user through context", () => {
    useGetStoreMock.mockReturnValue({ data: storeFixture, isLoading: false });
    useAuthMock.mockReturnValue({
      user: userFixture,
      userId: userFixture._id,
      guestId: undefined,
    });

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    expect(screen.getByTestId("organization-id")).toHaveTextContent("org_1");
    expect(screen.getByTestId("store-id")).toHaveTextContent("store_1");
    expect(screen.getByTestId("store-name")).toHaveTextContent("Wigclub");
    expect(screen.getByTestId("user-email")).toHaveTextContent("shopper@example.com");
    expect(screen.getByTestId("user-id")).toHaveTextContent("sfu_1");
    expect(screen.getByTestId("navbar-showing")).toHaveTextContent("true");
    expect(screen.getByTestId("navbar-class")).toHaveTextContent(
      "w-full flex flex-col items-center justify-center py-3 px-6 xl:px-0",
    );
  });

  it("builds the currency formatter from the loaded store currency", () => {
    useGetStoreMock.mockReturnValue({ data: storeFixture, isLoading: false });
    useAuthMock.mockReturnValue({ user: undefined, userId: undefined, guestId: undefined });

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    expect(screen.getByTestId("formatted").textContent).toBe("GH₵12.5");
  });

  it("persists organization and store identifiers for later reads", () => {
    useGetStoreMock.mockReturnValue({ data: storeFixture, isLoading: false });
    useAuthMock.mockReturnValue({ user: undefined, userId: undefined, guestId: undefined });

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    expect(localStorage.getItem(ORGANIZATION_ID_KEY)).toBe("org_1");
    expect(localStorage.getItem(STORE_ID_KEY)).toBe("store_1");
  });

  it("falls back to the guest identifier when there is no signed-in user", () => {
    useGetStoreMock.mockReturnValue({ data: storeFixture, isLoading: false });
    useAuthMock.mockReturnValue({
      user: undefined,
      userId: undefined,
      guestId: "guest_1",
    });

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    expect(screen.getByTestId("user-id")).toHaveTextContent("guest_1");
    expect(screen.getByTestId("user-email")).toBeEmptyDOMElement();
  });

  it("renders maintenance mode once loading settles with no store", () => {
    useGetStoreMock.mockReturnValue({ data: undefined, isLoading: false });
    useAuthMock.mockReturnValue({ user: undefined, userId: undefined, guestId: undefined });

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    expect(screen.getByTestId("maintenance-mode")).toBeInTheDocument();
    expect(screen.queryByTestId("store-id")).toBeNull();
  });

  it("keeps rendering children while the store is still loading", () => {
    useGetStoreMock.mockReturnValue({ data: undefined, isLoading: true });
    useAuthMock.mockReturnValue({ user: undefined, userId: undefined, guestId: undefined });

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    expect(screen.queryByTestId("maintenance-mode")).toBeNull();
    expect(screen.getByTestId("store-id")).toBeEmptyDOMElement();
    // Defaults to the storefront fallback currency when no store has loaded.
    expect(screen.getByTestId("formatted").textContent).toBe("$12.5");
  });

  it("throws when the hook is used outside the provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(
      "useStoreContext must be used within a StoreProvider",
    );

    consoleError.mockRestore();
  });
});
