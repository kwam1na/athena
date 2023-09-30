import prismadb from '@/lib/prismadb';

export const getTotalRevenue = async (store_id: string) => {
    const paidOrders = await prismadb.order.findMany({
        where: {
            store_id,
            isPaid: true,
        },
        include: {
            order_items: {
                include: {
                    product: true,
                },
            },
        },
    });

    const totalRevenue = paidOrders.reduce((total, order) => {
        const orderTotal = order.order_items.reduce((orderSum, item) => {
            return orderSum + item.product.price.toNumber();
        }, 0);
        return total + orderTotal;
    }, 0);

    return totalRevenue;
};
