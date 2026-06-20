import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, userError } from "~/shared/commandResult";
import { InventoryImportView } from "./InventoryImportView";

const mockedHooks = vi.hoisted(() => ({
  inventorySkuContext: [] as unknown[],
  latestReviewVersion: null as unknown,
  navigate: vi.fn(),
  saveReviewVersion: vi.fn(),
  stageReviewRowsForPos: vi.fn(),
  search: {} as Record<string, unknown>,
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useGetActiveStore: vi.fn(),
  useGetTerminal: vi.fn(),
  useAppActionBlocker: vi.fn(),
  useOptionalManagerElevation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockedHooks.useMutation(...args),
  useQuery: (...args: unknown[]) => mockedHooks.useQuery(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <a className={className} href="/product-edit">
      {children}
    </a>
  ),
  useNavigate: () => mockedHooks.navigate,
  useSearch: () => mockedHooks.search,
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

vi.mock("@/lib/app-messages", () => ({
  useAppActionBlocker: mockedHooks.useAppActionBlocker,
}));

vi.mock("@/lib/app-update", () => ({
  APP_UPDATE_APPLY_ACTION_ID: "app-update.apply",
}));

function buildCsvRow(index: number) {
  return `Product ${index},SKU-${index},${index * 10},${index}`;
}

function getSourcePreviewSection() {
  const heading = screen.getByRole("heading", { name: "Source preview" });
  const section = heading.closest("section");
  if (!section) throw new Error("Source preview section missing");
  return within(section);
}

function getReviewOverlaySection() {
  return within(getReviewOverlayElement());
}

function getReviewOverlayElement() {
  const heading = screen.getByRole("heading", { name: "Import review" });
  const section = heading.closest("section");
  if (!section) throw new Error("Import review section missing");
  return section;
}

function getLastNavigateSearch(current: Record<string, unknown> = {}) {
  const lastCall = mockedHooks.navigate.mock.calls.at(-1);
  if (!lastCall) throw new Error("navigate was not called");

  const search = lastCall[0]?.search;
  if (typeof search === "function") {
    return search(current) as Record<string, unknown>;
  }

  return search as Record<string, unknown>;
}

describe("InventoryImportView", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    window.sessionStorage.clear();
    mockedHooks.saveReviewVersion.mockReset();
    mockedHooks.stageReviewRowsForPos.mockReset();
    mockedHooks.navigate.mockReset();
    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.useAppActionBlocker.mockReset();
    mockedHooks.inventorySkuContext = [];
    mockedHooks.latestReviewVersion = null;
    mockedHooks.search = {};
    let mutationCallIndex = 0;
    mockedHooks.useMutation.mockImplementation(() => {
      mutationCallIndex += 1;
      return mutationCallIndex % 2 === 1
        ? mockedHooks.saveReviewVersion
        : mockedHooks.stageReviewRowsForPos;
    });
    let queryCallIndex = 0;
    mockedHooks.useQuery.mockImplementation(() => {
      queryCallIndex += 1;
      if (queryCallIndex % 2 === 0) {
        return mockedHooks.inventorySkuContext;
      }

      return mockedHooks.latestReviewVersion;
    });
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
    let sourcePreview = getSourcePreviewSection();
    expect(sourcePreview.getByText("Product 1")).toBeInTheDocument();
    expect(sourcePreview.getByText("Product 10")).toBeInTheDocument();
    expect(sourcePreview.queryByText("Product 11")).not.toBeInTheDocument();
    expect(sourcePreview.getByText("Showing 1-10 of 30")).toBeInTheDocument();
    expect(sourcePreview.getByText("Page 1 of 3")).toBeInTheDocument();

    await user.click(sourcePreview.getByRole("button", { name: "Go to next page" }));

    sourcePreview = getSourcePreviewSection();
    expect(sourcePreview.getByText("Product 11")).toBeInTheDocument();
    expect(sourcePreview.getByText("Product 20")).toBeInTheDocument();
    expect(sourcePreview.queryByText("Product 1")).not.toBeInTheDocument();
    expect(sourcePreview.getByText("Showing 11-20 of 30")).toBeInTheDocument();
    expect(sourcePreview.getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("defaults to product, price, and quantity while keeping every column available", async () => {
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
    const sourcePreview = getSourcePreviewSection();
    expect(sourcePreview.getByText("Product")).toBeInTheDocument();
    expect(sourcePreview.getByText("Price")).toBeInTheDocument();
    expect(sourcePreview.getByText("Qty")).toBeInTheDocument();
    expect(sourcePreview.queryByText("Barcode")).not.toBeInTheDocument();
    expect(sourcePreview.queryByText("123")).not.toBeInTheDocument();
    expect(sourcePreview.queryByText("SKU")).not.toBeInTheDocument();
    expect(sourcePreview.queryByText("COMB-1")).not.toBeInTheDocument();
    expect(sourcePreview.queryByText("Category")).not.toBeInTheDocument();
    expect(sourcePreview.queryByText("Accessories")).not.toBeInTheDocument();

    await user.click(sourcePreview.getByRole("button", { name: "Columns" }));

    expect(screen.getByRole("menuitemcheckbox", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Price" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Qty" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Barcode" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "SKU" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Category" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitemcheckbox", { name: "Barcode" }));

    expect(getSourcePreviewSection().getByText("Barcode")).toBeInTheDocument();
    expect(getSourcePreviewSection().getByText("123")).toBeInTheDocument();
  });

  it("overlays imported inventory against Athena stock context", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: "111",
        inventoryCount: 3,
        price: 2500,
        productAvailability: "live",
        productId: "product-1",
        productName: "Pocket Comb",
        productSkuId: "sku-1",
        quantityAvailable: 3,
        sku: "COMB-1",
      },
      {
        barcode: "222",
        inventoryCount: 4,
        price: 3000,
        productAvailability: "live",
        productId: "product-2",
        productName: "Brush",
        productSkuId: "sku-2",
        quantityAvailable: 4,
        sku: "BRUSH-1",
      },
    ];

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: [
          "product_name,sku,barcode,price,qty",
          "Comb,COMB-1,111,25,5",
          "Brush,BRUSH-1,222,30,4",
          "New Clip,CLIP-1,333,15,12345",
        ].join("\n"),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "Import review" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));
    const reviewNavigation = mockedHooks.navigate.mock.calls.at(-1)?.[0];
    expect(reviewNavigation).toEqual(
      expect.objectContaining({
        search: { filter: "review" },
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import/review",
      }),
    );
    expect(getLastNavigateSearch()).toEqual({
      filter: "review",
    });

    let reviewOverlay = getReviewOverlaySection();
    expect(screen.getByText("Inventory review")).toBeInTheDocument();
    expect(screen.getByText("3 import rows compared with Athena inventory")).toBeInTheDocument();
    expect(screen.getByText("+12,347")).toBeInTheDocument();
    expect(screen.getByText("Next action")).toBeInTheDocument();
    expect(screen.getByText(/2 rows still need decisions/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show review rows" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save for import handoff" })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.textContent?.trim())
        .filter((label) =>
          [
            "All",
            "Matched",
            "Needs review",
            "New items",
            "Needs decision",
            "Decided",
          ].includes(label ?? ""),
        ),
    ).toEqual(["All", "Matched", "Needs review", "New items", "Needs decision", "Decided"]);
    expect(reviewOverlay.getAllByRole("button", { name: "Import" }).length).toBeGreaterThan(0);
    expect(reviewOverlay.getAllByRole("button", { name: "Athena" }).length).toBeGreaterThan(0);
    expect(reviewOverlay.getByText("Name and count")).toBeInTheDocument();
    expect(reviewOverlay.getAllByText("(+2)").length).toBeGreaterThan(0);
    expect(reviewOverlay.getAllByText("Comb").length).toBeGreaterThanOrEqual(1);
    expect(reviewOverlay.getAllByText("COMB-1 / 111").length).toBeGreaterThanOrEqual(2);
    expect(reviewOverlay.queryByText("New Clip")).not.toBeInTheDocument();
    expect(reviewOverlay.queryByText("Brush")).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Search import rows by product identifiers"),
      "333",
    );
    expect(getLastNavigateSearch({ filter: "review", retained: "yes" })).toEqual({
      filter: "review",
      q: "333",
      retained: "yes",
    });

    reviewOverlay = getReviewOverlaySection();
    let reviewRows = Array.from(getReviewOverlayElement().querySelectorAll("article"));
    expect(reviewRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("New Clip"),
    ]);
    expect(
      reviewOverlay.getByText(/1 match from other statuses included/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(getLastNavigateSearch({ retained: "yes" })).toEqual({
      filter: "all",
      retained: "yes",
    });

    reviewOverlay = getReviewOverlaySection();
    reviewRows = Array.from(getReviewOverlayElement().querySelectorAll("article"));
    expect(reviewRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Brush"),
      expect.stringContaining("Comb"),
      expect.stringContaining("New Clip"),
    ]);
    expect(reviewOverlay.getAllByText("Matched").length).toBeGreaterThan(0);
    expect(reviewOverlay.getByText("New item")).toBeInTheDocument();
    expect(reviewOverlay.getByText("New Clip")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Search import rows by product identifiers"),
      "333",
    );
    expect(getLastNavigateSearch({ filter: "all", retained: "yes" })).toEqual({
      filter: "all",
      q: "333",
      retained: "yes",
    });

    reviewOverlay = getReviewOverlaySection();
    const identifierFilteredRows = Array.from(
      getReviewOverlayElement().querySelectorAll("article"),
    );
    expect(identifierFilteredRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("New Clip"),
    ]);
    expect(reviewOverlay.queryByText("Brush")).not.toBeInTheDocument();
    expect(reviewOverlay.queryByText("Comb")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to import" }));
    expect(
      getLastNavigateSearch({ filter: "all", page: 2, q: "333", retained: "yes" }),
    ).toEqual({
      retained: "yes",
    });
    expect(mockedHooks.navigate.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import",
      }),
    );

    expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Import review" })).not.toBeInTheDocument();
  });

  it("pages inventory review rows in groups of 10", async () => {
    const user = userEvent.setup();
    const content = [
      "product_name,sku,price,qty",
      ...Array.from({ length: 12 }, (_, index) => buildCsvRow(index + 1)),
    ].join("\n");

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: { value: content },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));

    const importReview = getReviewOverlaySection();
    expect(importReview.getByText("Product 1")).toBeInTheDocument();
    expect(importReview.getByText("Product 10")).toBeInTheDocument();
    expect(importReview.queryByText("Product 11")).not.toBeInTheDocument();
    expect(importReview.getByText("Showing 1-10 of 12")).toBeInTheDocument();
    expect(importReview.getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(importReview.getByRole("button", { name: "Go to next page" }));

    expect(getLastNavigateSearch({ filter: "new" })).toEqual({
      filter: "new",
      page: 2,
    });
  });

  it("uses close product-name matching only when the best Athena match is clear", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: undefined,
        inventoryCount: 4,
        price: 10000,
        productAvailability: "live",
        productId: "product-closure",
        productName: "Natural Black Closure Wig",
        productSkuId: "sku-closure",
        quantityAvailable: 4,
        sku: "NB-CLOSURE",
      },
      {
        barcode: undefined,
        inventoryCount: 7,
        price: 7000,
        productAvailability: "live",
        productId: "product-bundle",
        productName: "Natural Black Bundle",
        productSkuId: "sku-bundle",
        quantityAvailable: 7,
        sku: "NB-BUNDLE",
      },
    ];

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: [
          "product_name,price,qty",
          "Natrual Blak Closure Wig,100,4",
          "Natrual Blak,70,7",
        ].join("\n"),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));
    await user.click(screen.getByRole("button", { name: "All" }));

    const importReview = getReviewOverlaySection();
    expect(screen.getByText(/2 rows still need decisions/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show review rows" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save for import handoff" })).toBeInTheDocument();
    expect(importReview.getByText("Close name")).toBeInTheDocument();
    expect(importReview.getByText("Name differs")).toBeInTheDocument();
    expect(importReview.getByText("Natrual Blak Closure Wig")).toBeInTheDocument();
    expect(importReview.getByText("Natural Black Closure Wig")).toBeInTheDocument();
    expect(importReview.getByText("Name")).toBeInTheDocument();
    expect(importReview.getByText("No Athena match")).toBeInTheDocument();
    expect(importReview.getByText("New item")).toBeInTheDocument();
  });

  it("matches exact Athena product names even when multiple SKU rows share the name", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: undefined,
        inventoryCount: 1,
        price: 45000,
        productAvailability: "live",
        productId: "product-white-tea",
        productName: "Elizabeth Arden Green Tea",
        productSkuId: "sku-green-other",
        quantityAvailable: 1,
        sku: "EA-GREEN-ALT",
      },
      {
        barcode: undefined,
        inventoryCount: 8,
        price: 25000,
        productAvailability: "live",
        productId: "product-green-tea",
        productName: "Elizabeth Arden Green Tea",
        productSkuId: "sku-green",
        quantityAvailable: 8,
        sku: "EA-GREEN",
      },
    ];

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: [
          "product_name,price,qty",
          "ELIZABETH ARDEN GREEN TEA,250,8",
        ].join("\n"),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));

    const importReview = getReviewOverlaySection();
    expect(importReview.getByText("Elizabeth Arden Green Tea")).toBeInTheDocument();
    expect(importReview.getAllByText("Matched").length).toBeGreaterThan(0);
    expect(importReview.getByText("Name")).toBeInTheDocument();
    expect(importReview.queryByText("No Athena match")).not.toBeInTheDocument();
    expect(importReview.queryByText("New item")).not.toBeInTheDocument();
  });

  it("saves partial draft choices for review and new rows", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: "111",
        inventoryCount: 3,
        price: 2500,
        productAvailability: "live",
        productId: "product-1",
        productName: "Pocket Comb",
        productSkuId: "sku-1",
        quantityAvailable: 3,
        sku: "COMB-1",
      },
    ];
    mockedHooks.saveReviewVersion.mockResolvedValue(
      ok({
        _id: "review-version-6",
        createdAt: Date.UTC(2026, 5, 7, 15),
        fileName: "manual.csv",
        importKey: "review-key",
        issueCount: 0,
        rowCount: 2,
        sourceFormat: "csv",
        versionNumber: 6,
      }),
    );

    render(<InventoryImportView />);

    const content = [
      "product_name,sku,barcode,price,qty",
      "Comb,COMB-1,111,25,5",
      "New Clip,CLIP-1,333,15,2",
    ].join("\n");
    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: { value: content },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));

    const saveHandoffButton = screen.getByRole("button", {
      name: "Save for import handoff",
    });
    expect(saveHandoffButton).toBeEnabled();

    await user.click(getReviewOverlaySection().getAllByRole("button", { name: "Import" })[0]);
    await user.click(getReviewOverlaySection().getAllByRole("button", { name: "Import" })[1]);
    await user.click(screen.getByRole("button", { name: "Needs decision" }));

    expect(getReviewOverlaySection().getByText("New Clip")).toBeInTheDocument();
    expect(getReviewOverlaySection().queryByText("Comb")).not.toBeInTheDocument();
    expect(screen.getByText(/1 row still need decisions/)).toBeInTheDocument();
    expect(screen.getByText(/1 row ready/)).toBeInTheDocument();
    expect(screen.queryByText(/already have draft choices/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show needs decision" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Decided" }));

    expect(getReviewOverlaySection().getAllByText("Comb").length).toBeGreaterThan(0);
    expect(getReviewOverlaySection().queryByText("New Clip")).not.toBeInTheDocument();

    const selectedRowChoices = Array.from(
      getReviewOverlayElement().querySelectorAll('article button[aria-pressed="true"]'),
    );
    for (const button of selectedRowChoices) {
      await user.click(button as HTMLElement);
    }

    expect(getReviewOverlaySection().getByText("No rows in this view")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New items" }));
    await user.click(screen.getByRole("button", { name: "Needs review" }));
    await user.click(getReviewOverlaySection().getAllByRole("button", { name: "Import" })[0]);
    await user.click(getReviewOverlaySection().getAllByRole("button", { name: "Import" })[1]);
    await user.click(screen.getByRole("button", { name: "New items" }));
    await user.click(screen.getByRole("button", { name: "Create item" }));

    await user.click(screen.getByRole("button", { name: "Save for import handoff" }));

    await waitFor(() => {
      expect(mockedHooks.saveReviewVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: [
            "Import decisions:",
            "Row 2 Comb: Name from import; Qty from import",
            "Row 3 New Clip: Create item",
          ].join("\n"),
          rowDecisions: [
            expect.objectContaining({
              nameSource: "import",
              productName: "Comb",
              quantitySource: "import",
              rowNumber: 2,
            }),
            expect.objectContaining({
              action: "create_item",
              productName: "New Clip",
              rowNumber: 3,
            }),
          ],
        }),
      );
    });
  });

  it("applies a new-item decision to every row in the active review filter", async () => {
    const user = userEvent.setup();
    mockedHooks.saveReviewVersion.mockResolvedValue(
      ok({
        _id: "review-version-bulk",
        createdAt: Date.UTC(2026, 5, 7, 17),
        fileName: "manual.csv",
        importKey: "review-key",
        issueCount: 0,
        rowCount: 12,
        sourceFormat: "csv",
        versionNumber: 8,
      }),
    );

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: [
          "product_name,sku,price,qty",
          ...Array.from(
            { length: 12 },
            (_, index) => `New Product ${index + 1},NEW-${index + 1},${index + 1},1`,
          ),
        ].join("\n"),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));
    await user.click(screen.getByRole("button", { name: "Apply to 12" }));
    await user.click(screen.getByRole("menuitem", { name: "Create 12 new items" }));
    await user.click(screen.getByRole("button", { name: "Save for import handoff" }));

    await waitFor(() => {
      expect(mockedHooks.saveReviewVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          rowDecisions: expect.arrayContaining([
            expect.objectContaining({
              action: "create_item",
              productName: "New Product 1",
              rowNumber: 2,
            }),
            expect.objectContaining({
              action: "create_item",
              productName: "New Product 12",
              rowNumber: 13,
            }),
          ]),
        }),
      );
    });
    const savedRows = mockedHooks.saveReviewVersion.mock.calls.at(-1)?.[0]?.rowDecisions;
    expect(savedRows).toHaveLength(12);
  });

  it("surfaces POS staging after review rows receive decisions", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: "111",
        inventoryCount: 3,
        price: 2500,
        productAvailability: "live",
        productId: "product-1",
        productName: "Comb",
        productSkuId: "sku-1",
        quantityAvailable: 3,
        sku: "COMB-1",
      },
    ];

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: ["product_name,sku,barcode,price,qty", "Comb,COMB-1,111,25,5"].join(
          "\n",
        ),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));
    expect(screen.queryByRole("button", { name: "Make available in POS" })).not.toBeInTheDocument();

    await user.click(getReviewOverlaySection().getByRole("button", { name: "Import" }));

    expect(screen.getByText("Rows are ready for POS availability. Stage them without applying final counts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make available in POS" })).toBeInTheDocument();
  });

  it("stages reviewed rows for POS availability without applying final counts", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: "111",
        inventoryCount: 3,
        price: 2500,
        productAvailability: "live",
        productId: "product-1",
        productName: "Pocket Comb",
        productSkuId: "sku-1",
        quantityAvailable: 3,
        sku: "COMB-1",
      },
    ];
    mockedHooks.saveReviewVersion.mockResolvedValue(
      ok({
        _id: "review-version-7",
        createdAt: Date.UTC(2026, 5, 7, 16),
        fileName: "manual.csv",
        importKey: "review-key",
        issueCount: 0,
        rowCount: 1,
        sourceFormat: "csv",
        versionNumber: 7,
      }),
    );
    mockedHooks.stageReviewRowsForPos.mockResolvedValue(
      ok({
        alreadyStaged: false,
        catalogIdentitiesCreated: 0,
        provisionalRowsCreated: 1,
        provisionalRowsUpdated: 0,
        rowsSkipped: 0,
        rowsStaged: 1,
        trustedStockRowsUpdated: 0,
      }),
    );

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: [
          "product_name,sku,barcode,price,qty",
          "Pocket Comb,COMB-1,111,25,3",
        ].join("\n"),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));
    await user.click(screen.getByRole("button", { name: "Make available in POS" }));

    await waitFor(() => {
      expect(mockedHooks.stageReviewRowsForPos).toHaveBeenCalledWith(
        expect.objectContaining({
          importKey: expect.any(String),
          reviewVersionId: "review-version-7",
          rows: [
            expect.objectContaining({
              barcode: "111",
              price: 2500,
              productId: "product-1",
              productName: "Pocket Comb",
              productSkuId: "sku-1",
              quantity: 3,
              rowKey: "2:COMB-1:111:Pocket Comb",
              rowNumber: 2,
              sku: "COMB-1",
            }),
          ],
          sourceFormat: "csv",
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      );
    });
  });

  it("debounces draft autosave after row choices", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: "111",
        inventoryCount: 3,
        price: 2500,
        productAvailability: "live",
        productId: "product-1",
        productName: "Comb",
        productSkuId: "sku-1",
        quantityAvailable: 3,
        sku: "COMB-1",
      },
    ];
    mockedHooks.saveReviewVersion.mockResolvedValue(
      ok({
        _id: "review-version-7",
        createdAt: Date.UTC(2026, 5, 7, 16),
        fileName: "manual.csv",
        importKey: "review-key",
        issueCount: 0,
        rowCount: 1,
        sourceFormat: "csv",
        versionNumber: 7,
      }),
    );

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: ["product_name,sku,barcode,price,qty", "Comb,COMB-1,111,25,5"].join(
          "\n",
        ),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(mockedHooks.saveReviewVersion).not.toHaveBeenCalled();
    expect(screen.getByText("Autosave pending")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(mockedHooks.saveReviewVersion).toHaveBeenCalledWith(
          expect.objectContaining({
            rowDecisions: [
              expect.objectContaining({
                productName: "Comb",
                quantitySource: "import",
                rowNumber: 2,
              }),
            ],
          }),
        );
      },
      { timeout: 2500 },
    );
  });

  it("registers an update apply blocker while draft row decisions are unsaved", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: "111",
        inventoryCount: 3,
        price: 2500,
        productAvailability: "live",
        productId: "product-1",
        productName: "Comb",
        productSkuId: "sku-1",
        quantityAvailable: 3,
        sku: "COMB-1",
      },
    ];

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: ["product_name,sku,barcode,price,qty", "Comb,COMB-1,111,25,5"].join(
          "\n",
        ),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => {
      expect(mockedHooks.useAppActionBlocker).toHaveBeenLastCalledWith({
        actionId: "app-update.apply",
        active: true,
        blockerId: "operations.inventory-import",
        guidance: "Save the current import work before refreshing.",
        label: "Inventory import",
        priority: "active-command",
      });
    });
  });

  it("keeps the update apply blocker active after autosave fails", async () => {
    const user = userEvent.setup();
    mockedHooks.inventorySkuContext = [
      {
        barcode: "111",
        inventoryCount: 3,
        price: 2500,
        productAvailability: "live",
        productId: "product-1",
        productName: "Comb",
        productSkuId: "sku-1",
        quantityAvailable: 3,
        sku: "COMB-1",
      },
    ];
    mockedHooks.saveReviewVersion.mockResolvedValue(
      userError({
        code: "unavailable",
        message: "Save unavailable",
      }),
    );

    render(<InventoryImportView />);

    fireEvent.change(screen.getByLabelText("Raw export"), {
      target: {
        value: ["product_name,sku,barcode,price,qty", "Comb,COMB-1,111,25,5"].join(
          "\n",
        ),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory check" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Review inventory changes" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(
      () => {
        expect(screen.getByText("Autosave failed")).toBeInTheDocument();
      },
      { timeout: 2500 },
    );
    expect(mockedHooks.useAppActionBlocker).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionId: "app-update.apply",
        active: true,
        blockerId: "operations.inventory-import",
        guidance: "Save the current import work before refreshing.",
        label: "Inventory import",
        priority: "active-command",
      }),
    );
  });

  it("does not block update apply after loading a resumable saved review", async () => {
    mockedHooks.latestReviewVersion = {
      _id: "review-version-saved",
      createdAt: Date.UTC(2026, 5, 7, 18),
      fileName: "saved-products.csv",
      importKey: "review-key",
      issueCount: 0,
      notes: "",
      rawContent: ["product_name,sku,price,qty", "Saved Comb,SAVED-1,40,6"].join("\n"),
      rowCount: 1,
      rowDecisions: [
        {
          action: "create_item",
          productName: "Saved Comb",
          rowKey: "2:SAVED-1::Saved Comb",
          rowNumber: 2,
        },
      ],
      sourceFormat: "csv",
      versionNumber: 4,
    };

    render(<InventoryImportView mode="review" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory review" })).toBeInTheDocument();
    });

    expect(mockedHooks.useAppActionBlocker).toHaveBeenLastCalledWith({
      actionId: "app-update.apply",
      active: false,
      blockerId: "operations.inventory-import",
      guidance: "Save the current import work before refreshing.",
      label: "Inventory import",
      priority: "resume-required",
    });
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

  it("automatically loads the latest server review version into the preview", async () => {
    const user = userEvent.setup();
    mockedHooks.latestReviewVersion = {
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
    };

    render(<InventoryImportView />);

    expect(screen.getByText(/Version 4 - 1 row - 0 issues/)).toBeInTheDocument();
    await waitFor(() => {
      expect(getSourcePreviewSection().getByText("Saved Comb")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Raw export")).not.toBeInTheDocument();
    expect(screen.getByText("saved-products.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace source" })).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("Review before applying.");

    await user.click(screen.getByRole("button", { name: "Replace source" }));

    expect(screen.getByLabelText("Raw export")).toHaveValue(
      ["product_name,sku,price,qty", "Saved Comb,SAVED-1,40,6"].join("\n"),
    );
  });

  it("restores the review surface and selected filter from the URL", async () => {
    mockedHooks.search = { filter: "new" };
    mockedHooks.inventorySkuContext = [
      {
        barcode: "111",
        inventoryCount: 5,
        price: 2500,
        productAvailability: "live",
        productId: "product-comb",
        productName: "Comb",
        productSkuId: "sku-comb",
        quantityAvailable: 5,
        sku: "COMB-1",
      },
    ];
    mockedHooks.latestReviewVersion = {
      _id: "review-version-8",
      createdAt: Date.UTC(2026, 5, 7, 17),
      fileName: "saved-products.csv",
      importKey: "review-key",
      issueCount: 0,
      notes: "",
      rawContent: [
        "product_name,sku,barcode,price,qty",
        "Comb,COMB-1,111,25,5",
        "New Clip,CLIP-1,333,15,2",
      ].join("\n"),
      rowCount: 2,
      sourceFormat: "csv",
      versionNumber: 8,
    };

    render(<InventoryImportView mode="review" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory review" })).toBeInTheDocument();
    });

    const importReview = getReviewOverlaySection();
    expect(screen.getByRole("button", { name: "New items" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(importReview.getByText("New Clip")).toBeInTheDocument();
    expect(importReview.queryByText("Comb")).not.toBeInTheDocument();
  });

  it("rehydrates saved row decisions by row number when the persisted row key drifts", async () => {
    mockedHooks.search = { filter: "needs_decision" };
    mockedHooks.latestReviewVersion = {
      _id: "review-version-row-key-drift",
      createdAt: Date.UTC(2026, 5, 7, 20),
      fileName: "manual.csv",
      importKey: "review-key",
      issueCount: 0,
      notes: undefined,
      rawContent: [
        "product_name,sku,price,qty",
        "BLACK RUBBER BANDS SMALL,,5,45",
      ].join("\n"),
      rowCount: 1,
      rowDecisions: [
        {
          action: "create_item",
          productName: "BLACK RUBBER BANDS SMALL",
          rowKey: "stale-display-derived-row-key",
          rowNumber: 2,
        },
      ],
      sourceFormat: "csv",
      versionNumber: 9,
    };

    render(<InventoryImportView mode="review" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Inventory review" })).toBeInTheDocument();
    });

    expect(
      screen.getByText("Rows are ready for POS availability. Stage them without applying final counts."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make available in POS" })).toBeInTheDocument();
    expect(screen.getByText("No rows in this view")).toBeInTheDocument();
  });

  it("keeps reloads on the review route while the saved import loads", () => {
    mockedHooks.latestReviewVersion = undefined;

    render(<InventoryImportView mode="review" />);

    expect(screen.getByRole("heading", { name: "Inventory review" })).toBeInTheDocument();
    expect(screen.getByText("Loading inventory review")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Inventory import" })).not.toBeInTheDocument();
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
          managerElevationId: "elevation-1",
          storeId: "store-1",
          terminalId: "terminal-elevated-1",
        }),
      );
    });
  });

  it("uses the manager elevation terminal for import queries when a POS-only session has another terminal hook value", () => {
    mockedHooks.useGetTerminal.mockReturnValue({ _id: "terminal-local-1" });
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

    render(<InventoryImportView />);

    const queryArgs = mockedHooks.useQuery.mock.calls
      .map((call) => call[1])
      .filter((args) => args !== "skip");

    expect(queryArgs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          managerElevationId: "elevation-1",
          storeId: "store-1",
          terminalId: "terminal-elevated-1",
        }),
      ]),
    );
    expect(queryArgs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-local-1",
        }),
      ]),
    );
  });
});
