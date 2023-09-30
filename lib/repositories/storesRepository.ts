import prismadb from '@/lib/prismadb';

export const createStore = async (data: any) => {
    return await prismadb.store.create({
        data,
    });
}

export const getStore = async (id: string) => {
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

export const updateStore = async (id: string, user_id: string, data: any) => {
    return await prismadb.store.updateMany({
        where: {
            id,
            user_id,
        },
        data,
    })
}

export const deleteStore = async (id: string, user_id: string) => {
    return await prismadb.store.deleteMany({
        where: {
            id,
            user_id,
        },
    })
}

// export const fetchStores = async (storeId: string) => {
//     return await prismadb.store.findMany({
//         where: {
//             storeId,
//         },
//         include: {
//             products: true
//         }
//     });
// }