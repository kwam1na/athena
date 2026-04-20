import type { Meta, StoryObj } from "@storybook/react-vite";

import { StorybookList, StorybookSection, StorybookShell } from "../storybook-shell";

function PrimitivesOverview() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Shared UI contracts"
      description="The primitive layer now documents the controls Athena depends on before shell patterns and templates expand the system."
    >
      <StorybookSection
        title="Coverage"
        description="The story set focuses on the controls and surfaces that show up in real Athena flows."
      >
        <StorybookList
          items={[
            "Controls: buttons, badges, inputs, selects, textareas, switches, toggles, toggle groups, radio groups, and separators.",
            "Surfaces: cards, tabs, tables, scroll areas, dialogs, sheets, popovers, and tooltips.",
            "Feedback: skeletons, spinners, and toast surfaces in loading and success states.",
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
