import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StorefrontPage } from "./StorefrontPage";
describe("StorefrontPage", () => {
  it("composes as a section inside the shell main", () => {
    render(
      <main>
        <StorefrontPage aria-label="Catalog">Catalog</StorefrontPage>
      </main>,
    );
    expect(screen.getByRole("region", { name: "Catalog" })).toHaveClass(
      "max-w-content",
      "px-gutter",
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});
