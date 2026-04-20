import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  AthenaAdminShellPatterns,
  AthenaLoadingPattern,
  AthenaMetricPattern,
  AthenaPageHeaderPattern,
  AthenaSidebarPattern,
} from "./admin-shell-patterns";

const meta = {
  title: "Patterns/Athena Admin Shell",
  component: AthenaAdminShellPatterns,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Athena-authored shell scenes that pair the sidebar, page header, metrics, and loading surfaces without router, auth, or Convex dependencies.",
      },
    },
  },
} satisfies Meta<typeof AthenaAdminShellPatterns>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ShellComposition: Story = {};

export const SidebarFocus: Story = {
  render: () => <AthenaSidebarPattern />,
};

export const PageHeaderFocus: Story = {
  render: () => <AthenaPageHeaderPattern />,
};

export const MetricSurfaceFocus: Story = {
  render: () => <AthenaMetricPattern />,
};

export const LoadingSurfaceFocus: Story = {
  render: () => <AthenaLoadingPattern />,
};
