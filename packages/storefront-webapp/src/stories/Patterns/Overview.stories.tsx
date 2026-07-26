import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  StorybookList,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

function PatternsOverview() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <StorybookShell
      eyebrow="Patterns"
      title="Reusable commerce behavior"
      description="Patterns combine primitives into predictable page, overlay, feedback, media, status, and commerce-state contracts."
    >
      <StorybookSection
        title="Stateful pattern sensor"
        description="Interaction checks prove user-visible state rather than implementation details."
      >
        <button
          aria-expanded={isOpen}
          className="min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          {isOpen ? "Hide order summary" : "Show order summary"}
        </button>
        {isOpen ? (
          <div className="rounded-lg border border-border bg-card p-4" role="status">
            Synthetic order summary ready for review.
          </div>
        ) : null}
      </StorybookSection>
      <StorybookSection
        title="Pattern boundary"
        description="Patterns are shared only when multiple journeys need the same lifecycle."
      >
        <StorybookList
          items={[
            "Page composition and responsive action placement.",
            "Loading, empty, recoverable error, terminal error, and success states.",
            "Dialog, sheet, menu, toast, image fallback, inventory, and offer behavior.",
          ]}
        />
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Patterns/Overview",
  component: PatternsOverview,
} satisfies Meta<typeof PatternsOverview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ContractPreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole("button", { name: "Show order summary" }),
    );
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Synthetic order summary ready for review.",
    );
  },
};
