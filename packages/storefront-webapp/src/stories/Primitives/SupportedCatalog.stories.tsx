import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { StorefrontImage } from "@/components/ui/storefront-image";
import {
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

const sampleImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='currentColor'/%3E%3C/svg%3E";

function SupportedCatalog() {
  return (
    <StorybookShell
      eyebrow="Supported"
      title="Supported primitive catalog"
      description="These components have focused contracts and are safe for new storefront work."
    >
      <StorybookSection
        title="Actions"
        description="Named, focusable actions preserve minimum target geometry and reject repeat activation while busy."
      >
        <div className="flex flex-wrap items-center gap-layout-sm">
          <Button>Continue</Button>
          <IconButton label="Save item">
            <span aria-hidden="true">♡</span>
          </IconButton>
          <LoadingButton isLoading>Place order</LoadingButton>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Fields and feedback"
        description="Field relationships and semantic feedback remain available to assistive technology."
      >
        <div className="grid gap-layout-sm sm:grid-cols-2">
          <Field label="Email" hint="Used for order updates.">
            <Input type="email" placeholder="name@example.com" />
          </Field>
          <div className="space-y-layout-sm">
            <StatusBadge tone="warning">Low inventory</StatusBadge>
            <InlineAlert tone="info" title="Pickup available">
              Choose a location during checkout.
            </InlineAlert>
          </div>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Media and overlays"
        description="Images terminate fallback loops, while overlays own naming, focus, Escape, and restoration."
      >
        <div className="grid gap-layout-lg sm:grid-cols-2">
          <StorefrontImage
            src={sampleImage}
            alt="Neutral product placeholder"
            className="aspect-square w-32 rounded-lg object-cover"
          />
          <div className="flex flex-wrap items-start gap-layout-sm">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Product details</DialogTitle>
                <DialogDescription>
                  A named dialog restores focus when it closes.
                </DialogDescription>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>Your bag</SheetTitle>
                <SheetDescription>
                  A responsive overlay for supporting content.
                </SheetDescription>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Primitives/Supported Catalog",
  component: SupportedCatalog,
} satisfies Meta<typeof SupportedCatalog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
