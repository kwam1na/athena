import prismadb from '@/lib/prismadb';

export const createSKUCounter = async (data: any) => {
    return await prismadb.sKUCounter.create({
        data,
    });
}

export const getSKUCounter = async (categoryId: string, subcategoryId: string) => {
    return await prismadb.sKUCounter.findFirst({
        where: {
            category_id: categoryId,
            subcategory_id: subcategoryId,
        },
    })
}

export const updateSKUCounter = async (id: string, data: any) => {
    return await prismadb.sKUCounter.update({
        where: {
            id,
        },
        data,
    })
}
