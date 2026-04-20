import type { Meta, StoryObj } from "@storybook/react-vite";

import { StorybookList, StorybookSection, StorybookShell } from "../storybook-shell";

function TemplatesOverview() {
  return (
    <StorybookShell
      eyebrow="Templates"
      title="Reference admin workspaces"
      description="Templates will show how Athena's foundations, primitives, and shell patterns should compose at page level without becoming router-backed production screens."
    >
      <StorybookSection
        title="Planned references"
        description="These references are alignment tools for future rollout, not app migrations."
      >
        <StorybookList
          items={[
            "Dashboard workspace with hierarchy for metrics and sections.",
            "Operational data workspace with tables, filters, and states.",
            "Settings workspace with structured form layout and density rules.",
          ]}
        />
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Templates/Overview",
  component: TemplatesOverview,
} satisfies Meta<typeof TemplatesOverview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PlannedCoverage: Story = {};
