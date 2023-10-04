import prismadb from '@/lib/prismadb';

export const createTransactionItem = async (data: any) => {
    return await prismadb.transactionItem.create({
        data
    })
}

export const getTransactionItem = async (id: string) => {
    return await prismadb.transactionItem.findUnique({
        where: {
            id,
        }
    })
}

export const findTransactionItem = async (keys: any) => {
    return await prismadb.transactionItem.findFirst({
        where: keys,
    })
}

export const updateTransactionItem = async (id: string, data: any) => {

    return await prismadb.transactionItem.update({
        where: {
            id
        },
        data
    })
}


export const deleteTransactionItem = async (id: string) => {
    return await prismadb.transactionItem.delete({
        where: {
            id,
        },
    })
}

export const fetchTransactionItems = async (keys: { store_id: string;[key: string]: any }) => {
    return await prismadb.transactionItem.findMany({
        where: keys,
        orderBy: {
            created_at: 'desc',
        },
    });
}