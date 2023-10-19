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

export const fetchProducts = async (keys: { store_id: string; inventory_count?: { lte?: number, gte?: number };[key: string]: any }) => {

    const { store_id, sku, product_name, inventory_count, ...rest } = keys;

    const where: any = {
        store_id,
        ...rest
    };

    if (sku || product_name) {
        where.OR = [
            { sku: { contains: sku, mode: "insensitive" } },
            { name: { contains: product_name, mode: "insensitive" } }
        ];
    }

    if (inventory_count) {
        if (inventory_count.lte) {
            where.inventory_count = { lte: inventory_count.lte };
        } else if (inventory_count.gte) {
            where.inventory_count = { gte: inventory_count.gte };
        }
    }

    return await prismadb.product.findMany({
        where,
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