import type { Meta, StoryObj } from "@storybook/react-vite"

import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import { StorybookSection, StorybookShell } from "../storybook-shell"

function SheetShowcase() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Sheet"
      description="Sheets carry quick-edit and filter flows from the edge of the screen."
    >
      <StorybookSection
        title="Filter panel"
        description="Sheets show the right-hand drawer pattern used across Athena."
      >
        <Sheet defaultOpen>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>
                Adjust the store view without leaving the current page.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-3 text-sm text-foreground">
              <Badge variant="secondary">Active</Badge>
              <p>Quick filters stay visible while the sheet is open.</p>
            </div>
          </SheetContent>
        </Sheet>
      </StorybookSection>
    </StorybookShell>
  )
}

const meta = {
  title: "Primitives/Sheet",
  component: SheetShowcase,
} satisfies Meta<typeof SheetShowcase>

export default meta

type Story = StoryObj<typeof meta>

export const OpenFilterPanel: Story = {}
