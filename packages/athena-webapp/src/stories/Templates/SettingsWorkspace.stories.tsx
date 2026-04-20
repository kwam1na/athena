import type { Meta, StoryObj } from "@storybook/react-vite";

import { SettingsWorkspaceTemplate } from "./reference-fixtures";

const meta = {
  title: "Templates/Settings Workspace",
  component: SettingsWorkspaceTemplate,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A structured settings workspace that keeps permissions, density, and publishing decisions calm and readable.",
      },
    },
  },
} satisfies Meta<typeof SettingsWorkspaceTemplate>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
