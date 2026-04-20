import type { Meta, StoryObj } from "@storybook/react-vite";

import { DataWorkspaceTemplate } from "./reference-fixtures";

const meta = {
  title: "Templates/Data Workspace",
  component: DataWorkspaceTemplate,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A dense review workspace for tables, filters, and exception lanes that should feel like Athena without leaning on application data.",
      },
    },
  },
} satisfies Meta<typeof DataWorkspaceTemplate>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
