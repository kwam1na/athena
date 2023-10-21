import { fetchProducts } from "@/lib/repositories/productsRepository";

export const getLowStockProducts = async (storeId: string, threshold: number = 5) => {
    return await fetchProducts({
        store_id: storeId,
        inventory_count: { lte: threshold }
    });
}