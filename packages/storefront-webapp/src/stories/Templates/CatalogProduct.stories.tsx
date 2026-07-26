import type { Meta, StoryObj } from "@storybook/react-vite";

import placeholder from "@/assets/placeholder.png";
import { StorefrontPage } from "@/components/common/StorefrontPage";
import { PageState } from "@/components/states/PageState";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { StorefrontImage } from "@/components/ui/storefront-image";

const catalogItems = [
  { name: "Silk Press Bundle", price: "$128", status: "Low inventory" },
  { name: "Everyday Wave", price: "$96", status: "Offer" },
  { name: "Signature Sleek", price: "$144", status: "Sold out" },
  { name: "Weekend Curl", price: "$112", status: null },
] as const;

function CatalogProductMatrix() {
  return (
    <StorefrontPage
      aria-labelledby="catalog-product-heading"
      className="space-y-layout-xl"
    >
      <header className="max-w-2xl space-y-layout-xs">
        <p className="text-sm font-medium text-muted-foreground">
          Synthetic fixture
        </p>
        <h1 id="catalog-product-heading" className="text-3xl font-semibold">
          Catalog and product
        </h1>
        <p className="text-muted-foreground">
          One responsive composition for merchandise, inventory, media, and
          commerce-action states.
        </p>
      </header>

      <section aria-labelledby="catalog-heading" className="space-y-layout-md">
        <h2 id="catalog-heading" className="text-xl font-semibold">
          Responsive catalog
        </h2>
        <div className="grid grid-cols-2 gap-layout-md md:grid-cols-3 xl:grid-cols-4">
          {catalogItems.map((item, index) => (
            <article key={item.name} className="space-y-layout-sm">
              <StorefrontImage
                alt={`${item.name} product`}
                aspectRatio="1 / 1"
                src={
                  index === 3 ? "/synthetic-missing-product.jpg" : placeholder
                }
                wrapperClassName="rounded-card"
              />
              <div className="space-y-layout-xs">
                {item.status === "Low inventory" && (
                  <StatusBadge tone="warning">Low inventory</StatusBadge>
                )}
                {item.status === "Offer" && (
                  <StatusBadge tone="info">Offer</StatusBadge>
                )}
                {item.status === "Sold out" && (
                  <StatusBadge tone="danger">Sold out</StatusBadge>
                )}
                <h3 className="font-medium">{item.name}</h3>
                <p className="text-sm text-muted-foreground">{item.price}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="product-actions-heading"
        className="grid gap-layout-md rounded-card border border-border bg-surface-raised p-layout-md md:grid-cols-2"
      >
        <div className="space-y-layout-sm">
          <StatusBadge tone="warning">Only 2 left</StatusBadge>
          <h2 id="product-actions-heading" className="text-2xl font-semibold">
            Signature Sleek
          </h2>
          <p className="text-muted-foreground">$144 · 22 inches</p>
        </div>
        <div className="flex items-end gap-layout-sm">
          <Button className="flex-1">Add to bag</Button>
          <Button variant="outline">Save</Button>
          <Button disabled>Sold out</Button>
        </div>
      </section>

      <div className="grid gap-layout-md md:grid-cols-3">
        <PageState inline state="loading" title="Loading products" />
        <PageState
          inline
          state="empty"
          title="No products found"
          description="Try clearing a filter."
        />
        <PageState
          inline
          state="error"
          title="Products unavailable"
          description="Try again in a moment."
        />
      </div>
    </StorefrontPage>
  );
}

const meta = {
  title: "Templates/Catalog and Product",
  component: CatalogProductMatrix,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CatalogProductMatrix>;

export default meta;

type Story = StoryObj<typeof meta>;

export const StateAndResponsiveMatrix: Story = {};
