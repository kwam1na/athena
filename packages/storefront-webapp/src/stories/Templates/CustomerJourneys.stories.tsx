import type { Meta, StoryObj } from "@storybook/react-vite";
import { Banknote, PackageCheck } from "lucide-react";

import { StorefrontPage } from "@/components/common/StorefrontPage";
import { PageState } from "@/components/states/PageState";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusBadge } from "@/components/ui/status-badge";

const fixture = {
  customer: "Ama",
  orderNumber: "SYNTH-1042",
  points: 420,
} as const;

function CustomerJourneys() {
  return (
    <div className="space-y-layout-3xl bg-canvas">
      <StorefrontPage aria-labelledby="account-fixture-heading">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">Account fixture</p>
          <h1 id="account-fixture-heading" className="text-2xl font-semibold">
            Hi, {fixture.customer}.
          </h1>
        </header>
        <div className="mt-layout-lg grid gap-layout-lg md:grid-cols-2">
          <section className="space-y-2 rounded-lg border bg-surface p-6">
            <h2 className="font-medium">Contact information</h2>
            <p className="text-sm text-muted-foreground">
              ama.fixture@example.test
            </p>
            <Button variant="outline">Edit contact details</Button>
          </section>
          <section className="space-y-2 rounded-lg border bg-surface p-6">
            <h2 className="font-medium">Reward points</h2>
            <p className="font-numeric text-3xl">{fixture.points}</p>
            <StatusBadge tone="success">Available</StatusBadge>
          </section>
        </div>
      </StorefrontPage>

      <StorefrontPage aria-labelledby="order-fixture-heading">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Order fixture</p>
            <h2 id="order-fixture-heading" className="text-2xl font-semibold">
              Order {fixture.orderNumber}
            </h2>
          </div>
          <StatusBadge tone="success">
            <PackageCheck aria-hidden="true" className="h-4 w-4" />
            Delivered
          </StatusBadge>
        </header>
        <InlineAlert tone="info" title="Payment">
          <span className="inline-flex items-center gap-2">
            <Banknote aria-hidden="true" className="h-4 w-4" />
            Cash payment collected
          </span>
        </InlineAlert>
      </StorefrontPage>

      <StorefrontPage aria-label="Customer state fixtures">
        <div className="grid gap-layout-lg md:grid-cols-2">
          <PageState
            state="empty"
            title="No saved items"
            description="Products saved for later will appear here."
            primaryAction={<Button>Browse products</Button>}
            inline
          />
          <PageState
            state="loading"
            title="Loading orders"
            description="We're retrieving recent purchases."
            inline
          />
        </div>
      </StorefrontPage>
    </div>
  );
}

const meta = {
  title: "Templates/Customer Journeys",
  component: CustomerJourneys,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CustomerJourneys>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SyntheticCustomerStates: Story = {};
