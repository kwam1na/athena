import { render, screen } from "@testing-library/react";
import type { HTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProductActions } from "./ProductActions";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe("ProductActions", () => {
  it("exposes a stable add-to-bag hook", () => {
    render(
      <ProductActions
        handleUpdateBag={vi.fn(async () => {})}
        handleUpdateSavedBag={vi.fn(async () => {})}
        isUpdatingBag={false}
        isSoldOut={false}
        addedItemSuccessfully={null}
      />,
    );

    expect(screen.getByTestId("storefront-product-add-to-bag")).toBeInTheDocument();
  });
});
