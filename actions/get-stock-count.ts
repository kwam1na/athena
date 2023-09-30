import prismadb from '@/lib/prismadb';

export const getStockCount = async (storeId: string) => {
    const totalCount = await prismadb.product.aggregate({
        where: {
            store_id: storeId,
            is_archived: false,
        },
        _sum: {
            count: true,
        },
    });

    return totalCount._sum.count || 0;
};
