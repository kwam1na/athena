import prismadb from '@/lib/prismadb';

export const createSize = async (data: any) => {
    return await prismadb.size.create({
        data,
    });
}

export const getSize = async (id: string) => {
    return await prismadb.size.findUnique({
        where: {
            id,
        },
        include: {
            products: true,
        },
    })
}

export const updateSize = async (id: string, data: any) => {
    return await prismadb.size.update({
        where: {
            id,
        },
        data,
    })
}

export const deleteSize = async (id: string) => {
    return await prismadb.size.delete({
        where: {
            id,
        },
    })
}

export const fetchSizes = async (store_id: string, include?: Record<string, boolean>) => {
    return await prismadb.size.findMany({
        where: {
            store_id,
        },
        include,
    });
}