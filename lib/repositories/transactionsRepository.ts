import prismadb from '@/lib/prismadb';
import { Transaction } from '@prisma/client';

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

export const fetchTransactions = async (keys: { store_id: string;[key: string]: any }) => {
    return await prismadb.transaction.findMany({
        where: keys,
        orderBy: {
            created_at: 'desc',
        },
        include: {
            transaction_items: true
        }
    });
}