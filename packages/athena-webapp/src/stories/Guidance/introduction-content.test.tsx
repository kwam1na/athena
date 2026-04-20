import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AthenaGuidanceIntroductionPage } from "./introduction-content";

describe("AthenaGuidanceIntroductionPage", () => {
  it("covers the Athena guidance rules for the reference pass", () => {
    render(<AthenaGuidanceIntroductionPage />);

    expect(screen.getByRole("heading", { name: /card usage/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /typography/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /density/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /shell composition/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /restrained motion/i })).toBeInTheDocument();
  });
});
