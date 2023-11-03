import prismadb from '@/lib/prismadb';

export const createStore = async (data: any) => {
    return await prismadb.store.create({
        data,
    });
}

export const getStore = async (id: number) => {
    return await prismadb.store.findUnique({
        where: {
            id,
        },
        include: {
            products: true,
        },
    })
}

export const findStore = async (keys: any) => {
    return await prismadb.store.findFirst({
        where: keys,
    })
}

export const updateStore = async (id: number, user_id: string, data: any) => {
    return await prismadb.store.updateMany({
        where: {
            id,
            created_by: user_id,
        },
        data,
    })
}

export const deleteStore = async (id: number, user_id: string) => {
    return await prismadb.store.deleteMany({
        where: {
            id,
            created_by: user_id,
        },
    })
}

export const fetchStores = async (userId: string, include?: Record<string, boolean>) => {
    return await prismadb.store.findMany({
        where: {
            created_by: userId,
        },
        include,
    });
}