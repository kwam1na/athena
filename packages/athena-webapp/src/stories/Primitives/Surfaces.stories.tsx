import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ScrollArea,
} from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

import { StorybookCallout, StorybookSection, StorybookShell } from "../storybook-shell"

function SurfacesShowcase() {
  return (
    <StorybookShell
      eyebrow="Primitives"
      title="Surfaces"
      description="Cards, tabs, tables, and scroll areas structure the app's denser information views without switching visual language."
    >
      <StorybookSection
        title="Card rhythm"
        description="Cards hold summary metrics, forms, and panel content across Athena."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Daily revenue</CardTitle>
              <CardDescription>Simple content card with supporting text.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight text-foreground">
                GH₵ 24,180
              </div>
            </CardContent>
            <CardFooter className="justify-between text-sm text-muted-foreground">
              <span>Compared with yesterday</span>
              <span>+12.4%</span>
            </CardFooter>
          </Card>
          <StorybookCallout title="Surface elevation">
            The card uses the Athena surface tokens, so the same shape reads cleanly in light and dark themes.
          </StorybookCallout>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Tabs"
        description="Tabs keep the current context visible while moving between adjacent views."
      >
        <div className="grid gap-4">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="rounded-md border border-border bg-surface-raised p-layout-md">
              Overview content
            </TabsContent>
            <TabsContent value="history" className="rounded-md border border-border bg-surface-raised p-layout-md">
              History content
            </TabsContent>
            <TabsContent value="settings" className="rounded-md border border-border bg-surface-raised p-layout-md">
              Settings content
            </TabsContent>
          </Tabs>
          <Tabs defaultValue="compact" className="w-full">
            <TabsList size="sm">
              <TabsTrigger size="sm" value="compact">
                Compact
              </TabsTrigger>
              <TabsTrigger size="sm" value="comfortable">
                Comfortable
              </TabsTrigger>
            </TabsList>
            <TabsContent value="compact" className="rounded-md border border-border bg-surface-raised p-layout-md">
              Compact tabs show the new shared size scale.
            </TabsContent>
            <TabsContent value="comfortable" className="rounded-md border border-border bg-surface-raised p-layout-md">
              Comfortable tabs leave room for longer labels.
            </TabsContent>
          </Tabs>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Tables"
        description="Tables document the selected-row treatment and the spacing used in operational data views."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow data-state="selected">
              <TableCell>Starter kit</TableCell>
              <TableCell>Ready</TableCell>
              <TableCell className="text-right">GH₵ 120</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Promo bundle</TableCell>
              <TableCell>Draft</TableCell>
              <TableCell className="text-right">GH₵ 80</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </StorybookSection>

      <StorybookSection
        title="Scrollable detail panels"
        description="Scroll areas keep long filter lists and side panels visually contained."
      >
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <ScrollArea className="h-48 rounded-md border border-border">
            <div className="space-y-3 p-layout-md">
              {Array.from({ length: 12 }, (_, index) => (
                <div
                  key={index}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground"
                >
                  Scroll item {index + 1}
                </div>
              ))}
            </div>
          </ScrollArea>
          <StorybookCallout title="Contained overflow">
            The scroll area keeps the viewport steady while still allowing dense lists to be scanned.
          </StorybookCallout>
        </div>
      </StorybookSection>
    </StorybookShell>
  )
}

const meta = {
  title: "Primitives/Surfaces",
  component: SurfacesShowcase,
} satisfies Meta<typeof SurfacesShowcase>

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
