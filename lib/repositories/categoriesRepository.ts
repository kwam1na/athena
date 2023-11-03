import prismadb from '@/lib/prismadb';

export const createCategory = async (data: any) => {
    return await prismadb.category.create({
        data,
    });
}

export const getCategory = async (id: string) => {
    return await prismadb.category.findUnique({
        where: {
            id,
        },
        include: {
            subcategory: true,
            products: true,
        },
    })
}

export const updateCategory = async (id: string, data: any) => {
    return await prismadb.category.update({
        where: {
            id,
        },
        data,
    })
}

export const deleteCategory = async (id: string) => {
    return await prismadb.category.delete({
        where: {
            id,
        },
    })
}

export const fetchCategories = async (store_id: number) => {
    return await prismadb.category.findMany({
        where: {
            store_id,
        },
        include: {
            subcategory: true,
            products: true
        }
    });
}