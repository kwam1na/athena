import prismadb from '@/lib/prismadb';

export const createColor = async (data: any) => {
    return await prismadb.color.create({
        data,
    });
}

export const getColor = async (id: string) => {
    return await prismadb.color.findUnique({
        where: {
            id,
        },
        include: {
            products: true,
        },
    })
}

export const updateColor = async (id: string, data: any) => {
    return await prismadb.color.update({
        where: {
            id,
        },
        data,
    })
}

export const deleteColor = async (id: string) => {
    return await prismadb.color.delete({
        where: {
            id,
        },
    })
}

export const fetchColors = async (store_id: string) => {
    return await prismadb.color.findMany({
        where: {
            store_id,
        },
        include: {
            products: true
        }
    });
}