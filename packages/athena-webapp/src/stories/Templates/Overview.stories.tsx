import type { Meta, StoryObj } from "@storybook/react-vite";

import { StorybookCallout, StorybookList, StorybookSection, StorybookShell } from "../storybook-shell";

function TemplatesOverview() {
  return (
    <StorybookShell
      eyebrow="Templates"
      title="Athena reference workspaces"
      description="Templates are Storybook-only scenes that show how Athena's foundations, patterns, and density rules should compose across common admin workspaces."
    >
      <StorybookSection
        title="Coverage"
        description="These scenes are reference material for the design-system rollout, not application routes."
      >
        <StorybookList
          items={[
            "Dashboard workspace for hierarchy, revenue context, and action rails.",
            "Data workspace for dense tables, filters, and exception lanes.",
            "Settings workspace for permissions, density, and publishing posture.",
          ]}
        />
      </StorybookSection>

      <StorybookSection
        title="Review stance"
        description="Each workspace uses static fixtures so the composition stays readable without router, auth, or Convex state."
      >
        <StorybookCallout title="Reference-only rule">
          Use these stories to align on layout, hierarchy, and density. Do not wire them to live
          data, feature flags, or production navigation.
        </StorybookCallout>
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

export const Overview: Story = {};
