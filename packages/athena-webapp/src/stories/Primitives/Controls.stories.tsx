import type { Meta, StoryObj } from "@storybook/react-vite"
import { CircleAlert, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { StorybookCallout, StorybookPillRow, StorybookSection, StorybookShell } from "../storybook-shell"

function ControlsShowcase() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Controls"
      description="Action buttons, badges, and form controls share one Athena sizing rhythm so dense product flows stay readable."
    >
      <StorybookSection
        title="Action hierarchy"
        description="These states match the real app: primary actions, quiet affordances, destructive actions, and compact icon buttons."
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="workflow">Workflow</Button>
            <Button variant="workflow-soft">Selected workflow</Button>
            <Button variant="utility">Utility</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="link">Inline link</Button>
            <Button size="icon" aria-label="Open settings">
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <StorybookPillRow
            items={[
              "Default / sm / lg / icon",
              "Disabled states",
              "Link and destructive variants",
            ]}
          />
        </div>
      </StorybookSection>

      <StorybookSection
        title="Status labels"
        description="Badges show the small, real-world labels that appear in tables, cards, and filter chips."
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge>Live</Badge>
            <Badge variant="secondary">Queued</Badge>
            <Badge variant="outline">Draft</Badge>
            <Badge variant="destructive">Blocked</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge size="sm">Small</Badge>
            <Badge>Default</Badge>
            <Badge size="lg">Large</Badge>
          </div>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Form density"
        description="Inputs, textareas, and selects now use the same compact / default / comfortable size scale."
      >
        <div className="grid gap-4">
          <StorybookCallout title="Search and details">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">Search</label>
                <Input placeholder="Find products, orders, or customers" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">Compact search</label>
                <Input size="sm" placeholder="Compact" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">Comfortable search</label>
                <Input size="lg" placeholder="Comfortable" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">Billing cadence</label>
                <Select defaultValue="weekly" defaultOpen>
                  <SelectTrigger aria-label="Billing cadence">
                    <SelectValue placeholder="Choose cadence" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 md:col-span-2">
                <label className="text-sm font-medium text-foreground">Notes</label>
                <Textarea placeholder="Add context for the next handoff" />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <label className="text-sm font-medium text-foreground">Compact notes</label>
                <Textarea size="sm" placeholder="Tighter note field" />
              </div>
            </div>
          </StorybookCallout>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Choice controls"
        description="Switches, toggles, toggle groups, radios, and separators document the on/off and segmented choices used throughout Athena."
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <Switch defaultChecked aria-label="Enable shipping" />
            <Toggle pressed aria-label="Pin to dashboard">
              <CircleAlert className="h-4 w-4" />
            </Toggle>
            <ToggleGroup type="single" defaultValue="left">
              <ToggleGroupItem value="left">Left</ToggleGroupItem>
              <ToggleGroupItem value="center">Center</ToggleGroupItem>
              <ToggleGroupItem value="right">Right</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid gap-3 rounded-[calc(var(--radius)*1.2)] border border-border bg-surface-raised p-layout-md shadow-surface md:grid-cols-[1fr_auto_1fr] md:items-center">
            <RadioGroup
              value="standard"
              onValueChange={() => undefined}
              className="flex gap-3"
            >
              <label className="flex items-center gap-2 text-sm text-foreground">
                <RadioGroupItem value="standard" />
                Standard
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <RadioGroupItem value="express" />
                Express
              </label>
            </RadioGroup>
            <Separator orientation="vertical" className="hidden h-6 md:block" />
            <StorybookCallout title="Segmented controls">
              Toggle groups and radio groups appear in modals, filters, and checkout flows.
            </StorybookCallout>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>Primary choice</span>
            <Separator className="max-w-28" />
            <span>Secondary detail</span>
          </div>
        </div>
      </StorybookSection>
    </StorybookShell>
  )
}

const meta = {
  title: "Primitives/Controls",
  component: ControlsShowcase,
} satisfies Meta<typeof ControlsShowcase>

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
