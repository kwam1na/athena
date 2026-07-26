import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  StorybookList,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

function TemplatesOverview() {
  return (
    <StorybookShell
      eyebrow="Templates"
      title="End-to-end storefront families"
      description="Templates prove that foundations, primitives, and patterns survive complete responsive customer journeys."
    >
      <StorybookSection
        title="Migration sequence"
        description="Each family graduates through characterization, responsive review, state coverage, and browser proof."
      >
        <StorybookList
          items={[
            "Catalog and product discovery.",
            "Bag, checkout, payment, and terminal outcomes.",
            "Identity, account, rewards, orders, reviews, policies, and receipt.",
          ]}
        />
      </StorybookSection>
      <StorybookSection
        title="Fixture policy"
        description="Template evidence must be safe to retain and useful at every target viewport."
      >
        <StorybookList
          items={[
            "Use deterministic synthetic products, customers, orders, and status states.",
            "Never include live identifiers, secrets, payment data, or session tokens.",
            "Keep route behavior in the app; Storybook documents presentation contracts.",
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

export const Overview: Story = {};
