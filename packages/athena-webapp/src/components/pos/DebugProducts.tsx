import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import useGetActiveStore from "@/hooks/useGetActiveStore";

export function DebugProducts() {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore) {
    return (
      <div className="p-4 bg-yellow-100 rounded">No active store found</div>
    );
  }

  return (
    <div className="p-4 bg-gray-100 rounded space-y-4">
      <h3 className="font-bold">Debug: Store Products</h3>
      <div>
        <p>
          <strong>Store:</strong> {activeStore.name} (ID: {activeStore._id})
        </p>
      </div>

      <div>
        <h4 className="font-semibold">Products ({products?.length || 0}):</h4>
        {products?.slice(0, 3).map((product: any) => (
          <div key={product._id} className="text-sm">
            • {product.name} - {product.availability}
          </div>
        ))}
      </div>
    </div>
  );
}
