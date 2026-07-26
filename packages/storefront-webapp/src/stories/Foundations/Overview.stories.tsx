import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  StorybookList,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

function FoundationsOverview() {
  return (
    <StorybookShell
      eyebrow="Foundations"
      title="Semantic storefront foundations"
      description="Canvas, surface, action, status, typography, spacing, focus, and motion roles are the shared vocabulary for every journey."
    >
      <StorybookSection
        title="Color roles"
        description="These examples resolve through the same global stylesheet used by the app."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background p-5 text-foreground">
            Canvas and foreground
          </div>
          <div className="rounded-lg border border-border bg-card p-5 text-card-foreground">
            Raised surface
          </div>
          <div className="rounded-lg bg-primary p-5 text-primary-foreground">
            Primary action
          </div>
          <div className="rounded-lg bg-selection p-5 text-selection-foreground">
            Storefront accent
          </div>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Foundation contract"
        description="Named roles keep implementation intent stable while values evolve."
      >
        <StorybookList
          items={[
            "One light-first theme authority and one scalable viewport declaration.",
            "Visible focus and immediate reduced-motion behavior.",
            "Named page width, gutter, safe-area, control, radius, and elevation recipes.",
            "Temporary historical accent aliases remain migration-only, not canonical guidance.",
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

export const Overview: Story = {};
