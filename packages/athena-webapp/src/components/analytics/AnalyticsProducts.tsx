import { Product } from "~/types";
import { columns } from "./analytics-products-table/columns";
import { AnalyticsProductsTable } from "./analytics-products-table/data-table";

export interface AnalyticProduct {
  productId: string;
  views: number;
  product: Product;
  lastViewed: number;
  productSku: string;
}

export default function AnalyticsProducts({
  items,
}: {
  items: AnalyticProduct[];
}) {
  return (
    <AnalyticsProductsTable
      data={items}
      columns={columns}
      tableId="analytics-products"
    />
  );
}
