import type { Meta, StoryObj } from "@storybook/react-vite";

import { StorybookList, StorybookSection, StorybookShell } from "../storybook-shell";

function FoundationsOverview() {
  return (
    <StorybookShell
      eyebrow="Foundations"
      title="Athena semantic design tokens"
      description="This section is reserved for the token system that will define Athena's authored visual language in the next ticket."
    >
      <StorybookSection
        title="Planned coverage"
        description="These stories are the next layer after Storybook scaffolding."
      >
        <StorybookList
          items={[
            "Color roles for shell, surfaces, text, feedback, and focus.",
            "Typography scales for display, headings, UI copy, and numerics.",
            "Spacing, density, and motion guidance for operational surfaces.",
          ]}
        />
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Foundations/Overview",
  component: FoundationsOverview,
} satisfies Meta<typeof FoundationsOverview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PlannedCoverage: Story = {};
