import type { Meta, StoryObj } from "@storybook/react-vite";

import { ViewUsagePatterns } from "./view-patterns";

const meta = {
  title: "Patterns/View Component",
  component: ViewUsagePatterns,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A focused reference for the different ways Athena uses the View component as the foundational workspace shell.",
      },
    },
  },
} satisfies Meta<typeof ViewUsagePatterns>;

export default meta;

type Story = StoryObj<typeof meta>;

export const UsageModes: Story = {};
