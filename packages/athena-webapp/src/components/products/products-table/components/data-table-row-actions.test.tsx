import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GENERIC_UNEXPECTED_ERROR_MESSAGE } from "~/shared/commandResult";
import { OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON } from "~/shared/productArchivePolicy";

import { DataTableRowActions } from "./data-table-row-actions";

const mocks = vi.hoisted(() => ({
  archiveProduct: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.archiveProduct,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, { error: mocks.toastError }),
}));

vi.mock("../../../../hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "storezzzz" } }),
}));

// Radix menu and dialog primitives are replaced with inert passthroughs so the
// assertions stay on this component's archive decision handling.
vi.mock("../../../ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button onClick={onClick} type="button">
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/modals/alert-modal", () => ({
  AlertModal: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <button onClick={onConfirm} type="button">
        Confirm archive
      </button>
    ) : null,
}));

function renderRowActions() {
  const row = {
    original: {
      _id: "product001",
      name: "Edge control",
      slug: "edge-control",
    },
  };

  return render(<DataTableRowActions row={row as never} />);
}

async function confirmArchive() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await user.click(screen.getByRole("button", { name: "Confirm archive" }));
}

describe("products table archive row action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("presents the normalized conflict copy when open sale inventory reviews block the archive", async () => {
    mocks.archiveProduct.mockResolvedValue({
      error: {
        code: "conflict",
        message: "server copy that must not reach the operator",
        metadata: {
          openSyncedSaleInventoryReviewGroupCount: 2,
          reason: OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON,
        },
        title: "Archiving on hold",
      },
      kind: "user_error",
    });

    renderRowActions();
    await confirmArchive();

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Archiving on hold",
        expect.objectContaining({
          description:
            "Resolve 2 open sale inventory reviews for this product before archiving.",
        }),
      ),
    );
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.toastError.mock.calls)).not.toContain(
      "server copy that must not reach the operator",
    );
    expect(JSON.stringify(mocks.toastError.mock.calls)).not.toContain(
      "product001",
    );
  });

  it("collapses unexpected archive failures to the shared fallback copy", async () => {
    mocks.archiveProduct.mockRejectedValue(
      new Error("[CONVEX M(inventory/products:archive)] Server Error: raw"),
    );

    renderRowActions();
    await confirmArchive();

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Something went wrong",
        expect.objectContaining({
          description: GENERIC_UNEXPECTED_ERROR_MESSAGE,
        }),
      ),
    );
  });

  it("keeps the successful archive flow intact", async () => {
    mocks.archiveProduct.mockResolvedValue({
      data: { _id: "product001", availability: "archived" },
      kind: "ok",
    });

    renderRowActions();
    await confirmArchive();

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Product 'Edge control' archived",
        expect.anything(),
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalled();
  });
});
