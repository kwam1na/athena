import { Analytic, BagItem } from "~/types";
import { analyticsColumns } from "./analytics-data-table/analytics-columns";
import { AnalyticsItemsTable } from "./analytics-data-table/data-table";
import { GenericDataTable } from "../base/table/data-table";

export default function AnalyticsItems({ items }: { items: Analytic[] }) {
  return (
    <div className="container mx-auto">
      <div className="py-8">
        <GenericDataTable data={items} columns={analyticsColumns} />
      </div>
    </div>
  );
}
