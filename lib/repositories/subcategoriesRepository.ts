import prismadb from '@/lib/prismadb';

export const createSubategory = async (data: any) => {
    return await prismadb.subcategory.create({
        data,
    });
}

export const getSubcategory = async (id: string) => {
    return await prismadb.subcategory.findUnique({
        where: {
            id,
        },
        include: {
            category: true,
            products: true,
        },
    })
}

export const updateSubcategory = async (id: string, data: any) => {
    return await prismadb.subcategory.update({
        where: {
            id,
        },
        data,
    })
}

export const deleteSubcategory = async (id: string) => {
    return await prismadb.subcategory.delete({
        where: {
            id,
        },
    })
}

export const fetchSubcategories = async (store_id: string) => {
    return await prismadb.subcategory.findMany({
        where: {
            store_id,
        },
        include: {
            category: true,
            products: true
        }
    });
}