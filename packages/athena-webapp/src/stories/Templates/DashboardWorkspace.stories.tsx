import type { Meta, StoryObj } from "@storybook/react-vite";

import { DashboardWorkspaceTemplate } from "./reference-fixtures";

const meta = {
  title: "Templates/Dashboard Workspace",
  component: DashboardWorkspaceTemplate,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A reference dashboard workspace that demonstrates hierarchy, operational signal density, and authored card composition without live state.",
      },
    },
  },
} satisfies Meta<typeof DashboardWorkspaceTemplate>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
