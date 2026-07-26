import type { Meta, StoryObj } from "@storybook/react-vite";

import { PageState } from "@/components/states/PageState";
import { Button } from "@/components/ui/button";
import {
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

function PageStates() {
  return (
    <StorybookShell
      eyebrow="Supported pattern"
      title="Page-state recipes"
      description="Routes use one state language while preserving the domain-specific explanation and recovery action."
    >
      <StorybookSection
        title="Loading and empty"
        description="Loading is named; empty states explain the next useful action."
      >
        <div className="grid gap-layout-sm sm:grid-cols-2">
          <PageState
            state="loading"
            title="Loading your bag"
            inline
          />
          <PageState
            state="empty"
            title="Your bag is empty"
            description="Browse products when you're ready."
            primaryAction={<Button>Shop products</Button>}
            inline
          />
        </div>
      </StorybookSection>

      <StorybookSection
        title="Recovery and completion"
        description="Error and success recipes pair status with explicit text and available actions."
      >
        <div className="grid gap-layout-sm sm:grid-cols-2">
          <PageState
            state="error"
            title="We couldn't load this order"
            description="Your information is safe. Try again."
            primaryAction={<Button>Try again</Button>}
            inline
          />
          <PageState
            state="success"
            title="Order confirmed"
            description="We'll email you when it is ready."
            primaryAction={<Button>View order</Button>}
            inline
          />
        </div>
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Patterns/Page States",
  component: PageStates,
} satisfies Meta<typeof PageStates>;

export default meta;

type Story = StoryObj<typeof meta>;

export const StateMatrix: Story = {};
