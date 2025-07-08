import { Analytic, Product } from "~/types";
import { columns } from "./analytics-products-table/columns";
import { AnalyticsItemsTable } from "./analytics-data-table/data-table";
import { groupProductViewsByDay } from "./utils";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Id } from "~/convex/_generated/dataModel";
import { AnalyticsProductsTable } from "./analytics-products-table/data-table";

export interface AnalyticProduct {
  productId: string;
  views: number;
  product: Product;
  lastViewed: number;
  productSku: string;
}

export default function AnalyticsProducts({ items }: { items: Analytic[] }) {
  const productViews = groupProductViewsByDay(items, { groupByDay: false }) as {
    productId: string;
    productSku: string;
    views: number;
    lastViewed: number;
  }[];

  const ids = productViews.map((item) => item.productId) as Id<"product">[];

  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.batchGet,
    activeStore?._id ? { storeId: activeStore._id, ids } : "skip"
  );

  // Combine product views with product details
  const combinedData: AnalyticProduct[] = products
    ? productViews.map((view) => {
        const product = products.find((p) => p?._id === view.productId);
        return {
          ...view,
          product: product || null,
        };
      })
    : [];

  const data = combinedData
    .filter((p) => !!p.product?.name)
    .sort((a, b) => b.views - a.views);

  return (
    <div className="container mx-auto">
      <div className="py-8">
        <AnalyticsProductsTable data={data} columns={columns} />
      </div>
    </div>
  );
}
