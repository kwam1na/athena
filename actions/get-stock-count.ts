import prismadb from '@/lib/prismadb';

export const getStockCount = async (storeId: number) => {
    const totalCount = await prismadb.product.aggregate({
        where: {
            store_id: storeId,
            is_archived: false,
        },
        _sum: {
            inventory_count: true,
        },
    });

    return totalCount._sum.inventory_count || 0;
};
