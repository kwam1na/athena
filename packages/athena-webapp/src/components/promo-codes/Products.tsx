import { selectableProductColumns } from "./selectable-products-table/columns";
import { SelectableProductsTable } from "./selectable-products-table/data-table";

export default function Products({ products }: { products: any[] }) {
  return (
    <div className="container mx-auto">
      <div className="py-8">
        <SelectableProductsTable
          data={products}
          columns={selectableProductColumns}
        />
      </div>
    </div>
  );
}
