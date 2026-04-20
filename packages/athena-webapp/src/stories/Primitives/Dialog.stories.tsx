import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { StorybookSection, StorybookShell } from "../storybook-shell"

function DialogShowcase() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Dialog"
      description="Modal surfaces keep confirmation and form flows focused while preserving Athena's tokenized overlay tone."
    >
      <StorybookSection
        title="Open confirmation"
        description="A real edit or delete flow needs the modal content visible up front."
      >
        <Dialog defaultOpen>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archive this order?</DialogTitle>
              <DialogDescription>
                This mirrors the destructive confirmation pattern used in product and admin flows.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 text-sm text-muted-foreground">
              <p>Primary action: archive the order.</p>
              <p>Secondary action: keep the current state.</p>
            </div>
            <DialogFooter>
              <Button variant="outline">Cancel</Button>
              <Button variant="destructive">Archive order</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </StorybookSection>
    </StorybookShell>
  )
}

const meta = {
  title: "Primitives/Dialog",
  component: DialogShowcase,
} satisfies Meta<typeof DialogShowcase>

export default meta

type Story = StoryObj<typeof meta>

export const OpenConfirmation: Story = {}
