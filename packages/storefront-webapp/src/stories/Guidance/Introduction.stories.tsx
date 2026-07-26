import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  StorybookList,
  StorybookSection,
  StorybookShell,
  StorybookStatus,
} from "../storybook-shell";

function Introduction() {
  return (
    <StorybookShell
      eyebrow="Guidance"
      title="A customer-facing storefront system"
      description="Storefront owns its commerce voice and visual language. Athena provides governance patterns, not operator-shell components or density."
    >
      <StorybookSection
        title="Maturity labels"
        description="Every catalog entry must state how contributors may use it."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <StorybookStatus status="Supported">
            Stable, documented, and safe for new storefront work.
          </StorybookStatus>
          <StorybookStatus status="Experimental">
            Available for evaluation; its contract may still change.
          </StorybookStatus>
          <StorybookStatus status="Feature-specific">
            Owned by one commerce journey rather than the shared primitive layer.
          </StorybookStatus>
          <StorybookStatus status="Deprecated">
            Retained only while existing consumers migrate.
          </StorybookStatus>
          <StorybookStatus status="Removable">
            Proven unused and queued for the final cleanup boundary.
          </StorybookStatus>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Working agreement"
        description="The workbench is a contract surface, not a gallery of disconnected examples."
      >
        <StorybookList
          items={[
            "Use semantic color, spacing, type, status, and motion roles.",
            "Exercise loading, empty, error, disabled, and success behavior where it applies.",
            "Use synthetic commerce fixtures only; never retain customer, order, payment, or session data.",
            "Keep feature-owned patterns out of the supported primitive catalog.",
          ]}
        />
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Guidance/Introduction",
  component: Introduction,
} satisfies Meta<typeof Introduction>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
