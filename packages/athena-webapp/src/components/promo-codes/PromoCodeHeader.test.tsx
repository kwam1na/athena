import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GENERIC_UNEXPECTED_ERROR_MESSAGE } from "~/shared/commandResult";

import PromoCodeHeader from "./PromoCodeHeader";

const mocks = vi.hoisted(() => ({
  deletePromoCode: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.deletePromoCode,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ promoCodeSlug: "promo-1" }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("../common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
    trailingContent,
  }: {
    leadingContent: React.ReactNode;
    trailingContent: React.ReactNode;
  }) => (
    <div>
      <div>{leadingContent}</div>
      <div>{trailingContent}</div>
    </div>
  ),
}));

describe("PromoCodeHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collapses thrown delete failures to the shared fallback copy", async () => {
    mocks.deletePromoCode.mockRejectedValue(
      new Error("[CONVEX] promo deletion details should stay private"),
    );

    const user = userEvent.setup();

    render(<PromoCodeHeader handleSave={vi.fn()} isUpdating={false} />);

    const buttons = screen.getAllByRole("button");
    await user.click(buttons[1]!);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to delete promo code",
        {
          description: GENERIC_UNEXPECTED_ERROR_MESSAGE,
        },
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        description: expect.stringContaining("promo deletion details"),
      }),
    );
  });

  it("preserves the successful delete flow", async () => {
    mocks.deletePromoCode.mockResolvedValue(undefined);

    const user = userEvent.setup();

    render(<PromoCodeHeader handleSave={vi.fn()} isUpdating={false} />);

    const buttons = screen.getAllByRole("button");
    await user.click(buttons[1]!);

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Promo code deleted"),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      params: expect.any(Function),
      to: "/$orgUrlSlug/store/$storeUrlSlug/promo-codes",
    });
  });
});
