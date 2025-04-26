import { BagsTable } from "./user-bags-table/bags-table";
import { bagColumns } from "./user-bags-table/bag-columns";

export default function Bags() {
  return (
    <div className="container mx-auto">
      <div className="py-8">
        <BagsTable columns={bagColumns} />
      </div>
    </div>
  );
}
