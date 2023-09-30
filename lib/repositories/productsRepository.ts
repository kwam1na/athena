import prismadb from '@/lib/prismadb';

export const createProduct = async (data: any) => {
    return await prismadb.product.create({
        data
    })
}

export const getProduct = async (id: string) => {
    return await prismadb.product.findUnique({
        where: {
            id,
        },
        include: {
            images: true,
            category: true,
            subcategory: true,
            size: true,
            color: true,
        },
    })
}

export const updateProduct = async (id: string, data: any) => {

    // TODO: add support for images
    return await prismadb.product.update({
        where: {
            id
        },
        data
    })
}


export const deleteProduct = async (id: string) => {
    return await prismadb.product.delete({
        where: {
            id,
        },
    })
}

export const fetchProducts = async (keys: { store_id: string; category_id?: string; color_id?: string; size_id?: string; is_featured?: boolean; is_archived?: boolean }) => {
    return await prismadb.product.findMany({
        where: keys,
        include: {
            category: true,
            subcategory: true,
            size: true,
            color: true,
        },
        orderBy: {
            created_at: 'desc',
        },
    });
}