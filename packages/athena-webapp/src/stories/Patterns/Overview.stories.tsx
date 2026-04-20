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
        title="Shell stories"
        description="These stories are authored scenes, not primitive showcases. They use stable fixtures so the admin shell reads like Athena without live app dependencies."
      >
        <StorybookList
          items={[
            "Athena admin shell composition with sidebar, header, metrics, and loading surfaces.",
            "Focused sidebar, page header, and metric surface stories for design review.",
            "Static loading states that keep the shell rhythm intact while data resolves.",
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
