import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import Spinner from "@/components/ui/spinner"
import { Toaster } from "@/components/ui/sonner"

import { StorybookCallout, StorybookSection, StorybookShell } from "../storybook-shell"

function FeedbackShowcase() {
  useEffect(() => {
    toast("Inventory synced", {
      description: "The toast surface uses Athena tokens in dark and light themes.",
    })
  }, [])

  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Feedback"
      description="Skeletons, spinners, and toast surfaces show progress without breaking the visual contract."
    >
      <StorybookSection
        title="Skeleton loading"
        description="Shimmer placeholders keep cards and form areas stable while data arrives."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-[calc(var(--radius)*1.2)] border border-border bg-surface-raised p-layout-md shadow-surface">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-5/6" />
          </div>
          <StorybookCallout title="Loading rhythm">
            The placeholder shape should match the finished layout so the page does not jump when data resolves.
          </StorybookCallout>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Spinner sizes"
        description="Spinners need to work in compact controls, loading panes, and larger blank states."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid place-items-center gap-2 rounded-md border border-border bg-surface-raised p-layout-md">
            <Spinner size="sm" />
            <span className="text-xs text-muted-foreground">Small</span>
          </div>
          <div className="grid place-items-center gap-2 rounded-md border border-border bg-surface-raised p-layout-md">
            <Spinner />
            <span className="text-xs text-muted-foreground">Default</span>
          </div>
          <div className="grid place-items-center gap-2 rounded-md border border-border bg-surface-raised p-layout-md">
            <Spinner size="lg" />
            <span className="text-xs text-muted-foreground">Large</span>
          </div>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Toast surface"
        description="The toaster is mounted once, while real product actions trigger the actual toast copy."
      >
        <div className="grid gap-4">
          <Toaster expand />
          <Button
            onClick={() =>
              toast("Saved to draft", {
                description: "Click the button to retrigger the toast in Storybook.",
              })
            }
          >
            Trigger toast
          </Button>
        </div>
      </StorybookSection>
    </StorybookShell>
  )
}

const meta = {
  title: "Primitives/Feedback",
  component: FeedbackShowcase,
} satisfies Meta<typeof FeedbackShowcase>

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
