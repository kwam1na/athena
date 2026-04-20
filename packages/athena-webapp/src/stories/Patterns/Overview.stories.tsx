import type { Meta, StoryObj } from "@storybook/react-vite";

import { StorybookList, StorybookSection, StorybookShell } from "../storybook-shell";

function PatternsOverview() {
  return (
    <StorybookShell
      eyebrow="Patterns"
      title="Athena admin shell language"
      description="Patterns are where the system starts to feel like Athena: navigation, page headers, metric surfaces, filters, and shared app states."
    >
      <StorybookSection
        title="Planned shell stories"
        description="Pattern stories will avoid live app state and use stable fixtures instead."
      >
        <StorybookList
          items={[
            "Sidebar navigation and shell rhythm.",
            "Page headers, toolbar rows, and metric surfaces.",
            "Empty, loading, error, and confirmation patterns.",
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

export const PlannedCoverage: Story = {};
