import type { Meta, StoryObj } from "@storybook/react-vite";

import { AthenaGuidanceIntroductionPage } from "./introduction-content";

const meta = {
  title: "Guidance/Introduction",
  component: AthenaGuidanceIntroductionPage,
  parameters: {
    docs: {
      description: {
        component:
          "Written guidance for how Athena reference workspaces should use cards, typography, density, shell composition, and restrained motion.",
      },
    },
  },
} satisfies Meta<typeof AthenaGuidanceIntroductionPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
