import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import View from "./View";

describe("View", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  it("keeps full-width and full-height layouts inside their parent box", () => {
    render(
      <View width="full">
        <div>Content</div>
      </View>,
    );

    const section = screen.getByText("Content").closest("section");
    expect(section).toHaveClass("box-border");
    expect(section?.firstElementChild).toHaveClass("box-border");
  });

  it("uses the app canvas token for the shared view surface", () => {
    render(
      <View>
        <div>Canvas content</div>
      </View>,
    );

    expect(screen.getByText("Canvas content").closest("section")).toHaveClass(
      "bg-app-canvas",
    );
  });
});
