import { BagItem } from "~/types";
import { columns } from "./user-bags-table/columns";
import { BagItemsTable } from "./user-bags-table/data-table";

export default function BagItems({ items }: { items: BagItem[] }) {
  return (
    <div className="container mx-auto">
      <div className="py-8">
        <BagItemsTable data={items} columns={columns} />
      </div>
    </div>
  );
}
