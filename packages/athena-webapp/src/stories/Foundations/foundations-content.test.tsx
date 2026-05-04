import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AthenaFoundationsPage } from "./foundations-content";

const indexCss = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("AthenaFoundationsPage", () => {
  it("documents the core Athena foundation sections and review cues", () => {
    render(<AthenaFoundationsPage />);

    expect(
      screen.getByRole("heading", {
        name: /athena semantic design foundations/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: /color roles/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /typography system/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /spacing and density/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /detail view system/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /elevation and motion/i }),
    ).toBeInTheDocument();

    expect(screen.getAllByText(/shell \/ ink/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/signal \/ action/i)).not.toHaveLength(0);
    expect(screen.getByText(/display sans/i)).toBeInTheDocument();
    expect(screen.getByText(/operational numerics/i)).toBeInTheDocument();
    expect(screen.getByText(/standard workspace/i)).toBeInTheDocument();
    expect(screen.getAllByText(/receipt rail/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/item canvas/i)).not.toHaveLength(0);
    expect(screen.getByText(/focus sweep/i)).toBeInTheDocument();
    for (const reviewButton of screen.getAllByRole("button", { name: /review/i })) {
      expect(reviewButton).toBeDisabled();
    }
  });

  it("keeps the light sidebar tokens aligned with the light canvas palette", () => {
    expect(indexCss).toContain("--radius: 0.75rem;");
    expect(indexCss).toContain("--font-preset-athena-classic-display:");
    expect(indexCss).toContain("--font-preset-athena-classic-numeric:");
    expect(indexCss).toContain("--font-preset-athena-story-display:");
    expect(indexCss).toContain("--font-preset-athena-story-display: var(--font-preset-athena-story-sans);");
    expect(indexCss).toContain("--font-preset-athena-story-numeric: var(--font-preset-athena-story-sans);");
    expect(indexCss).toContain("--font-numeric: var(--font-preset-athena-story-numeric);");
    expect(indexCss).toContain("--sidebar-background: var(--background);");
    expect(indexCss).toContain("--sidebar-foreground: var(--foreground);");
    expect(indexCss).toContain("--sidebar-accent: 220 20% 96%;");
    expect(indexCss).toContain("--sidebar-accent-foreground: var(--foreground);");
    expect(indexCss).toContain("--sidebar-border: 220 16% 88%;");
    expect(indexCss).toContain("--border: 220 16% 88%;");
    expect(indexCss).toContain("--input: 220 16% 88%;");
    expect(indexCss).toContain("--action-commit: 338 62% 43%;");
    expect(indexCss).toContain("--action-workflow: 232 42% 45%;");
    expect(indexCss).toContain("--action-workflow-soft: 232 58% 96%;");
  });
});
