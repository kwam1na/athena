import prismadb from '@/lib/prismadb';

export const createTransaction = async (data: any) => {
    return await prismadb.transaction.create({
        data
    })
}

export const getTransaction = async (id: string, attr?: Record<string, any>) => {
    return await prismadb.transaction.findUnique({
        where: {
            id,
            ...attr,
        },
        include: {
            transaction_items: true,
        }
    })
}

export const updateTransaction = async (id: string, data: any) => {

    return await prismadb.transaction.update({
        where: {
            id
        },
        data
    })
}


export const deleteTransaction = async (id: string) => {
    return await prismadb.transaction.delete({
        where: {
            id,
        },
    })
}


export const fetchTransactions = async ({ dateRange, ...restKeys }: { store_id: string; dateRange?: { start: Date, end: Date }, [key: string]: any }) => {
    const dateFilter = dateRange ? {
        AND: [
            {
                transaction_date: {
                    gte: dateRange.start,
                },
            },
            {
                transaction_date: {
                    lte: dateRange.end,
                },
            },
        ],
    } : {};

    return await prismadb.transaction.findMany({
        where: {
            ...restKeys,
            ...dateFilter,
        },
        orderBy: {
            created_at: 'desc',
        },
        include: {
            transaction_items: true,
        },
    });
};