import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { HomePageReadyShell } from "./HomePage";

describe("HomePageReadyShell", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes a stable homepage readiness hook independent of merchandising", () => {
    render(
      <HomePageReadyShell>
        <div>Homepage Content</div>
      </HomePageReadyShell>,
    );

    expect(screen.getByTestId("storefront-homepage-ready")).toBeInTheDocument();
  });

  it("can expose critical homepage content without a blank shell", () => {
    render(
      <HomePageReadyShell>
        <section data-testid="homepage-critical-content">Hero</section>
      </HomePageReadyShell>,
    );

    expect(screen.getByTestId("storefront-homepage-ready")).toBeInTheDocument();
    expect(screen.getByTestId("homepage-critical-content")).toBeInTheDocument();
  });
});
