import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GalleryViewer from "./GalleryViewer";

class IntersectionObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe("GalleryViewer", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    Element.prototype.scrollTo = vi.fn();
  });

  it("exposes named thumbnail controls and the selected image", () => {
    render(
      <GalleryViewer
        images={[
          "https://images.example.com/front.webp",
          "https://images.example.com/back.webp",
        ]}
        productName="Demo wig"
      />,
    );

    const secondThumbnail = screen.getByRole("button", {
      name: "Show Demo wig image 2 of 2",
    });

    expect(
      screen.getByRole("button", { name: "Show Demo wig image 1 of 2" }),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByAltText("Demo wig, view 1 of 2")).toBeInTheDocument();

    fireEvent.click(secondThumbnail);

    expect(secondThumbnail).toHaveAttribute("aria-current", "true");
  });
});
