import { BagsTable } from "./user-bags-table/bags-table";
import { bagColumns } from "./user-bags-table/bag-columns";

export default function Bags({ items }: { items: any[] }) {
  return (
    <div className="container mx-auto">
      <div className="py-8">
        <BagsTable data={items} columns={bagColumns} />
      </div>
    </div>
  );
}
