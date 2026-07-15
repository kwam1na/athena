import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShopLookImageUploader } from "./ShopLookImageUploader";

const mockedHooks = vi.hoisted(() => ({
  useAction: vi.fn(),
  useGetActiveStore: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: mockedHooks.useAction,
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: mockedHooks.useGetActiveStore,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("ShopLookImageUploader", () => {
  beforeEach(() => {
    mockedHooks.useAction.mockReturnValue(vi.fn());
    mockedHooks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1" },
    });
  });

  it("replaces a failed image with a recovery state", () => {
    render(<ShopLookImageUploader currentImageUrl="/unavailable-image.jpg" />);

    fireEvent.error(screen.getByAltText("Shop the look"));

    expect(screen.getByRole("status")).toHaveTextContent("No image yet");
    expect(
      screen.getByText("Upload an image to add this visual."),
    ).toBeInTheDocument();
    expect(screen.queryByAltText("Shop the look")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update image" })).toBeEnabled();
  });
});
