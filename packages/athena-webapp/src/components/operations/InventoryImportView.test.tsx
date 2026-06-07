import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok } from "~/shared/commandResult";
import { InventoryImportView } from "./InventoryImportView";

const mockedHooks = vi.hoisted(() => ({
  latestReviewVersion: null as unknown,
  saveReviewVersion: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useGetActiveStore: vi.fn(),
  useGetTerminal: vi.fn(),
  useOptionalManagerElevation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockedHooks.useMutation(...args),
  useQuery: (...args: unknown[]) => mockedHooks.useQuery(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
}));

vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => vi.fn(),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: mockedHooks.useGetActiveStore,
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: mockedHooks.useGetTerminal,
}));

vi.mock("@/contexts/ManagerElevationContext", () => ({
  useOptionalManagerElevation: mockedHooks.useOptionalManagerElevation,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

function buildCsvRow(index: number) {
  return `Product ${index},SKU-${index},${index * 10},${index}`;
}

describe("InventoryImportView", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    mockedHooks.saveReviewVersion.mockReset();
    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.latestReviewVersion = null;
    mockedHooks.useMutation.mockReturnValue(mockedHooks.saveReviewVersion);
    mockedHooks.useQuery.mockReturnValue(null);
    mockedHooks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1", name: "Wigclub" },
    });
    mockedHooks.useGetTerminal.mockReturnValue({ _id: "terminal-1" });
    mockedHooks.useOptionalManagerElevation.mockReturnValue(null);
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      hasFullAdminAccess: true,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
  });

  it("pages through every parsed preview row with the shared list pagination", async () => {
    const user = userEvent.setup();
    const content = [
      "product_name,sku,price,qty",
      ...Array.from({ length: 30 }, (_, index) => buildCsvRow(index + 1)),
    ].join("\n");

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: { value: content },
    });

    await waitFor(() => {
      expect(screen.getByText("30 rows ready")).toBeInTheDocument();
    });
    expect(screen.getByText("Product 1")).toBeInTheDocument();
    expect(screen.getByText("Product 25")).toBeInTheDocument();
    expect(screen.queryByText("Product 26")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-25 of 30")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(screen.getByText("Product 26")).toBeInTheDocument();
    expect(screen.getByText("Product 30")).toBeInTheDocument();
    expect(screen.queryByText("Product 1")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 26-30 of 30")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("hides SKU and category by default and lets operators reveal columns", async () => {
    const user = userEvent.setup();

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: [
          "product_name,sku,barcode,category,price,qty",
          "Comb,COMB-1,123,Accessories,25,4",
        ].join("\n"),
      },
    });

    await waitFor(() => {
      expect(screen.getByText("1 row ready")).toBeInTheDocument();
    });
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Barcode")).toBeInTheDocument();
    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(screen.getByText("Qty")).toBeInTheDocument();
    expect(screen.queryByText("SKU")).not.toBeInTheDocument();
    expect(screen.queryByText("COMB-1")).not.toBeInTheDocument();
    expect(screen.queryByText("Category")).not.toBeInTheDocument();
    expect(screen.queryByText("Accessories")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "SKU" }));

    expect(screen.getByText("SKU")).toBeInTheDocument();
    expect(screen.getByText("COMB-1")).toBeInTheDocument();
    expect(screen.queryByText("Category")).not.toBeInTheDocument();
    expect(screen.queryByText("Accessories")).not.toBeInTheDocument();
  });

  it("saves the current raw export as a server review version", async () => {
    const user = userEvent.setup();
    mockedHooks.saveReviewVersion.mockResolvedValue(
      ok({
        _id: "review-version-3",
        createdAt: Date.UTC(2026, 5, 7, 12),
        fileName: "manual.csv",
        importKey: "review-key",
        issueCount: 0,
        rowCount: 1,
        sourceFormat: "csv",
        versionNumber: 3,
      }),
    );

    render(<InventoryImportView />);

    const content = ["product_name,sku,price,qty", "Comb,COMB-1,25,4"].join("\n");
    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: { value: content },
    });
    await waitFor(() => {
      expect(screen.getByText("1 row ready")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save review version" }));

    await waitFor(() => {
      expect(mockedHooks.saveReviewVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "manual.csv",
          issueCount: 0,
          rawContent: content,
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      );
    });
    expect(screen.getByText(/Last saved: version 3/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import inventory" })).not.toBeInTheDocument();
  });

  it("loads the latest server review version into the preview", async () => {
    const user = userEvent.setup();
    mockedHooks.useQuery.mockReturnValue({
      _id: "review-version-4",
      createdAt: Date.UTC(2026, 5, 7, 13),
      fileName: "saved-products.csv",
      importKey: "review-key",
      issueCount: 0,
      notes: "Review before applying.",
      rawContent: ["product_name,sku,price,qty", "Saved Comb,SAVED-1,40,6"].join("\n"),
      rowCount: 1,
      sourceFormat: "csv",
      versionNumber: 4,
    });

    render(<InventoryImportView />);

    expect(screen.getByText(/Version 4 - 1 row - 0 issues/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load saved version" }));

    expect(screen.getByLabelText("Raw export")).toHaveValue(
      ["product_name,sku,price,qty", "Saved Comb,SAVED-1,40,6"].join("\n"),
    );
    expect(screen.getByLabelText("Notes")).toHaveValue("Review before applying.");
    expect(screen.getByText("Saved Comb")).toBeInTheDocument();
  });

  it("uses the manager elevation terminal when saving without a terminal hook value", async () => {
    const user = userEvent.setup();
    mockedHooks.useGetTerminal.mockReturnValue(null);
    mockedHooks.useOptionalManagerElevation.mockReturnValue({
      activeElevation: {
        displayName: "Kwamina Mensah",
        elevationId: "elevation-1",
        expiresAt: Date.now() + 60_000,
        staffProfileId: "staff-manager-1",
        startedAt: Date.now(),
        terminalId: "terminal-elevated-1",
      },
    });
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      hasFullAdminAccess: false,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
    mockedHooks.saveReviewVersion.mockResolvedValue(
      ok({
        _id: "review-version-5",
        createdAt: Date.UTC(2026, 5, 7, 14),
        fileName: "manual.csv",
        importKey: "review-key",
        issueCount: 0,
        rowCount: 1,
        sourceFormat: "csv",
        versionNumber: 5,
      }),
    );

    render(<InventoryImportView />);

    const content = ["product_name,sku,price,qty", "Comb,COMB-1,25,4"].join("\n");
    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: { value: content },
    });
    await waitFor(() => {
      expect(screen.getByText("1 row ready")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save review version" }));

    await waitFor(() => {
      expect(mockedHooks.saveReviewVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: "store-1",
          terminalId: "terminal-elevated-1",
        }),
      );
    });
  });
});
