import type { Meta, StoryObj } from "@storybook/react-vite";

import { AthenaFoundationsPage } from "./foundations-content";

const meta = {
  title: "Foundations/Overview",
  component: AthenaFoundationsPage,
} satisfies Meta<typeof AthenaFoundationsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
