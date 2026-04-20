import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { StorybookCallout, StorybookSection, StorybookShell } from "../storybook-shell"

function TooltipShowcase() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Tooltip"
      description="Tooltips keep short explanations close to the control without interrupting the flow."
    >
      <StorybookSection
        title="Hover help"
        description="The tooltip content stays compact and tokenized."
      >
        <TooltipProvider delayDuration={0}>
          <Tooltip defaultOpen>
            <TooltipTrigger asChild>
              <Button variant="ghost">Shipping cost</Button>
            </TooltipTrigger>
            <TooltipContent>Shown when the order qualifies for free delivery.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </StorybookSection>
      <StorybookCallout title="Overlay rhythm">
        Dialogs, sheets, popovers, and tooltips now share the same overlay tone instead of hard-coded black scrims.
      </StorybookCallout>
    </StorybookShell>
  )
}

const meta = {
  title: "Primitives/Tooltip",
  component: TooltipShowcase,
} satisfies Meta<typeof TooltipShowcase>

export default meta

type Story = StoryObj<typeof meta>

export const OpenHelp: Story = {}
