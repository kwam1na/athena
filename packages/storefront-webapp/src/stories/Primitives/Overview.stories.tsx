import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { Button } from "@/components/ui/button";
import {
  StorybookList,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

function PrimitivesOverview() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Accessible interaction contracts"
      description="Supported primitives own naming, focus, keyboard behavior, disabled and loading semantics, geometry, and feedback."
    >
      <StorybookSection
        title="Action sensor"
        description="The interaction check exercises the actual storefront button primitive."
      >
        <Button onClick={(event) => event.currentTarget.setAttribute("data-activated", "true")}>
          Add to bag
        </Button>
      </StorybookSection>
      <StorybookSection
        title="Planned catalog"
        description="Primitive maturity is promoted only after contract coverage exists."
      >
        <StorybookList
          items={[
            "Actions: button, link, icon action, and loading action.",
            "Fields: input, textarea, select, checkbox, radio, label, hint, and error.",
            "Overlays and feedback remain patterns until shared lifecycle contracts are proven.",
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

export const ContractPreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const action = canvas.getByRole("button", { name: "Add to bag" });

    await userEvent.click(action);
    await expect(action).toHaveAttribute("data-activated", "true");
  },
};
