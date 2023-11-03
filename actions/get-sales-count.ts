import prismadb from '@/lib/prismadb';

export const getSalesCount = async (storeId: number) => {
    const salesCount = await prismadb.order.count({
        where: {
            store_id: storeId,
            isPaid: true,
        },
    });

    return salesCount;
};
