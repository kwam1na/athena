import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import View from "./View";

const originalScrollTo = window.scrollTo;

beforeEach(() => {
  window.scrollTo = vi.fn();
});

afterEach(() => {
  window.scrollTo = originalScrollTo;
});

describe("View", () => {
  it("adds responsive containment and horizontal overflow guards by default", () => {
    const { container } = render(
      <View fullHeight={false}>
        <div>Content</div>
      </View>,
    );

    const section = container.querySelector("section");
    const surface = section?.firstElementChild;

    expect(section).toHaveClass(
      "container",
      "mx-auto",
      "w-full",
      "min-w-0",
      "px-4",
      "sm:px-6",
      "lg:px-8",
      "overflow-x-hidden",
    );
    expect(surface).toHaveClass("min-w-0", "overflow-x-hidden");
  });

  it("keeps full-width views on the responsive page gutter scale", () => {
    const { container } = render(
      <View width="full" fullHeight={false}>
        <div>Content</div>
      </View>,
    );

    const section = container.querySelector("section");

    expect(section).toHaveClass(
      "w-full",
      "max-w-none",
      "px-4",
      "sm:px-6",
      "lg:px-8",
      "overflow-x-hidden",
    );
  });
});
