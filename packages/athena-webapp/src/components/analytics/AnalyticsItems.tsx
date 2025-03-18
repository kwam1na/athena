import { Analytic, BagItem } from "~/types";
import { columns } from "./analytics-data-table/columns";
import { AnalyticsItemsTable } from "./analytics-data-table/data-table";

export default function AnalyticsItems({ items }: { items: Analytic[] }) {
  return (
    <div className="container mx-auto">
      <div className="py-8">
        <AnalyticsItemsTable data={items} columns={columns} />
      </div>
    </div>
  );
}
