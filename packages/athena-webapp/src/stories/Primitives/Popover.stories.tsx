import type { Meta, StoryObj } from "@storybook/react-vite"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

import { StorybookSection, StorybookShell } from "../storybook-shell"

function PopoverShowcase() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Popover"
      description="Popovers keep inline metadata and short option menus attached to their trigger."
    >
      <StorybookSection
        title="Inline options"
        description="This is the shape used by filter menus and compact pickers."
      >
        <Popover defaultOpen>
          <PopoverTrigger asChild>
            <Button variant="outline">Open details</Button>
          </PopoverTrigger>
          <PopoverContent className="grid gap-3">
            <div className="text-sm font-medium text-foreground">Availability</div>
            <div className="text-sm text-muted-foreground">
              Popovers anchor to the trigger and stay within the tokenized surface hierarchy.
            </div>
            <Badge variant="outline" className="w-fit">
              In stock
            </Badge>
          </PopoverContent>
        </Popover>
      </StorybookSection>
    </StorybookShell>
  )
}

const meta = {
  title: "Primitives/Popover",
  component: PopoverShowcase,
} satisfies Meta<typeof PopoverShowcase>

export default meta

type Story = StoryObj<typeof meta>

export const OpenDetails: Story = {}
