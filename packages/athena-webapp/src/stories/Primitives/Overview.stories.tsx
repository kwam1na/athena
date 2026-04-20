import type { Meta, StoryObj } from "@storybook/react-vite";

import { StorybookList, StorybookSection, StorybookShell } from "../storybook-shell";

function PrimitivesOverview() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Shared UI contracts"
      description="The primitive layer will document and normalize the controls Athena depends on before shell patterns and templates expand the system."
    >
      <StorybookSection
        title="Targeted components"
        description="The next primitive ticket will focus on the highest-leverage shared controls."
      >
        <StorybookList
          items={[
            "Buttons, badges, inputs, selects, and textareas.",
            "Dialogs, sheets, tabs, tables, skeletons, spinners, and toast surfaces.",
            "State coverage for loading, disabled, destructive, compact, and dark-theme cases.",
          ]}
        />
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Primitives/Overview",
  component: PrimitivesOverview,
} satisfies Meta<typeof PrimitivesOverview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PlannedCoverage: Story = {};
