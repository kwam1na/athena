import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { HomePageReadyShell } from "./HomePage";

describe("HomePageReadyShell", () => {
  it("exposes a stable homepage readiness hook independent of merchandising", () => {
    render(
      <HomePageReadyShell>
        <div>Homepage Content</div>
      </HomePageReadyShell>,
    );

    expect(screen.getByTestId("storefront-homepage-ready")).toBeInTheDocument();
  });
});
